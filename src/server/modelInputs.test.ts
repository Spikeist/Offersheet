/**
 * Model inputs (CLAUDE.md §3, §5, §6, §9, §2.10): the pure assembly on hand-built loads and on Parker's
 * sanitized fixtures, and the loader sequence on fake HTTP clients. No network.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import { normalizeEspnLeague } from "@/adapters/espn/normalize";
import { espnProjectionsFrom } from "@/adapters/espn/projections";
import { fakeResolver as espnFakeResolver, NOW as ESPN_NOW, PARKER, parkerBundle } from "@/adapters/espn/test-helpers";
import { sleeperUrls } from "@/adapters/sleeper/fetch";
import type { SleeperStatRow } from "@/adapters/sleeper/schemas";
import type { HttpClient, HttpRequestOptions, HttpResponse } from "@/adapters/types";
import { FANTASYCALC_PLAYERS_URL, type FantasyCalcPlayerIds } from "@/data/fantasyCalcPlayers";
import { FANTASYCALC_DYNASTY_MIN_PLAYERS, FANTASYCALC_REDRAFT_MIN_PLAYERS, fantasyCalcValuesUrl, type FantasyCalcValueRow, type FantasyCalcValuesLoad } from "@/data/fantasyCalcValues";
import { nflScheduleUrl, reduceNflSchedule, type NflSchedule, type NflScheduleResponse } from "@/data/nflSchedule";
import {
  playedStatLines,
  projectionLines,
  seasonPerGameLines,
  SLEEPER_OUTAGE_HOLD_MS,
  sleeperSeasonProjectionsUrl,
  sleeperStatsUrl,
  type SleeperLoadMeta,
  type SleeperSeasonProjectionsLoad,
  type SleeperStatsLoad,
  type SleeperWeeklyProjectionsLoad,
} from "@/data/sleeperProjections";
import { FIXTURE, fakeHttp, fantasyCalcWith, fixtureFantasyCalcResponse, type FakeRoute } from "@/data/testSupport";
import { config } from "@/engine/config";
import type { FantasyCalcFormat } from "@/engine/inputs";
import { fantasyCalcFormatLabel } from "@/engine/market";
import type { LeagueSettings, LeagueSnapshot, PlayerInfo, Pos, Scoring, StatLine, Team } from "@/engine/model";
import { actualPoints, expectedPoints } from "@/engine/scoring";
import { isModelResponse } from "@/lib/api";
import { MemoryCache, TTL } from "@/server/cache";
import { createHttpClient } from "@/server/http";
import { readSanitizedFixture } from "@/test-utils/fixtures";
import { createProjectionArchiver, firstKickoffOf, projectionSnapshotFile, readProjectionSnapshot, type ArchiveOutcome, type ProjectionArchiveInput, type ProjectionArchiver } from "./projectionArchive";
import {
  assembleModelInputs,
  buildModelInputs,
  collapseWeekWarnings,
  fantasyCalcNotes,
  marketFormats,
  MODEL_SOURCES,
  modelWeekPlan,
  relevantPlayerIds,
  roundPoints,
  startablePositions,
  weeksText,
  type ModelSources,
} from "./modelInputs";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const HOUR = 3_600_000;

// ---------------------------------------------------------------------------------------------
// A small fictional league (fictional player and team names; ids shaped like Sleeper's)

const SCORING: Scoring = {
  perStat: { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 0.5, rec_yd: 0.1, rec_td: 6, fum_lost: -2, sack: 1, int: 2 },
  byPosition: { TE: { rec: 1 } },
  rules: [
    { kind: "threshold", stat: "rush_yd", min: 100, points: 3 },
    { kind: "threshold", stat: "pass_td", min: 3, points: 2, positions: ["QB"] },
    { kind: "range", stat: "pts_allow", min: 0, max: 0, points: 10, positions: ["DEF"] },
    { kind: "range", stat: "pts_allow", min: 1, max: 13, points: 4, positions: ["DEF"] },
    { kind: "range", stat: "pts_allow", min: 28, points: -4, positions: ["DEF"] },
  ],
  unmapped: [],
};

const weeks = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const SETTINGS: LeagueSettings = {
  numTeams: 10,
  leagueType: "redraft",
  lineup: [
    { slot: "QB", count: 1, eligible: ["QB"] },
    { slot: "RB", count: 2, eligible: ["RB"] },
    { slot: "WR", count: 2, eligible: ["WR"] },
    { slot: "TE", count: 1, eligible: ["TE"] },
    { slot: "FLEX", count: 1, eligible: ["RB", "WR", "TE"] },
    { slot: "D/ST", count: 1, eligible: ["DEF"] },
    { slot: "K", count: 1, eligible: ["K"] },
    { slot: "P", count: 0, eligible: ["P"] },
  ],
  benchSlots: 7,
  irSlots: 1,
  taxiSlots: 0,
  maxRosterSize: 16,
  scoring: SCORING,
  regularSeasonWeeks: weeks(1, 14),
  playoffWeeks: [15, 16, 17],
  playoffTeams: 4,
  medianGame: false,
  pointsOnly: false,
  tradeDeadline: null,
  tradeReview: "none",
};

function info(id: string, name: string, pos: Pos, extra: Partial<PlayerInfo> = {}): PlayerInfo {
  return { id, name, pos, eligible: [pos], nflTeam: "KC", injury: "ACTIVE", ids: {}, ...extra };
}

const PLAYERS: Record<string, PlayerInfo> = {
  "4046": info("4046", "Quill Arbuckle", "QB"),
  "9221": info("9221", "Rory Bellweather", "RB"),
  "7000": info("7000", "Tess Calloway", "TE"),
  "5000": info("5000", "Wes Dunmore", "WR"),
  "6000": info("6000", "Kip Ellery", "K"),
  DAL: info("DAL", "Dallas", "DEF", { nflTeam: "DAL" }),
  "8000": info("8000", "Ike Farrow", "WR"),
  "espn:3900101": info("espn:3900101", "Nash Galloway", "WR", { ids: { espn: "3900101" } }),
  "espn:5550002": info("espn:5550002", "Cole Hightower", "WR", { ids: { espn: "5550002" } }),
};

function team(id: string, roster: string[], ir: string[] = [], taxi: string[] = []): Team {
  return { id, name: `Team ${id}`, ownerName: `Owner ${id}`, roster, ir, taxi, record: { w: 2, l: 1, t: 0 }, pointsFor: 300, pointsAgainst: 280 };
}

function snapshot(over: Partial<LeagueSnapshot> = {}, settings: Partial<LeagueSettings> = {}): LeagueSnapshot {
  return {
    platform: "sleeper",
    leagueId: "123456789012345678",
    season: 2026,
    name: "Test League",
    fetchedAt: "2026-09-30T11:00:00.000Z",
    currentWeek: 4,
    settings: { ...SETTINGS, ...settings },
    teams: [team("1", ["4046", "9221", "espn:3900101"], ["7000"]), team("2", ["DAL", "5000"], [], ["6000"])],
    myTeamId: "1",
    players: PLAYERS,
    schedule: [],
    transactions: [],
    freeAgents: ["8000", "espn:5550002", "4046"],
    warnings: [],
    ...over,
  };
}

// ---- Hand-built loads, in the loaders' own types

const meta = (extra: Partial<SleeperLoadMeta> = {}): SleeperLoadMeta => ({ warnings: [], fromCache: false, stale: false, ...extra });

function weeklyLoad(byWeek: Record<number, Record<string, StatLine>>, extra: Partial<SleeperLoadMeta> = {}): SleeperWeeklyProjectionsLoad {
  const out: SleeperWeeklyProjectionsLoad["weeks"] = new Map();
  for (const [w, lines] of Object.entries(byWeek)) out.set(Number(w), new Map(Object.entries(lines).map(([id, stats]) => [id, { stats, sleeperPosition: "" }])));
  return { weeks: out, ...meta(extra) };
}

function statsLoad(byWeek: Record<number, Record<string, StatLine>>, extra: Partial<SleeperLoadMeta> = {}): SleeperStatsLoad {
  const out: SleeperStatsLoad["weeks"] = new Map();
  for (const [w, lines] of Object.entries(byWeek)) out.set(Number(w), new Map(Object.entries(lines)));
  return { weeks: out, ...meta(extra) };
}

function seasonLoad(lines: Record<string, StatLine>, extra: Partial<SleeperLoadMeta> = {}): SleeperSeasonProjectionsLoad {
  return { perGame: new Map(Object.entries(lines)), ...meta(extra) };
}

let nextFcId = 100;
function fcRow(name: string, position: string, value: number, ids: { sleeperId?: string; espnId?: string } = {}): FantasyCalcValueRow {
  return { fantasyCalcId: String(nextFcId++), name, position, sleeperId: ids.sleeperId ?? null, espnId: ids.espnId ?? null, mflId: null, fleaflickerId: null, team: null, value, redraftValue: null };
}

function fcPlayer(name: string, position: string, ids: { sleeperId?: string; espnId?: string } = {}): FantasyCalcPlayerIds {
  return { fantasyCalcId: String(nextFcId++), name, position, sleeperId: ids.sleeperId ?? null, espnId: ids.espnId ?? null, mflId: null, fleaflickerId: null, team: null };
}

function valuesLoad(format: FantasyCalcFormat, rows: FantasyCalcValueRow[], extra: Partial<FantasyCalcValuesLoad> = {}): FantasyCalcValuesLoad {
  return { format, players: rows, picks: [], topValue: Math.max(0, ...rows.map((r) => r.value)), fromCache: false, stale: false, ...extra };
}

function schedule(extra: Partial<NflSchedule> = {}): NflSchedule {
  return {
    season: 2026,
    byeWeek: { KC: 10, DAL: 5 },
    kickoffs: { 3: { KC: Date.parse("2026-09-21T00:15:00Z") }, 4: { KC: Date.parse("2026-09-27T17:00:00Z"), DAL: Date.parse("2026-09-28T00:20:00Z") }, 5: { KC: Date.parse("2026-10-04T20:25:00Z") } },
    lastWeek: 18,
    fromCache: true,
    stale: false,
    fetchedAt: Date.parse("2026-09-29T08:00:00Z"),
    ...extra,
  };
}

function sources(over: Partial<ModelSources> = {}): ModelSources {
  return { schedule: null, weekly: null, season: null, stats: null, fantasyCalc: null, warnings: [], ...over };
}

// Lines (projected means per game, and one game's actual stats).
const QB_LINE: StatLine = { pass_yd: 250, pass_td: 1.8, pass_int: 0.7, rush_yd: 15, rush_td: 0.1, fum_lost: 0.1 };
const RB_LINE: StatLine = { rush_yd: 85, rush_td: 0.6, rec: 3, rec_yd: 22, fum_lost: 0.05 };
const CATCHES: StatLine = { rec: 4, rec_yd: 40 };
const DEF_LINE: StatLine = { sack: 2.5, int: 0.8, pts_allow: 20 };

// ---------------------------------------------------------------------------------------------

describe("modelWeekPlan (§6 step 1: lookback weeks; the weeks the inputs cover)", () => {
  it("covers lookbackWeeks before the current week through the last playoff week, and stats for the completed weeks", () => {
    expect(config.projections.lookbackWeeks).toBe(3);
    expect(modelWeekPlan(snapshot(), NOW)).toEqual({ lastWeek: 17, lastWeekUnknown: false, seasonOver: false, notStarted: false, projectionWeeks: weeks(1, 17), statsWeeks: [1, 2, 3] });
    expect(modelWeekPlan(snapshot({ currentWeek: 10 }), NOW)).toMatchObject({ projectionWeeks: weeks(7, 17), statsWeeks: weeks(1, 9) });
    expect(modelWeekPlan(snapshot({ currentWeek: 1 }), NOW)).toMatchObject({ projectionWeeks: weeks(1, 17), statsWeeks: [] });
    expect(modelWeekPlan(snapshot({ currentWeek: 17 }), NOW)).toMatchObject({ seasonOver: false, projectionWeeks: weeks(14, 17), statsWeeks: weeks(1, 16) }); // the last week still counts
  });

  it("ends at the last regular-season week without playoffs, and never asks for weeks after NFL week 18", () => {
    expect(modelWeekPlan(snapshot({}, { playoffWeeks: [] }), NOW)).toMatchObject({ lastWeek: 14, projectionWeeks: weeks(1, 14) });
    expect(modelWeekPlan(snapshot({}, { playoffWeeks: [15, 16, 17, 18, 19] }), NOW)).toMatchObject({ lastWeek: 19, projectionWeeks: weeks(1, 18) });
    expect(modelWeekPlan(snapshot({ currentWeek: 19 }, { playoffWeeks: [15, 16, 17, 18, 19] }), NOW)).toMatchObject({ seasonOver: false, projectionWeeks: [16, 17, 18], statsWeeks: weeks(1, 18) });
  });

  it("once the season is over (no fantasy week left): nothing to project, so no projection or stats weeks", () => {
    expect(modelWeekPlan(snapshot({ currentWeek: 18 }), NOW)).toEqual({ lastWeek: 17, lastWeekUnknown: false, seasonOver: true, notStarted: false, projectionWeeks: [], statsWeeks: [] });
    expect(modelWeekPlan(snapshot({ currentWeek: 15 }, { playoffWeeks: [] }), NOW)).toMatchObject({ seasonOver: true, projectionWeeks: [], statsWeeks: [] });
  });

  it("before the season has started (a league renewed in January or February for next season): nothing is published yet, so no weeks (review DATA-3)", () => {
    const feb = new Date("2027-02-05T12:00:00.000Z");
    const renewed = snapshot({ season: 2027, currentWeek: 1 });
    expect(modelWeekPlan(renewed, feb)).toEqual({ lastWeek: 17, lastWeekUnknown: false, seasonOver: false, notStarted: true, projectionWeeks: [], statsWeeks: [] });
    // The season being played (its playoffs end in January) is under way; from March on next season's league is too.
    expect(modelWeekPlan(snapshot({ currentWeek: 17 }), new Date("2027-01-02T12:00:00.000Z"))).toMatchObject({ notStarted: false, projectionWeeks: weeks(14, 17) });
    expect(modelWeekPlan(renewed, new Date("2027-03-01T00:00:00.000Z"))).toMatchObject({ notStarted: false, projectionWeeks: weeks(1, 17), statsWeeks: [] });
    // August's preseason: the same season, whose projections are out.
    expect(modelWeekPlan(snapshot({ currentWeek: 1 }), new Date("2026-08-15T12:00:00.000Z"))).toMatchObject({ notStarted: false, projectionWeeks: weeks(1, 17) });
    // A season that's over stays over.
    expect(modelWeekPlan(snapshot({ season: 2027, currentWeek: 18 }), feb)).toMatchObject({ seasonOver: true, notStarted: false });
  });

  it("falls back to NFL week 18 when the settings list no season weeks", () => {
    expect(modelWeekPlan(snapshot({}, { regularSeasonWeeks: [], playoffWeeks: [] }), NOW)).toEqual({
      lastWeek: 18,
      lastWeekUnknown: true,
      seasonOver: false,
      notStarted: false,
      projectionWeeks: weeks(1, 18),
      statsWeeks: [1, 2, 3],
    });
  });
});

describe("relevant players, positions and FantasyCalc formats", () => {
  it("takes every rostered player (roster, IR, taxi) team by team, then the free agents, once each (§4, ModelInputs.players)", () => {
    expect(relevantPlayerIds(snapshot())).toEqual(["4046", "9221", "espn:3900101", "7000", "DAL", "5000", "6000", "8000", "espn:5550002"]);
  });

  it("requests the positions a lineup slot can start, in canonical order", () => {
    expect(startablePositions(SETTINGS)).toEqual(["QB", "RB", "WR", "TE", "K", "DEF"]);
    expect(startablePositions({ lineup: [...SETTINGS.lineup, { slot: "IDP", count: 1, eligible: ["DL", "LB"] }] })).toEqual(["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB"]);
  });

  it("asks FantasyCalc for the league's own list, and keeper leagues for the dynasty and the redraft list (§9)", () => {
    expect(marketFormats(SETTINGS)).toEqual({ values: expect.objectContaining({ isDynasty: false, numTeams: 10, ppr: 0.5, numQbs: 1, tep: "te+" }) });
    expect(marketFormats({ ...SETTINGS, leagueType: "dynasty" }).values.isDynasty).toBe(true);
    const keeper = marketFormats({ ...SETTINGS, leagueType: "keeper" });
    expect(keeper.values.isDynasty).toBe(true);
    expect(keeper.redraft?.isDynasty).toBe(false);
    expect(keeper.values.substitutions[0]).toMatch(/dynasty values for long-term worth/);
    expect(keeper.redraft?.substitutions[0]).toMatch(/redraft values for how managers see a trade/);
  });

  it("dynasty leagues also name this season's list, the redraft list in their own format, for the market blend (§6 step 8); no other league type does", () => {
    const dynasty = marketFormats({ ...SETTINGS, leagueType: "dynasty", numTeams: 16 });
    expect(dynasty.values).toEqual(expect.objectContaining({ isDynasty: true, numTeams: 14, ppr: 0.5, numQbs: 1, tep: "te+" }));
    expect(dynasty.season).toEqual(expect.objectContaining({ isDynasty: false, numTeams: 14, ppr: 0.5, numQbs: 1, tep: "te+" }));
    expect(dynasty).not.toHaveProperty("redraft"); // perception keeps reading the dynasty list
    expect(marketFormats(SETTINGS)).not.toHaveProperty("season");
    expect(marketFormats({ ...SETTINGS, leagueType: "keeper" })).not.toHaveProperty("season");
  });
});

describe("assembleModelInputs: league scoring (§5, §6)", () => {
  it("scores Sleeper's weekly projections with the league's rules as expected values, by NFL week", () => {
    const loaded = sources({ weekly: weeklyLoad({ 1: { "4046": QB_LINE }, 2: { "4046": QB_LINE, "7000": CATCHES, "5000": CATCHES }, 4: { "4046": QB_LINE, DAL: DEF_LINE } }) });
    const out = assembleModelInputs(snapshot(), loaded, NOW);
    const qb = out.players["4046"];
    const expected = roundPoints(expectedPoints(QB_LINE, "QB", SCORING));
    expect(qb?.sleeper).toEqual({ 1: expected, 2: expected, 4: expected });
    // Linear parts are 17.7; the "3+ passing TDs" bonus adds its Poisson expected value (§5), so it isn't ~0.
    expect(expected).toBeGreaterThan(17.7 + 0.5);
    expect(expected).toBeLessThan(17.7 + 0.6);
    // A TE's catches use the league's TE rate (byPosition replaces perStat): 4 × 1 + 4 against a WR's 4 × 0.5 + 4.
    expect(out.players["7000"]?.sleeper[2]).toBe(8);
    expect(out.players["5000"]?.sleeper[2]).toBe(6);
    expect(out.players.DAL?.sleeper[4]).toBe(roundPoints(expectedPoints(DEF_LINE, "DEF", SCORING)));
  });

  it("gives every player every loaded week: null when Sleeper has no real line for him (a stub) or the line is worth 0; unloaded weeks stay missing", () => {
    const zero: StatLine = { rush_att: 12 }; // no rate for rush_att in this league
    const loaded = sources({ weekly: weeklyLoad({ 3: { "4046": QB_LINE, "9221": zero }, 4: { "4046": QB_LINE }, 19: { "4046": QB_LINE } }) });
    const out = assembleModelInputs(snapshot(), loaded, NOW);
    expect(Object.keys(out.players["4046"]?.sleeper ?? {})).toEqual(["3", "4"]); // week 19 isn't a week of this league
    expect(out.players["9221"]?.sleeper).toEqual({ 3: null, 4: null });
    expect(out.players["8000"]?.sleeper).toEqual({ 3: null, 4: null });
  });

  it("adds Sleeper's season projection per game, scored the same way (§6's last-resort base rate)", () => {
    const perGame: StatLine = { ...RB_LINE, gp: 1 };
    const out = assembleModelInputs(snapshot(), sources({ season: seasonLoad({ "9221": perGame, "5000": { rush_att: 1, gp: 1 } }) }), NOW);
    expect(out.players["9221"]?.sleeperSeasonPerGame).toBe(roundPoints(expectedPoints(perGame, "RB", SCORING)));
    expect(out.players["5000"]).not.toHaveProperty("sleeperSeasonPerGame"); // worth 0 points: no rate
    expect(out.players["4046"]).not.toHaveProperty("sleeperSeasonPerGame");
  });

  it("scores completed weeks' stats exactly (actualPoints), only for games played (gp > 0) and weeks before the current one", () => {
    const qbGame: StatLine = { gp: 1, pass_yd: 300, pass_td: 3, pass_int: 1, rush_yd: 20 };
    const loaded = sources({
      stats: statsLoad({
        1: { "4046": qbGame, "9221": { gp: 1, rush_att: 3 } },
        2: { "4046": { pass_yd: 280, pass_td: 2 } }, // no gp: a game he didn't play
        3: { "4046": { ...qbGame, pass_td: 1 } },
        4: { "4046": qbGame }, // the current week isn't complete
      }),
    });
    const out = assembleModelInputs(snapshot(), loaded, NOW);
    // 300 × 0.04 + 3 × 4 − 2 + 20 × 0.1 = 24, plus the 3+ passing TD bonus.
    expect(out.players["4046"]?.actual).toEqual({ 1: 26, 3: 16 });
    expect(actualPoints(qbGame, "QB", SCORING)).toBe(26);
    expect(out.players["9221"]?.actual).toEqual({ 1: 0 }); // played, scored nothing
    expect(out.players["7000"]?.actual).toEqual({});
  });

  it("rounds points to a hundredth", () => {
    expect(roundPoints(17.123456)).toBe(17.12);
    expect(roundPoints(-1.456)).toBe(-1.46);
    const out = assembleModelInputs(snapshot(), sources({ stats: statsLoad({ 1: { "4046": { gp: 1, pass_yd: 237 } } }) }), NOW);
    expect(out.players["4046"]?.actual[1]).toBe(9.48); // 237 × 0.04 = 9.480000000000002
  });
});

describe("assembleModelInputs: players without a Sleeper id, and ESPN's projections", () => {
  it("gives players without a Sleeper id empty Sleeper and stats inputs, and one warning naming them", () => {
    const loaded = sources({ weekly: weeklyLoad({ 4: { "4046": QB_LINE } }), stats: statsLoad({ 1: { "4046": { gp: 1, pass_yd: 100 } } }) });
    const out = assembleModelInputs(snapshot(), loaded, NOW);
    expect(out.players["espn:3900101"]).toEqual({ sleeper: {}, actual: {} });
    expect(out.players["espn:5550002"]).toEqual({ sleeper: {}, actual: {} });
    const w = out.warnings.find((x) => x.code === "NO_SLEEPER_ID");
    expect(w?.message).toBe("2 players have no Sleeper id, so Sleeper's projections and stats don't cover them: Nash Galloway, Cole Hightower.");
    const one = assembleModelInputs(snapshot({ freeAgents: [] }), loaded, NOW).warnings.find((x) => x.code === "NO_SLEEPER_ID");
    expect(one?.message).toBe("1 player has no Sleeper id, so Sleeper's projections and stats don't cover him: Nash Galloway.");
  });

  it("ESPN leagues: ESPN's league-scored projections by week for every player (rounded; null = not projected)", () => {
    const espn = { "4046": { 3: 18.123456, 4: null }, "espn:3900101": { 4: 12.5 }, "5000": { 4: 0.001 } };
    const out = assembleModelInputs(snapshot({ platform: "espn" }), sources({ espn }), NOW);
    expect(out.espnProjections).toBe(true);
    expect(out.players["4046"]?.espn).toEqual({ 3: 18.12, 4: null });
    expect(out.players["espn:3900101"]?.espn).toEqual({ 4: 12.5 });
    expect(out.players["5000"]?.espn).toEqual({ 4: null }); // rounds to 0: not projected
    expect(out.players["9221"]?.espn).toEqual({});
    expect(out.warnings.map((w) => w.code)).not.toContain("ESPN_PROJECTIONS_UNAVAILABLE");
    expect(out.warnings.find((w) => w.code === "NO_SLEEPER_ID")?.message).toContain("(ESPN's own projections still cover them)");
  });

  it("ESPN leagues without ESPN's projections: espnProjections false, no espn fields, and a warning", () => {
    for (const espn of [undefined, {}]) {
      const out = assembleModelInputs(snapshot({ platform: "espn" }), sources(espn ? { espn } : {}), NOW);
      expect(out.espnProjections).toBe(false);
      expect(out.players["4046"]).not.toHaveProperty("espn");
      expect(out.warnings.map((w) => w.code)).toContain("ESPN_PROJECTIONS_UNAVAILABLE");
    }
    // Other platforms have none to miss, and once the season is over nothing is projected anyway.
    const sleeper = assembleModelInputs(snapshot(), sources(), NOW);
    expect(sleeper.espnProjections).toBe(false);
    expect(sleeper.warnings.map((w) => w.code)).not.toContain("ESPN_PROJECTIONS_UNAVAILABLE");
    const over = assembleModelInputs(snapshot({ platform: "espn", currentWeek: 18 }), sources(), NOW);
    expect(over.warnings.map((w) => w.code)).not.toContain("ESPN_PROJECTIONS_UNAVAILABLE");
  });
});

describe("assembleModelInputs: FantasyCalc (§9, §2.9)", () => {
  const format = marketFormats(SETTINGS).values;

  it("joins the league-format values to canonical ids: Sleeper ids on sleeperId, espn: ids on espnId only when name and position match", () => {
    const rows = [
      fcRow("Quill Arbuckle", "QB", 5000, { sleeperId: "4046" }),
      fcRow("Nash Galloway", "WR", 7000, { sleeperId: "99999", espnId: "3900101" }),
      fcRow("Someone Else", "WR", 6500, { espnId: "5550002" }), // a stale ESPN id on another player
      fcRow("Rory Bellweather", "RB", 9000, { sleeperId: "9221" }),
      fcRow("Not In This League", "WR", 9500, { sleeperId: "1" }),
    ];
    const listOnly = [fcPlayer("Wes Dunmore", "WR", { sleeperId: "5000" }), fcPlayer("Cole Hightower", "WR", { espnId: "5550002" })];
    const fantasyCalc = { values: valuesLoad(format, rows, { fetchedAt: Date.parse("2026-09-30T06:00:00Z") }), players: listOnly };
    const out = assembleModelInputs(snapshot(), sources({ fantasyCalc }), NOW);
    expect(out.market).toEqual({
      format,
      fetchedAt: "2026-09-30T06:00:00.000Z",
      values: { "4046": 5000, "9221": 9000, "espn:3900101": 7000 },
      knownIds: ["4046", "9221", "espn:3900101", "5000", "espn:5550002"],
      topValue: 9500,
    });
    expect(out.market).not.toHaveProperty("redraftValues");
  });

  it("an espn: id whose FantasyCalc row is at another position isn't matched", () => {
    const rows = [fcRow("Nash Galloway", "RB", 7000, { espnId: "3900101" }), ...Array.from({ length: 3 }, (_, i) => fcRow(`Filler ${i}`, "WR", 100 + i))];
    const out = assembleModelInputs(snapshot(), sources({ fantasyCalc: { values: valuesLoad(format, rows), players: null } }), NOW);
    expect(out.market?.values).toEqual({});
    expect(out.market?.knownIds).toEqual([]);
  });

  it("keeper leagues: dynasty values for the future term, redraft values for perception; notes name both lists and each substitution once", () => {
    const keeper: LeagueSettings = { ...SETTINGS, leagueType: "keeper", numTeams: 16 };
    const f = marketFormats(keeper);
    const redraftFormat = f.redraft as FantasyCalcFormat;
    const fantasyCalc = {
      values: valuesLoad(f.values, [fcRow("Quill Arbuckle", "QB", 4000, { sleeperId: "4046" })], { fetchedAt: Date.parse("2026-09-30T06:00:00Z") }),
      redraft: valuesLoad(redraftFormat, [fcRow("Quill Arbuckle", "QB", 5200, { sleeperId: "4046" })], { fetchedAt: Date.parse("2026-09-30T05:00:00Z"), stale: true }),
      players: null,
    };
    const out = assembleModelInputs(snapshot({}, keeper), sources({ fantasyCalc }), NOW);
    expect(out.market).toMatchObject({ format: f.values, values: { "4046": 4000 }, redraftValues: { "4046": 5200 }, fetchedAt: "2026-09-30T05:00:00.000Z" });
    expect(out.notes[0]).toBe(
      `Trade values: FantasyCalc ${fantasyCalcFormatLabel(f.values)} for long-term worth, and ${fantasyCalcFormatLabel(redraftFormat)} for how managers see a trade this season.`,
    );
    expect(out.notes.slice(1)).toEqual([
      "Trade values: keeper league → FantasyCalc's dynasty values for long-term worth.",
      "Trade values: 16 teams → FantasyCalc's 14-team values.",
      expect.stringMatching(/^Trade values: TE premium \+0\.5 per reception → FantasyCalc's TE\+ values/),
      "Trade values: keeper league → FantasyCalc's redraft values for how managers see a trade this season.",
    ]);
    expect(out.sources.find((s) => s.source === MODEL_SOURCES.fantasyCalc)).toEqual({ source: "FantasyCalc values", fetchedAt: "2026-09-30T05:00:00.000Z", stale: true });
  });

  it("dynasty leagues: dynasty values for perception and the future term, this season's list only as seasonValues (the market blend's), never redraftValues; no note of its own (the League page says which values the blend reads)", () => {
    const dynasty: LeagueSettings = { ...SETTINGS, leagueType: "dynasty" };
    const f = marketFormats(dynasty);
    const seasonFormat = f.season as FantasyCalcFormat;
    const fantasyCalc = {
      values: valuesLoad(f.values, [fcRow("Quill Arbuckle", "QB", 4000, { sleeperId: "4046" })], { fetchedAt: Date.parse("2026-09-30T06:00:00Z") }),
      season: valuesLoad(seasonFormat, [fcRow("Quill Arbuckle", "QB", 5200, { sleeperId: "4046" }), fcRow("Rory Bellweather", "RB", 6100, { sleeperId: "9221" })], { fetchedAt: Date.parse("2026-09-30T04:00:00Z"), stale: true }),
      players: null,
    };
    const out = assembleModelInputs(snapshot({}, dynasty), sources({ fantasyCalc }), NOW);
    expect(out.market).toMatchObject({ format: f.values, values: { "4046": 4000 }, seasonValues: { "4046": 5200, "9221": 6100 }, fetchedAt: "2026-09-30T04:00:00.000Z" });
    expect(out.market).not.toHaveProperty("redraftValues");
    // Only the dynasty list's row is FantasyCalc's own value for 9221 in this format: the season list makes him known, not valued.
    expect(out.market?.values).not.toHaveProperty("9221");
    expect(out.market?.knownIds).toEqual(["4046", "9221"]);
    // The notes are the dynasty list's alone: the season list adds none (review of track A: a note in dynasty leagues
    // only, where the blend reads a list in every league type; the League page's "Projected points" names it).
    expect(out.notes).toEqual(fantasyCalcNotes(f.values));
    expect(out.notes[0]).toBe(`Trade values: FantasyCalc ${fantasyCalcFormatLabel(f.values)}.`);
    expect(fantasyCalcFormatLabel(seasonFormat)).toBe("10 teams · half-PPR · 1 QB · redraft · TE+");
    // The season list's own mode note ("dynasty league → … redraft values") isn't a trade-values note either.
    expect(out.notes.filter((n) => n.includes("dynasty league →"))).toEqual([]);
    expect(out.sources.find((s) => s.source === MODEL_SOURCES.fantasyCalc)).toEqual({ source: "FantasyCalc values", fetchedAt: "2026-09-30T04:00:00.000Z", stale: true });
    // Without the season list: no seasonValues, the same notes (the League model says the blend is off).
    const without = assembleModelInputs(snapshot({}, dynasty), sources({ fantasyCalc: { values: fantasyCalc.values, players: null } }), NOW);
    expect(without.market).not.toHaveProperty("seasonValues");
    expect(without.notes).toEqual(out.notes);
  });

  it("the format in words for a redraft league: the list's label, then each substitution (the Import Report hides the ones it shows itself)", () => {
    expect(fantasyCalcNotes(format)).toEqual([`Trade values: FantasyCalc ${fantasyCalcFormatLabel(format)}.`, ...format.substitutions.map((s) => `Trade values: ${s}.`)]);
    expect(fantasyCalcFormatLabel(format)).toBe("10 teams · half-PPR · 1 QB · redraft · TE+");
    expect(format.substitutions).toEqual([expect.stringMatching(/^TE premium \+0\.5 per reception → FantasyCalc's TE\+ values/)]);
  });

  it("FantasyCalc down: market null, no FantasyCalc stamp and no format notes", () => {
    const warnings = [{ code: "FANTASYCALC_UNAVAILABLE", message: "FantasyCalc's values couldn't be loaded (FantasyCalc redraft values: HTTP 503), so players have no market values yet.", platformPath: "values/current" }];
    const out = assembleModelInputs(snapshot(), sources({ warnings }), NOW);
    expect(out.market).toBeNull();
    expect(out.notes).toEqual([]);
    expect(out.sources.map((s) => s.source)).not.toContain(MODEL_SOURCES.fantasyCalc);
    expect(out.warnings.filter((w) => w.code !== "NO_SLEEPER_ID")).toEqual(warnings);
  });
});

describe("assembleModelInputs: schedule, stamps, warnings and the header", () => {
  it("passes every bye, the kickoffs from the current week on (ISO times) and the NFL's last week (§6 step 3: byes come only from the NFL schedule)", () => {
    const out = assembleModelInputs(snapshot(), sources({ schedule: schedule() }), NOW);
    expect(out.nfl).toEqual({ byeWeek: { KC: 10, DAL: 5 }, kickoffs: { 4: { KC: "2026-09-27T17:00:00.000Z", DAL: "2026-09-28T00:20:00.000Z" }, 5: { KC: "2026-10-04T20:25:00.000Z" } }, lastWeek: 18 });
    expect(assembleModelInputs(snapshot(), sources(), NOW).nfl).toEqual({ byeWeek: {}, kickoffs: {} });
    // A schedule without a last week (no games at all) leaves it unknown rather than guessing.
    const noLastWeek = schedule();
    delete noLastWeek.lastWeek;
    expect(assembleModelInputs(snapshot(), sources({ schedule: noLastWeek }), NOW).nfl).not.toHaveProperty("lastWeek");
  });

  it("passes each team's NFL opponents from the current week on (Phase 4: the League page's streaming picks show them); none for a schedule without them", () => {
    const opponents = { 3: { KC: { team: "LV", home: false }, LV: { team: "KC", home: true } }, 4: { KC: { team: "DEN", home: true }, DEN: { team: "KC", home: false } }, 5: { DAL: { team: "NYG", home: false }, NYG: { team: "DAL", home: true } } };
    const out = assembleModelInputs(snapshot(), sources({ schedule: schedule({ opponents }) }), NOW);
    expect(out.nfl.opponents).toEqual({ 4: opponents[4], 5: opponents[5] });
    expect(out.nfl.kickoffs).toEqual(assembleModelInputs(snapshot(), sources({ schedule: schedule() }), NOW).nfl.kickoffs);
    expect(assembleModelInputs(snapshot(), sources({ schedule: schedule() }), NOW).nfl).not.toHaveProperty("opponents");
    expect(assembleModelInputs(snapshot(), sources(), NOW).nfl).not.toHaveProperty("opponents");
  });

  it("stamps each source that delivered data, in a fixed order: its oldest fetch time, stale when a saved copy stood in, the build time when unknown", () => {
    const loaded = sources({
      weekly: weeklyLoad({ 4: { "4046": QB_LINE } }, { fetchedAt: Date.parse("2026-09-30T09:00:00Z") }),
      season: seasonLoad({ "4046": QB_LINE }, { fetchedAt: Date.parse("2026-09-30T08:00:00Z"), stale: true }),
      stats: statsLoad({ 1: { "4046": { gp: 1 } } }),
      fantasyCalc: { values: valuesLoad(marketFormats(SETTINGS).values, [fcRow("Quill Arbuckle", "QB", 5000, { sleeperId: "4046" })], { fetchedAt: Date.parse("2026-09-30T07:00:00Z") }), players: [] },
      schedule: schedule(),
    });
    expect(assembleModelInputs(snapshot(), loaded, NOW).sources).toEqual([
      { source: "Sleeper projections", fetchedAt: "2026-09-30T08:00:00.000Z", stale: true },
      { source: "Sleeper stats", fetchedAt: NOW.toISOString() },
      { source: "FantasyCalc values", fetchedAt: "2026-09-30T07:00:00.000Z" },
      { source: "NFL schedule (ESPN)", fetchedAt: "2026-09-29T08:00:00.000Z" },
    ]);
    // A load that delivered nothing (every week failed) gets no stamp; the warnings say why.
    const empty = sources({ weekly: weeklyLoad({}, { fetchedAt: Date.parse("2026-09-30T09:00:00Z") }), stats: statsLoad({}), season: seasonLoad({}) });
    expect(assembleModelInputs(snapshot(), empty, NOW).sources).toEqual([]);
  });

  it("keeps the load warnings in order, one line per failing Sleeper source instead of one per week", () => {
    const week = (w: number, why: string) => ({ code: "PROJECTIONS_WEEK_UNAVAILABLE", message: `Sleeper's projections for week ${w} couldn't be read (${why}), so that week is left out.`, platformPath: `projections/${w}` });
    const warnings = [
      { code: "NFL_SCHEDULE_UNAVAILABLE", message: "The NFL schedule couldn't be loaded." },
      week(1, "HTTP 503"),
      week(2, "HTTP 503"),
      week(3, "HTTP 503"),
      week(17, "no projections in it"),
      { code: "STATS_WEEK_UNAVAILABLE", message: "Sleeper's stats for week 2 couldn't be read (HTTP 500), so that week's points are left out.", platformPath: "stats/2" },
      { code: "PROJECTION_ROWS_UNREADABLE", message: "Week 5 projections: 2 row(s) didn't have the expected shape and were skipped.", platformPath: "projections/5[3]" },
    ];
    expect(assembleModelInputs(snapshot(), sources({ warnings }), NOW).warnings).toEqual([
      warnings[0],
      { code: "PROJECTIONS_WEEK_UNAVAILABLE", message: "Sleeper's projections for weeks 1–3, 17 couldn't be read (HTTP 503; no projections in it), so those weeks are left out.", platformPath: "projections" },
      warnings[5],
      warnings[6],
      { code: "NO_SLEEPER_ID", message: expect.stringMatching(/^2 players have no Sleeper id/) },
    ]);
  });

  it("collapseWeekWarnings: leaves single week warnings and other codes alone, and copes with paths it can't read", () => {
    const stats = (path: string | undefined) => ({ code: "STATS_WEEK_UNAVAILABLE", message: "Sleeper's stats for week ? couldn't be read, so that week's points are left out.", ...(path ? { platformPath: path } : {}) });
    const single = [stats("stats/1"), { code: "X", message: "y" }];
    expect(collapseWeekWarnings(single)).toEqual(single);
    expect(collapseWeekWarnings([{ code: "X", message: "y" }, stats("stats/1"), stats(undefined)])).toEqual([
      { code: "X", message: "y" },
      { code: "STATS_WEEK_UNAVAILABLE", message: "Sleeper's stats for 2 weeks couldn't be read, so those weeks' points are left out.", platformPath: "stats" },
    ]);
    expect(weeksText([5, 1, 2, 3, 9, 10, 2])).toBe("1–3, 5, 9–10");
  });

  it("collapseWeekWarnings: everything Sleeper didn't serve because it stopped answering (SLEEPER_DOWN, any source) is one warning at the first one's place", () => {
    const down = (path: string, what: string, why = "HTTP 503") => ({ code: "SLEEPER_DOWN", message: `Sleeper's ${what} are left out: Sleeper stopped answering (${why}).`, platformPath: path });
    const other = { code: "X", message: "y" };
    const answered = { code: "PROJECTIONS_WEEK_UNAVAILABLE", message: "Sleeper's projections for week 4 couldn't be read (HTTP 404), so that week is left out.", platformPath: "projections/4" };
    expect(
      collapseWeekWarnings([other, answered, down("projections/5", "projections for week 5"), down("projections/6", "projections for week 6"), down("projections/season", "season projections"), down("stats/1", "stats for week 1"), down("stats/2", "stats for week 2")]),
    ).toEqual([
      other,
      answered, // an answer without projections stays its own line
      { code: "SLEEPER_DOWN", message: "Sleeper stopped answering (HTTP 503), so its projections for weeks 5–6, its season projections and its stats for weeks 1–2 are left out. Try again in a few minutes." },
    ]);
    // One item; two reasons; a path it can't read.
    expect(collapseWeekWarnings([down("stats/3", "stats for week 3", "no response")])).toEqual([{ code: "SLEEPER_DOWN", message: "Sleeper stopped answering (no response), so its stats for week 3 are left out. Try again in a few minutes." }]);
    expect(collapseWeekWarnings([down("projections/season", "season projections", "HTTP 429"), down("projections/9", "projections for week 9")])).toEqual([
      { code: "SLEEPER_DOWN", message: "Sleeper stopped answering (HTTP 429; HTTP 503), so its projections for week 9 and its season projections are left out. Try again in a few minutes." },
    ]);
    expect(collapseWeekWarnings([{ code: "SLEEPER_DOWN", message: "odd" }])).toEqual([{ code: "SLEEPER_DOWN", message: "Sleeper stopped answering, so some of its data is left out. Try again in a few minutes." }]);
  });

  it("before the season has started: no weeks, and a warning first that says why (review DATA-3)", () => {
    const feb = new Date("2027-02-05T12:00:00.000Z");
    const out = assembleModelInputs(snapshot({ season: 2027, currentWeek: 1, platform: "espn" }), sources({ warnings: [{ code: "X", message: "y" }] }), feb);
    expect(out.warnings[0]).toEqual({
      code: "SEASON_NOT_STARTED",
      message: "The 2027 season hasn't started yet, so nothing is projected: Sleeper's projections and stats and the NFL schedule are loaded from March 2027 on.",
      platformPath: "season",
    });
    expect(out.warnings.map((w) => w.code)).not.toContain("ESPN_PROJECTIONS_UNAVAILABLE"); // nothing to project, so nothing missing
    expect(out).toMatchObject({ season: 2027, currentWeek: 1, lastWeek: 17, nfl: { byeWeek: {}, kickoffs: {} } });
    expect(out.players["4046"]).toEqual({ sleeper: {}, actual: {} });
    expect(assembleModelInputs(snapshot(), sources(), NOW).warnings.map((w) => w.code)).not.toContain("SEASON_NOT_STARTED");
  });

  it("warns when the league's season weeks are unknown", () => {
    const out = assembleModelInputs(snapshot({}, { regularSeasonWeeks: [], playoffWeeks: [] }), sources(), NOW);
    expect(out.lastWeek).toBe(18);
    expect(out.warnings[0]).toEqual({ code: "SEASON_WEEKS_UNKNOWN", message: "The league's settings don't list its season weeks, so projections run through NFL week 18.", platformPath: "settings.regularSeasonWeeks" });
  });

  it("fills the header: version, season, weeks and the build time", () => {
    const out = assembleModelInputs(snapshot(), sources(), NOW);
    expect(out).toMatchObject({ version: 1, season: 2026, currentWeek: 4, lastWeek: 17, builtAt: "2026-09-30T12:00:00.000Z", espnProjections: false, market: null });
    expect(Object.keys(out.players)).toHaveLength(9);
    expect(isModelResponse({ import: { snapshot: snapshot() }, model: out })).toBe(true);
  });

  it("once the season is over: nothing projected or scored (the plan has no weeks), still valid inputs for every player", () => {
    const loaded = sources({ weekly: weeklyLoad({ 17: { "4046": QB_LINE } }), stats: statsLoad({ 17: { "4046": { gp: 1, pass_yd: 100 } } }) });
    const out = assembleModelInputs(snapshot({ currentWeek: 18 }), loaded, NOW);
    expect(out).toMatchObject({ currentWeek: 18, lastWeek: 17, nfl: { byeWeek: {}, kickoffs: {} } });
    expect(out.players["4046"]).toEqual({ sleeper: {}, actual: {} });
    expect(Object.keys(out.players)).toHaveLength(9);
  });
});

// ---------------------------------------------------------------------------------------------
// Parker's league (sanitized fixtures: placeholder team and owner names) with the committed Sleeper rows

const SLEEPER_PROJ = (w: number) => `sleeper/projections/2026/${w} (top 150 QB/RB/WR/TE + 6 per K/DEF/IDP)`;
const SLEEPER_STATS = (w: number) => `sleeper/stats/2026/${w} (top 150 QB/RB/WR/TE + 6 per K/DEF/IDP)`;
const SLEEPER_SEASON_QB = "sleeper/projections/2026?position=QB (season, top 40)";
const FC_VALUES_10 = "fantasycalc/values?isDynasty=false&numQbs=1&numTeams=10&ppr=1";
const shared = <T>(label: string) => readSanitizedFixture<T>("shared", label);
const rows = (label: string) => shared<SleeperStatRow[]>(label);

describe("assembleModelInputs on Parker's league (sanitized fixtures)", () => {
  const bundle = parkerBundle();
  const { snapshot: parker } = normalizeEspnLeague(bundle, { leagueId: PARKER.leagueId, resolver: espnFakeResolver(), now: ESPN_NOW, swid: PARKER.swid });
  const espn = espnProjectionsFrom(bundle, parker);
  const week4 = projectionLines(rows(SLEEPER_PROJ(4)));
  const week5 = projectionLines(rows(SLEEPER_PROJ(5)));
  const stats = new Map([1, 2, 3].map((w) => [w, playedStatLines(rows(SLEEPER_STATS(w)))] as const));
  const season = seasonPerGameLines(rows(SLEEPER_SEASON_QB));
  const loaded = sources({
    weekly: { weeks: new Map([[4, week4], [5, week5]]), ...meta() },
    season: { perGame: season, ...meta() },
    stats: { weeks: stats, ...meta() },
    espn,
  });
  const out = assembleModelInputs(parker, loaded, NOW);
  const scoring = parker.settings.scoring;
  const ids = relevantPlayerIds(parker);

  it("covers every rostered player and free agent", () => {
    expect(parker.currentWeek).toBe(PARKER.currentWeek);
    expect(ids.length).toBeGreaterThan(300);
    expect(Object.keys(out.players).sort()).toEqual([...ids].sort());
    expect(out.lastWeek).toBe(Math.max(...parker.settings.playoffWeeks));
  });

  it("scores Sleeper's lines with the league's own rules for every Sleeper-id player, and keeps ESPN's league-scored projections", () => {
    let projected = 0;
    for (const id of ids) {
      const p = out.players[id];
      const pos = parker.players[id]?.pos as Pos;
      if (id.includes(":")) {
        expect(p?.sleeper).toEqual({});
        continue;
      }
      const line4 = week4.get(id);
      const want4 = line4 ? roundPoints(expectedPoints(line4.stats, pos, scoring)) : null;
      expect(p?.sleeper[4], id).toBe(want4 === 0 ? null : want4);
      expect(Object.keys(p?.sleeper ?? {})).toEqual(["4", "5"]);
      if (want4) projected++;
      for (const [w, lines] of stats) {
        const line = lines.get(id);
        if (line) expect(p?.actual[w], `${id} week ${w}`).toBe(roundPoints(actualPoints(line, pos, scoring)));
        else expect(p?.actual[w]).toBeUndefined();
      }
      const seasonLine = season.get(id);
      if (seasonLine && pos === "QB") expect(p?.sleeperSeasonPerGame).toBe(roundPoints(expectedPoints(seasonLine, pos, scoring)));
    }
    expect(projected).toBeGreaterThan(100);
    // Every rostered player has ESPN's projection for the previous and the current week.
    for (const t of parker.teams) for (const id of t.roster) expect(Object.keys(out.players[id]?.espn ?? {}), id).toEqual(["3", "4"]);
    expect(out.espnProjections).toBe(true);
  });

  it("joins FantasyCalc values to Parker's players (a committed values list)", () => {
    const format = marketFormats(parker.settings).values;
    const body = shared<Array<{ player: Record<string, unknown>; value: number }>>(FC_VALUES_10);
    const valueRows: FantasyCalcValueRow[] = body.map((r) => ({
      fantasyCalcId: String(r.player.id),
      name: String(r.player.name),
      position: String(r.player.position),
      sleeperId: r.player.sleeperId == null ? null : String(r.player.sleeperId),
      espnId: r.player.espnId == null ? null : String(r.player.espnId),
      mflId: null,
      fleaflickerId: null,
      team: null,
      value: r.value,
      redraftValue: null,
    }));
    const withMarket = assembleModelInputs(parker, { ...loaded, fantasyCalc: { values: valuesLoad(format, valueRows), players: null } }, NOW);
    const market = withMarket.market;
    expect(market?.format).toEqual(format);
    // Every row whose Sleeper id is one of Parker's players (rostered or a free agent) is his value.
    const relevant = new Set(ids);
    const bySleeperId = valueRows.filter((r) => r.sleeperId !== null && relevant.has(r.sleeperId));
    expect(bySleeperId.length).toBeGreaterThan(30);
    for (const r of bySleeperId) expect(market?.values[r.sleeperId as string], r.name).toBe(r.value);
    const valued = Object.keys(market?.values ?? {});
    expect(valued.length).toBeGreaterThanOrEqual(bySleeperId.length);
    for (const id of valued) expect(relevant.has(id), id).toBe(true);
    expect(market?.knownIds).toEqual(expect.arrayContaining(valued));
    expect(withMarket.notes[0]).toBe(`Trade values: FantasyCalc ${fantasyCalcFormatLabel(format)}.`);
  });
});

describe("assembleModelInputs performance (§6: log nothing per player, well under a second)", () => {
  it("assembles ~420 players × 17 weeks of realistic Sleeper lines well under a second", () => {
    const { snapshot: parker } = normalizeEspnLeague(parkerBundle(), { leagueId: PARKER.leagueId, resolver: espnFakeResolver(), now: ESPN_NOW, swid: PARKER.swid });
    const fixtureWeeks = [4, 5, 10, 15, 17, 18];
    const byWeek = new Map(fixtureWeeks.map((w) => [w, projectionLines(rows(SLEEPER_PROJ(w)))] as const));
    const nearest = (w: number) => fixtureWeeks.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));
    const base = rows(SLEEPER_PROJ(4));
    const posOf: Record<string, Pos> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", DEF: "DEF", DL: "DL", LB: "LB", DB: "DB" };
    // 420 players cycling through the committed rows: copies get their own ids and the same lines.
    const players: Record<string, PlayerInfo> = {};
    const rowOf = new Map<string, string>();
    for (let i = 0; i < 420; i++) {
      const row = base[i % base.length] as SleeperStatRow;
      const id = i < base.length ? row.player_id : `${row.player_id}~${Math.floor(i / base.length)}`;
      const pos = posOf[row.player?.position ?? ""] ?? "WR";
      players[id] = info(id, `Player ${i}`, pos);
      rowOf.set(id, row.player_id);
    }
    const all = [...rowOf.keys()];
    const teams = Array.from({ length: 10 }, (_, t) => team(String(t + 1), all.slice(t * 16, t * 16 + 16)));
    const snap = snapshot({ players, teams, freeAgents: all.slice(160), platform: "espn" }, { scoring: parker.settings.scoring });
    const remap = <T>(lines: ReadonlyMap<string, T>) => new Map([...rowOf].flatMap(([id, rowId]) => (lines.has(rowId) ? [[id, lines.get(rowId) as T] as const] : [])));
    const weekly = new Map(weeks(1, 17).map((w) => [w, remap(byWeek.get(nearest(w)) as ReadonlyMap<string, { stats: StatLine; sleeperPosition: string }>)] as const));
    const statWeeks = new Map([1, 2, 3].map((w) => [w, remap(playedStatLines(rows(SLEEPER_STATS(w))))] as const));
    const espn = Object.fromEntries(all.map((id) => [id, { 3: 10.5, 4: 11.25 }]));
    const loaded = sources({ weekly: { weeks: weekly, ...meta() }, stats: { weeks: statWeeks, ...meta() }, season: { perGame: remap(seasonPerGameLines(rows(SLEEPER_SEASON_QB))), ...meta() }, espn });

    let lines = 0;
    for (const m of weekly.values()) lines += m.size;
    expect(lines).toBeGreaterThan(6000);
    const log = vi.spyOn(console, "log");
    const t0 = performance.now();
    const out = assembleModelInputs(snap, loaded, NOW);
    const ms = performance.now() - t0;
    expect(Object.keys(out.players)).toHaveLength(420);
    expect(Object.keys(out.players[all[0] as string]?.sleeper ?? {})).toHaveLength(17);
    expect(ms).toBeLessThan(1000);
    expect(log).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// Loading: one request at a time, every failure a warning

/** Wraps a client to record the most requests ever in flight at once (a flood would show > 1). */
function serial(http: HttpClient): { http: HttpClient; maxInFlight: () => number } {
  let inFlight = 0;
  let max = 0;
  return {
    maxInFlight: () => max,
    http: {
      async get(url: string, opts?: HttpRequestOptions): Promise<HttpResponse> {
        inFlight++;
        max = Math.max(max, inFlight);
        try {
          await new Promise((resolve) => setTimeout(resolve, 0));
          return await http.get(url, opts);
        } finally {
          inFlight--;
        }
      },
    },
  };
}

