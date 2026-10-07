/**
 * Test-only: a small fictional league with a hand-built LeagueModel and model inputs, for the League
 * page's view-model and markup tests (no engine run, no network). Every team and player name is
 * made up. Four teams, NFL week 12 of a season whose regular season ends in week 14 and whose
 * playoffs are weeks 15–17. Team 1 (the user's) has a full roster, so its one free-agent pickup
 * (TeamModel.faMoves) drops a player; team 3 has open spots and two pickups, the first into an open spot,
 * the second for one of its players; teams 2 and 4 have none that helps. Team 2 has a Doubtful
 * player in an IR slot (his injury badge doesn't say IR) and team 3 a taxi-squad player.
 *
 * Trade chips (CLAUDE.md §7): team 2 has five (the table shows three), one of them best for the user's team
 * ("to you"); team 3 has two; teams 1 and 4 have one each. Every chip carries its cost per week counted
 * (cost ÷ omega()) and, except team 1's and team 2's bench back, the "starter" tag. Streaming (§7): the user's
 * team and team 3 stream D/ST, with two free-agent D/STs as this week's picks (streaming(), below). Two
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
 *
 * One baseline everywhere (Phase 4c; planner reply to Checkpoint 4b, change 9): LeagueModel.odds is every team after its
 * free-agent pickups (TeamModel.scoreWithPickups: team 1's score plus PICKUP_GAIN["1"] a week, team 3's plus its own;
 * teams 2 and 4 make none, so theirs is their score), and LeagueModel.oddsAsRostersStand every team as it stands: team 1
 * 82% / 40% there against 86% / 43% with pickups. On game day each scoreWithPickups keeps score's week 12 (the engine plays
 * a week under way with today's rosters); before kickoff the pickups count in week 12 too.
 *
 * The star premium (planner addendum to Checkpoint 3, §1–§2; TeamModel.premiums) follows the engine's rules
 * (premiums(), below): each team's two most valuable players who are also among the top 12 by FantasyCalc value
 * are "Harder to get": team 1's Pemberton and McSprocket (mine: never shown), team 2's Gloop and Wobbleton,
 * team 3's Quill and Kettleburn, team 4's Nibble and Fennel. Team 2's best partner player for me is Gloop (tagged),
 * so its card leads with "Best of their trade chips: C. Snoot" and "Bigger upgrade, harder to get: M. Gloop";
 * Wobbleton, a fifth team 2 chip, shows tagged in the rest of the list, and Kettleburn is a tagged trade chip of team 3.
 * Team 3's only partner player for me, Mop (+0.9/wk), adds less than config.needs.bestTargetMin (1) a week and isn't
 * tagged, so its card leads with no chip (lead decision N12); team 4's Wren (+1.6/wk) leads its card as the best of its
 * trade chips.
 */
import { config } from "@/engine/config";
import type { ModelInputs } from "@/engine/inputs";
import type { AvailabilityNote, LeagueModel, PlayerModel, PlayerPremium, SeasonOdds, SlotStrength, StreamingSummary, TeamModel, TeamOdds, TeamPlayerValue, TradeChip, ValueSource } from "@/engine/leagueModel";
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
  // Free-agent D/STs: this week's streaming picks (the league starts no kicker, so there are no K picks).
  { id: "SEA", name: "Seahawks D/ST", pos: "DEF", team: "SEA", pts: 8.2, value: { value: 107, source: "floor" } },
  { id: "NYG", name: "Giants D/ST", pos: "DEF", team: "NYG", pts: 6.6, value: { value: 107, source: "floor" } },
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

/** Each team's players: active roster, IR and taxi squad. */
const ROSTERS: Record<string, { roster: string[]; ir: string[]; taxi: string[] }> = {
  "1": { roster: ["101", "102", "103", "104", "105", "106", "108", "MIN"], ir: ["107"], taxi: [] },
  "2": { roster: ["201", "202", "203", "204", "205", "DET"], ir: ["206"], taxi: [] },
  "3": { roster: ["301", "302", "303", "304", "305", "PHI"], ir: [], taxi: ["306"] },
  "4": { roster: ["401", "402", "403", "404", "405", "BAL"], ir: [], taxi: [] },
};

