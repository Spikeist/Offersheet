/**
 * The user's own return weeks for his injured players (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.5: "the user
 * can change the week, and the new week works like a return week from the platform … saved per league in the browser and
 * never sent. It clears when the player is active again or the week passes."; TradeSettings.returnWeeks): which saved
 * entries count, and which are stale. Pure: no I/O, no clock.
 *
 * An entry counts while its player is on my team's active roster or IR (snapshot.myTeamId's; ⚠️ ours: not its taxi squad,
 * where nobody starts), his status isn't ACTIVE, and its week hasn't passed (at least snapshot.currentWeek), in the season
 * the weeks were set for (TradeSettings.returnWeeksSeason: review of wave C, UI-C-3: a league's settings carry over to the
 * next season's import, where last season's weeks, "out for the season" among them, would hold a player still listed
 * injured out of the new one). The engine follows the ones that count, for my players only (league.ts step 3:
 * availability.userReturnWeekDistribution, whatever his tag says), in the League model and in every trade context alike (the
 * settings go with every engine request, and the worker keys both by them: settingsStore.ts LEAGUE_MODEL_SETTINGS), and the
 * trade cards' injury tags say them (explain.tagContextOf). The others are stale: the League page drops them from the saved
 * settings in one save, once per new snapshot or team (LeaguePage.tsx, leagueSettingsEdit.ts withoutStaleReturnWeeks), and
 * the engine ignores them meanwhile. ⚠️ Ours: without a team of mine nothing counts, and only another season's entries are
 * stale (no roster to judge an entry by, so the page leaves this season's be until a team is picked).
 */
import type { LeagueSnapshot, Team } from "./model";
import type { TradeSettings } from "./settings";

/** What the rule reads of a snapshot: the teams, the players' statuses, the NFL week and season, and my team. */
export type ReturnWeekSnapshot = Pick<LeagueSnapshot, "teams" | "players" | "currentWeek" | "myTeamId" | "season">;

/** What the rule reads of the settings: the weeks and the season they were set for (absent: none, and no season). */
export type ReturnWeekSettings = Partial<Pick<TradeSettings, "returnWeeks" | "returnWeeksSeason">>;

function myTeamOf(snapshot: ReturnWeekSnapshot): Team | undefined {
  return snapshot.myTeamId === null ? undefined : snapshot.teams.find((t) => t.id === snapshot.myTeamId);
}

/** Whether the saved weeks were set for the snapshot's season (the file header): only then can one of them count. */
function thisSeason(snapshot: ReturnWeekSnapshot, settings: ReturnWeekSettings | undefined): boolean {
  return settings?.returnWeeksSeason !== undefined && settings.returnWeeksSeason !== null && settings.returnWeeksSeason === snapshot.season;
}

/**
 * The saved return weeks the engine follows (the file header): id → NFL week, for my active-roster and IR players whose
 * status isn't ACTIVE, each week a whole one at least snapshot.currentWeek, set for the snapshot's season. Empty without a
 * team of mine.
 */
export function userReturnWeeks(snapshot: ReturnWeekSnapshot, settings: ReturnWeekSettings | undefined): Map<string, number> {
  const out = new Map<string, number>();
  const team = myTeamOf(snapshot);
  const returnWeeks = settings?.returnWeeks;
  if (!team || !returnWeeks || !thisSeason(snapshot, settings)) return out;
  const mine = new Set([...team.roster, ...team.ir]);
  for (const [id, week] of Object.entries(returnWeeks)) {
    const status = snapshot.players[id]?.injury;
    if (!mine.has(id) || status === undefined || status === "ACTIVE") continue;
    if (typeof week === "number" && Number.isInteger(week) && week >= snapshot.currentWeek) out.set(id, week);
  }
  return out;
}

/**
 * The saved return weeks that no longer count (userReturnWeeks), in id order: every one set for another season (or for
 * none); else, with a team of mine, the ones it doesn't count (the file header).
 */
export function staleReturnWeeks(snapshot: ReturnWeekSnapshot, settings: ReturnWeekSettings | undefined): string[] {
  const returnWeeks = settings?.returnWeeks;
  if (!returnWeeks) return [];
  const ids = Object.keys(returnWeeks);
  if (!thisSeason(snapshot, settings)) return ids.sort();
  if (!myTeamOf(snapshot)) return [];
  const counted = userReturnWeeks(snapshot, settings);
  return ids.filter((id) => !counted.has(id)).sort();
}
