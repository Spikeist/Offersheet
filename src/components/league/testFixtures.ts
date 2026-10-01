/**
 * Test-only: a small fictional league with a hand-built LeagueModel and model inputs, for the League
 * page's view-model and markup tests (no engine run, no network). Every team and player name is
 * made up. Four teams, NFL week 12 of a season whose regular season ends in week 14 and whose
 * playoffs are weeks 15–17. Team 1 (the user's) has a full roster, so its best free-agent move drops
 * a player; teams 3 and 4 have open spots; team 2 has no move that helps. Team 2 has a Doubtful
 * player in an IR slot (his injury badge doesn't say IR) and team 3 a taxi-squad player.
 *
 * Trade chips (CLAUDE.md §7): team 2 has four (the table shows three; its partner card lists three and
 * "1 more"), one of them best for the user's team ("to you"); teams 1, 3 and 4 have one each. Two
 * players have conflicting ESPN signals (§6 step 3): team 1's Questionable RB, whose far return date
 * Sleeper overrules, and team 2's Doubtful RB, who follows his return date (week 16).
 *
 * By default it is game day: MIN's Thanksgiving game kicked off before NOW, so week 12 is in progress
 * (LeagueModel.inProgressWeek) and the team numbers skip it, as the engine's do (CLAUDE.md §7, Phase 2
 * review decisions: game days). `{ gameDay: false }` is the same league before any week 12 kickoff
 * (use BEFORE_KICKOFF as "now").
 *
 * Season odds (§8; LeagueModel.odds, TeamModel.score): the top 2 of 4 make the playoffs (no byes), and
 * the odds add up the way the simulator's do (Σ playoff odds = 2, Σ title odds = 1, expected wins =
 * today's wins + the week-by-week win chances). The remaining schedule is 1–3 and 2–4 in week 12, 1–4
 * and 2–3 in week 13, 1–2 and 3–4 in week 14. Team 1 (the user's) is the underdog in week 14 (38%,
 * a risky week), when its RB2 is on bye. TeamModel.score holds each week's LV (the scenario lineups'
 * when a team has them), as the engine's does, except for a week in progress: on game day team 1's
 * week 12 LV is a partial week (MIN, with its QB, a WR and its D/ST, has kicked off), while its score
 * keeps the pre-kickoff projection (PRE_KICKOFF), which is the week's LV before kickoff. Nobody else
 * plays in that game, so the other teams' week 12 LV is their pre-kickoff projection either way.
 */
import { config } from "@/engine/config";
import type { ModelInputs } from "@/engine/inputs";
import type { AvailabilityNote, LeagueModel, PlayerModel, SeasonOdds, SlotStrength, TeamModel, TeamOdds, TeamPlayerValue, ValueSource } from "@/engine/leagueModel";
import type { InjuryStatus, LeagueSettings, LeagueSnapshot, Matchup, PlayerInfo, Pos, Team } from "@/engine/model";
import { weekUnderWayNote } from "@/engine/season";

export const WEEKS = [12, 13, 14, 15, 16, 17];
export const REGULAR = [12, 13, 14];
export const PLAYOFFS = [15, 16, 17];
/** "Now" for the fixture: after MIN's week 12 Thanksgiving kickoff, before everyone else's games. */
export const NOW = "2026-11-26T22:00:00.000Z";
/** "Now" for `{ gameDay: false }`: week 12, before its first kickoff. */
export const BEFORE_KICKOFF = "2026-11-26T16:00:00.000Z";

const settings: LeagueSettings = {
  numTeams: 4,
  leagueType: "redraft",
  lineup: [
    { slot: "QB", count: 1, eligible: ["QB"] },
    { slot: "RB", count: 2, eligible: ["RB"] },
    { slot: "WR", count: 1, eligible: ["WR"] },
    { slot: "FLEX", count: 1, eligible: ["RB", "WR", "TE"] },
    { slot: "D/ST", count: 1, eligible: ["DEF"] },
  ],
  benchSlots: 2,
  irSlots: 1,
  taxiSlots: 1,
  maxRosterSize: 8,
  scoring: { perStat: { rec: 0.5, pass_td: 4 }, rules: [], unmapped: [] },
  regularSeasonWeeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  playoffWeeks: PLAYOFFS,
  playoffTeams: 2,
  playoffByes: 0,
  medianGame: false,
  pointsOnly: false,
  tradeDeadline: { week: 13 },
  tradeReview: "none",
};

