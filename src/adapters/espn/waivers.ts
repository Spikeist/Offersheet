/**
 * ESPN's waiver order → Team.waiverRank and Team.liveWaiverRank, and LeagueSettings.waiverOrderUsed (CLAUDE.md §2.2, §7 "one
 * free agent, one team"; Phase 4c, planner reply to Checkpoint 4b, answer 2: "use the weekly reset order when the league
 * resets weekly, as Parker's does; use the live order for rolling waivers. The baseline must not depend on which day someone
 * imports."). PURE: normalize.ts passes in what it read; tests run it on made-up leagues.
 *
 * What ESPN reports (view=mSettings+mTeam+mStatus; every path checked on both test leagues as captured on 2026-09-30:
 * Parker's league, fixtures/sanitized/espn, and the public test league 899513, a git-ignored raw capture):
 * - teams[].waiverRank: the order as it stands, 1 = first claim (a 1..10 permutation in both).
 * - settings.acquisitionSettings.waiverOrderReset: true in both, read as "the order resets every week". At the reset (Sep 30,
 *   before that week's first waiver run) waiverRank was numTeams + 1 − teams[].playoffSeed for 10 of 10 teams of each (✅ 20
 *   of 20, in leagues whose seeds break ties by points for: settings.scheduleSettings.playoffSeedingRule is
 *   TOTAL_POINTS_SCORED in both): reverse standings, the worst team first. The reset comes with ESPN's weekly standings
 *   update (⚠️ read from both leagues' timestamps: in Parker's league status.waiverLastExecutionDate, Tue Sep 29 07:55:45Z,
 *   not one of its waiver days, is 0.1 s before status.standingsUpdateDate; the public test league's last waiver run was Sun
 *   Sep 27, yet its order was numTeams + 1 − playoffSeed after its Sep 29 standings update), so between updates today's seeds
 *   give the last reset's order. Between resets ESPN's own order isn't reverse standings: in Parker's league
 *   (WAIVERS_TRADITIONAL, waivers run six days a week) a team whose claim goes through moves to the back until the next
 *   reset, so on Oct 4, after three runs, ESPN's order was Team 5 > 8 > 6 > 4 > 9 > 7 > 2 > 1 > 10 > 3 and the reset order
 *   Team 2 > 4 > 10 > 3 > 5 > 9 > 8 > 1 > 7 > 6 (Parker's Team 3 picks 4th, not 10th).
 * - teams[].playoffSeed: each team's seed if the season ended today, 1 = best: ESPN's standings with the league's own
 *   tiebreaker (Parker's league: win %, then points for, its TOTAL_POINTS_SCORED rule), the division winners first in a league
 *   with divisions (normalize.ts DIVISION_SEEDING_SOURCE). Both test leagues have a single division.
 * - settings.acquisitionSettings.acquisitionType: ESPN's own list is FREEAGENCY, WAIVERS_TRADITIONAL, WAIVERS_CONTINUOUS
 *   (settings.typeNames.acquisitionTypes of GET /seasons/{season}?view=proTeamSchedules_wl). Parker's league:
 *   WAIVERS_TRADITIONAL; the public test league: WAIVERS_CONTINUOUS (waivers on Thursdays and Sundays).
 * - settings.acquisitionSettings.isUsingAcquisitionBudget: FAAB (false in Parker's league; true in the public one, budget 200).
 * - status.isWaiverOrderEdited: false in both (never seen true).
 *
 * The rules, first that applies:
 * 1. A FAAB league (isUsingAcquisitionBudget): "faab": the budgets left decide (league.ts allocationOrder), and waiverRank
 *    breaks ties between equal budgets. In a league whose order resets weekly (waiverOrderReset true, as the public test
 *    league's does) that tiebreak is the weekly reset order once a game has been played, by rule 5's reading (waiverRank =
 *    the reset order, liveWaiverRank = ESPN's live rank, its notes and warnings worded for the tiebreak; Phase 4c review of
 *    track AD: budgets often tie early in the season, and a tie mustn't depend on the day of the import, the planner's
 *    answer 2; the budgets themselves are read as they stand, so the allocation still can: review of track EF, finding 5);
 *    before any game, and in a league that doesn't reset weekly or doesn't say, ESPN's live rank (as in Phase 4b). One
 *    without a numeric acquisitionBudget (never seen) stays "faab" (as a Sleeper FAAB league without its budget does), but
 *    with no budgets the engine hands free agents out by waiverRank, and the Import Report's row says the league's budget
 *    is missing.
 * 2. acquisitionType FREEAGENCY: ⚠️ read from its name as no waivers (first come, first served; no such league seen): no
 *    waiver order (waiverRank left out, so the engine hands free agents out by the biggest gain first), with a warning.
 * 3. waiverOrderReset false: rolling waivers (⚠️ the field's own name; no such league seen): "live", ESPN's live rank.
 * 4. waiverOrderReset missing: unknown, so ESPN's live rank ("live"), with a warning: it can change as claims go through.
 * 5. waiverOrderReset true:
 *    a. no game played yet (no team's record shows one): there are no standings to reset to, so ESPN's live rank ("live"),
 *       with a warning (ESPN_WAIVER_RESET_BEFORE_GAMES, which the Import Report's row reads): until the first games, that
 *       order can change as claims go through.
 *    b. otherwise "weeklyReset": waiverRank = the reset order, liveWaiverRank = ESPN's live rank (every team ESPN ranks, even
 *       where the two agree, as at the reset). Without divisions the reset order is numTeams + 1 − playoffSeed when the seeds
 *       are 1..n once each (✅ 20 of 20, above, for leagues seeded by points for; ⚠️ under another seeding rule ESPN's seeds
 *       follow that rule's tiebreaker, and whether its reset does too is unverified). With divisions (2+), where playoffSeed
 *       puts the division winners first, or seeds that aren't 1..n: ⚠️ the reverse of the overall standings, worst first by
 *       win %, then fewer points for, then the worse playoff seed, then team id (our reading; ESPN doesn't say what its reset
 *       does with divisions), with a note. ⚠️ status.isWaiverOrderEdited true (the commissioner edited the order; never seen
 *       true) keeps the reset order, with a warning (ESPN_WAIVER_ORDER_EDITED) that an edited order is in place until the
 *       reset: our reading is that the next weekly reset replaces a commissioner's edit (Phase 4c review of track AD; until
 *       then the flag sent the league to ESPN's live order, so if ESPN kept the flag set after one edit the order would have
 *       depended on the day of the import all season).
 * A live order is used only when ESPN ranks every team (as the engine reads ranks: league.ts allocationOrder); otherwise
 * waiverOrderUsed is left out with whatever ranks ESPN sent, as before.
 */
