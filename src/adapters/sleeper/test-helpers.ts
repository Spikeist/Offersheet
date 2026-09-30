/**
 * Test-only helpers for the Sleeper adapter tests: the minimized test-league fixtures
 * (fixtures/sanitized/min/sleeper/test-league/, built by scripts/minimize/sleeper.ts), a
 * PlayerIdResolver backed by their player facts (a fake one, or the real crosswalk built with
 * resolverFromData), and a fake HttpClient that serves them by URL. No network. Not imported by app
 * code.
 */
import type { HttpClient, HttpRequestOptions, HttpResponse } from "@/adapters/types";
import { resolverFromData, SLEEPER_PLAYER_POSITIONS, type CrosswalkData, type DynastyRow, type SleeperPlayerRecord } from "@/data";
import type { PlayerIdResolver, SleeperPlayerLite } from "@/data/types";
import { readMinFixture, readSanitizedFixture } from "@/test-utils/fixtures";
import type { SleeperRawLeague } from "./normalize";

const GROUP = "test-league";

export interface TestLeagueMeta {
  season: number;
  currentWeek: number;
  lastScoredWeek: number;
  oracleWeeks: number[];
  projectionWeek: number;
  me: { userId: string; rosterId: number; via: string };
  txLegs: number[];
}

/* eslint-disable @typescript-eslint/no-explicit-any -- raw API captures */
export interface TestLeague {
  meta: TestLeagueMeta;
  state: any;
  league: any;
  users: any[];
  rosters: any[];
  matchups: Record<number, any[]>;
  transactions: Record<number, any[]>;
  tradedPicks: any[];
  drafts: any[];
  projections: any[];
  stats: Record<number, Array<{ player_id: string; stats: Record<string, number> }>>;
  players: SleeperPlayerLite[];
}

/** A fresh deep copy each call, so tests can mutate it. */
export function loadTestLeague(): TestLeague {
  const read = <T = any>(label: string): T => structuredClone(readMinFixture<T>("sleeper", GROUP, label));
  const meta = read<TestLeagueMeta>("meta");
  const matchups: Record<number, any[]> = {};
  for (let w = 1; w <= 15; w++) matchups[w] = read(`matchups/${w}`);
  const transactions: Record<number, any[]> = {};
  for (const leg of meta.txLegs) transactions[leg] = read(`transactions/${leg}`);
  const stats: TestLeague["stats"] = {};
  for (const w of meta.oracleWeeks) stats[w] = read(`stats/${w}`);
  return {
    meta,
    state: structuredClone(readSanitizedFixture("sleeper", "state/nfl")),
    league: read("league"),
    users: read("users"),
    rosters: read("rosters"),
    matchups,
    transactions,
    tradedPicks: read("traded_picks"),
    drafts: read("drafts"),
    projections: read(`projections/${meta.projectionWeek}`),
    stats,
    players: read("players"),
  };
}

/** The raw bundle normalizeSleeperLeague() takes, as the fetch half would collect it (one projection week). */
export function rawOf(t: TestLeague): SleeperRawLeague {
  return {
    state: t.state,
    league: t.league,
    users: t.users,
    rosters: t.rosters,
    matchups: t.matchups,
    transactions: t.transactions,
    tradedPicks: t.tradedPicks,
    drafts: t.drafts,
    projections: { [t.meta.projectionWeek]: t.projections },
    projectionWeek: t.meta.projectionWeek,
  };
}

export function fakeResolver(players: SleeperPlayerLite[]): PlayerIdResolver {
  const byId = new Map(players.map((p) => [p.id, p]));
  return {
    canonical: () => undefined,
    sleeperPlayer: (id) => byId.get(id),
    defenseId: (code) => code,
    sources: () => [{ name: "test fixtures", fetchedAt: null }],
  };
}

/** DynastyProcess positions for Sleeper positions (src/data/crosswalk.ts reads them back). */
const DP_POSITION: Readonly<Record<string, string>> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "PK", P: "PN", DE: "DE", DT: "DT", LB: "LB", CB: "CB", S: "S" };

const toRecord = (p: SleeperPlayerLite): SleeperPlayerRecord => ({ ...p, fantasyPositions: [...p.fantasyPositions], firstName: null, lastName: null, espnId: null, yahooId: null, sportradarId: null, gsisId: null });

/** A DynastyProcess row for a player (no platform ids; team codes in Sleeper's convention). */
function dynastyRowOf(p: SleeperPlayerLite): DynastyRow | undefined {
  const position = p.position ? DP_POSITION[p.position] : undefined;
  if (!position) return undefined; // team defenses aren't in DynastyProcess
  return { sleeperId: p.id, espnId: null, yahooId: null, mflId: null, fleaflickerId: null, sportradarId: null, gsisId: null, name: p.name, position, team: p.team };
}

/** Every Sleeper player list (one per position), for a players DB that loaded fully. */
export const ALL_SLEEPER_LISTS: readonly string[] = SLEEPER_PLAYER_POSITIONS;

/**
 * The REAL crosswalk (src/data resolverFromData), as production builds it: `sleeper` is what the
 * Sleeper players DB returned (null = unavailable), `complete` the position lists that loaded fully
 * (the loader's SleeperPlayersLoad.complete), `dynasty` the players DynastyProcess has rows for,
 * `notes` the loader's notes (e.g. a position list that failed).
 */
export function crosswalkResolver(opts: { sleeper: SleeperPlayerLite[] | null; complete?: readonly string[]; dynasty: SleeperPlayerLite[]; notes?: CrosswalkData["notes"] }): PlayerIdResolver {
  return resolverFromData({
    sleeperPlayers: opts.sleeper ? opts.sleeper.map(toRecord) : null,
    ...(opts.complete ? { sleeperCompletePositions: opts.complete } : {}),
    dynastyRows: opts.dynasty.map(dynastyRowOf).filter((r): r is DynastyRow => !!r),
    fantasyCalcPlayers: [],
    ...(opts.notes ? { notes: opts.notes } : {}),
  });
}

/**
 * A /projections row for a player as production gets it: a real projection and the embedded player
 * object (the committed fixture keeps player objects on two rows only).
 */
export function projectionRowOf(p: SleeperPlayerLite, stats: Record<string, number>, week: number): Record<string, unknown> {
  const [first, ...rest] = p.name.split(" ");
  return {
    player_id: p.id,
    week,
    stats,
    player: { position: p.position, fantasy_positions: p.fantasyPositions, team: p.team, first_name: first ?? p.name, last_name: rest.join(" "), injury_status: p.injuryStatus },
  };
}

export function json(body: unknown, status = 200): HttpResponse {
  return { status, ok: status >= 200 && status < 300, isHtml: false, json: body, text: JSON.stringify(body), fromCache: false };
}

export interface FakeHttp extends HttpClient {
  calls: Array<{ url: string; opts: HttpRequestOptions | undefined }>;
}

/** Serves `routes` by exact URL; any other URL answers `fallback` (default: 404). */
export function fakeHttp(routes: Map<string, HttpResponse | (() => HttpResponse)>, fallback: HttpResponse = json(null, 404)): FakeHttp {
  const calls: FakeHttp["calls"] = [];
  return {
    calls,
    async get(url, opts) {
      calls.push({ url, opts });
      const r = routes.get(url);
      return typeof r === "function" ? r() : (r ?? fallback);
    },
  };
}