interface P {
  id: string;
  name: string;
  pos: Pos;
  team: string | null;
  injury?: InjuryStatus;
  /** Points when he plays, per remaining week. */
  pts: number;
  bye?: number;
  /** Availability per remaining week (default 1, 0 on his bye, and 0 in week 12 on game day when his team is MIN). */
  a?: number[];
  value?: { value: number; source: ValueSource } | null;
  /** Conflicting ESPN signals (§6 step 3). */
  note?: AvailabilityNote;
}

const PLAYERS: P[] = [
  // Team 1 (the user's): a strong QB, thin at RB.
  { id: "101", name: "Fizzwick Pemberton", pos: "QB", team: "MIN", pts: 22, bye: 6, value: { value: 7342, source: "fantasycalc" } },
  { id: "102", name: "Dorian Quibble Jr.", pos: "RB", team: "DAL", pts: 12, bye: 14, value: { value: 2400, source: "fantasycalc" } },
  {
    id: "103",
    name: "Bartleby Crumpet",
    pos: "RB",
    team: "NYJ",
    injury: "QUESTIONABLE",
    pts: 9,
    a: [0.85, 0.97, 0.95, 0.93, 0.92, 0.91],
    value: { value: 900, source: "fantasycalc" },
    // ESPN expects him back in week 15, but Sleeper still projects him this week: the date is stale.
    note: { status: "QUESTIONABLE", returnWeek: 15, used: "sleeper", sleeperNow: 8.1, healthyRate: 9 },
  },
  { id: "104", name: "Noodle McSprocket", pos: "WR", team: "MIN", injury: "PROBABLE", pts: 17, bye: 6, a: [0.95, 0.98, 0.97, 0.96, 0.95, 0.94], value: { value: 6100, source: "fantasycalc" } },
  { id: "105", name: "Glimmer Oddfellow", pos: "WR", team: "SEA", pts: 13, value: { value: 3900, source: "fantasycalc" } },
  { id: "106", name: "Wiggleton Spoons", pos: "WR", team: "ATL", pts: 11, value: { value: 3000, source: "fantasycalc" } },
  { id: "108", name: "Tobias Thimble", pos: "TE", team: "JAX", pts: 4, value: { value: 180, source: "estimate" } },
  { id: "MIN", name: "Vikings D/ST", pos: "DEF", team: "MIN", pts: 7, value: { value: 107, source: "floor" } },
  { id: "107", name: "Humbert Fiddlesticks", pos: "WR", team: "CHI", injury: "IR", pts: 14, a: [0, 0, 0, 0.8, 0.97, 0.96], value: { value: 1800, source: "fantasycalc" } },
  // Team 2 (Rupert is in the IR slot while only Doubtful).
  { id: "201", name: "Pip Wobbleton", pos: "QB", team: "KC", pts: 20, value: { value: 6800, source: "fantasycalc" } },
  { id: "202", name: "Mortimer Gloop", pos: "RB", team: "DET", pts: 16, value: { value: 7900, source: "fantasycalc" } },
  { id: "203", name: "Ignatius Fumblewick", pos: "RB", team: "BUF", pts: 14, value: { value: 6100, source: "fantasycalc" } },
  { id: "204", name: "Cornelius Snoot", pos: "RB", team: "HOU", pts: 11, value: { value: 4200, source: "fantasycalc" } },
  { id: "205", name: "Percival Plunk", pos: "WR", team: "LAR", pts: 12, value: { value: 3500, source: "fantasycalc" } },
  { id: "DET", name: "Lions D/ST", pos: "DEF", team: "DET", pts: 8, value: { value: 107, source: "floor" } },
  {
    id: "206",
    name: "Rupert Wimbleton",
    pos: "RB",
    team: "PIT",
    injury: "DOUBTFUL",
    pts: 10,
    // He follows ESPN's return date (week 16, give or take a week): Sleeper doesn't project him this week.
    a: [0, 0, 0, 0.25, 0.75, 1],
    value: { value: 1500, source: "fantasycalc" },
    note: { status: "DOUBTFUL", returnWeek: 16, used: "returnDate", sleeperNow: null, healthyRate: 10 },
  },
  // Team 3 (Ferdinand is on the taxi squad).
  { id: "301", name: "Thaddeus Bramble", pos: "QB", team: "PHI", pts: 19, value: { value: 5200, source: "fantasycalc" } },
  { id: "302", name: "Ozzie Kettleburn", pos: "RB", team: "SF", pts: 15, value: { value: 7000, source: "fantasycalc" } },
  { id: "303", name: "Lysander Mop", pos: "RB", team: "GB", pts: 10, value: { value: 2600, source: "fantasycalc" } },
  { id: "304", name: "Rutherford Quill", pos: "WR", team: "CIN", pts: 18, value: { value: 8800, source: "fantasycalc" } },
  { id: "305", name: "Barnaby Tuft", pos: "WR", team: "TB", pts: 9, value: { value: 1500, source: "fantasycalc" } },
  { id: "PHI", name: "Eagles D/ST", pos: "DEF", team: "PHI", pts: 6, value: { value: 107, source: "floor" } },
  { id: "306", name: "Ferdinand Puddle", pos: "WR", team: "ARI", pts: 3, value: { value: 400, source: "estimate" } },
  // Team 4
  { id: "401", name: "Eustace Nibble", pos: "QB", team: "BAL", pts: 18, value: { value: 5600, source: "fantasycalc" } },
  { id: "402", name: "Gideon Parsnip", pos: "RB", team: "ATL", pts: 13, value: { value: 5000, source: "fantasycalc" } },
  { id: "403", name: "Octavius Wren", pos: "RB", team: "IND", pts: 12, value: { value: 4700, source: "fantasycalc" } },
  { id: "404", name: "Leopold Fennel", pos: "WR", team: "MIA", pts: 14, value: { value: 5200, source: "fantasycalc" } },
  { id: "405", name: "Silas Crumb", pos: "WR", team: "NO", pts: 10, value: { value: 2100, source: "fantasycalc" } },
  { id: "BAL", name: "Ravens D/ST", pos: "DEF", team: "BAL", pts: 7, value: { value: 107, source: "floor" } },
  // Free agents
  { id: "901", name: "Floopy Freeman", pos: "RB", team: "CAR", pts: 8, value: { value: 600, source: "estimate" } },
  { id: "902", name: "Waverly Waiver", pos: "RB", team: "NE", pts: 6, value: null },
  { id: "903", name: "Dabney Drifter", pos: "WR", team: null, injury: "NA", pts: 5, a: [0, 0, 0, 0, 0, 0], value: null },
  { id: "904", name: "Kip Kickington", pos: "K", team: "LV", pts: 8, value: { value: 107, source: "floor" } },
];

