/**
 * Synthetic leagues for the trade evaluation and search tests (src/engine/evaluate.test.ts, search.test.ts; CLAUDE.md
 * §16: made-up data, no network). They add what the trade engine needs beyond src/engine/testLeague.ts: a remaining
 * schedule (so the season simulates and B exists), playoff settings, full rosters (so trades meet roster legality),
 * and records with the decided games behind them when a test needs the standings to matter. Player names are made up and
 * teams are placeholders. Test-only: nothing in the app imports it.
 */
import type { ModelInputs } from "./inputs";
import type { LeagueSettings, LeagueSnapshot, Matchup } from "./model";
import { buildTestLeague, randomLeague, type TestLeagueSpec, type TestPlayer, type TestTeam } from "./testLeague";

const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

/**
 * Round-robin pairings (the circle method) for `ids` over `weeks`: every team plays once a week (an odd count gives one
 * team a bye, teamB null), cycling through the rounds.
 */
export function roundRobin(ids: readonly string[], weeks: readonly number[]): Matchup[] {
  const list: (string | null)[] = [...ids];
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const out: Matchup[] = [];
  weeks.forEach((week, r) => {
    const round = r % Math.max(1, n - 1);
    const rot = [list[0] as string | null, ...Array.from({ length: n - 1 }, (_, i) => list[1 + ((i + round) % (n - 1))] as string | null)];
    for (let i = 0; i < n / 2; i++) {
      const a = rot[i] ?? null;
      const b = rot[n - 1 - i] ?? null;
      if (a === null && b === null) continue;
      if (a === null) out.push({ week, teamA: b as string, teamB: null, isPlayoff: false });
      else out.push({ week, teamA: a, teamB: b, isPlayoff: false });
    }
  });
  return out;
}

export interface SeasonSpec {
  /** Regular-season and playoff NFL weeks (default 1–8 and 9–10). */
  regular?: number[];
  playoff?: number[];
  /** Playoff teams (default 4). */
  playoffTeams?: number;
  /** maxRosterSize (default: the largest roster, so every roster is full). */
  maxRosterSize?: number;
  tradeDeadline?: LeagueSettings["tradeDeadline"];
  tradeReview?: LeagueSettings["tradeReview"];
  rosterMinimums?: LeagueSettings["rosterMinimums"];
  leagueType?: LeagueSettings["leagueType"];
  /**
   * Decide the weeks before the current one: team ids in order of strength (the first beats everyone, …); records,
   * points and decided results follow. Absent: no games before the current week (every record 0-0).
   */
  pastWinnersOrder?: string[];
}

/**
 * A league with a season to simulate: the snapshot's settings get the weeks and playoffs of `season`, and its schedule
 * round-robin matchups for every regular-season week (decided before the current week when `pastWinnersOrder` is
 * given, else only the weeks from the current one on are listed).
 */
export function withSeason(league: { snapshot: LeagueSnapshot; inputs: ModelInputs }, season: SeasonSpec = {}): { snapshot: LeagueSnapshot; inputs: ModelInputs } {
  const { snapshot } = league;
  const regular = season.regular ?? range(1, 8);
  const playoff = season.playoff ?? range(9, 10);
  const maxRoster = season.maxRosterSize ?? Math.max(...snapshot.teams.map((t) => t.roster.length));
  const settings: LeagueSettings = {
    ...snapshot.settings,
    regularSeasonWeeks: regular,
    playoffWeeks: playoff,
    playoffTeams: season.playoffTeams ?? 4,
    maxRosterSize: maxRoster,
    tradeDeadline: season.tradeDeadline ?? null,
    tradeReview: season.tradeReview ?? "none",
    ...(season.rosterMinimums ? { rosterMinimums: season.rosterMinimums } : {}),
    ...(season.leagueType ? { leagueType: season.leagueType } : {}),
  };
  const ids = snapshot.teams.map((t) => t.id);
  const order = season.pastWinnersOrder;
  const weeks = order ? regular : regular.filter((w) => w >= snapshot.currentWeek);
  const schedule = roundRobin(ids, weeks).map((m): Matchup => {
    if (!order || m.week >= snapshot.currentWeek || m.teamB === null) return m;
    const aWins = order.indexOf(m.teamA) < order.indexOf(m.teamB);
    return { ...m, decided: true, result: { pointsA: aWins ? 120 : 90, pointsB: aWins ? 90 : 120, winnerId: aWins ? m.teamA : m.teamB } };
  });
  const teams = snapshot.teams.map((t) => {
    const games = schedule.filter((m) => m.decided && (m.teamA === t.id || m.teamB === t.id));
    const w = games.filter((m) => m.result?.winnerId === t.id).length;
    const pf = games.reduce((s, m) => s + (m.teamA === t.id ? (m.result?.pointsA ?? 0) : (m.result?.pointsB ?? 0)), 0);
    const pa = games.reduce((s, m) => s + (m.teamA === t.id ? (m.result?.pointsB ?? 0) : (m.result?.pointsA ?? 0)), 0);
    return { ...t, record: { w, l: games.length - w, t: 0 }, pointsFor: pf, pointsAgainst: pa };
  });
  return { snapshot: { ...snapshot, settings, schedule, teams }, inputs: league.inputs };
}

