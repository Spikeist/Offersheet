/**
 * Synthetic leagues for engine tests (CLAUDE.md §16: engine tests run on made-up data, no network):
 * - buildTestLeague: small hand-built leagues whose right answers are obvious (a bench RB behind two
 *   stars, a team without a TE, …);
 * - randomLeague: seeded random leagues for property and performance tests (the §12 performance target
 *   is about a 12-team league);
 * - syntheticInputs: made-up model inputs for any snapshot, so the committed sanitized ESPN fixture can
 *   run through the whole engine.
 * Player names are made up and teams are placeholders ("Team 3"). Test-only: nothing in the app imports it.
 */
import type { FantasyCalcFormat, ModelInputs, PlayerInputs } from "./inputs";
import type { InjuryStatus, LeagueSettings, LeagueSnapshot, PlayerInfo, Platform, Pos, SlotDef, Team } from "./model";
import { hash32, mulberry32 } from "./rng";

const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

/** QB, 2 RB, 2 WR, TE, FLEX, K, D/ST: a common redraft lineup (9 starters). */
export const TEST_LINEUP: SlotDef[] = [
  { slot: "QB", count: 1, eligible: ["QB"] },
  { slot: "RB", count: 2, eligible: ["RB"] },
  { slot: "WR", count: 2, eligible: ["WR"] },
  { slot: "TE", count: 1, eligible: ["TE"] },
  { slot: "FLEX", count: 1, eligible: ["RB", "WR", "TE"] },
  { slot: "K", count: 1, eligible: ["K"] },
  { slot: "DEF", count: 1, eligible: ["DEF"] },
];

export const TEST_NOW = new Date("2026-09-29T20:00:00.000Z");

const FORMAT: FantasyCalcFormat = { isDynasty: false, numQbs: 1, numTeams: 12, ppr: 1, substitutions: [] };

export interface TestPlayer {
  id: string;
  pos: Pos;
  /** Sleeper's projection in league points: the same every week, or by NFL week (a missing or 0 week = a stub). */
  points: number | Readonly<Record<number, number>>;
  eligible?: Pos[];
  /** NFL team code (default "AAA", a team without a bye); null = no NFL team. */
  nflTeam?: string | null;
  injury?: InjuryStatus;
  injuryReturnWeek?: number;
  /** FantasyCalc value; absent = FantasyCalc doesn't value him. */
  value?: number;
  /** League points in completed weeks he played. */
  actual?: Record<number, number>;
  /** ESPN's league-scored projections by week (ESPN leagues). */
  espn?: Record<number, number | null>;
  /** Leave him out of the model inputs (the engine should skip him with a warning). */
  noInputs?: boolean;
  name?: string;
}

export interface TestTeam {
  id: string;
  roster: TestPlayer[];
  ir?: TestPlayer[];
  taxi?: TestPlayer[];
}

export interface TestLeagueSpec {
  teams: TestTeam[];
  freeAgents?: TestPlayer[];
  platform?: Platform;
  currentWeek?: number;
  lineup?: SlotDef[];
  regularSeasonWeeks?: number[];
  playoffWeeks?: number[];
  /** Default: the first team. */
  myTeamId?: string | null;
  leagueType?: LeagueSettings["leagueType"];
  positionLimits?: LeagueSettings["positionLimits"];
  starterLimits?: LeagueSettings["starterLimits"];
  /** NFL team code → bye week. */
  byeWeek?: Record<string, number>;
  kickoffs?: Record<number, Record<string, string>>;
  /** The NFL regular season's last week (ModelInputs.nfl.lastWeek); absent = unknown. */
  nflLastWeek?: number;
  /** false = FantasyCalc down (market null). */
  market?: boolean;
  topValue?: number;
  espnProjections?: boolean;
  /** Inputs built for another week than the snapshot's (a stale model). */
  inputsWeek?: number;
}

function sleeperLine(points: TestPlayer["points"], lastWeek: number): Record<number, number | null> {
  const out: Record<number, number | null> = {};
  for (const w of range(1, lastWeek)) {
    const v = typeof points === "number" ? points : points[w];
    out[w] = v !== undefined && v > 0 ? v : null;
  }
  return out;
}