/** Runs the fake clock until the promise settles (the real client's backoff and pacing sleeps). */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  void p.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 1_000 && !done; i++) await vi.advanceTimersByTimeAsync(100);
  return p;
}

const defenseId = (code: string) => ({ WSH: "WAS" })[code] ?? code;
const LOAD_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
/** Players in the committed Sleeper rows (public NFL players). */
const LOAD_PLAYERS: Record<string, PlayerInfo> = {
  "9221": info("9221", "Jahmyr Gibbs", "RB", { nflTeam: "DET" }),
  "11560": info("11560", "Caleb Williams", "QB", { nflTeam: "CHI" }),
  MIN: info("MIN", "Minnesota", "DEF", { nflTeam: "MIN" }),
};

function loadSnapshot(over: Partial<LeagueSnapshot> = {}, settings: Partial<LeagueSettings> = {}): LeagueSnapshot {
  return snapshot({ players: LOAD_PLAYERS, teams: [team("1", ["9221", "11560", "MIN"])], freeAgents: [], ...over }, settings);
}

/**
 * A /values/current body: a committed capture (trimmed to its top rows) plus fictional filler players
 * without ids up to `players` player rows, so it passes the loader's row floor (150 redraft, 300 dynasty).
 */
function valuesBody(label: string, players: number): unknown[] {
  const capture = shared<Array<{ player: { position: string } }>>(label);
  const have = capture.filter((r) => r.player.position !== "PICK").length;
  const filler = Array.from({ length: Math.max(0, players - have) }, (_, i) => ({ player: { id: 900_000 + i, name: `Filler ${i}`, position: "WR", sleeperId: null, espnId: null }, value: 1, redraftValue: 1 }));
  return [...capture, ...filler];
}

