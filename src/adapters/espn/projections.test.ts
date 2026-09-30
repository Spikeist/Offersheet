/**
 * ESPN's league-scored weekly projections (CLAUDE.md §6 step 1, "ESPN leagues") on Parker's sanitized
 * fixtures, with no network. The fixtures are refreshed whenever the ESPN probe re-runs, so the
 * expected values are read from the fixtures themselves, restating the rule independently.
 */
import { describe, expect, it } from "vitest";
import type { HttpClient, HttpRequestOptions, HttpResponse } from "@/adapters/types";
import type { LeagueSnapshot, PlayerInfo } from "@/engine/model";
import { importEspnLeague, importEspnLeagueForModel } from ".";
import { normalizeEspnLeague, type EspnRawBundle } from "./normalize";
import { espnProjectionsFrom } from "./projections";
import { FA_POSITIONS, LABELS, NOW, PARKER, fakeResolver, parkerBundle, parkerCards, readEspn } from "./test-helpers";

interface Line {
  seasonId: number;
  statSourceId: number;
  statSplitTypeId: number;
  scoringPeriodId: number;
  stats?: Record<string, number> | null;
  appliedTotal?: number | null;
}
interface RawPlayer {
  id: number;
  defaultPositionId: number;
  stats?: Line[] | null;
}
interface RawLeague {
  teams: Array<{ roster?: { entries: Array<{ playerPoolEntry: { player: RawPlayer } }> } | null }>;
  settings: { scoringSettings: { scoringItems: Array<{ statId: number; points: number; pointsOverrides?: Record<string, number> | null }> } };
}

const bundle = parkerBundle();
const { snapshot } = normalizeEspnLeague(bundle, { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW, swid: PARKER.swid });
const espn = espnProjectionsFrom(bundle, snapshot);

const league = readEspn<RawLeague>(LABELS.league);
const rosteredRaw = league.teams.flatMap((t) => (t.roster?.entries ?? []).map((e) => e.playerPoolEntry.player));
const poolRaw = FA_POSITIONS.flatMap((pos) => readEspn<{ players: Array<{ player: RawPlayer }> }>(LABELS.fa(pos)).players.map((x) => x.player));
/** ESPN id → the snapshot's canonical id. */
const idOf = new Map(Object.entries(snapshot.players).map(([id, p]) => [p.ids.espn, id]));
/** This season's weekly projection lines: statSourceId 1 (projected), statSplitTypeId 1 (one week). */
const weeklyLines = (p: RawPlayer) => (p.stats ?? []).filter((l) => l.seasonId === PARKER.season && l.statSourceId === 1 && l.statSplitTypeId === 1);
const hasStats = (l: Line) => Object.keys(l.stats ?? {}).length > 0;

