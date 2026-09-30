/**
 * NFL schedule and bye weeks (CLAUDE.md §2.2 "NFL bye weeks", §2.9): nflverse games.csv and ESPN
 * proTeamSchedules_wl. The ESPN↔nflverse team-code map is derived from the data itself by joining
 * games on ESPN's game id (nflverse's `espn` column), never hand-written.
 */
import type { CsvRow } from "./idmap";

export interface NflGame {
  gameId: string;
  season: number;
  week: number;
  away: string;
  home: string;
  /** ESPN event id from nflverse's `espn` column (joins to ESPN proGamesByScoringPeriod[].id). */
  espnId: string | null;
  gameday: string;
  gametime: string;
}

export function regularSeasonGames(rows: CsvRow[], season: number): NflGame[] {
  return rows
    .filter((r) => Number(r.season) === season && r.game_type === "REG")
    .map((r) => ({
      gameId: r.game_id ?? "",
      season,
      week: Number(r.week),
      away: r.away_team ?? "",
      home: r.home_team ?? "",
      espnId: r.espn && r.espn !== "NA" ? r.espn : null,
      gameday: r.gameday ?? "",
      gametime: r.gametime ?? "",
    }));
}

/** Weeks 1..maxWeek in which each team has no game. A normal season gives exactly one per team. */
export function byesFromGames(games: NflGame[], maxWeek = 18): Map<string, number[]> {
  const played = new Map<string, Set<number>>();
  for (const g of games)
    for (const t of [g.away, g.home]) {
      if (!played.has(t)) played.set(t, new Set());
      played.get(t)?.add(g.week);
    }
  const out = new Map<string, number[]>();
  for (const [team, weeks] of [...played].sort(([a], [b]) => a.localeCompare(b))) {
    const byes: number[] = [];
    for (let w = 1; w <= maxWeek; w++) if (!weeks.has(w)) byes.push(w);
    out.set(team, byes);
  }
  return out;
}

export function gamesPerWeek(games: NflGame[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const g of games) out[g.week] = (out[g.week] ?? 0) + 1;
  return out;
}

export interface EspnProGame {
  id: number;
  week: number;
  homeProTeamId: number;
  awayProTeamId: number;
  date?: number;
}

export interface EspnProTeam {
  id: number;
  abbrev: string;
  byeWeek: number;
  name?: string;
  location?: string;
  proGamesByScoringPeriod?: Record<string, Array<Partial<EspnProGame> & { id?: number; homeProTeamId?: number; awayProTeamId?: number; scoringPeriodId?: number }>>;
}

/** ESPN's 32 NFL teams (drops the "FA" pseudo-team, id 0). */
export function espnNflTeams(json: unknown): EspnProTeam[] {
  const teams = (json as { settings?: { proTeams?: EspnProTeam[] } })?.settings?.proTeams ?? [];
  return teams.filter((t) => t && typeof t.id === "number" && t.id !== 0);
}

/** Unique games from every team's proGamesByScoringPeriod. */
export function espnGames(teams: EspnProTeam[]): EspnProGame[] {
  const byId = new Map<number, EspnProGame>();
  for (const t of teams)
    for (const [week, games] of Object.entries(t.proGamesByScoringPeriod ?? {}))
      for (const g of games ?? []) {
        if (typeof g.id !== "number" || typeof g.homeProTeamId !== "number" || typeof g.awayProTeamId !== "number") continue;
        if (!byId.has(g.id)) byId.set(g.id, { id: g.id, week: Number(g.scoringPeriodId ?? week), homeProTeamId: g.homeProTeamId, awayProTeamId: g.awayProTeamId, date: g.date });
      }
  return [...byId.values()];
}

/** Weeks in which an ESPN team has no game in proGamesByScoringPeriod (should equal its byeWeek). */
export function espnScheduleByes(team: EspnProTeam, maxWeek = 18): number[] {
  const weeks = new Set(Object.entries(team.proGamesByScoringPeriod ?? {}).filter(([, g]) => (g ?? []).length > 0).map(([w]) => Number(w)));
  const out: number[] = [];
  for (let w = 1; w <= maxWeek; w++) if (!weeks.has(w)) out.push(w);
  return out;
}

export interface TeamMapResult {
  /** ESPN proTeamId → nflverse team code. */
  byEspnId: Map<number, string>;
  /** ESPN abbrev → nflverse code, only where they differ. */
  differing: Record<string, string>;
  joinedGames: number;
  unjoinedEspnGames: number;
  /** Joined games whose week or home/away teams disagree between the sources. */
  mismatches: Array<{ espnGameId: number; issue: string }>;
  /** ESPN team ids that mapped to more than one nflverse code. */
  conflicts: number[];
}

