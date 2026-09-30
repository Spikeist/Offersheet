/**
 * Test-only: a small fictional league with a hand-built LeagueModel and model inputs, for the League
 * page's view-model and markup tests (no engine run, no network). Every team and player name is
 * made up. Four teams, NFL week 12 of a season whose regular season ends in week 14 and whose
 * playoffs are weeks 15–17. Team 1 (the user's) has a full roster, so its best free-agent move drops
 * a player; teams 3 and 4 have open spots; team 2 has no move that helps. Team 2 has a Doubtful
 * player in an IR slot (his injury badge doesn't say IR) and team 3 a taxi-squad player.
 *
 * By default it is game day: MIN's Thanksgiving game kicked off before NOW, so week 12 is in progress
 * (LeagueModel.inProgressWeek) and the team numbers skip it, as the engine's do (CLAUDE.md §7, Phase 2
 * review decisions: game days). `{ gameDay: false }` is the same league before any week 12 kickoff
 * (use BEFORE_KICKOFF as "now").
 */
import { config } from "@/engine/config";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueModel, PlayerModel, SlotStrength, TeamModel, TeamPlayerValue, ValueSource } from "@/engine/leagueModel";
import type { InjuryStatus, LeagueSettings, LeagueSnapshot, PlayerInfo, Pos, Team } from "@/engine/model";

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
}

const PLAYERS: P[] = [
  // Team 1 (the user's): a strong QB, thin at RB.
  { id: "101", name: "Fizzwick Pemberton", pos: "QB", team: "MIN", pts: 22, bye: 6, value: { value: 7342, source: "fantasycalc" } },
  { id: "102", name: "Dorian Quibble Jr.", pos: "RB", team: "DAL", pts: 12, bye: 14, value: { value: 2400, source: "fantasycalc" } },
  { id: "103", name: "Bartleby Crumpet", pos: "RB", team: "NYJ", injury: "QUESTIONABLE", pts: 9, a: [0.85, 0.97, 0.95, 0.93, 0.92, 0.91], value: { value: 900, source: "fantasycalc" } },
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
  { id: "206", name: "Rupert Wimbleton", pos: "RB", team: "PIT", injury: "DOUBTFUL", pts: 10, a: [0.25, 1, 1, 1, 1, 1], value: { value: 1500, source: "fantasycalc" } },
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

function tpv(mvLoseEv: number, mvLoseScen: number | null, surplusScore = 0, startsFor = 0): TeamPlayerValue {
  return { mvLoseEv, mvLoseScen, autoAdd: "901", surplusScore, startsFor };
}

function teams(gameDay: boolean): TeamModel[] {
  const lu = (lv: number[]) => lineup(lv, gameDay);
  return [
    {
      id: "1",
      ev: lu([80, 88, 86, 90, 90, 90]),
      scen: { ...lu([82, 90, 84, 88, 88, 88]), sd: [9, 9, 9, 9, 9, 9] },
      strength: strength([1.2, -1.3, -0.5, 0.2, 0.6, 0], [1.1, -0.4, -0.6, 0.1, 0.5, 0], [21.5, 11.8, 8.6, 16.1, 12.4, 7]),
      needs: [
        { slot: "RB2", z: -0.5, window: "ros" },
        { slot: "RB1", z: -1.3, window: "ros" },
      ],
      surplus: [{ playerId: "106", score: 1.4, startsFor: 2 }],
      players: {
        "101": tpv(60, 58.2),
        "102": tpv(20, 18.5),
        "103": tpv(4, 6.1),
        "104": tpv(30, 27.9),
        "105": tpv(10, 12.3),
        "106": tpv(2, null, 1.4, 2),
        "108": tpv(0, 0.4),
        MIN: tpv(5, 5.5),
      },
      // Full roster: the best move drops the player whose loss hurts least.
      waiver: { add: "901", drop: "108", gainEv: 3.2, gainScen: 4.64 },
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
      surplus: [
        { playerId: "203", score: 1.2, startsFor: 3 },
        { playerId: "204", score: 1.9, startsFor: 1 },
      ],
      players: { "201": tpv(40, 38), "202": tpv(35, 33), "203": tpv(8, 9), "204": tpv(3, 4, 1.9, 1), "205": tpv(15, 16), DET: tpv(4, 4) },
      // No free agent would help.
      waiver: null,
    },
    {
      id: "3",
      ev: lu([88, 87, 89, 88, 88, 88]),
      scen: null,
      strength: strength([0, 0.4, -0.2, 1.3, -0.4, -1.2], [0, 0.3, -0.1, 1.2, -0.3, -1.1], [19, 15, 10, 18, 9, 6]),
      needs: [{ slot: "DEF1", z: -1.2, window: "ros" }],
      surplus: [],
      players: { "301": tpv(30, null), "302": tpv(30, null), "303": tpv(10, null), "304": tpv(40, null), "305": tpv(3, null), PHI: tpv(3, null) },
      // No scenarios for this team: the expected-value gain, into an open spot.
      waiver: { add: "902", drop: null, gainEv: 2.44, gainScen: null },
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
      surplus: [],
      players: { "401": tpv(25, 24), "402": tpv(20, 19), "403": tpv(15, 14), "404": tpv(22, 21), "405": tpv(5, 5), BAL: tpv(4, 4) },
      // The scenario gain rounds to nothing, so the page shows no move.
      waiver: { add: "901", drop: null, gainEv: 0.3, gainScen: 0.04 },
    },
  ];
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
    schedule: [],
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
          { teamId: "2", mutual: true, score: 2.4, theyCanGive: [{ playerId: "204", ppw: 2.1 }, { playerId: "203", ppw: 1.2 }], youCanGive: [{ playerId: "106", ppw: 1.8 }] },
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