const byId = new Map(PLAYERS.map((p) => [p.id, p]));

function playerModel(p: P, gameDay: boolean): PlayerModel {
  // On game day MIN's week 12 game has kicked off, so it no longer counts (§6 step 3).
  const started = (w: number) => gameDay && p.team === "MIN" && w === 12;
  const weekly = WEEKS.map((w, i) => {
    const bye = p.bye === w;
    const a = bye || started(w) ? 0 : (p.a?.[i] ?? 1);
    const pts = p.pts * a;
    return { p: pts, a, m: 1, bye, sd: 0.5 * pts + 2 };
  });
  const regular = weekly.filter((_, i) => REGULAR.includes(WEEKS[i] ?? 0)).reduce((s, w) => s + w.p, 0);
  const playoffs = weekly.filter((_, i) => PLAYOFFS.includes(WEEKS[i] ?? 0)).reduce((s, w) => s + w.p, 0);
  const games = WEEKS.filter((w) => w !== p.bye && !started(w));
  return {
    id: p.id,
    base: { b: p.pts, projNow: p.pts, projWeek: 12, mNow: 1, actualPpg: p.pts, games: 10, alpha: 0.25, source: "sleeper" },
    weekly,
    ros: {
      total: regular + playoffs,
      regular,
      playoffs,
      gamesLeft: games.length,
      gamesLeftRegular: games.filter((w) => REGULAR.includes(w)).length,
      gamesLeftPlayoffs: games.filter((w) => PLAYOFFS.includes(w)).length,
      bye: p.bye === undefined ? (p.team ? { status: "done", week: 7 } : { status: "unknown" }) : p.bye < 12 ? { status: "done", week: p.bye } : { status: "upcoming", week: p.bye },
    },
    value: p.value ?? null,
    ...(p.note ? { availabilityNote: p.note } : {}),
  };
}