describe("espnProjectionsFrom on Parker's league (§6 step 1, ESPN leagues)", () => {
  it("gives every rostered player ESPN's projection for the previous and the current week (3 and 4, from mRoster)", () => {
    expect(rosteredRaw.length).toBeGreaterThan(150);
    for (const p of rosteredRaw) {
      const id = idOf.get(String(p.id));
      expect(id, `ESPN player ${p.id}`).toBeDefined();
      expect(Object.keys(espn[id as string] ?? {}), `ESPN player ${p.id}`).toEqual([String(PARKER.currentWeek - 1), String(PARKER.currentWeek)]);
    }
  });

  it("gives the snapshot's free agents the current week (4), from the free-agent lists", () => {
    const byEspnId = new Map(poolRaw.map((p) => [String(p.id), p]));
    let covered = 0;
    for (const id of snapshot.freeAgents) {
      const raw = byEspnId.get(snapshot.players[id]?.ids.espn ?? "");
      expect(raw, id).toBeDefined();
      const weeks = weeklyLines(raw as RawPlayer).map((l) => l.scoringPeriodId);
      expect(weeks.every((w) => w === PARKER.currentWeek)).toBe(true);
      if (weeks.length) covered++;
      expect(espn[id] && Object.keys(espn[id])).toEqual(weeks.length ? [String(PARKER.currentWeek)] : undefined);
    }
    // The lists are requested for the current week, so nearly every free agent has its line.
    expect(covered).toBeGreaterThan(snapshot.freeAgents.length * 0.9);
  });

  it("uses ESPN's appliedTotal exactly, and reads an empty line (no stats) as null: not projected that week", () => {
    const empty = { rostered: 0, freeAgents: 0 };
    let values = 0;
    for (const [group, players] of [["rostered", rosteredRaw], ["freeAgents", poolRaw]] as const)
      for (const p of players) {
        const id = idOf.get(String(p.id));
        if (id === undefined) continue;
        for (const l of weeklyLines(p)) {
          const got = espn[id]?.[l.scoringPeriodId];
          if (!hasStats(l)) {
            expect(got, `ESPN player ${p.id}, week ${l.scoringPeriodId}`).toBeNull();
            empty[group]++;
          } else {
            expect(got, `ESPN player ${p.id}, week ${l.scoringPeriodId}`).toBe(l.appliedTotal === 0 ? null : l.appliedTotal);
            values++;
          }
        }
      }
    expect(values).toBeGreaterThan(300);
    // Injured players get empty lines on rosters (out, doubtful, IR) and in the free-agent pool.
    expect(empty.rostered).toBeGreaterThan(0);
    expect(empty.freeAgents).toBeGreaterThan(0);
  });

  it("reads points in THIS league's scoring: appliedTotal = Σ stat × scoring item, pointsOverrides replacing it by defaultPositionId", () => {
    const items = league.settings.scoringSettings.scoringItems;
    expect(items.some((i) => Object.keys(i.pointsOverrides ?? {}).length > 0)).toBe(true);
    const rescore = (l: Line, positionId: number) => items.reduce((sum, i) => sum + (l.stats?.[String(i.statId)] ?? 0) * (i.pointsOverrides?.[String(positionId)] ?? i.points), 0);
    let lines = 0;
    for (const p of [...rosteredRaw, ...poolRaw])
      for (const l of weeklyLines(p)) {
        expect(rescore(l, p.defaultPositionId), `ESPN player ${p.id}, week ${l.scoringPeriodId}`).toBeCloseTo(l.appliedTotal ?? 0, 6);
        lines++;
      }
    expect(lines).toBeGreaterThan(500);
  });

  it("maps ESPN ids to canonical ids through PlayerInfo.ids.espn (Sleeper ids, D/ST team codes)", () => {
    // 49ers D/ST: ESPN id −16025 → "SF".
    expect(snapshot.players.SF?.ids.espn).toBe("-16025");
    expect(espn.SF).toEqual({ 3: expect.any(Number), 4: expect.any(Number) });
    expect(Object.keys(espn).filter((id) => snapshot.players[id]?.ids.sleeper === id).length).toBeGreaterThan(150);
    // Whatever key the snapshot gives a player is the key his projections get.
    const [key, info] = Object.entries(snapshot.players).find(([id]) => typeof espn[id]?.[PARKER.currentWeek] === "number") as [string, PlayerInfo];
    const players: Record<string, PlayerInfo> = { ...snapshot.players, "custom:1": { ...info, id: "custom:1" } };
    delete players[key];
    const rekeyed = espnProjectionsFrom(bundle, { ...snapshot, players });
    expect(rekeyed["custom:1"]).toEqual(espn[key]);
    expect(rekeyed[key]).toBeUndefined();
  });

  it("skips players the snapshot doesn't carry (free agents outside the top 50 per position)", () => {
    expect(poolRaw.filter((p) => !idOf.has(String(p.id)) && weeklyLines(p).length > 0).length).toBeGreaterThan(0);
    expect(Object.keys(espn).every((id) => id in snapshot.players)).toBe(true);
    const dropped = snapshot.teams[0]?.roster[0] as string;
    expect(espn[dropped]).toBeDefined();
    const players = { ...snapshot.players };
    delete players[dropped];
    const without = espnProjectionsFrom(bundle, { ...snapshot, players });
    expect(without[dropped]).toBeUndefined();
    expect(Object.keys(without)).toHaveLength(Object.keys(espn).length - 1);
  });

  it("reads only this season's weekly projections: not week 3's actual lines, season lines or another season", () => {
    const actual = rosteredRaw.flatMap((p) => (p.stats ?? []).filter((l) => l.statSourceId === 0 && l.statSplitTypeId === 1 && hasStats(l)).map((l) => ({ p, l })));
    expect(actual.length).toBeGreaterThan(100);
    const differs = actual.find(({ p, l }) => weeklyLines(p).some((x) => x.scoringPeriodId === l.scoringPeriodId && hasStats(x) && x.appliedTotal !== l.appliedTotal));
    expect(differs).toBeDefined();
    const { p, l } = differs as (typeof actual)[number];
    expect(espn[idOf.get(String(p.id)) as string]?.[l.scoringPeriodId]).toBe(weeklyLines(p).find((x) => x.scoringPeriodId === l.scoringPeriodId)?.appliedTotal);
    for (const weeks of Object.values(espn)) expect(Object.keys(weeks).every((w) => Number(w) >= 1)).toBe(true);
    expect(espnProjectionsFrom(bundle, { ...snapshot, season: PARKER.season - 1 })).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------
// Hand-made bodies: the rule's edges and malformed input.

const testPlayer = (espnId: number): PlayerInfo => ({ id: `espn:${espnId}`, name: `Test Player ${espnId}`, pos: "WR", eligible: ["WR"], nflTeam: null, injury: "ACTIVE", ids: { espn: String(espnId) } });
const withPlayers = (...espnIds: number[]): LeagueSnapshot => ({ ...snapshot, players: Object.fromEntries(espnIds.map((e) => [`espn:${e}`, testPlayer(e)])) });
const line = (week: unknown, appliedTotal: unknown, stats: unknown = { "53": 4.2 }) => ({ seasonId: PARKER.season, statSourceId: 1, statSplitTypeId: 1, scoringPeriodId: week, stats, appliedTotal });
const player = (id: unknown, ...stats: unknown[]) => ({ id, stats });
const rosters = (...players: unknown[]) => ({ teams: [{ roster: { entries: players.map((p) => ({ playerPoolEntry: { player: p } })) } }] });
const pool = (...players: unknown[]) => ({ players: players.map((p) => ({ player: p })) });

describe("espnProjectionsFrom on hand-made bodies", () => {
  it("keeps appliedTotal as sent, negative included, and ignores actual lines, season lines, other splits and other seasons", () => {
    const raw: EspnRawBundle = {
      // Each ignored line carries a usable week, so only its source, split or season can rule it out.
      league: rosters(player(1, { ...line(3, 20), statSourceId: 0 }, { ...line(6, 150), statSplitTypeId: 0 }, { ...line(7, 140), statSplitTypeId: 2 }, { ...line(4, 11), seasonId: PARKER.season - 1 }, line(4, 9.53502864), line(5, -1.5))),
    };
    expect(espnProjectionsFrom(raw, withPlayers(1))).toEqual({ "espn:1": { 4: 9.53502864, 5: -1.5 } });
  });

  it("reads a line without numeric stats as null, whatever its appliedTotal, and a projection worth exactly 0 as null", () => {
    const raw: EspnRawBundle = {
      league: rosters(player(1, line(3, 0, {}), line(4, 0), line(5, 7, {}))),
      freeAgents: [pool(player(2, line(4, 0, { "53": "x" }))), pool(player(3, line(4, 0, null)), player(4, line(4, 0, undefined)))],
    };
    expect(espnProjectionsFrom(raw, withPlayers(1, 2, 3, 4))).toEqual({ "espn:1": { 3: null, 4: null, 5: null }, "espn:2": { 4: null }, "espn:3": { 4: null }, "espn:4": { 4: null } });
  });

  it("keeps the first line for a player's week, reading rosters before the free-agent lists", () => {
    const raw: EspnRawBundle = { league: rosters(player(1, line(4, 10), line(4, 99))), freeAgents: [pool(player(1, line(4, 20), line(5, 30))), pool(player(1, line(5, 40)))] };
    expect(espnProjectionsFrom(raw, withPlayers(1))).toEqual({ "espn:1": { 4: 10, 5: 30 } });
  });

  it("leaves out players without a single weekly projection line", () => {
    const raw: EspnRawBundle = { league: rosters(player(1), player(2, { ...line(3, 20), statSourceId: 0 }), { id: 3 }) };
    expect(espnProjectionsFrom(raw, withPlayers(1, 2, 3))).toEqual({});
  });

  it("skips malformed lines, players and responses without throwing, and keeps the good lines around them", () => {
    const good = line(4, 12.5);
    const bad = [null, "x", 3, [], {}, line(0, 5), line(-1, 5), line(1.5, 5), line("4", 5), line(5, 5, "x"), line(6, 5, []), line(7, "5"), line(8, undefined), line(9, null)];
    const raw: EspnRawBundle = {
      league: {
        teams: [null, 7, { roster: null }, { roster: { entries: "x" } }, { roster: { entries: [null, {}, { playerPoolEntry: null }, { playerPoolEntry: { player: null } }, { playerPoolEntry: { player: player("1", good) } }, { playerPoolEntry: { player: player(1, ...bad, good) } }] } }],
      },
      freeAgents: [null, "x", { players: null }, { players: [null, { player: 5 }, { player: { id: 2, stats: "x" } }, { player: player(2, line(4, 3.25)) }] }],
    };
    expect(espnProjectionsFrom(raw, withPlayers(1, 2))).toEqual({ "espn:1": { 4: 12.5 }, "espn:2": { 4: 3.25 } });
    for (const leagueBody of [undefined, null, "x", 42, [], {}, { teams: "x" }, { teams: {} }, { teams: [{ roster: { entries: {} } }] }])
      for (const freeAgents of [undefined, [], [null], { players: [] }] as unknown as Array<unknown[] | undefined>) expect(espnProjectionsFrom({ league: leagueBody, freeAgents }, withPlayers(1))).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------
// importEspnLeagueForModel, with Parker's fixtures served by a scripted HttpClient.

const json = (status: number, body: unknown): HttpResponse => ({ status, ok: status >= 200 && status < 300, isHtml: false, json: body, text: JSON.stringify(body), fromCache: false });
const FA_FILE: Record<number, string> = { 0: "QB", 2: "RB", 4: "WR", 6: "TE", 17: "K", 16: "D/ST" };
const filterOf = (opts: HttpRequestOptions) => JSON.parse(opts.headers?.["x-fantasy-filter"] ?? "{}") as { players?: { filterSlotIds?: { value: number[] }; filterIds?: { value: number[] } } };

/** Serves Parker's sanitized fixtures the way ESPN answers each request (as fetch.test.ts does), recording every request. */
function parkerHttp(): HttpClient & { calls: string[] } {
  const calls: string[] = [];
  const route = (url: string, opts: HttpRequestOptions): HttpResponse => {
    const u = new URL(url);
    const views = u.searchParams.getAll("view");
    if (views.includes("proTeamSchedules_wl")) return json(200, readEspn(LABELS.proSchedule));
    if (views.includes("mTransactions2")) return json(200, readEspn(LABELS.tx(Number(u.searchParams.get("scoringPeriodId")))));
    if (views.includes("kona_playercard")) {
      const ids = new Set(filterOf(opts).players?.filterIds?.value ?? []);
      return json(200, { players: parkerCards().players.filter((p) => ids.has(p.id)) });
    }
    if (views.includes("kona_player_info")) return json(200, readEspn(LABELS.fa(FA_FILE[filterOf(opts).players?.filterSlotIds?.value[0] as number] as string)));
    if (views.includes("mSettings")) return json(200, readEspn(LABELS.league));
    return json(404, { details: [{ type: "GENERAL_NOT_FOUND" }] });
  };
  return {
    calls,
    async get(url, opts = {}) {
      calls.push(`${url} ${opts.headers?.["x-fantasy-filter"] ?? ""}`);
      const res = route(url, opts);
      if (!opts.transformText || res.json === undefined) return res;
      const text = opts.transformText(res.text);
      return { ...res, text, json: JSON.parse(text) as unknown };
    },
  };
}

describe("importEspnLeagueForModel", () => {
  const req = { leagueId: PARKER.leagueId, season: PARKER.season, myTeamId: PARKER.myTeamId };

  it("returns exactly importEspnLeague's result plus ESPN's projections, from the same requests", async () => {
    const plainHttp = parkerHttp();
    const modelHttp = parkerHttp();
    const plain = await importEspnLeague(req, { http: plainHttp, resolver: fakeResolver(), now: NOW });
    const model = await importEspnLeagueForModel(req, { http: modelHttp, resolver: fakeResolver(), now: NOW });
    expect(model.result).toEqual(plain);
    expect(modelHttp.calls).toEqual(plainHttp.calls);
    expect(model.espn).toEqual(espnProjectionsFrom(parkerBundle(), model.result.snapshot));
    expect(Object.keys(model.espn).length).toBeGreaterThan(300);
  });

  it("fails exactly as importEspnLeague does when the league can't be read", async () => {
    const notFound: HttpClient = { get: async () => json(404, { details: [{ type: "GENERAL_NOT_FOUND" }] }) };
    const deps = { http: notFound, resolver: fakeResolver(), now: NOW };
    const plain = await importEspnLeague(req, deps).catch((e: unknown) => e);
    const model = await importEspnLeagueForModel(req, deps).catch((e: unknown) => e);
    expect(plain).toMatchObject({ name: "LeagueImportError", code: "LEAGUE_NOT_FOUND" });
    expect(model).toEqual(plain);
  });
});