import type { ImportWarning, LeagueSettings } from "@/engine/model";

export type WaiverOrderUsed = NonNullable<LeagueSettings["waiverOrderUsed"]>;

/** ESPN's value for leagues without waivers (rule 2; ⚠️ read from its name). */
export const ESPN_NO_WAIVERS_TYPE = "FREEAGENCY";

/** Warning codes (src/lib/importReport.ts words the "Waiver order used" row by them). */
export const ESPN_WAIVER_CODES = {
  noWaivers: "ESPN_NO_WAIVERS",
  resetUnknown: "ESPN_WAIVER_RESET_UNKNOWN",
  edited: "ESPN_WAIVER_ORDER_EDITED",
  beforeGames: "ESPN_WAIVER_RESET_BEFORE_GAMES",
} as const;

/** teams[].waiverRank (or a playoff seed) when it is a whole number ≥ 1 (1 = first claim), else undefined. */
export function waiverRankOf(rank: number | null | undefined): number | undefined {
  return typeof rank === "number" && Number.isInteger(rank) && rank >= 1 ? rank : undefined;
}

/**
 * A FAAB league's remaining budget for a team: acquisitionSettings.acquisitionBudget − teams[].transactionCounter.
 * acquisitionBudgetSpent, when the league uses FAAB (`budget`: settings.faabBudget) and the spent amount is a number;
 * undefined otherwise, or when it would be below 0 (unreadable).
 */
export function faabRemainingOf(budget: number | undefined, spent: number | null | undefined): number | undefined {
  if (budget === undefined || typeof spent !== "number" || !Number.isFinite(spent)) return undefined;
  const left = budget - spent;
  return Number.isFinite(left) && left >= 0 ? left : undefined;
}

/** A team as the waiver order reads it: ESPN's two ranks as sent, and the normalized record (Team.record, pointsFor). */
export interface EspnWaiverTeam {
  id: string;
  /** teams[].waiverRank as ESPN sends it. */
  waiverRank?: number | null;
  /** teams[].playoffSeed as ESPN sends it. */
  playoffSeed?: number | null;
  record: { w: number; l: number; t: number };
  pointsFor: number;
}

/** What the waiver order reads from the league's settings and status. */
export interface EspnWaiverSettings {
  /** The league uses FAAB (settings.acquisitionSettings.isUsingAcquisitionBudget), whether or not it reports a budget. */
  faab: boolean;
  /** settings.acquisitionSettings.acquisitionType. */
  acquisitionType?: string | null;
  /** settings.acquisitionSettings.waiverOrderReset. */
  waiverOrderReset?: boolean | null;
  /** status.isWaiverOrderEdited. */
  orderEdited?: boolean | null;
  /** The league has 2+ divisions (settings.divisions). */
  divisions: boolean;
}