function info(p: P): PlayerInfo {
  return { id: p.id, name: p.name, pos: p.pos, eligible: [p.pos], nflTeam: p.team, injury: p.injury ?? "ACTIVE", ids: { sleeper: p.id } };
}

function team(id: string, name: string, owner: string, rec: [number, number], pf: number, roster: string[], ir: string[] = [], taxi: string[] = []): Team {
  return { id, name, ownerName: owner, roster, ir, taxi, record: { w: rec[0], l: rec[1], t: 0 }, pointsFor: pf, pointsAgainst: 1000 };
}

export const SLOTS = [
  { key: "QB1", label: "QB", slot: "QB", rank: 1 },
  { key: "RB1", label: "RB1", slot: "RB", rank: 1 },
  { key: "RB2", label: "RB2", slot: "RB", rank: 2 },
  { key: "WR1", label: "WR", slot: "WR", rank: 1 },
  { key: "FLEX1", label: "FLEX", slot: "FLEX", rank: 1 },
  { key: "DEF1", label: "D/ST", slot: "D/ST", rank: 1 },
];

function strength(zRos: number[], zNext: number[], ros: number[]): Record<string, SlotStrength> {
  return Object.fromEntries(SLOTS.map((s, i) => [s.key, { ros: ros[i] ?? 0, next: (ros[i] ?? 0) - 1, zRos: zRos[i] ?? 0, zNext: zNext[i] ?? 0 }]));
}

/**
 * LineupValues the way the engine builds them: LV for every week (a week in progress is a partial
 * week), ROS(T) and PPW over the weeks team numbers count (from week 13 on game day).
 */
function lineup(lv: number[], gameDay: boolean) {
  const from = gameDay ? 1 : 0;
  const reg = lv.slice(from, REGULAR.length);
  const ros = lv.reduce((s, x, i) => (i < from ? s : s + x * (i >= REGULAR.length ? config.lineups.playoffWeight : 1)), 0);
  return { lv, ros, ppw: reg.length ? reg.reduce((s, x) => s + x, 0) / reg.length : 0 };
}

/**
 * Week 12's pre-kickoff projection per team: its LV before kickoff (scenario lineups when the team has
 * them), and what TeamModel.score keeps once the week is under way (team 1's LV then counts a partial week).
 */
export const PRE_KICKOFF: Record<string, number> = { "1": 91.4, "2": 93, "3": 88, "4": 84 };

/**
 * TeamModel.score (§8): the weekly means the simulator draws around, and their SDs. The means are the
 * team's LV (`lv`), except that a week in progress (game day) keeps week 12's pre-kickoff projection.
 */
function score(teamId: string, lv: number[], sd: number, gameDay: boolean): TeamModel["score"] {
  return { mean: lv.map((x, i) => (i === 0 && gameDay ? (PRE_KICKOFF[teamId] ?? x) : x)), sd: lv.map((_, i) => sd + (i === 2 ? 1.2 : 0)) };
}

function tpv(mvLoseEv: number, mvLoseScen: number | null, surplusScore = 0): TeamPlayerValue {
  return { mvLoseEv, mvLoseScen, autoAdd: "901", surplusScore };
}

/** A trade chip whose gap is maxOther − cost. */
function chip(playerId: string, cost: number, maxOther: number, bestTeamId: string) {
  return { playerId, gap: maxOther - cost, cost, maxOther, bestTeamId };
}