/** A hand-built league: every player's Sleeper projection is his `points` (so his base rate is `points` when flat). */
export function buildTestLeague(spec: TestLeagueSpec): { snapshot: LeagueSnapshot; inputs: ModelInputs } {
  const currentWeek = spec.currentWeek ?? 4;
  const regularSeasonWeeks = spec.regularSeasonWeeks ?? range(1, 14);
  const playoffWeeks = spec.playoffWeeks ?? range(15, 17);
  const lastWeek = Math.max(...playoffWeeks, ...regularSeasonWeeks);
  const players: Record<string, PlayerInfo> = {};
  const inputs: Record<string, PlayerInputs> = {};
  const values: Record<string, number> = {};
  const add = (p: TestPlayer): string => {
    players[p.id] = {
      id: p.id,
      name: p.name ?? `Testy McTest ${p.id}`,
      pos: p.pos,
      eligible: p.eligible ?? [p.pos],
      nflTeam: p.nflTeam === undefined ? "AAA" : p.nflTeam,
      injury: p.injury ?? "ACTIVE",
      ...(p.injuryReturnWeek !== undefined ? { injuryReturnWeek: p.injuryReturnWeek } : {}),
      ids: { sleeper: p.id },
    };
    if (!p.noInputs) inputs[p.id] = { sleeper: sleeperLine(p.points, lastWeek), actual: p.actual ?? {}, ...(p.espn ? { espn: p.espn } : {}) };
    if (p.value !== undefined) values[p.id] = p.value;
    return p.id;
  };
  const teams: Team[] = spec.teams.map((t) => ({
    id: t.id,
    name: `Team ${t.id}`,
    ownerName: `Owner ${t.id}`,
    roster: t.roster.map(add),
    ir: (t.ir ?? []).map(add),
    taxi: (t.taxi ?? []).map(add),
    record: { w: 0, l: 0, t: 0 },
    pointsFor: 0,
    pointsAgainst: 0,
  }));
  const freeAgents = (spec.freeAgents ?? []).map(add);
  const settings: LeagueSettings = {
    numTeams: teams.length,
    leagueType: spec.leagueType ?? "redraft",
    lineup: spec.lineup ?? TEST_LINEUP,
    benchSlots: 7,
    irSlots: 1,
    taxiSlots: 0,
    maxRosterSize: 16,
    ...(spec.positionLimits ? { positionLimits: spec.positionLimits } : {}),
    ...(spec.starterLimits ? { starterLimits: spec.starterLimits } : {}),
    scoring: { perStat: { rec: 1 }, rules: [], unmapped: [] },
    regularSeasonWeeks,
    playoffWeeks,
    playoffTeams: 4,
    medianGame: false,
    pointsOnly: false,
    tradeDeadline: null,
    tradeReview: "none",
  };
  const snapshot: LeagueSnapshot = {
    platform: spec.platform ?? "sleeper",
    leagueId: "test-league",
    season: 2026,
    name: "Test League",
    fetchedAt: TEST_NOW.toISOString(),
    currentWeek,
    settings,
    teams,
    myTeamId: spec.myTeamId === undefined ? (teams[0]?.id ?? null) : spec.myTeamId,
    players,
    schedule: [],
    transactions: [],
    freeAgents,
    warnings: [],
  };
  const top = spec.topValue ?? Math.max(1, ...Object.values(values));
  const model: ModelInputs = {
    version: 1,
    season: 2026,
    currentWeek: spec.inputsWeek ?? currentWeek,
    lastWeek,
    builtAt: TEST_NOW.toISOString(),
    nfl: { byeWeek: spec.byeWeek ?? {}, kickoffs: spec.kickoffs ?? {}, ...(spec.nflLastWeek !== undefined ? { lastWeek: spec.nflLastWeek } : {}) },
    players: inputs,
    espnProjections: spec.espnProjections ?? false,
    market: spec.market === false ? null : { format: FORMAT, fetchedAt: TEST_NOW.toISOString(), values, knownIds: Object.keys(values), topValue: top },
    sources: [],
    warnings: [],
    notes: [],
  };
  return { snapshot, inputs: model };
}