export interface EspnWaiverOrder {
  /** LeagueSettings.waiverOrderUsed; undefined when no order is used (rule 2) or ESPN doesn't rank every team. */
  used?: WaiverOrderUsed;
  /** Team id → Team.waiverRank and Team.liveWaiverRank, each when known. */
  ranks: Map<string, { waiverRank?: number; liveWaiverRank?: number }>;
  /** Import Report notes (our readings). */
  notes: string[];
  warnings: ImportWarning[];
}

/** Whether any game has been played: a team's record shows one (wins, losses, ties or points for). */
export function anyGamePlayed(teams: ReadonlyArray<Pick<EspnWaiverTeam, "record" | "pointsFor">>): boolean {
  return teams.some((t) => t.record.w + t.record.l + t.record.t > 0 || t.pointsFor > 0);
}

const winPct = (r: EspnWaiverTeam["record"]): number => {
  const games = r.w + r.l + r.t;
  return games ? (r.w + 0.5 * r.t) / games : 0;
};

/** Team ids compare as numbers (ESPN's ids), then as text. */
const byId = (a: string, b: string): number => Number(a) - Number(b) || a.localeCompare(b);

/**
 * The weekly reset order (rule 5c): team id → rank, 1 = first claim. `fromSeeds` says whether it is ESPN's own
 * numTeams + 1 − playoffSeed (✅) or our reverse of the overall standings (⚠️).
 */
export function resetOrder(teams: readonly EspnWaiverTeam[], divisions: boolean): { ranks: Map<string, number>; fromSeeds: boolean } {
  const n = teams.length;
  const seeds = teams.map((t) => waiverRankOf(t.playoffSeed));
  const permutation = seeds.every((s) => s !== undefined && s <= n) && new Set(seeds).size === n;
  if (!divisions && permutation) return { ranks: new Map(teams.map((t, i) => [t.id, n + 1 - (seeds[i] as number)])), fromSeeds: true };
  // Worst first: lower win %, fewer points for, the worse (higher) seed, then team id. Never the live rank, which changes as
  // claims go through (the order mustn't depend on the day of the import).
  const seedOf = (t: EspnWaiverTeam) => waiverRankOf(t.playoffSeed) ?? 0;
  const worstFirst = [...teams].sort((a, b) => winPct(a.record) - winPct(b.record) || a.pointsFor - b.pointsFor || seedOf(b) - seedOf(a) || byId(a.id, b.id));
  return { ranks: new Map(worstFirst.map((t, i) => [t.id, i + 1])), fromSeeds: false };
}

/** ESPN's live ranks, when it ranks every team (else the ones it sent, and no order is "used"). */
function liveOrder(teams: readonly EspnWaiverTeam[]): { ranks: EspnWaiverOrder["ranks"]; complete: boolean } {
  const ranks: EspnWaiverOrder["ranks"] = new Map();
  let complete = teams.length > 0;
  for (const t of teams) {
    const r = waiverRankOf(t.waiverRank);
    if (r === undefined) complete = false;
    ranks.set(t.id, r !== undefined ? { waiverRank: r } : {});
  }
  return { ranks, complete };
}

/**
 * A league whose order resets weekly (rule 5, and rule 1's tiebreak in a FAAB league, `faab`): the reset order's ranks, with
 * ESPN's live rank kept as liveWaiverRank, once a game has been played (rule 5b, warned when the commissioner has edited the
 * order); else null, ESPN's live order standing (rule 5a, warned when ESPN ranks every team). Its notes and warnings go
 * into `notes` and `warnings`, worded for a waiver order or for a tiebreak between equal FAAB budgets.
 */