/** Every route a full load asks for, answered from the committed fixtures. */
function fullRoutes(s: LeagueSnapshot): Record<string, FakeRoute> {
  const routes: Record<string, FakeRoute> = {};
  const fetchedAt = Date.parse("2026-09-30T10:00:00Z");
  routes[nflScheduleUrl(2026)] = { json: shared(FIXTURE.espnProTeams), fetchedAt: fetchedAt - 24 * HOUR, fromCache: true };
  for (const w of modelWeekPlan(s, NOW).projectionWeeks) routes[sleeperUrls.projections(2026, w, LOAD_POSITIONS)] = { json: rows(SLEEPER_PROJ(w < 5 ? 4 : 5)), fetchedAt };
  routes[sleeperSeasonProjectionsUrl(2026, LOAD_POSITIONS)] = { json: rows(SLEEPER_SEASON_QB), fetchedAt };
  for (const w of modelWeekPlan(s, NOW).statsWeeks) routes[sleeperStatsUrl(2026, w, LOAD_POSITIONS)] = { json: rows(SLEEPER_STATS(Math.min(w, 3))), fetchedAt };
  const formats = marketFormats(s.settings);
  const dynasty = () => valuesBody("fantasycalc/values?isDynasty=true&numQbs=1&numTeams=12&ppr=1", FANTASYCALC_DYNASTY_MIN_PLAYERS);
  const redraft = () => valuesBody(FC_VALUES_10, FANTASYCALC_REDRAFT_MIN_PLAYERS);
  routes[fantasyCalcValuesUrl(formats.values)] = { json: formats.values.isDynasty ? dynasty() : redraft(), fetchedAt: fetchedAt - HOUR };
  if (formats.redraft) routes[fantasyCalcValuesUrl(formats.redraft)] = { json: redraft(), fetchedAt: fetchedAt - HOUR };
  if (formats.season) routes[fantasyCalcValuesUrl(formats.season)] = { json: redraft(), fetchedAt: fetchedAt - HOUR };
  routes[FANTASYCALC_PLAYERS_URL] = { json: fantasyCalcWith(fixtureFantasyCalcResponse() as unknown[]), fetchedAt };
  return routes;
}