// ---------------------------------------------------------------------------------------------
// Random leagues

/** Typical points per game by position: [low, high] of a uniform draw (starters and bench alike). */
const POINTS: Readonly<Record<Pos, readonly [number, number]>> = {
  QB: [10, 24],
  RB: [3, 20],
  WR: [3, 20],
  TE: [2, 14],
  K: [5, 10],
  P: [3, 6],
  DEF: [3, 10],
  DL: [3, 9],
  LB: [4, 11],
  DB: [3, 9],
};

/** Roster composition by index: 16 players = 2 QB, 5 RB, 5 WR, 2 TE, K, D/ST (repeats past 16). */
const ROSTER_POSITIONS: readonly Pos[] = ["QB", "RB", "RB", "WR", "WR", "TE", "RB", "WR", "K", "DEF", "QB", "RB", "WR", "TE", "RB", "WR"];

export interface RandomLeagueOptions {
  teams: number;
  seed: number;
  rosterSize?: number;
  /** Free agents per position (QB, RB, WR, TE, K, DEF). */
  freeAgentsPerPosition?: number;
  currentWeek?: number;
  /** Current injuries (questionable, doubtful, out, IR with a return week) on a few players. */
  injuries?: boolean;
  lineup?: SlotDef[];
}

/** A seeded random league: 32 NFL teams with byes in weeks 5–14, random points, injuries and values. */
export function randomLeague(opts: RandomLeagueOptions): { snapshot: LeagueSnapshot; inputs: ModelInputs } {
  const rand = mulberry32(opts.seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * rand();
  const currentWeek = opts.currentWeek ?? 4;
  const nflTeams = range(1, 32).map((i) => `T${String(i).padStart(2, "0")}`);
  const byeWeek: Record<string, number> = {};
  for (const t of nflTeams) byeWeek[t] = 5 + Math.floor(rand() * 10);
  let next = 1;
  const player = (pos: Pos, scale: number): TestPlayer => {
    const id = String(1000 + next++);
    const [lo, hi] = POINTS[pos];
    const base = between(lo, hi) * scale;
    const points: Record<number, number> = {};
    for (const w of range(1, 17)) points[w] = Math.round(base * between(0.85, 1.15) * 100) / 100;
    const r = opts.injuries === false ? 1 : rand();
    const injury: InjuryStatus = r < 0.04 ? "QUESTIONABLE" : r < 0.05 ? "DOUBTFUL" : r < 0.07 ? "OUT" : r < 0.09 ? "IR" : "ACTIVE";
    const skill = pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE";
    return {
      id,
      pos,
      points,
      nflTeam: nflTeams[Math.floor(rand() * nflTeams.length)] as string,
      injury,
      ...(injury === "IR" ? { injuryReturnWeek: currentWeek + 2 + Math.floor(rand() * 5) } : {}),
      ...(skill && base > (pos === "QB" ? 14 : 7) ? { value: Math.round(base * base * 25) } : {}),
    };
  };
  const size = opts.rosterSize ?? 16;
  const teams: TestTeam[] = range(1, opts.teams).map((t) => ({ id: String(t), roster: range(0, size - 1).map((i) => player(ROSTER_POSITIONS[i % ROSTER_POSITIONS.length] as Pos, 1)) }));
  const perPos = opts.freeAgentsPerPosition ?? 50;
  const freeAgents = (["QB", "RB", "WR", "TE", "K", "DEF"] as Pos[]).flatMap((pos) => range(1, perPos).map(() => player(pos, 0.6)));
  return buildTestLeague({ teams, freeAgents, currentWeek, byeWeek, ...(opts.lineup ? { lineup: opts.lineup } : {}) });
}

// ---------------------------------------------------------------------------------------------
// Synthetic inputs for any snapshot

/** A uniform in [0, 1) from a string (deterministic). */
function unit(key: string): number {
  return mulberry32(hash32(key))();
}

/**
 * Made-up model inputs for a real (sanitized) snapshot: every rostered player and free agent gets
 * Sleeper projections from a hash of his id (by position; free agents from the lower half of the
 * range, as on a real waiver wire), a few actual games, ESPN projections within a few percent of
 * Sleeper's (ESPN leagues), a bye for his NFL team, and FantasyCalc values for the best QB/RB/WR/TE.
 * Players out now have a stub (null) projection this week, as Sleeper sends. The NFL's last week is
 * 18, as ESPN's 2026 schedule says.
 */
export function syntheticInputs(snapshot: LeagueSnapshot, seed = 1): ModelInputs {
  const { settings, currentWeek } = snapshot;
  const lastWeek = Math.max(...settings.playoffWeeks, ...settings.regularSeasonWeeks);
  const rostered = new Set(snapshot.teams.flatMap((t) => [...t.roster, ...t.ir, ...t.taxi]));
  const ids = new Set<string>([...rostered, ...snapshot.freeAgents]);
  const players: Record<string, PlayerInputs> = {};
  const base: { id: string; pos: Pos; b: number }[] = [];
  for (const id of ids) {
    const info = snapshot.players[id];
    if (!info) continue;
    const [lo, hi] = POINTS[info.pos];
    const b = lo + (hi - lo) * unit(`${seed}:${id}`) * (rostered.has(id) ? 1 : 0.5);
    const out = info.injury === "OUT" || info.injury === "IR" || info.injury === "PUP" || info.injury === "SUSPENDED" || info.injury === "NA";
    const sleeper: Record<number, number | null> = {};
    for (const w of range(1, lastWeek)) sleeper[w] = out && w === currentWeek ? null : Math.round(b * (0.85 + 0.3 * unit(`${seed}:${id}:${w}`)) * 100) / 100;
    const actual: Record<number, number> = {};
    for (const w of range(1, currentWeek - 1)) if (unit(`${seed}:${id}:played:${w}`) < 0.9) actual[w] = Math.round(b * (0.4 + 1.2 * unit(`${seed}:${id}:actual:${w}`)) * 100) / 100;
    const espn: Record<number, number | null> = {};
    if (snapshot.platform === "espn") for (const w of [currentWeek - 1, currentWeek]) espn[w] = sleeper[w] === null || sleeper[w] === undefined ? null : Math.round((sleeper[w] as number) * (0.96 + 0.08 * unit(`${seed}:${id}:espn:${w}`)) * 100) / 100;
    players[id] = { sleeper, actual, ...(snapshot.platform === "espn" ? { espn } : {}), sleeperSeasonPerGame: b };
    base.push({ id, pos: info.pos, b });
  }
  const byeWeek: Record<string, number> = {};
  for (const info of Object.values(snapshot.players)) if (info.nflTeam && byeWeek[info.nflTeam] === undefined) byeWeek[info.nflTeam] = 5 + Math.floor(10 * unit(`${seed}:bye:${info.nflTeam}`));
  const values: Record<string, number> = {};
  base
    .filter((p) => p.pos === "QB" || p.pos === "RB" || p.pos === "WR" || p.pos === "TE")
    .sort((a, b) => b.b - a.b || (a.id < b.id ? -1 : 1))
    .slice(0, 150)
    .forEach((p) => {
      values[p.id] = Math.round(p.b * p.b * 25);
    });
  const top = Math.max(1, ...Object.values(values));
  return {
    version: 1,
    season: snapshot.season,
    currentWeek,
    lastWeek,
    builtAt: snapshot.fetchedAt,
    nfl: { byeWeek, kickoffs: {}, lastWeek: 18 },
    players,
    espnProjections: snapshot.platform === "espn",
    market: { format: FORMAT, fetchedAt: snapshot.fetchedAt, values, knownIds: Object.keys(values), topValue: top },
    sources: [],
    warnings: [],
    notes: [],
  };
}