function teams(gameDay: boolean): TeamModel[] {
  const lu = (lv: number[]) => lineup(lv, gameDay);
  // Team 1's week 12 LV: a partial week on game day (MIN has kicked off), the full week before kickoff.
  const week12 = (partial: number, full: number) => (gameDay ? partial : full);
  const scen1 = [week12(82, PRE_KICKOFF["1"] as number), 90, 84, 88, 88, 88];
  return [
    {
      id: "1",
      ev: lu([week12(80, 89.4), 88, 86, 90, 90, 90]),
      scen: { ...lu(scen1), sd: [9, 9, 9, 9, 9, 9] },
      strength: strength([1.2, -1.3, -0.5, 0.2, 0.6, 0], [1.1, -0.4, -0.6, 0.1, 0.5, 0], [21.5, 11.8, 8.6, 16.1, 12.4, 7]),
      needs: [
        { slot: "RB2", z: -0.5, window: "ros" },
        { slot: "RB1", z: -1.3, window: "ros" },
      ],
      chips: [chip("106", 2, 16.6, "2")],
      players: {
        "101": tpv(60, 58.2),
        "102": tpv(20, 18.5),
        "103": tpv(4, 6.1),
        "104": tpv(30, 27.9),
        "105": tpv(10, 12.3),
        "106": tpv(2, null, 1.4),
        "108": tpv(0, 0.4),
        MIN: tpv(5, 5.5),
      },
      // Full roster: the best move drops the player whose loss hurts least.
      waiver: { add: "901", drop: "108", gainEv: 3.2, gainScen: 4.64 },
      score: score("1", scen1, 24.1, gameDay),
    },
    {
      id: "2",
      ev: lu([95, 94, 96, 95, 95, 95]),
      scen: { ...lu([93, 92, 94, 93, 93, 93]), sd: [9, 9, 9, 9, 9, 9] },
      strength: strength([0.5, 1.4, 1.2, -0.3, -1.1, 0.9], [0.4, 1.3, 1.1, -0.2, -1, 0.8], [20, 16, 14, 12, 9, 8]),
      needs: [
        { slot: "FLEX1", z: -1.1, window: "ros" },
        { slot: "WR1", z: -0.6, window: "next" },
      ],
      // Biggest gap first, as the engine lists them; the table shows the first chipsShown.
      chips: [chip("204", 4, 35.2, "1"), chip("203", 9, 27.44, "4"), chip("205", 16, 28.06, "3"), chip("202", 33, 43.2, "1")],
      players: { "201": tpv(40, 38), "202": tpv(35, 33), "203": tpv(8, 9), "204": tpv(3, 4, 1.9), "205": tpv(15, 16), DET: tpv(4, 4) },
      // No free agent would help.
      waiver: null,
      score: score("2", [93, 92, 94, 93, 93, 93], 22.2, gameDay),
    },
    {
      id: "3",
      ev: lu([88, 87, 89, 88, 88, 88]),
      scen: null,
      strength: strength([0, 0.4, -0.2, 1.3, -0.4, -1.2], [0, 0.3, -0.1, 1.2, -0.3, -1.1], [19, 15, 10, 18, 9, 6]),
      needs: [{ slot: "DEF1", z: -1.2, window: "ros" }],
      chips: [chip("303", 10, 20.4, "1")],
      players: { "301": tpv(30, null), "302": tpv(30, null), "303": tpv(10, null), "304": tpv(40, null), "305": tpv(3, null), PHI: tpv(3, null) },
      // No scenarios for this team: the expected-value gain, into an open spot.
      waiver: { add: "902", drop: null, gainEv: 2.44, gainScen: null },
      // No scenarios: the expected-value lineups.
      score: score("3", [88, 87, 89, 88, 88, 88], 23.5, gameDay),
    },
    {
      id: "4",
      ev: lu([84, 85, 83, 84, 84, 84]),
      scen: { ...lu([84, 85, 83, 84, 84, 84]), sd: [9, 9, 9, 9, 9, 9] },
      strength: strength([-1.7, 0.1, 0.4, 0.7, 0.3, 0.1], [-1.6, 0, 0.3, 0.6, 0.2, 0.1], [18, 13, 12, 14, 10, 7]),
      needs: [
        { slot: "QB1", z: -1.7, window: "ros" },
        { slot: "RB2", z: -0.1, window: "next" },
        { slot: "WR1", z: -0.9, window: "next" },
        { slot: "DEF1", z: -0.55, window: "ros" },
      ],
      chips: [chip("403", 14, 26.5, "1")],
      players: { "401": tpv(25, 24), "402": tpv(20, 19), "403": tpv(15, 14), "404": tpv(22, 21), "405": tpv(5, 5), BAL: tpv(4, 4) },
      // The scenario gain rounds to nothing, so the page shows no move.
      waiver: { add: "901", drop: null, gainEv: 0.3, gainScen: 0.04 },
      score: score("4", [84, 85, 83, 84, 84, 84], 24.4, gameDay),
    },
  ];
}