/**
 * The star premium (planner addendum to Checkpoint 3, §1; lead decision N1) of every player a team rosters (active, IR
 * and taxi), as the engine computes it: his rank by value on the roster (ties: more ROS points, then the smaller id),
 * e_rank from config.acceptance.starPremium.rank, e_elite when he's among the top eliteTop players by FantasyCalc value
 * (FantasyCalc-valued players only; ties at the cut: the smaller id), "Harder to get" at harderToGetMin. A redraft
 * league: nobody's premium is halved.
 */
function premiums(teamId: string, gameDay: boolean): Record<string, PlayerPremium> {
  const sp = config.acceptance.starPremium;
  const byIdAsc = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const valueOf = (id: string) => byId.get(id)?.value?.value ?? 0;
  const fantasyCalc = PLAYERS.filter((p) => p.value?.source === "fantasycalc").sort((a, b) => valueOf(b.id) - valueOf(a.id) || byIdAsc(a.id, b.id));
  const elite = new Set(fantasyCalc.slice(0, sp.eliteTop).map((p) => p.id));
  const ros = (id: string) => {
    const p = byId.get(id);
    return p ? playerModel(p, gameDay).ros.total : 0;
  };
  const r = ROSTERS[teamId];
  const ids = r ? [...r.roster, ...r.ir, ...r.taxi] : [];
  const ranked = [...ids].sort((a, b) => valueOf(b) - valueOf(a) || ros(b) - ros(a) || byIdAsc(a, b));
  return Object.fromEntries(
    ranked.map((id, i) => {
      const e = (sp.rank[i] ?? 0) + (elite.has(id) ? sp.elite : 0);
      return [id, { e, rank: i + 1, elite: elite.has(id), harderToGet: e >= sp.harderToGetMin }];
    }),
  );
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

/** What each team's free-agent pickups (TeamModel.faMoves) add to its weekly mean: teams 1 and 3 make some, teams 2 and 4 none. */
export const PICKUP_GAIN: Record<string, number> = { "1": 1.5, "2": 0, "3": 2.2, "4": 0 };

/**
 * TeamModel.scoreWithPickups (Phase 4c): the score with the team's pickups (PICKUP_GAIN a week, the same SD), except a week
 * in progress, which keeps the score's week (the engine plays it with today's rosters).
 */
function scoreWithPickups(teamId: string, s: TeamModel["score"], gameDay: boolean): NonNullable<TeamModel["scoreWithPickups"]> {
  const gain = PICKUP_GAIN[teamId] ?? 0;
  return { mean: s.mean.map((x, i) => (i === 0 && gameDay ? x : x + gain)), sd: [...s.sd] };
}

function tpv(mvLoseEv: number, mvLoseScen: number | null, surplusScore = 0): TeamPlayerValue {
  return { mvLoseEv, mvLoseScen, autoAdd: "901", surplusScore };
}

/**
 * Σ ω over the weeks team numbers count: weeks 13–17 on game day (2 regular-season weeks and 3 playoff weeks at the
 * playoff weight), weeks 12–17 before kickoff.
 */
export function omega(gameDay: boolean): number {
  return (gameDay ? REGULAR.length - 1 : REGULAR.length) + PLAYOFFS.length * config.lineups.playoffWeight;
}

/** A trade chip whose gap is maxOther − cost, with its cost per week counted and whether he starts for his team. */
function chip(playerId: string, cost: number, maxOther: number, bestTeamId: string, starter: boolean, gameDay: boolean): TradeChip {
  return { playerId, gap: maxOther - cost, cost, maxOther, bestTeamId, costPerWeek: cost / omega(gameDay), starter };
}

function teams(gameDay: boolean): TeamModel[] {
  const lu = (lv: number[]) => lineup(lv, gameDay);
  const chip_ = (playerId: string, cost: number, maxOther: number, bestTeamId: string, starter = false) => chip(playerId, cost, maxOther, bestTeamId, starter, gameDay);
  // Team 1's week 12 LV: a partial week on game day (MIN has kicked off), the full week before kickoff.
  const week12 = (partial: number, full: number) => (gameDay ? partial : full);
  const scen1 = [week12(82, PRE_KICKOFF["1"] as number), 90, 84, 88, 88, 88];
  const list: TeamModel[] = [
    {
      id: "1",
      ev: lu([week12(80, 89.4), 88, 86, 90, 90, 90]),
      scen: { ...lu(scen1), sd: [9, 9, 9, 9, 9, 9] },
      strength: strength([1.2, -1.3, -0.5, 0.2, 0.6, 0], [1.1, -0.4, -0.6, 0.1, 0.5, 0], [21.5, 11.8, 8.6, 16.1, 12.4, 7]),
      needs: [
        { slot: "RB2", z: -0.5, window: "ros" },
        { slot: "RB1", z: -1.3, window: "ros" },
      ],
      chips: [chip_("106", 2, 16.6, "2")],
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
      // Full roster: the pickup drops a player (its gain with injuries and byes simulated is lower than on projected lineups).
      // Each week counted once (the plain gains the page shows: planner reply to Checkpoint 7b, Q6), it's less again: the
      // playoff weeks' part isn't weighted up.
      faMoves: [{ add: "901", drop: "108", gainEv: 4.64, gainScen: 3.92, gainEvPlain: 3.71, gainScenPlain: 3.31 }],
      premiums: premiums("1", gameDay),
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
      // Snoot is a bench back; Fumblewick, Plunk, Wobbleton and Gloop start for team 2.
      chips: [chip_("204", 4, 35.2, "1"), chip_("203", 9, 27.44, "4", true), chip_("205", 16, 28.06, "3", true), chip_("201", 38, 48.5, "1", true), chip_("202", 33, 43.2, "1", true)],
      players: { "201": tpv(40, 38), "202": tpv(35, 33), "203": tpv(8, 9), "204": tpv(3, 4, 1.9), "205": tpv(15, 16), DET: tpv(4, 4) },
      // No free agent would help.
      faMoves: [],
      premiums: premiums("2", gameDay),
      score: score("2", [93, 92, 94, 93, 93, 93], 22.2, gameDay),
    },
    {
      id: "3",
      ev: lu([88, 87, 89, 88, 88, 88]),
      scen: null,
      strength: strength([0, 0.4, -0.2, 1.3, -0.4, -1.2], [0, 0.3, -0.1, 1.2, -0.3, -1.1], [19, 15, 10, 18, 9, 6]),
      needs: [{ slot: "DEF1", z: -1.2, window: "ros" }],
      // Kettleburn, its second most valuable player and a top-12 one, is a starting trade chip: "Harder to get".
      chips: [chip_("302", 30, 41.5, "4", true), chip_("303", 10, 20.4, "1", true)],
      players: { "301": tpv(30, null), "302": tpv(30, null), "303": tpv(10, null), "304": tpv(40, null), "305": tpv(3, null), PHI: tpv(3, null) },
      // No scenarios for this team (no simulated gains): one pickup into an open spot, then one for a bench WR.
      faMoves: [
        { add: "902", drop: null, gainEv: 3.44, gainScen: null, gainEvPlain: 2.87, gainScenPlain: null },
        { add: "901", drop: "305", gainEv: 3.06, gainScen: null, gainEvPlain: 2.61, gainScenPlain: null },
      ],
      premiums: premiums("3", gameDay),
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
      chips: [chip_("403", 14, 26.5, "1", true)],
      players: { "401": tpv(25, 24), "402": tpv(20, 19), "403": tpv(15, 14), "404": tpv(22, 21), "405": tpv(5, 5), BAL: tpv(4, 4) },
      // No pickup reaches the optimizer's minimum gain.
      faMoves: [],
      premiums: premiums("4", gameDay),
      score: score("4", [84, 85, 83, 84, 84, 84], 24.4, gameDay),
    },
  ];
  // Phase 4c: each team's score after its free-agent pickups (the headline odds' scores).
  return list.map((t) => ({ ...t, scoreWithPickups: scoreWithPickups(t.id, t.score, gameDay) }));
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

/**
 * The season simulation (§8): 2 playoff spots, no byes, a fixed bracket; same team order as the model. The headline
 * (LeagueModel.odds: every team after its free-agent pickups), or `asRostersStand` (LeagueModel.oddsAsRostersStand: no
 * team's pickups, so teams 1 and 3, who make some, do a little worse). Both add up: Σ playoffs = 2, Σ titles = 1.
 */
function seasonOdds(gameDay: boolean, asRostersStand = false): SeasonOdds {
  return {
    sims: 5000,
    seed: config.simulation.seed,
    playoffTeams: 2,
    byes: 0,
    tiebreaker: { rule: "pointsFor", assumed: false },
    reseed: { value: false, assumed: false },
    playoffsKnown: true,
    teams: asRostersStand
      ? [
          teamOdds("1", 2, 0.82, 0.4, [0.19, 0.63, 0.16, 0.02], [7, 4]),
          teamOdds("2", 1, 0.97, 0.51, [0.8, 0.17, 0.029, 0.001], [8, 3]),
          teamOdds("3", 3, 0.2085, 0.0897, [0.0098, 0.1987, 0.7465, 0.045], [5, 6]),
          teamOdds("4", 4, 0.0015, 0.0003, [0.0002, 0.0013, 0.0645, 0.934], [2, 9]),
        ]
      : [
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

/**
 * Streaming positions (LeagueModel.streaming, §7): the league starts a D/ST but no kicker, so only D/ST counts.
 * The user's team streams D/ST (the default setting, K and DEF, minus the K the lineup doesn't start); team 3 is
 * detected streaming D/ST (3 adds there this season; its K add doesn't count: no K slot); teams 2 and 4 aren't
 * (one D/ST add, none). The replacement is the 3rd-best free-agent D/ST each week: with only two, the last one
 * (the Giants, 6.6 every week). This week's picks: the Seahawks at home against ARI, the Giants at DAL. Without
 * a team of mine, team 1 is detected like the others (one add: not a streamer).
 */
function streaming(myTeamId: string | null): StreamingSummary {
  return {
    byTeam: {
      "1": myTeamId === "1" ? { positions: ["DEF"], source: "setting", adds: { DEF: 1 } } : { positions: [], source: "detected", adds: { DEF: 1 } },
      "2": { positions: [], source: "detected", adds: { DEF: 1 } },
      "3": { positions: ["DEF"], source: "detected", adds: { DEF: 3, K: 1 } },
      "4": { positions: [], source: "detected", adds: {} },
    },
    replacement: { DEF: WEEKS.map(() => 6.6) },
    picks: [
      { playerId: "SEA", pos: "DEF", projection: 8.2, opponent: { team: "ARI", home: true } },
      { playerId: "NYG", pos: "DEF", projection: 6.6, opponent: { team: "DAL", home: false } },
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
  const r = (id: string) => ROSTERS[id] ?? { roster: [], ir: [], taxi: [] };
  const rostered = [
    team("1", "Moonbeam Mudcats", "Zorblax Quintavious", [7, 4], 1180.4, r("1").roster, r("1").ir, r("1").taxi),
    team("2", "Gravel Gophers", "Brumhilda Snarfwhistle", [8, 3], 1210.25, r("2").roster, r("2").ir, r("2").taxi),
    team("3", "Quasar Quokkas", "Quenby Flapdoodle", [5, 6], 1100, r("3").roster, r("3").ir, r("3").taxi),
    team("4", "Tundra Tortoises", "Thaddeus Wobblegong", [2, 9], 990.5, r("4").roster, r("4").ir, r("4").taxi),
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
    freeAgents: ["901", "902", "903", "904", "SEA", "NYG"],
    warnings: [],
  };
  const model: LeagueModel = {
    weeks: WEEKS,
    regularWeeks: REGULAR,
    playoffWeeks: PLAYOFFS,
    scenarios: 32,
    playoffWeight: config.lineups.playoffWeight,
    streaming: streaming(myTeamId),
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
            // Most first, as the engine lists them: Gloop (Harder to get) would help me most.
            theyCanGive: [
              { playerId: "202", ppw: 2.5 },
              { playerId: "204", ppw: 2.1 },
              { playerId: "203", ppw: 1.2 },
              { playerId: "205", ppw: 0.5 },
              { playerId: "201", ppw: 0.4 },
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
    oddsAsRostersStand: seasonOdds(gameDay, true),
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