describe("buildModelInputs (loading: §0.9 politeness, §2.10 caching)", () => {
  it("loads every source one request at a time, in order (schedule, weekly projections, season, stats, FantasyCalc), then assembles", async () => {
    const s = loadSnapshot();
    const fake = fakeHttp(fullRoutes(s));
    const client = serial(fake.http);
    const out = await buildModelInputs({ snapshot: s, http: client.http, resolver: { defenseId }, now: NOW });
    expect(client.maxInFlight()).toBe(1);
    const formats = marketFormats(s.settings);
    expect(fake.calls.map((c) => c.url)).toEqual([
      nflScheduleUrl(2026),
      ...weeks(1, 17).map((w) => sleeperUrls.projections(2026, w, LOAD_POSITIONS)),
      sleeperSeasonProjectionsUrl(2026, LOAD_POSITIONS),
      ...[1, 2, 3].map((w) => sleeperStatsUrl(2026, w, LOAD_POSITIONS)),
      fantasyCalcValuesUrl(formats.values),
      FANTASYCALC_PLAYERS_URL,
    ]);
    // The Sleeper requests share the adapter's cache entries (key sleeper:<url>, 6 hours).
    const projectionCall = fake.calls[1];
    expect(projectionCall?.opts?.cache).toMatchObject({ key: `sleeper:${projectionCall?.url}`, ttlMs: 6 * HOUR });

    expect(out.warnings).toEqual([]);
    expect(out.sources.map((x) => x.source)).toEqual(["Sleeper projections", "Sleeper stats", "FantasyCalc values", "NFL schedule (ESPN)"]);
    expect(out.sources[3]).toEqual({ source: "NFL schedule (ESPN)", fetchedAt: "2026-09-29T10:00:00.000Z" });
    const gibbs = projectionLines(rows(SLEEPER_PROJ(4))).get("9221");
    expect(out.players["9221"]?.sleeper[4]).toBe(roundPoints(expectedPoints(gibbs?.stats ?? {}, "RB", SCORING)));
    expect(Object.keys(out.players["9221"]?.sleeper ?? {})).toHaveLength(17);
    expect(out.nfl.byeWeek.WAS).toBeGreaterThan(0);
    expect(out.nfl.byeWeek).not.toHaveProperty("WSH");
    expect(out.nfl.lastWeek).toBe(18); // ESPN's week-18 games are all time-TBD, and still count
    // Opponents from the current week on, in Sleeper codes (WSH is WAS on both sides), time-TBD weeks included.
    expect(Object.keys(out.nfl.opponents ?? {}).map(Number)).toEqual(weeks(s.currentWeek, 18));
    expect(out.nfl.opponents?.[4]?.WAS).toEqual({ team: "IND", home: true });
    expect(out.nfl.opponents?.[4]?.IND).toEqual({ team: "WAS", home: false });
    expect(out.nfl.opponents?.[18]?.KC).toEqual({ team: "LV", home: true });
    expect(out.market?.values["9221"]).toBeGreaterThan(0);
    expect(out.notes[0]).toBe(`Trade values: FantasyCalc ${fantasyCalcFormatLabel(formats.values)}.`);
  });

  it("degrades every failing source to a warning and never throws; FantasyCalc isn't asked again once its values fail", async () => {
    const fake = fakeHttp({});
    const out = await buildModelInputs({ snapshot: loadSnapshot(), http: fake.http, resolver: { defenseId }, now: NOW });
    expect(out.warnings.map((w) => w.code)).toEqual(["NFL_SCHEDULE_UNAVAILABLE", "PROJECTIONS_WEEK_UNAVAILABLE", "SEASON_PROJECTIONS_UNAVAILABLE", "STATS_WEEK_UNAVAILABLE", "FANTASYCALC_UNAVAILABLE"]);
    expect(out.warnings[0]?.message).toBe("The NFL schedule couldn't be loaded (NFL schedule (ESPN): HTTP 404), so bye weeks are unknown and every remaining week counts as a game.");
    expect(out.warnings[1]?.message).toBe("Sleeper's projections for weeks 1–17 couldn't be read (HTTP 404), so those weeks are left out.");
    expect(out.warnings[4]?.message).toMatch(/^FantasyCalc's values couldn't be loaded \(FantasyCalc redraft values: HTTP 404\)/);
    expect(out).toMatchObject({ market: null, sources: [], nfl: { byeWeek: {}, kickoffs: {} }, notes: [] });
    expect(out.players["9221"]).toEqual({ sleeper: {}, actual: {} });
    expect(fake.calls.map((c) => c.url)).not.toContain(FANTASYCALC_PLAYERS_URL);
    for (const c of fake.calls) expect(c.url).not.toContain(" ");
  });

  it("a client that throws is a warning too, and Sleeper is asked once", async () => {
    const asked: string[] = [];
    const throwing: HttpClient = {
      get: async (url) => {
        asked.push(url);
        throw new TypeError("socket hang up");
      },
    };
    const out = await buildModelInputs({ snapshot: loadSnapshot(), http: throwing, resolver: { defenseId }, now: NOW });
    expect(out.warnings.map((w) => w.code)).toEqual(["NFL_SCHEDULE_UNAVAILABLE", "SLEEPER_DOWN", "FANTASYCALC_UNAVAILABLE"]);
    expect(out.warnings[1]?.message).toBe("Sleeper stopped answering (no response), so its projections for weeks 1–17, its season projections and its stats for weeks 1–3 are left out. Try again in a few minutes.");
    expect(asked.filter((u) => u.startsWith("https://api.sleeper.app/"))).toEqual([sleeperUrls.projections(2026, 1, LOAD_POSITIONS)]);
    expect(JSON.stringify(out.warnings)).not.toContain("socket hang up");
  });

  it("a Sleeper outage: the first failure stops the build's Sleeper requests (one warning says what's left out), and builds within the hold ask Sleeper nothing (review DATA-1, PERF-1)", async () => {
    const s = loadSnapshot();
    const routes = fullRoutes(s);
    for (const url of Object.keys(routes)) if (url.startsWith("https://api.sleeper.app/")) routes[url] = { status: 503, json: null };
    const fake = fakeHttp(routes);
    const sleeperCalls = () => fake.calls.filter((c) => c.url.startsWith("https://api.sleeper.app/")).length;
    const build = (now: Date) => buildModelInputs({ snapshot: s, http: fake.http, resolver: { defenseId }, now });
    const first = await build(NOW);
    expect(sleeperCalls()).toBe(1); // it was 21 URLs × 4 attempts
    const down = { code: "SLEEPER_DOWN", message: "Sleeper stopped answering (HTTP 503), so its projections for weeks 1–17, its season projections and its stats for weeks 1–3 are left out. Try again in a few minutes." };
    expect(first.warnings).toEqual([down]);
    expect(first.sources.map((x) => x.source)).toEqual([MODEL_SOURCES.fantasyCalc, MODEL_SOURCES.nflSchedule]); // the other sources still load
    expect(first.market?.values["9221"]).toBeGreaterThan(0);
    expect(first.players["9221"]).toEqual({ sleeper: {}, actual: {} });
    // The next build, a minute later (a new tab, a Refresh): Sleeper isn't asked at all.
    const next = await build(new Date(NOW.getTime() + 60_000));
    expect(sleeperCalls()).toBe(1);
    expect(next.warnings).toEqual([down]);
    // Once the hold is over, one request finds out whether it's back.
    await build(new Date(NOW.getTime() + SLEEPER_OUTAGE_HOLD_MS));
    expect(sleeperCalls()).toBe(2);
  });

  it("through the real client, a Sleeper outage costs a build 2 attempts and seconds, not 84 attempts and minutes", async () => {
    vi.useFakeTimers({ now: NOW });
    try {
      const s = loadSnapshot();
      const bodies = fullRoutes(s);
      const attempts: string[] = [];
      const fetchImpl = (async (url: string | URL) => {
        const u = String(url);
        attempts.push(u);
        if (u.startsWith("https://api.sleeper.app/")) return new Response("", { status: 503 });
        const route = bodies[u];
        const body = typeof route === "function" ? undefined : route?.json;
        return new Response(JSON.stringify(body ?? null), { status: route ? 200 : 404, headers: { "content-type": "application/json" } });
      }) as typeof fetch;
      const http = createHttpClient({ fetchImpl, cache: new MemoryCache() });
      const t0 = Date.now();
      const out = await settle(buildModelInputs({ snapshot: s, http, resolver: { defenseId }, now: NOW }));
      expect(attempts.filter((u) => u.startsWith("https://api.sleeper.app/"))).toEqual([sleeperUrls.projections(2026, 1, LOAD_POSITIONS), sleeperUrls.projections(2026, 1, LOAD_POSITIONS)]);
      expect(Date.now() - t0).toBeLessThan(10_000); // one backoff and the hosts' pacing (FantasyCalc's is 1.5 s)
      expect(out.warnings.map((w) => w.code)).toEqual(["SLEEPER_DOWN"]);
      expect(out.market?.values["9221"]).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failing FantasyCalc /players only narrows knownIds: the market still loads, with one warning, mid-season and after it (review TQ-2)", async () => {
    for (const currentWeek of [4, 18]) {
      const s = loadSnapshot({ currentWeek });
      const routes = fullRoutes(s);
      routes[FANTASYCALC_PLAYERS_URL] = { status: 503, json: null };
      const fake = fakeHttp(routes);
      const out = await buildModelInputs({ snapshot: s, http: fake.http, resolver: { defenseId }, now: NOW });
      expect(fake.calls.map((c) => c.url)).toContain(FANTASYCALC_PLAYERS_URL);
      expect(out.market?.values["9221"]).toBeGreaterThan(0);
      expect([...(out.market?.knownIds ?? [])].sort()).toEqual(Object.keys(out.market?.values ?? {}).sort());
      expect(out.warnings).toEqual([
        { code: "FANTASYCALC_PLAYERS_UNAVAILABLE", message: "FantasyCalc's player list couldn't be loaded (FantasyCalc players: HTTP 503), so only players with a value count as known to FantasyCalc.", platformPath: "players" },
      ]);
    }
  });

  it("a Sleeper loader that throws anyway (a bug) degrades to a warning, logged by the error's name only (review TQ-2)", async () => {
    const leak = `loader bug at ${sleeperStatsUrl(2026, 1, LOAD_POSITIONS)}`;
    vi.resetModules();
    vi.doMock("@/data/sleeperProjections", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/data/sleeperProjections")>()),
      loadSleeperStats: async () => {
        throw new Error(leak);
      },
    }));
    try {
      const { buildModelInputs: build } = await import("./modelInputs");
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const s = loadSnapshot();
      const out = await build({ snapshot: s, http: fakeHttp(fullRoutes(s)).http, resolver: { defenseId }, now: NOW });
      expect(out.warnings).toEqual([{ code: "SLEEPER_STATS_UNAVAILABLE", message: "Sleeper's stats couldn't be loaded, so they're left out.", platformPath: "stats" }]);
      expect(out.players["9221"]?.actual).toEqual({});
      expect(Object.keys(out.players["9221"]?.sleeper ?? {})).toHaveLength(17); // the other loads still ran
      expect(logged.mock.calls).toEqual([["[offer-sheet] model inputs: Sleeper stats failed unexpectedly (Error)"]]);
    } finally {
      vi.doUnmock("@/data/sleeperProjections");
      vi.resetModules();
    }
  });

  it("keeper leagues ask for the dynasty list, then the redraft list; a failing redraft list only narrows the market", async () => {
    const s = loadSnapshot({}, { leagueType: "keeper" });
    const formats = marketFormats(s.settings);
    const routes = fullRoutes(s);
    delete routes[fantasyCalcValuesUrl(formats.redraft as FantasyCalcFormat)];
    const fake = fakeHttp(routes);
    const out = await buildModelInputs({ snapshot: s, http: fake.http, resolver: { defenseId }, now: NOW });
    const fcCalls = fake.calls.map((c) => c.url).filter((u) => u.includes("fantasycalc"));
    expect(fcCalls).toEqual([fantasyCalcValuesUrl(formats.values), fantasyCalcValuesUrl(formats.redraft as FantasyCalcFormat), FANTASYCALC_PLAYERS_URL]);
    expect(out.market?.format.isDynasty).toBe(true);
    expect(out.market?.values["9221"]).toBeGreaterThan(0);
    expect(out.market).not.toHaveProperty("redraftValues");
    expect(out.warnings.map((w) => w.code)).toEqual(["FANTASYCALC_REDRAFT_UNAVAILABLE"]);
    expect(out.notes[0]).toBe(`Trade values: FantasyCalc ${fantasyCalcFormatLabel(formats.values)}.`);
  });

  it("keeper leagues whose dynasty list fails still get the redraft list, the one the League page shows; the market's format says the future term is missing (review DATA-2)", async () => {
    for (const currentWeek of [4, 18]) {
      const s = loadSnapshot({ currentWeek }, { leagueType: "keeper" });
      const formats = marketFormats(s.settings);
      const redraftFormat = formats.redraft as FantasyCalcFormat;
      const routes = fullRoutes(s);
      routes[fantasyCalcValuesUrl(formats.values)] = { status: 503, json: null };
      const fake = fakeHttp(routes);
      const out = await buildModelInputs({ snapshot: s, http: fake.http, resolver: { defenseId }, now: NOW });
      const fcCalls = fake.calls.filter((c) => c.url.includes("fantasycalc"));
      expect(fcCalls.map((c) => c.url)).toEqual([fantasyCalcValuesUrl(formats.values), fantasyCalcValuesUrl(redraftFormat), FANTASYCALC_PLAYERS_URL]);
      expect(fcCalls[1]?.opts?.maxRetries).toBe(0); // FantasyCalc didn't answer the first list: the second gets no retry
      expect(out.market?.format).toEqual(redraftFormat);
      expect(out.market?.format.isDynasty).toBe(false);
      expect(out.market?.values["9221"]).toBeGreaterThan(0);
      expect(out.market).not.toHaveProperty("redraftValues");
      expect(out.warnings).toEqual([
        { code: "FANTASYCALC_DYNASTY_UNAVAILABLE", message: "FantasyCalc's dynasty values couldn't be loaded (FantasyCalc dynasty values: HTTP 503), so this season's redraft values stand in for long-term worth.", platformPath: "values/current" },
      ]);
      expect(out.notes[0]).toBe(`Trade values: FantasyCalc ${fantasyCalcFormatLabel(redraftFormat)}.`);
      expect(out.sources.map((x) => x.source)).toContain(MODEL_SOURCES.fantasyCalc);
    }
  });

  it("keeper leagues: a dynasty list FantasyCalc answers unusably still leaves the redraft list its retry; both failing is one warning naming both, and /players isn't asked", async () => {
    const s = loadSnapshot({}, { leagueType: "keeper" });
    const formats = marketFormats(s.settings);
    const redraftUrl = fantasyCalcValuesUrl(formats.redraft as FantasyCalcFormat);
    const routes = fullRoutes(s);
    delete routes[fantasyCalcValuesUrl(formats.values)]; // 404: an answer
    const answered = fakeHttp(routes);
    await buildModelInputs({ snapshot: s, http: answered.http, resolver: { defenseId }, now: NOW });
    expect(answered.calls.find((c) => c.url === redraftUrl)?.opts?.maxRetries).toBe(1);

    delete routes[redraftUrl];
    const fake = fakeHttp(routes);
    const out = await buildModelInputs({ snapshot: s, http: fake.http, resolver: { defenseId }, now: NOW });
    expect(fake.calls.map((c) => c.url).filter((u) => u.includes("fantasycalc"))).toEqual([fantasyCalcValuesUrl(formats.values), redraftUrl]);
    expect(out.market).toBeNull();
    expect(out.warnings).toEqual([
      {
        code: "FANTASYCALC_UNAVAILABLE",
        message: "FantasyCalc's values couldn't be loaded (FantasyCalc dynasty values: HTTP 404; FantasyCalc redraft values: HTTP 404), so players have no market values yet.",
        platformPath: "values/current",
      },
    ]);
  });

  it("before the season has started (a league renewed in February for next season), asks FantasyCalc only, and says why (review DATA-3)", async () => {
    const feb = new Date("2027-02-05T12:00:00.000Z");
    const s = loadSnapshot({ season: 2027, currentWeek: 1, platform: "espn" }, { leagueType: "dynasty" });
    const routes = fullRoutes(s);
    // Anything 2027 asked for anyway would answer (empty or unpublished) and show up in the calls.
    routes[nflScheduleUrl(2027)] = { json: { settings: { proTeams: [] } } };
    for (const w of weeks(1, 18)) routes[sleeperUrls.projections(2027, w, LOAD_POSITIONS)] = { json: [] };
    routes[sleeperSeasonProjectionsUrl(2027, LOAD_POSITIONS)] = { json: [] };
    const fake = fakeHttp(routes);
    const out = await buildModelInputs({ snapshot: s, http: fake.http, resolver: { defenseId }, now: feb });
    expect(fake.calls.map((c) => c.url)).toEqual([fantasyCalcValuesUrl(marketFormats(s.settings).values), FANTASYCALC_PLAYERS_URL]);
    expect(out.warnings.map((w) => w.code)).toEqual(["SEASON_NOT_STARTED"]);
    expect(out.market?.format.isDynasty).toBe(true);
    expect(out.sources.map((x) => x.source)).toEqual([MODEL_SOURCES.fantasyCalc]);
    expect(out.players["9221"]).toEqual({ sleeper: {}, actual: {} });
    // August, the same season's preseason: everything is asked for as usual.
    const august = loadSnapshot({ currentWeek: 1 });
    const pre = fakeHttp(fullRoutes(august));
    await buildModelInputs({ snapshot: august, http: pre.http, resolver: { defenseId }, now: new Date("2026-08-15T12:00:00.000Z") });
    expect(pre.calls.map((c) => c.url)).toEqual(expect.arrayContaining([nflScheduleUrl(2026), ...weeks(1, 17).map((w) => sleeperUrls.projections(2026, w, LOAD_POSITIONS)), sleeperSeasonProjectionsUrl(2026, LOAD_POSITIONS)]));
  });

  it("once the season is over, asks FantasyCalc only: no NFL schedule, projections, season projections or stats (nothing is left to project), and passes ESPN's projections through", async () => {
    const s = loadSnapshot({ currentWeek: 18, platform: "espn" });
    const routes = fullRoutes(s);
    // Answers for everything a mid-season load asks for, so a request made anyway would succeed and show up only in the calls.
    routes[nflScheduleUrl(2026)] = { json: shared(FIXTURE.espnProTeams) };
    for (const w of weeks(1, 18)) {
      routes[sleeperUrls.projections(2026, w, LOAD_POSITIONS)] = { json: rows(SLEEPER_PROJ(4)) };
      routes[sleeperStatsUrl(2026, w, LOAD_POSITIONS)] = { json: rows(SLEEPER_STATS(3)) };
    }
    routes[sleeperSeasonProjectionsUrl(2026, LOAD_POSITIONS)] = { json: rows(SLEEPER_SEASON_QB) };
    const fake = fakeHttp(routes);
    const out = await buildModelInputs({ snapshot: s, http: fake.http, resolver: { defenseId }, now: NOW, espn: { "9221": { 17: 14.456 } } });
    expect(fake.calls.map((c) => c.url)).toEqual([fantasyCalcValuesUrl(marketFormats(s.settings).values), FANTASYCALC_PLAYERS_URL]);
    expect(out.warnings).toEqual([]);
    expect(out).toMatchObject({ currentWeek: 18, lastWeek: 17, nfl: { byeWeek: {}, kickoffs: {} } });
    expect(out.sources.map((x) => x.source)).toEqual([MODEL_SOURCES.fantasyCalc]);
    expect(out.market?.values["9221"]).toBeGreaterThan(0);
    expect(out.players["9221"]).toMatchObject({ sleeper: {}, actual: {}, espn: { 17: 14.46 } });
    expect(out.espnProjections).toBe(true);
  });

  it("once the season is over, a keeper league still gets its dynasty and redraft values (long-term worth still matters)", async () => {
    const s = loadSnapshot({ currentWeek: 18 }, { leagueType: "keeper" });
    const formats = marketFormats(s.settings);
    const fake = fakeHttp(fullRoutes(s));
    const out = await buildModelInputs({ snapshot: s, http: fake.http, resolver: { defenseId }, now: NOW });
    expect(fake.calls.map((c) => c.url)).toEqual([fantasyCalcValuesUrl(formats.values), fantasyCalcValuesUrl(formats.redraft as FantasyCalcFormat), FANTASYCALC_PLAYERS_URL]);
    expect(out.market?.format.isDynasty).toBe(true);
    expect(out.market?.redraftValues?.["9221"]).toBeGreaterThan(0);
    expect(out.warnings).toEqual([]);
  });

  it("dynasty leagues ask for their dynasty list, then this season's list in their format (the market blend's, §6 step 8), then /players; perception keeps the dynasty values", async () => {
    const s = loadSnapshot({}, { leagueType: "dynasty" });
    const formats = marketFormats(s.settings);
    const seasonFormat = formats.season as FantasyCalcFormat;
    const fake = fakeHttp(fullRoutes(s));
    const out = await buildModelInputs({ snapshot: s, http: fake.http, resolver: { defenseId }, now: NOW });
    expect(fake.calls.map((c) => c.url).filter((u) => u.includes("fantasycalc"))).toEqual([fantasyCalcValuesUrl(formats.values), fantasyCalcValuesUrl(seasonFormat), FANTASYCALC_PLAYERS_URL]);
    expect(out.market?.format.isDynasty).toBe(true);
    expect(out.market?.values["9221"]).toBeGreaterThan(0);
    expect(out.market?.seasonValues?.["9221"]).toBeGreaterThan(0);
    expect(out.market?.seasonValues?.["9221"]).not.toBe(out.market?.values["9221"]); // two lists, two values
    expect(out.market).not.toHaveProperty("redraftValues");
    expect(out.warnings).toEqual([]);
    expect(out.notes).toEqual(fantasyCalcNotes(formats.values)); // no note of its own for the season list
    // FantasyCalc answered the first list, so the season list keeps its retry.
    expect(fake.calls.find((c) => c.url === fantasyCalcValuesUrl(seasonFormat))?.opts?.maxRetries).toBe(1);
  });

  it("right after a saved copy stood in for the first list (FantasyCalc failed to answer it), a later list is asked once, without a retry: dynasty and keeper leagues (review of track A)", async () => {
    const dynasty = loadSnapshot({}, { leagueType: "dynasty" });
    const formats = marketFormats(dynasty.settings);
    const routes = fullRoutes(dynasty);
    routes[fantasyCalcValuesUrl(formats.values)] = { ...(routes[fantasyCalcValuesUrl(formats.values)] as FakeRoute), stale: true };
    const fake = fakeHttp(routes);
    const out = await buildModelInputs({ snapshot: dynasty, http: fake.http, resolver: { defenseId }, now: NOW });
    expect(fake.calls.find((c) => c.url === fantasyCalcValuesUrl(formats.season as FantasyCalcFormat))?.opts?.maxRetries).toBe(0);
    expect(out.market?.seasonValues?.["9221"]).toBeGreaterThan(0); // a fresh or saved copy still serves
    expect(out.sources.find((x) => x.source === MODEL_SOURCES.fantasyCalc)?.stale).toBe(true);

    const keeper = loadSnapshot({}, { leagueType: "keeper" });
    const keeperFormats = marketFormats(keeper.settings);
    const keeperRoutes = fullRoutes(keeper);
    keeperRoutes[fantasyCalcValuesUrl(keeperFormats.values)] = { ...(keeperRoutes[fantasyCalcValuesUrl(keeperFormats.values)] as FakeRoute), stale: true };
    const keeperFake = fakeHttp(keeperRoutes);
    const keeperOut = await buildModelInputs({ snapshot: keeper, http: keeperFake.http, resolver: { defenseId }, now: NOW });
    expect(keeperFake.calls.find((c) => c.url === fantasyCalcValuesUrl(keeperFormats.redraft as FantasyCalcFormat))?.opts?.maxRetries).toBe(0);
    expect(keeperOut.market?.redraftValues?.["9221"]).toBeGreaterThan(0);
  });

  it("dynasty leagues: this season's list failing only leaves the blend off (the League model says so); their own list failing isn't followed by it", async () => {
    const s = loadSnapshot({}, { leagueType: "dynasty" });
    const formats = marketFormats(s.settings);
    const routes = fullRoutes(s);
    routes[fantasyCalcValuesUrl(formats.season as FantasyCalcFormat)] = { status: 503, json: null };
    const out = await buildModelInputs({ snapshot: s, http: fakeHttp(routes).http, resolver: { defenseId }, now: NOW });
    expect(out.market?.values["9221"]).toBeGreaterThan(0);
    expect(out.market).not.toHaveProperty("seasonValues");
    expect(out.warnings).toEqual([]);
    expect(out.notes).toEqual(fantasyCalcNotes(formats.values));

    const ownDown = fullRoutes(s);
    ownDown[fantasyCalcValuesUrl(formats.values)] = { status: 503, json: null };
    const fake = fakeHttp(ownDown);
    const none = await buildModelInputs({ snapshot: s, http: fake.http, resolver: { defenseId }, now: NOW });
    expect(fake.calls.map((c) => c.url).filter((u) => u.includes("fantasycalc"))).toEqual([fantasyCalcValuesUrl(formats.values)]);
    expect(none.market).toBeNull();
    expect(none.warnings.map((w) => w.code)).toEqual(["FANTASYCALC_UNAVAILABLE"]);
  });

  it("dynasty leagues once the season is over: no season list (nothing is left to project, so nothing to blend)", async () => {
    const s = loadSnapshot({ currentWeek: 18 }, { leagueType: "dynasty" });
    const fake = fakeHttp(fullRoutes(s));
    const out = await buildModelInputs({ snapshot: s, http: fake.http, resolver: { defenseId }, now: NOW });
    expect(fake.calls.map((c) => c.url)).toEqual([fantasyCalcValuesUrl(marketFormats(s.settings).values), FANTASYCALC_PLAYERS_URL]);
    expect(out.market?.format.isDynasty).toBe(true);
    expect(out.market).not.toHaveProperty("seasonValues");
  });
});