export function deriveTeamMap(teams: EspnProTeam[], espn: EspnProGame[], nfl: NflGame[]): TeamMapResult {
  const nflByEspnId = new Map(nfl.filter((g) => g.espnId).map((g) => [String(g.espnId), g]));
  const seen = new Map<number, Set<string>>();
  const mismatches: TeamMapResult["mismatches"] = [];
  let joined = 0;
  for (const g of espn) {
    const n = nflByEspnId.get(String(g.id));
    if (!n) continue;
    joined++;
    if (n.week !== g.week) mismatches.push({ espnGameId: g.id, issue: `week ESPN ${g.week} vs nflverse ${n.week}` });
    for (const [espnTeam, code] of [
      [g.homeProTeamId, n.home],
      [g.awayProTeamId, n.away],
    ] as const) {
      if (!seen.has(espnTeam)) seen.set(espnTeam, new Set());
      seen.get(espnTeam)?.add(code);
    }
  }
  const byEspnId = new Map<number, string>();
  const conflicts: number[] = [];
  for (const [id, codes] of seen) {
    if (codes.size === 1) byEspnId.set(id, [...codes][0] as string);
    else conflicts.push(id);
  }
  const differing: Record<string, string> = {};
  for (const t of teams) {
    const code = byEspnId.get(t.id);
    if (code && code !== t.abbrev.toUpperCase()) differing[t.abbrev] = code;
  }
  // Second pass: home/away consistency under the derived map.
  for (const g of espn) {
    const n = nflByEspnId.get(String(g.id));
    if (!n) continue;
    const h = byEspnId.get(g.homeProTeamId);
    const a = byEspnId.get(g.awayProTeamId);
    if (h && a && (h !== n.home || a !== n.away)) mismatches.push({ espnGameId: g.id, issue: `teams ESPN ${a}@${h} vs nflverse ${n.away}@${n.home}` });
  }
  return { byEspnId, differing, joinedGames: joined, unjoinedEspnGames: espn.length - joined, mismatches, conflicts };
}

export interface ByeComparison {
  team: string;
  espnAbbrev: string;
  espnBye: number;
  espnScheduleBye: number[];
  nflverseBye: number[] | null;
  match: boolean;
}

export function compareByes(teams: EspnProTeam[], teamMap: Map<number, string>, nflByes: Map<string, number[]>, maxWeek = 18): ByeComparison[] {
  return teams.map((t) => {
    const code = teamMap.get(t.id) ?? t.abbrev.toUpperCase();
    const nb = nflByes.get(code) ?? null;
    const sched = espnScheduleByes(t, maxWeek);
    const match = nb !== null && nb.length === 1 && nb[0] === t.byeWeek && sched.length === 1 && sched[0] === t.byeWeek;
    return { team: code, espnAbbrev: t.abbrev, espnBye: t.byeWeek, espnScheduleBye: sched, nflverseBye: nb, match };
  });
}

/** Teams on bye in a week, from a team → bye weeks map. */
export function teamsOnBye(byes: Map<string, number[]>, week: number): string[] {
  return [...byes].filter(([, w]) => w.includes(week)).map(([t]) => t).sort();
}

export interface TeamCodePairing {
  /** Codes already in the reference set. */
  same: string[];
  /** Codes mapped by majority vote of their players' reference team (support = votes for `to`). */
  pairs: Array<{ code: string; to: string; support: number; voters: number }>;
  /** Codes whose players are not in the reference (or split without a majority). */
  unpaired: Array<{ code: string; players: number; voters: number }>;
}

/**
 * Pair a source's team codes with the reference codes (nflverse) through the players who carry
 * them: a code's pair is the reference team most of its players are on in the reference data.
 * Nothing is hand-mapped, so e.g. "JAC"→"JAX" comes out of the data or not at all.
 */
export function pairTeamCodes(codes: Map<string, Set<string>>, reference: Set<string>, teamOfPlayer: Map<string, string>): TeamCodePairing {
  const out: TeamCodePairing = { same: [], pairs: [], unpaired: [] };
  for (const [code, players] of [...codes].sort(([a], [b]) => a.localeCompare(b))) {
    if (reference.has(code)) {
      out.same.push(code);
      continue;
    }
    const votes = new Map<string, number>();
    for (const pid of players) {
      const t = teamOfPlayer.get(pid);
      if (t) votes.set(t, (votes.get(t) ?? 0) + 1);
    }
    const voters = [...votes.values()].reduce((a, b) => a + b, 0);
    const [to, support] = [...votes].sort(([, x], [, y]) => y - x)[0] ?? [undefined, 0];
    if (to && support * 2 > voters) out.pairs.push({ code, to, support, voters });
    else out.unpaired.push({ code, players: players.size, voters });
  }
  return out;
}
