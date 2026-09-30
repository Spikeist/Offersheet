import { describe, expect, it } from "vitest";
import { byesFromGames, compareByes, deriveTeamMap, espnGames, espnNflTeams, espnScheduleByes, gamesPerWeek, pairTeamCodes, regularSeasonGames, teamsOnBye, type EspnProTeam } from "./nfl";

// A 4-team, 3-week toy season: every team plays twice and has one bye.
const rows = [
  { season: "2026", game_type: "REG", week: "1", game_id: "g1", away_team: "LA", home_team: "WAS", espn: "101", gameday: "2026-09-13", gametime: "13:00" },
  { season: "2026", game_type: "REG", week: "2", game_id: "g2", away_team: "KC", home_team: "LA", espn: "102", gameday: "2026-09-20", gametime: "13:00" },
  { season: "2026", game_type: "REG", week: "3", game_id: "g3", away_team: "WAS", home_team: "KC", espn: "103", gameday: "2026-09-27", gametime: "13:00" },
  { season: "2026", game_type: "REG", week: "1", game_id: "g4", away_team: "DEN", home_team: "KC", espn: "104", gameday: "2026-09-13", gametime: "16:25" },
  { season: "2026", game_type: "REG", week: "2", game_id: "g5", away_team: "DEN", home_team: "WAS", espn: "105", gameday: "2026-09-20", gametime: "16:25" },
  { season: "2026", game_type: "REG", week: "3", game_id: "g6", away_team: "LA", home_team: "DEN", espn: "106", gameday: "2026-09-27", gametime: "16:25" },
  { season: "2026", game_type: "POST", week: "19", game_id: "g7", away_team: "LA", home_team: "KC", espn: "107", gameday: "2027-01-10", gametime: "13:00" },
  { season: "2025", game_type: "REG", week: "1", game_id: "g8", away_team: "LA", home_team: "KC", espn: "108", gameday: "2025-09-07", gametime: "13:00" },
];

const game = (id: number, week: number, home: number, away: number) => ({ id, scoringPeriodId: week, homeProTeamId: home, awayProTeamId: away });
const espnJson = {
  settings: {
    proTeams: [
      { id: 0, abbrev: "FA", byeWeek: 0 },
      { id: 14, abbrev: "LAR", byeWeek: 3, name: "Rams", proGamesByScoringPeriod: { "1": [game(101, 1, 28, 14)], "2": [game(102, 2, 14, 12)], "3": [] } },
      { id: 28, abbrev: "WSH", byeWeek: 2, name: "Commanders", proGamesByScoringPeriod: { "1": [game(101, 1, 28, 14)], "3": [game(103, 3, 12, 28)] } },
      { id: 12, abbrev: "KC", byeWeek: 1, name: "Chiefs", proGamesByScoringPeriod: { "2": [game(102, 2, 14, 12)], "3": [game(103, 3, 12, 28)] } },
      { id: 7, abbrev: "DEN", byeWeek: 1, name: "Broncos", proGamesByScoringPeriod: { "1": [game(104, 1, 12, 7)], "2": [game(105, 2, 28, 7)], "3": [game(106, 3, 7, 14)] } },
    ],
  },
};

describe("NFL schedule helpers", () => {
  it("keeps only one season's regular-season games", () => {
    const games = regularSeasonGames(rows, 2026);
    expect(games).toHaveLength(6);
    expect(gamesPerWeek(games)).toEqual({ 1: 2, 2: 2, 3: 2 });
    expect(games[0]).toMatchObject({ week: 1, away: "LA", home: "WAS", espnId: "101" });
  });

  it("derives byes as weeks without a game", () => {
    const byes = byesFromGames(regularSeasonGames(rows, 2026), 3);
    expect(Object.fromEntries(byes)).toEqual({ DEN: [], KC: [], LA: [], WAS: [] });
    const partial = byesFromGames(regularSeasonGames(rows, 2026).filter((g) => g.gameId !== "g4"), 3);
    expect(partial.get("DEN")).toEqual([1]);
    expect(teamsOnBye(partial, 1)).toEqual(["DEN", "KC"]);
  });

  it("drops ESPN's FA pseudo-team and reads schedule byes", () => {
    const teams = espnNflTeams(espnJson);
    expect(teams.map((t) => t.abbrev)).toEqual(["LAR", "WSH", "KC", "DEN"]);
    expect(espnScheduleByes(teams[0] as EspnProTeam, 3)).toEqual([3]);
    expect(espnScheduleByes(teams[1] as EspnProTeam, 3)).toEqual([2]);
  });

  it("maps ESPN team ids to nflverse codes by joining games on the ESPN event id", () => {
    const teams = espnNflTeams(espnJson);
    const games = regularSeasonGames(rows, 2026);
    const map = deriveTeamMap(teams, espnGames(teams), games);
    expect(map.joinedGames).toBe(6);
    expect(map.conflicts).toEqual([]);
    expect(map.mismatches).toEqual([]);
    expect(map.byEspnId.get(14)).toBe("LA");
    expect(map.differing).toEqual({ LAR: "LA", WSH: "WAS" });
  });

  it("flags mismatched weeks and home/away swaps", () => {
    const teams = espnNflTeams(espnJson);
    const games = regularSeasonGames(rows, 2026).map((g) => (g.gameId === "g2" ? { ...g, week: 9 } : g));
    const map = deriveTeamMap(teams, espnGames(teams), games);
    expect(map.mismatches.some((m) => m.espnGameId === 102 && m.issue.startsWith("week"))).toBe(true);
  });

  it("pairs a source's team codes with the reference set through shared players", () => {
    const codes = new Map([
      ["KC", new Set(["1", "2"])],
      ["JAC", new Set(["3", "4", "5"])],
      ["LAR", new Set(["6", "7"])],
      ["OAK", new Set(["8"])],
      ["SPL", new Set(["9", "10"])],
    ]);
    const ref = new Set(["KC", "JAX", "LA", "LV"]);
    const teamOf = new Map([
      ["3", "JAX"],
      ["4", "JAX"],
      ["5", "KC"],
      ["6", "LA"],
      ["9", "KC"],
      ["10", "LA"],
    ]);
    const r = pairTeamCodes(codes, ref, teamOf);
    expect(r.same).toEqual(["KC"]);
    expect(r.pairs).toEqual([
      { code: "JAC", to: "JAX", support: 2, voters: 3 },
      { code: "LAR", to: "LA", support: 1, voters: 1 },
    ]);
    expect(r.unpaired).toEqual([
      { code: "OAK", players: 1, voters: 0 },
      { code: "SPL", players: 2, voters: 2 },
    ]);
  });

  it("compares ESPN byeWeek with the nflverse-derived bye", () => {
    const teams = espnNflTeams(espnJson);
    const map = deriveTeamMap(teams, espnGames(teams), regularSeasonGames(rows, 2026));
    const nflByes = new Map([
      ["LA", [3]],
      ["WAS", [2]],
      ["KC", [1]],
      ["DEN", [2]],
    ]);
    const cmp = compareByes(teams, map.byEspnId, nflByes, 3);
    expect(cmp.filter((c) => c.match).map((c) => c.team)).toEqual(["LA", "WAS", "KC"]);
    expect(cmp.find((c) => c.team === "DEN")).toMatchObject({ espnBye: 1, nflverseBye: [2], match: false });
  });
});