/** The remaining regular-season schedule (the user's team is teamB in week 13, so either order is read). */
export const SCHEDULE: Matchup[] = [
  { week: 12, teamA: "1", teamB: "3", isPlayoff: false },
  { week: 12, teamA: "2", teamB: "4", isPlayoff: false },
  { week: 13, teamA: "4", teamB: "1", isPlayoff: false },
  { week: 13, teamA: "2", teamB: "3", isPlayoff: false },
  { week: 14, teamA: "1", teamB: "2", isPlayoff: false },
  { week: 14, teamA: "3", teamB: "4", isPlayoff: false },
];

/** Each team's chance to win its game, per remaining week (a pair's two chances add to 1). */
const WIN: Record<number, Record<string, number>> = {
  12: { "1": 0.54, "3": 0.46, "2": 0.61, "4": 0.39 },
  13: { "1": 0.56, "4": 0.44, "2": 0.56, "3": 0.44 },
  14: { "1": 0.38, "2": 0.62, "3": 0.57, "4": 0.43 },
};

function teamOdds(teamId: string, rank: number, pPlayoffs: number, pTitle: number, seedDist: number[], record: [number, number]): TeamOdds {
  // Expected wins = today's wins + the chance to win each game left (3 games, no ties).
  const expWins = record[0] + REGULAR.reduce((s, w) => s + (WIN[w]?.[teamId] ?? 0), 0);
  return { teamId, rank, pPlayoffs, pBye: null, pTitle, expWins, expLosses: record[0] + record[1] + REGULAR.length - expWins, expTies: 0, seedDist, eliminated: false };
}

/** The season simulation (§8): 2 playoff spots, no byes, a fixed bracket; same team order as the model. */
function seasonOdds(gameDay: boolean): SeasonOdds {
  return {
    sims: 5000,
    seed: config.simulation.seed,
    playoffTeams: 2,
    byes: 0,
    tiebreaker: { rule: "pointsFor", assumed: false },
    reseed: { value: false, assumed: false },
    playoffsKnown: true,
    teams: [
      teamOdds("1", 2, 0.86, 0.43, [0.21, 0.65, 0.13, 0.01], [7, 4]),
      teamOdds("2", 1, 0.93, 0.47, [0.77, 0.16, 0.069, 0.001], [8, 3]),
      teamOdds("3", 3, 0.2092, 0.0998, [0.0198, 0.1894, 0.7412, 0.0496], [5, 6]),
      teamOdds("4", 4, 0.0008, 0.0002, [0.0002, 0.0006, 0.0598, 0.9394], [2, 9]),
    ],
    weekly: REGULAR.map((week) => ({
      week,
      games: SCHEDULE.filter((m) => m.week === week).flatMap((m) => [
        { teamId: m.teamA, opponentId: m.teamB, pWin: WIN[week]?.[m.teamA] ?? null, pMedianWin: null },
        { teamId: m.teamB as string, opponentId: m.teamA, pWin: WIN[week]?.[m.teamB as string] ?? null, pMedianWin: null },
      ]),
    })),
    notes: [
      "Odds from 5,000 simulated seasons.",
      "Ties in the standings go to points for, the league's rule.",
      // The engine's own words for a week in progress (season.ts).
      ...(gameDay ? [weekUnderWayNote(12)] : []),
    ],
  };
}

export interface LeagueFixture {
  snapshot: LeagueSnapshot;
  model: LeagueModel;
  inputs: ModelInputs;
}

/**
 * The fictional league. `myTeamId` null = the user hasn't picked a team. `gameDay` (default true):
 * week 12 is in progress (use NOW); false: before its first kickoff (use BEFORE_KICKOFF).
 */