function weeklyReset(teams: readonly EspnWaiverTeam[], s: EspnWaiverSettings, live: { complete: boolean }, notes: string[], warnings: ImportWarning[], faab: boolean): EspnWaiverOrder["ranks"] | null {
  // What the order decides: who claims a free agent first, or (FAAB) who wins a tie between equal budgets. In a FAAB league
  // the budgets themselves are read as they stand on the day of the import, so only a tie can be made independent of it
  // (review of track EF, finding 5).
  const decides = faab ? "ties between equal FAAB budgets go by" : "free agents are handed out in";
  const dayBound = faab ? "a tie between equal budgets" : "the pickups";
  // 5a. No standings to reset to yet.
  if (!anyGamePlayed(teams)) {
    if (live.complete)
      warnings.push({
        code: ESPN_WAIVER_CODES.beforeGames,
        message: `No games have been played yet, so there are no standings for this league's weekly waiver reset (reverse standings): ${decides} ESPN's waiver order as it stands today. That order can change as claims go through, so until the first games are played ${dayBound} may depend on the day you import.`,
        platformPath: "teams[].record.overall",
      });
    return null;
  }

  // 5b. The weekly reset order.
  const reset = resetOrder(teams, s.divisions);
  const ranks: EspnWaiverOrder["ranks"] = new Map();
  let differs = false;
  for (const t of teams) {
    const waiverRank = reset.ranks.get(t.id) as number;
    const liveWaiverRank = waiverRankOf(t.waiverRank);
    if (liveWaiverRank !== undefined && liveWaiverRank !== waiverRank) differs = true;
    ranks.set(t.id, { waiverRank, ...(liveWaiverRank !== undefined ? { liveWaiverRank } : {}) });
  }
  // ⚠️ A commissioner's edit lasts until the next weekly reset (our reading): the reset order stands, warned.
  if (s.orderEdited === true)
    warnings.push({
      code: ESPN_WAIVER_CODES.edited,
      message: `ESPN says the commissioner has edited this league's waiver order. The next weekly reset replaces an edited order (our reading), so ${decides} the weekly reset order (reverse standings); until that reset, ESPN's own order may differ.`,
      platformPath: "status.isWaiverOrderEdited",
    });
  const how = reset.fromSeeds
    ? ""
    : s.divisions
      ? " With divisions, ESPN's playoff seeds put the division winners first, so the reset order is read as the reverse of the overall standings: worst win percentage first, then fewer points for (our reading)."
      : " ESPN's playoff seeds don't cover every team, so the reset order is read from the standings: worst win percentage first, then fewer points for (our reading).";
  if (differs || how)
    notes.push(
      faab
        ? `Waiver order: ESPN resets this league's waiver order every week to reverse standings, and it breaks ties between equal FAAB bids. Ties between equal budgets go by the reset order, so a tie doesn't depend on the day you import${differs ? "; ESPN's order right now is different" : ""}.${how}`
        : `Waiver order: ESPN resets this league's waiver order every week to reverse standings, and a team whose claim goes through moves to the back until the next reset. Free agents are handed out in the reset order, so the pickups don't depend on the day you import${differs ? "; ESPN's order right now is different" : ""}.${how}`,
    );
  return ranks;
}

/** The league's waiver order (the file header's rules). */
export function espnWaiverOrder(teams: readonly EspnWaiverTeam[], s: EspnWaiverSettings): EspnWaiverOrder {
  const notes: string[] = [];
  const warnings: ImportWarning[] = [];
  const live = liveOrder(teams);
  const asLive = (): EspnWaiverOrder => ({ ...(live.complete ? { used: "live" as const } : {}), ranks: live.ranks, notes, warnings });

  // 1. FAAB: the budgets decide; the waiver order breaks ties between equal budgets: the weekly reset order where the
  //    league resets weekly (rule 5's reading), else ESPN's live rank.
  if (s.faab) {
    const reset = s.waiverOrderReset === true ? weeklyReset(teams, s, live, notes, warnings, true) : null;
    return { used: "faab", ranks: reset ?? live.ranks, notes, warnings };
  }

  // 2. No waivers at all (⚠️ read from the type's name).
  if (s.acquisitionType === ESPN_NO_WAIVERS_TYPE) {
    warnings.push({
      code: ESPN_WAIVER_CODES.noWaivers,
      message: `ESPN lists this league's player acquisitions as ${ESPN_NO_WAIVERS_TYPE}, read as no waivers: free agents are first come, first served (our reading of the name). So no waiver order is used: the team that gains the most from a pickup gets him first.`,
      platformPath: "settings.acquisitionSettings.acquisitionType",
    });
    return { ranks: new Map(teams.map((t) => [t.id, {}])), notes, warnings };
  }

  // 3. Rolling waivers.
  if (s.waiverOrderReset === false) return asLive();

  // 4. Not reported.
  if (s.waiverOrderReset !== true) {
    if (live.complete)
      warnings.push({
        code: ESPN_WAIVER_CODES.resetUnknown,
        message: "ESPN didn't say whether this league's waiver order resets each week, so free agents are handed out in ESPN's waiver order as it stands today. That order can change as claims go through, so the pickups may depend on the day you import.",
        platformPath: "settings.acquisitionSettings.waiverOrderReset",
      });
    return asLive();
  }

  // 5. The weekly reset order once a game has been played (a commissioner's edit warned), else the live order.
  const reset = weeklyReset(teams, s, live, notes, warnings, false);
  return reset ? { used: "weeklyReset", ranks: reset, notes, warnings } : asLive();
}
