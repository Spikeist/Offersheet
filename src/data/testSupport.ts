/**
 * TEST-ONLY helpers (imported by src/data/*.test.ts, never by app code): crosswalk inputs built from
 * committed fixtures, with no network.
 *
 * - fixtures/sanitized/shared/: public, league-independent captures from Phase 0 (a DynastyProcess
 *   subset, FantasyCalc's first 100 /players, Sleeper projection and stats rows that embed the
 *   player objects, ESPN proTeams, nflverse games).
 * - fixtures/sanitized/espn/: Parker's league, sanitized (placeholder team and owner names).
 */
import { readFileSync } from "node:fs";
import type { HttpClient, HttpRequestOptions, HttpResponse } from "@/adapters/types";
import { fixtureLabels, readSanitizedFixture, sanitizedFixturePath } from "@/test-utils/fixtures";
import { DYNASTYPROCESS_MIN_ROWS, parseDynastyProcessCsv, type DynastyRow } from "./dynastyProcess";
import { FANTASYCALC_MIN_ROWS, fantasyCalcPlayersSchema, reduceFantasyCalcPlayers, type FantasyCalcPlayerIds } from "./fantasyCalcPlayers";
import { reduceSleeperPlayers, SLEEPER_LIST_MIN_ROWS, SLEEPER_PLAYER_POSITIONS, sleeperPlayersSchema, type SleeperPlayerRecord } from "./sleeperPlayers";
import { SLEEPER_TEAM_CODES } from "./teamCodes";

export const FIXTURE = {
  dynastyProcess: "dynastyprocess/db_playerids (rows for active Sleeper QB/RB/WR/TE/K)",
  fantasyCalcPlayers: "fantasycalc/players (first 100)",
  espnProTeams: "espn/seasons/2026?view=proTeamSchedules_wl",
  nflverseGames: "nflverse/games 2026 REG",
  espnLeague: "league/{leagueId}/view=mSettings+mTeam+mRoster+mMatchup+mStatus",
} as const;

export function fixtureDynastyCsv(): string {
  return readFileSync(sanitizedFixturePath("shared", FIXTURE.dynastyProcess, ".csv"), "utf8");
}

export function fixtureDynastyRows(): DynastyRow[] {
  return parseDynastyProcessCsv(fixtureDynastyCsv());
}

export function fixtureFantasyCalcResponse(): unknown {
  return readSanitizedFixture("shared", FIXTURE.fantasyCalcPlayers);
}

export function fixtureFantasyCalcPlayers(): FantasyCalcPlayerIds[] {
  return reduceFantasyCalcPlayers(fantasyCalcPlayersSchema.parse(fixtureFantasyCalcResponse()));
}

interface SleeperStatRow {
  player_id: string;
  player?: Record<string, unknown>;
}

/**
 * The player objects embedded in the committed Sleeper projection and stats rows, keyed by
 * player_id the way /v1/players/nfl keys them (a subset of its fields; no platform ids).
 */
export function fixtureSleeperResponse(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const label of fixtureLabels("fixtures/sanitized/shared").filter((l) => l.startsWith("sleeper/"))) {
    for (const row of readSanitizedFixture<SleeperStatRow[]>("shared", label)) if (row.player && !out[row.player_id]) out[row.player_id] = row.player;
  }
  return out;
}

export function fixtureSleeperPlayers(): SleeperPlayerRecord[] {
  return reduceSleeperPlayers(sleeperPlayersSchema.parse(fixtureSleeperResponse()));
}

export interface EspnProTeam {
  id: number;
  abbrev: string;
  location: string;
  name: string;
  proGamesByScoringPeriod?: Record<string, Array<{ id: number; homeProTeamId: number; awayProTeamId: number }>>;
}

/** ESPN's 32 NFL teams (the "FA" pseudo-team, id 0, dropped). */
export function fixtureEspnProTeams(): EspnProTeam[] {
  return readSanitizedFixture<{ settings: { proTeams: EspnProTeam[] } }>("shared", FIXTURE.espnProTeams).settings.proTeams.filter((t) => t.id !== 0);
}

export interface NflverseGame {
  week: number;
  awayTeam: string;
  homeTeam: string;
  espnEventId: string | null;
}

export function fixtureNflverseGames(): NflverseGame[] {
  return readSanitizedFixture<NflverseGame[]>("shared", FIXTURE.nflverseGames);
}

/** ESPN defaultPositionId → position, for the positions Parker's league rosters (Phase 0 E.defaultPosition). */
const ESPN_POSITION: Record<number, string> = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };

export interface EspnRosteredPlayer {
  espnId: string;
  /** Public NFL player name (for reporting misses). */
  name: string;
  pos: string;
  proTeamId: number;
}

/** Every rostered player in Parker's league (sanitized fixture: team and owner names are placeholders). */
export function fixtureEspnRostered(): EspnRosteredPlayer[] {
  const league = readSanitizedFixture<{
    teams: { roster: { entries: { playerPoolEntry: { player: { id: number; fullName: string; defaultPositionId: number; proTeamId: number } } }[] } }[];
  }>("espn", FIXTURE.espnLeague);
  return league.teams.flatMap((t) =>
    t.roster.entries.map(({ playerPoolEntry: { player: p } }) => ({ espnId: String(p.id), name: p.fullName, pos: ESPN_POSITION[p.defaultPositionId] ?? `ESPN ${p.defaultPositionId}`, proTeamId: p.proTeamId })),
  );
}