/**
 * A small seeded random league with a season (randomLeague + withSeason): 6 teams of 12 (full rosters), 5 free agents
 * a position, NFL week 6 of a 1–8 regular season with playoffs in weeks 9–10 (4 teams), no injuries.
 */
export function smallLeague(seed = 11, season: SeasonSpec = {}, teams = 6): { snapshot: LeagueSnapshot; inputs: ModelInputs } {
  return withSeason(randomLeague({ teams, seed, rosterSize: 12, freeAgentsPerPosition: 5, currentWeek: 6, injuries: false }), season);
}

/** The free agent withWaiverStash adds. */
export const STASH_ID = "stash-p";

/**
 * `league` with one more free agent, worth `value`, whom no team can use: a punter (no lineup here starts one), so no
 * team's free-agent pickups ever claim him, and the waiver credit W, the best free agent the allocation leaves unclaimed
 * (league.ts step 4; planner reply to Checkpoint 4c, A3), is at least `value`. Default `value`: the best free agent's own
 * value, the W of the rule before A3 (the best free agent of all). For the tests of mechanics that need players worth at
 * most W (neutral throw-ins, lean versions, the dominance pruning, Plan B's given-player cap) on the synthetic leagues their
 * narratives were measured on: A3 lowered W there, since these leagues' best free agents get picked up. Throws when the
 * stash would be one of FantasyCalc's top 12 (the elite list would change: premium.eliteIds), or without market values.
 */
export function withWaiverStash(league: { snapshot: LeagueSnapshot; inputs: ModelInputs }, value?: number): { snapshot: LeagueSnapshot; inputs: ModelInputs } {
  const { snapshot, inputs } = league;
  const market = inputs.market;
  if (!market) throw new Error("withWaiverStash: no market values");
  const v = value ?? Math.max(0, ...snapshot.freeAgents.map((id) => market.values[id] ?? 0));
  if (Object.values(market.values).filter((x) => x >= v).length < 12) throw new Error(`withWaiverStash: ${v} would be a top-12 value`);
  const sleeper: Record<number, number | null> = {};
  for (let w = 1; w <= inputs.lastWeek; w++) sleeper[w] = null;
  return {
    snapshot: {
      ...snapshot,
      players: { ...snapshot.players, [STASH_ID]: { id: STASH_ID, name: "Testy Stash", pos: "P", eligible: ["P"], nflTeam: "AAA", injury: "ACTIVE", ids: { sleeper: STASH_ID } } },
      freeAgents: [...snapshot.freeAgents, STASH_ID],
    },
    inputs: { ...inputs, players: { ...inputs.players, [STASH_ID]: { sleeper, actual: {} } }, market: { ...market, values: { ...market.values, [STASH_ID]: v }, knownIds: [...market.knownIds, STASH_ID] } },
  };
}

/** A player with the same points every week (and a FantasyCalc value of 25 × points², as randomLeague's). */
export function flat(id: string, pos: TestPlayer["pos"], points: number, extra: Partial<TestPlayer> = {}): TestPlayer {
  const skill = pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE";
  return { id, pos, points, ...(skill ? { value: Math.round(points * points * 25) } : {}), ...extra };
}

/**
 * A hand-built league for legality and consistency tests: 4 teams of 10 (QB, 2 RB, 2 WR, TE, K, D/ST, a bench RB and a
 * bench WR), flat projections (no byes), every roster full, NFL week 5 of a 1–8 regular season, a one-round playoff in
 * week 9 for 2 teams. Team "1" is mine. `edit` changes the spec before it's built.
 */
export function handLeague(edit: (spec: TestLeagueSpec) => void = () => undefined, season: SeasonSpec = {}): { snapshot: LeagueSnapshot; inputs: ModelInputs } {
  const team = (t: number, s: number): TestTeam => ({
    id: String(t),
    roster: [
      flat(`q${t}`, "QB", 20 - s),
      flat(`ra${t}`, "RB", 15 - s),
      flat(`rb${t}`, "RB", 12 - s),
      flat(`wa${t}`, "WR", 14 - s),
      flat(`wb${t}`, "WR", 11 - s),
      flat(`te${t}`, "TE", 8 - s / 2),
      flat(`k${t}`, "K", 7),
      flat(`d${t}`, "DEF", 6),
      flat(`rc${t}`, "RB", 4 + t / 10),
      flat(`wc${t}`, "WR", 3 + t / 10),
    ],
  });
  const spec: TestLeagueSpec = {
    teams: [team(1, 0), team(2, 1), team(3, 2), team(4, 3)],
    freeAgents: [flat("fq", "QB", 6), flat("fr", "RB", 2), flat("fw", "WR", 2), flat("ft", "TE", 1), flat("fk", "K", 5), flat("fd", "DEF", 4)],
    currentWeek: 5,
    regularSeasonWeeks: range(1, 8),
    playoffWeeks: [9],
  };
  edit(spec);
  return withSeason(buildTestLeague(spec), { regular: range(1, 8), playoff: [9], playoffTeams: 2, ...season });
}