export function leagueFixture(opts: { myTeamId?: string | null; platform?: "espn" | "sleeper"; gameDay?: boolean } = {}): LeagueFixture {
  const myTeamId = opts.myTeamId === undefined ? "1" : opts.myTeamId;
  const platform = opts.platform ?? "espn";
  const gameDay = opts.gameDay ?? true;
  const rostered = [
    team("1", "Moonbeam Mudcats", "Zorblax Quintavious", [7, 4], 1180.4, ["101", "102", "103", "104", "105", "106", "108", "MIN"], ["107"]),
    team("2", "Gravel Gophers", "Brumhilda Snarfwhistle", [8, 3], 1210.25, ["201", "202", "203", "204", "205", "DET"], ["206"]),
    team("3", "Quasar Quokkas", "Quenby Flapdoodle", [5, 6], 1100, ["301", "302", "303", "304", "305", "PHI"], [], ["306"]),
    team("4", "Tundra Tortoises", "Thaddeus Wobblegong", [2, 9], 990.5, ["401", "402", "403", "404", "405", "BAL"]),
  ];
  const snapshot: LeagueSnapshot = {
    platform,
    leagueId: "4242",
    season: 2026,
    name: "The Gloopdorf Invitational",
    fetchedAt: gameDay ? "2026-11-26T21:55:00.000Z" : "2026-11-26T15:55:00.000Z",
    currentWeek: 12,
    settings,
    teams: rostered,
    myTeamId,
    players: Object.fromEntries(PLAYERS.map((p) => [p.id, info(p)])),
    schedule: SCHEDULE,
    transactions: [],
    freeAgents: ["901", "902", "903", "904"],
    warnings: [],
  };
  const model: LeagueModel = {
    weeks: WEEKS,
    regularWeeks: REGULAR,
    playoffWeeks: PLAYOFFS,
    scenarios: 32,
    inProgressWeek: gameDay ? 12 : null,
    players: Object.fromEntries(PLAYERS.map((p) => [p.id, playerModel(p, gameDay)])),
    teams: teams(gameDay),
    myTeamId,
    slots: SLOTS,
    partners: myTeamId
      ? [
          {
            teamId: "2",
            mutual: true,
            score: 2.4,
            theyCanGive: [
              { playerId: "204", ppw: 2.1 },
              { playerId: "203", ppw: 1.2 },
              { playerId: "202", ppw: 0.8 },
              { playerId: "205", ppw: 0.5 },
            ],
            youCanGive: [{ playerId: "106", ppw: 1.8 }],
          },
          { teamId: "3", mutual: true, score: 1.1, theyCanGive: [{ playerId: "303", ppw: 0.9 }], youCanGive: [{ playerId: "106", ppw: 1.3 }] },
          { teamId: "4", mutual: false, score: 1.6, theyCanGive: [{ playerId: "403", ppw: 1.6 }], youCanGive: [] },
        ]
      : [],
    market: {
      format: { isDynasty: false, numQbs: 1, numTeams: 8, ppr: 0.5, substitutions: ["4 teams → FantasyCalc's 8-team values"] },
      waiverCredit: 600,
      topValue: 10722,
      counts: { fantasycalc: 23, estimate: 3, floor: 5, none: 2 },
    },
    projection: { espnAveraged: false, agreement: { meanRelDiff: 0.14, players: 26, week: 12 }, disagreements: [], sources: { "espn+sleeper": 0, sleeper: 33, espn: 0, season: 0, actual: 0, none: 0 } },
    odds: seasonOdds(gameDay),
    timings: {},
    warnings: ["No projection for Dabney Drifter."],
  };
  const inputs: ModelInputs = {
    version: 1,
    season: 2026,
    currentWeek: 12,
    lastWeek: 17,
    builtAt: gameDay ? "2026-11-26T21:56:00.000Z" : "2026-11-26T15:56:00.000Z",
    nfl: { byeWeek: { MIN: 6, DAL: 14 }, kickoffs: { 12: { MIN: "2026-11-26T17:30:00.000Z", DAL: "2026-11-27T01:20:00.000Z", NYJ: "2026-11-29T18:00:00.000Z" } } },
    players: {},
    espnProjections: platform === "espn",
    market: null,
    sources: [
      { source: "Sleeper projections", fetchedAt: "2026-11-26T20:00:00.000Z" },
      { source: "FantasyCalc values", fetchedAt: "2026-11-25T23:00:00.000Z", stale: true },
    ],
    warnings: [{ code: "PROJECTIONS_WEEK_UNAVAILABLE", message: "Sleeper's week 17 projections didn't load." }],
    // The server's value notes (src/server/modelInputs.ts fantasyCalcNotes) repeat what the page shows; the last one doesn't.
    notes: ["Trade values: FantasyCalc 8 teams · half-PPR · 1 QB · redraft.", "Trade values: 4 teams → FantasyCalc's 8-team values.", "Sleeper hasn't published week 18 projections yet."],
  };
  return { snapshot, model, inputs };
}

/** A fixture player's name (tests read names from here, not from literals scattered around). */
export function nameOf(id: string): string {
  return byId.get(id)?.name ?? id;
}