// ---------------------------------------------------------------------------------------------
// Per-week projection caching and the pre-game projection archive (CLAUDE.md §2.10, §2.3)

/** An archiver that records what it's given and answers `outcome` (default: a promise that never settles). */
function recordingArchiver(outcome?: ArchiveOutcome): { archiver: ProjectionArchiver; inputs: ProjectionArchiveInput[] } {
  const inputs: ProjectionArchiveInput[] = [];
  return {
    inputs,
    archiver: {
      archive: (i) => {
        inputs.push(i);
        return outcome ? Promise.resolve(outcome) : new Promise<ArchiveOutcome>(() => {});
      },
      flush: async () => {},
    },
  };
}

/** The committed NFL schedule, keyed as buildModelInputs keys it. */
const fixtureSchedule = () => reduceNflSchedule(shared<NflScheduleResponse>(FIXTURE.espnProTeams), defenseId);

describe("buildModelInputs: per-week projection caching and the pre-game archive (§2.10, §2.3)", () => {
  it("caches each projection week under its own policy: served 6 hours through two weeks after the current one, 24 hours later, and kept 24 hours either way", async () => {
    const s = loadSnapshot();
    const fake = fakeHttp(fullRoutes(s));
    await buildModelInputs({ snapshot: s, http: fake.http, resolver: { defenseId }, now: NOW, projectionArchive: null });
    const projectionCalls = fake.calls.filter((c) => c.url.startsWith("https://api.sleeper.app/projections/nfl/2026/"));
    expect(projectionCalls).toHaveLength(17);
    for (const c of projectionCalls) {
      const week = Number(/\/2026\/(\d+)\?/.exec(c.url)?.[1]);
      const ttl = week <= 6 ? TTL.projections : TTL.projectionsLater;
      expect(c.opts?.cache, `week ${week}`).toEqual({ key: `sleeper:${c.url}`, ttlMs: ttl, retainMs: TTL.projectionsLater });
    }
    // The season projections and the stats keep 6 hours.
    for (const c of fake.calls.filter((x) => x.url.startsWith("https://api.sleeper.app/") && !projectionCalls.includes(x))) expect(c.opts?.cache?.ttlMs).toBe(TTL.projections);
  });

  it("hands every projection week it reads to the archive with the current week and that week's first kickoff, and doesn't wait for it", async () => {
    const s = loadSnapshot();
    const { archiver, inputs } = recordingArchiver(); // its promises never settle: the build must not wait on them
    const out = await buildModelInputs({ snapshot: s, http: fakeHttp(fullRoutes(s)).http, resolver: { defenseId }, now: NOW, projectionArchive: archiver });
    expect(out.warnings).toEqual([]);
    const schedule = fixtureSchedule();
    expect(inputs.map((i) => i.week)).toEqual(weeks(1, 17));
    for (const i of inputs) {
      expect(i, `week ${i.week}`).toMatchObject({ season: 2026, currentWeek: 4, positions: LOAD_POSITIONS, firstKickoff: firstKickoffOf(schedule, i.week) });
      expect(i.res.fetchedAt).toBe(Date.parse("2026-09-30T10:00:00Z"));
      expect(i.rows.length).toBeGreaterThan(100);
    }
    expect(inputs[3]?.firstKickoff).toBe(Date.parse("2026-10-02T00:15:00Z")); // week 4 opens on Thursday night (US time)
  });

  it("without the NFL schedule, every week's first kickoff is unknown (so only weeks after the current one can be archived)", async () => {
    const s = loadSnapshot();
    const routes = fullRoutes(s);
    delete routes[nflScheduleUrl(2026)];
    const { archiver, inputs } = recordingArchiver({ status: "skipped", reason: "kickoff unknown" });
    const out = await buildModelInputs({ snapshot: s, http: fakeHttp(routes).http, resolver: { defenseId }, now: NOW, projectionArchive: archiver });
    expect(out.warnings.map((w) => w.code)).toEqual(["NFL_SCHEDULE_UNAVAILABLE"]);
    expect(inputs).toHaveLength(17);
    expect(inputs.every((i) => i.firstKickoff === null)).toBe(true);
  });

  it("uses the process's archive when none is passed (off under Vitest), and none when passed null", async () => {
    const { archiver, inputs } = recordingArchiver({ status: "unchanged", file: "x" });
    vi.resetModules();
    vi.doMock("./projectionArchive", async (importOriginal) => ({ ...(await importOriginal<typeof import("./projectionArchive")>()), defaultProjectionArchiver: () => archiver }));
    try {
      const { buildModelInputs: build } = await import("./modelInputs");
      const s = loadSnapshot();
      await build({ snapshot: s, http: fakeHttp(fullRoutes(s)).http, resolver: { defenseId }, now: NOW });
      expect(inputs).toHaveLength(17);
      await build({ snapshot: s, http: fakeHttp(fullRoutes(s)).http, resolver: { defenseId }, now: NOW, projectionArchive: null });
      expect(inputs).toHaveLength(17);
    } finally {
      vi.doUnmock("./projectionArchive");
      vi.resetModules();
    }
  });

  it("through the real archive: the weeks still ahead of their first kickoff are archived, the weeks already played aren't", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "offer-sheet-model-archive-"));
    try {
      const s = loadSnapshot();
      const archiver = createProjectionArchiver({ root: dir });
      const outcomes: Array<Promise<ArchiveOutcome>> = [];
      const spying: ProjectionArchiver = { archive: (i) => (outcomes.push(archiver.archive(i)), outcomes.at(-1) as Promise<ArchiveOutcome>), flush: () => archiver.flush() };
      await buildModelInputs({ snapshot: s, http: fakeHttp(fullRoutes(s)).http, resolver: { defenseId }, now: NOW, projectionArchive: spying });
      await archiver.flush();
      const done = await Promise.all(outcomes);
      expect(done.slice(0, 3)).toEqual([1, 2, 3].map(() => ({ status: "skipped", reason: "after kickoff" })));
      expect(done.slice(3).map((o) => o.status)).toEqual(weeks(4, 17).map(() => "archived"));
      const week4 = await readProjectionSnapshot(projectionSnapshotFile(dir, 2026, 4));
      expect(week4).toMatchObject({ version: 1, season: 2026, week: 4, firstKickoff: "2026-10-02T00:15:00.000Z" });
      expect(Object.keys(week4?.groups ?? {})).toEqual(LOAD_POSITIONS);
      expect(week4?.groups.RB?.fetchedAt).toBe("2026-09-30T10:00:00.000Z");
      expect(week4?.groups.RB?.players["9221"]?.pos).toBe("RB");
      expect(await readProjectionSnapshot(projectionSnapshotFile(dir, 2026, 3))).toBeNull();
      // The next build reads the same cached copies: nothing new to write.
      const again: Array<Promise<ArchiveOutcome>> = [];
      await buildModelInputs({
        snapshot: s,
        http: fakeHttp(fullRoutes(s)).http,
        resolver: { defenseId },
        now: new Date(NOW.getTime() + 60_000),
        projectionArchive: { archive: (i) => (again.push(archiver.archive(i)), again.at(-1) as Promise<ArchiveOutcome>), flush: () => archiver.flush() },
      });
      expect((await Promise.all(again)).slice(3).map((o) => o.status)).toEqual(weeks(4, 17).map(() => "unchanged"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
