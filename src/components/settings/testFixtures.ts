/**
 * Test-only: a small made-up ESPN league for the Settings page's tests (view model and markup). Three teams:
 * team 1 (the user's when a test says so) has a full set of starters and an injured RB on IR; team 2 has three
 * players; team 3 has one RB and a WR on the taxi squad. One free agent. Every name is invented.
 */
import type { LeagueSettings, LeagueSnapshot, PlayerInfo, Pos, SlotDef, Team } from "@/engine/model";

export const LINEUP: SlotDef[] = [
  { slot: "QB", count: 1, eligible: ["QB"] },
  { slot: "RB", count: 2, eligible: ["RB"] },
  { slot: "WR", count: 2, eligible: ["WR"] },
  { slot: "TE", count: 1, eligible: ["TE"] },
  { slot: "FLEX", count: 1, eligible: ["RB", "WR", "TE"] },
  { slot: "K", count: 1, eligible: ["K"] },
  { slot: "D/ST", count: 1, eligible: ["DEF"] },
];

function player(id: string, name: string, pos: Pos, nflTeam: string | null = "AAA"): PlayerInfo {
  return { id, name, pos, eligible: [pos], nflTeam, injury: "ACTIVE", ids: {} };
}

export const PLAYERS: PlayerInfo[] = [
  player("101", "Zed Quarterback", "QB", "BUF"),
  player("102", "Abe Runner", "RB", "DAL"),
  player("103", "Cal Catcher", "WR", "SEA"),
  player("104", "Bo Blocker", "TE", "KC"),
  player("105", "Kip Kicker", "K", "LV"),
  player("106", "Wes Wideout", "WR", "MIA"),
  player("107", "Ira Injured", "RB", "NYJ"),
  player("201", "Pat Passer", "QB", "KC"),
  player("202", "Rex Rusher", "RB", "DET"),
  player("203", "Ty Tightend", "TE", "PHI"),
  player("301", "Moe Mover", "RB", "SF"),
  player("302", "Ned Newbie", "WR", null),
  player("901", "Fred Freeagent", "RB", "CAR"),
];

function team(id: string, name: string, roster: string[], ir: string[] = [], taxi: string[] = []): Team {
  return { id, name, ownerName: `Owner ${id}`, roster, ir, taxi, record: { w: 2, l: 1, t: 0 }, pointsFor: 300, pointsAgainst: 290 };
}

export function snapshot(over: { leagueType?: LeagueSettings["leagueType"]; lineup?: SlotDef[]; platform?: LeagueSnapshot["platform"] } = {}): LeagueSnapshot {
  return {
    platform: over.platform ?? "espn",
    leagueId: "4242",
    season: 2026,
    name: "The Made-Up League",
    fetchedAt: "2026-09-30T20:00:00.000Z",
    currentWeek: 4,
    settings: {
      numTeams: 3,
      leagueType: over.leagueType ?? "redraft",
      lineup: over.lineup ?? LINEUP,
      benchSlots: 6,
      irSlots: 1,
      taxiSlots: 1,
      maxRosterSize: 15,
      scoring: { perStat: {}, rules: [], unmapped: [] },
      regularSeasonWeeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
      playoffWeeks: [15, 16, 17],
      playoffTeams: 2,
      medianGame: false,
      pointsOnly: false,
      tradeDeadline: null,
      tradeReview: "none",
    },
    teams: [team("1", "Team One", ["101", "102", "103", "104", "105", "106"], ["107"]), team("2", "Team Two", ["201", "202", "203"]), team("3", "Team Three", ["301"], [], ["302"])],
    myTeamId: null,
    players: Object.fromEntries(PLAYERS.map((p) => [p.id, p])),
    schedule: [],
    transactions: [],
    freeAgents: ["901"],
    warnings: [],
  };
}