// ---- Filler rows: canned source bodies must meet the loaders' row floors. Fictional players only.

type SleeperList = Record<string, Record<string, unknown>>;

/**
 * A Sleeper /players list for `position`: the given rows plus fictional filler players ("Filler
 * 801000"…, no platform ids) up to `rows`. Like real lists, the fillers are spread over the NFL teams
 * (any three lists together hold all 32 codes).
 */
export function sleeperListWith(position: string, players: SleeperList = {}, rows = SLEEPER_LIST_MIN_ROWS): SleeperList {
  const out: SleeperList = { ...players };
  const base = 800_000 + 1_000 * (SLEEPER_PLAYER_POSITIONS.indexOf(position as (typeof SLEEPER_PLAYER_POSITIONS)[number]) + 1);
  for (let i = 0; Object.keys(out).length < rows; i++) {
    const id = base + i;
    out[String(id)] = { full_name: `Filler ${id}`, position, fantasy_positions: [position], team: SLEEPER_TEAM_CODES[id % SLEEPER_TEAM_CODES.length], active: true };
  }
  return out;
}

/** Sleeper's DEF list: one row per team code (placeholder names unless given, e.g. DAL: Dallas Cowboys). */
export function sleeperDefList(named: SleeperList = {}): SleeperList {
  return Object.fromEntries(
    SLEEPER_TEAM_CODES.map((code) => [code, { first_name: code, last_name: `Team ${code}`, position: "DEF", fantasy_positions: ["DEF"], team: code, active: true, ...named[code] }]),
  );
}

/** Every Sleeper list route, meeting the row floors: `lists[position]` rows plus filler (DEF: the 32 teams). */
export function sleeperListsWith(lists: Partial<Record<string, SleeperList>> = {}): Record<string, SleeperList> {
  return Object.fromEntries(SLEEPER_PLAYER_POSITIONS.map((p) => [p, p === "DEF" ? sleeperDefList(lists.DEF) : sleeperListWith(p, lists[p])]));
}

const fillerCsvCache = new Map<string, string>();

/**
 * A DynastyProcess CSV padded with `rows` filler lines ("NA" ids, name "Filler N", position XX) in the
 * CSV's own column order, so it meets DYNASTYPROCESS_MIN_ROWS whatever it already holds.
 */
export function padDynastyCsv(csv: string, rows = DYNASTYPROCESS_MIN_ROWS): string {
  const header = csv.slice(0, csv.indexOf("\n")).replace(/\r$/, "");
  const key = `${header}\u0000${rows}`;
  let filler = fillerCsvCache.get(key);
  if (filler === undefined) {
    const columns = header.split(",").map((c) => c.trim());
    filler = Array.from({ length: rows }, (_, i) => columns.map((c) => (c === "name" ? `Filler ${i}` : c === "position" ? "XX" : "NA")).join(",")).join("\n");
    fillerCsvCache.set(key, filler);
  }
  return `${csv.endsWith("\n") ? csv : `${csv}\n`}${filler}\n`;
}

/** A FantasyCalc /players body: the given rows plus fictional filler players with no ids, up to `rows`. */
export function fantasyCalcWith(players: unknown[], rows = FANTASYCALC_MIN_ROWS): unknown[] {
  const filler = Array.from({ length: Math.max(0, rows - players.length) }, (_, i) => ({ id: 900_000 + i, name: `Filler ${i}`, position: "WR", sleeperId: null, espnId: null, mflId: null, fleaflickerId: null, maybeTeam: null }));
  return [...players, ...filler];
}

export interface FakeRoute {
  status?: number;
  json?: unknown;
  /** Raw body (CSV); defaults to JSON.stringify(json). */
  text?: string;
  isHtml?: boolean;
  fromCache?: boolean;
  /** A saved copy served because the live request failed (HttpResponse.stale). */
  stale?: boolean;
  fetchedAt?: number;
}

/**
 * An HttpClient that serves canned responses by exact URL (unknown URLs → 404) and records every
 * call with its options. A route can be a function of how many times its URL was requested.
 */
export function fakeHttp(routes: Record<string, FakeRoute | ((attempt: number) => FakeRoute)>): { http: HttpClient; calls: { url: string; opts?: HttpRequestOptions }[] } {
  const calls: { url: string; opts?: HttpRequestOptions }[] = [];
  const http: HttpClient = {
    async get(url: string, opts?: HttpRequestOptions): Promise<HttpResponse> {
      calls.push({ url, opts });
      const entry = routes[url];
      const route: FakeRoute = typeof entry === "function" ? entry(calls.filter((c) => c.url === url).length) : (entry ?? { status: 404, text: "" });
      const status = route.status ?? 200;
      const text = route.text ?? (route.json === undefined ? "" : JSON.stringify(route.json));
      return {
        status,
        ok: status >= 200 && status < 300,
        isHtml: route.isHtml ?? false,
        json: route.json,
        text,
        fromCache: route.fromCache ?? route.stale ?? false,
        ...(route.stale ? { stale: true } : {}),
        ...(route.fetchedAt !== undefined ? { fetchedAt: route.fetchedAt } : {}),
      };
    },
  };
  return { http, calls };
}
