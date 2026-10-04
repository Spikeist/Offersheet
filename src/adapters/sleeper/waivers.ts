/**
 * Sleeper's waiver order → Team.waiverRank and Team.liveWaiverRank, and LeagueSettings.waiverOrderUsed (CLAUDE.md §2.3, §7
 * "one free agent, one team"; Phase 4c, planner reply to Checkpoint 4b, answer 2: "use the weekly reset order when the
 * league resets weekly; use the live order for rolling waivers. The baseline must not depend on which day someone
 * imports."). PURE and browser-safe, like the normalizer that calls it.
 *
 * What Sleeper reports: settings.waiver_type, and rosters[].settings.waiver_position, the order as it stands (1 = first
 * claim; a 1..n permutation in all 18 leagues below and in the public test league). Evidence: the Phase 0 crawl's 18 public
 * 2026 leagues read on Tuesday Sep 29 (NFL week 4; reports/probe-output/sleeper-codes.md; their rosters, cached in the
 * git-ignored data-local/sleeper-codes, re-read for Phase 4c without new requests):
 * - waiver_type 2 = FAAB (✅ Phase 0: bids on 1,099 of 1,099 waiver claims in 26 leagues).
 * - waiver_type 1 = reverse standings, reset each week (✅ 3 of 3 type-1 leagues, none against; the evidence rule of
 *   sleeper-codes.md: 3 independent leagues): in the 2 read before their weekly waiver run (leg = last_scored_leg = 3),
 *   waiver_position was exactly the reverse standings of the records after week 3 for 10 of 10 teams of each, worst win
 *   percentage first and ties by fewer points for (9 of the 10 teams shared a win percentage with another; points for
 *   broke every tie). In the one read after its run (leg 4), only 2 of 12 were in their reverse-standings place, but the
 *   first 8 were the reverse standings in order with 4 teams taken out, and those 4 trailed them: the week's claimants moved
 *   to the back (⚠️ read so, as in ESPN: that league's transactions weren't captured), so between resets waiver_position is
 *   a live order. None of the 15 type-0 or type-2 leagues matched the reverse standings exactly (Spearman ρ with them −0.40
 *   … 0.73 in the 8 type-0 leagues, −0.39 … 0.32 in the 7 type-2 ones; Phase 0 couldn't tell types 0 and 1 apart from the
 *   final orders of finished seasons).
 * - waiver_type 0 = rolling waivers (⚠️ by elimination: Sleeper's other two types are 1 and 2, and type-0 positions don't
 *   follow the standings).
 *
 * The rules:
 * 1. waiver_type 2: "faab"; waiverRank = waiver_position, the tiebreak between equal budgets (unchanged from Phase 4b). A
 *    type-2 league without a waiver_budget (never seen: all 122 FAAB leagues of the Phase 0 sample had one) stays "faab" (as
 *    an ESPN FAAB league without its budget does), but with no budgets the engine hands free agents out by waiver_position,
 *    and the Import Report's row says the league's budget is missing.
 * 2. waiver_type 1: "weeklyReset": waiverRank = the reverse standings: worst win % first, then fewer points for, then fewer
 *    points against (Sleeper's documented standings tiebreakers, more points for and then more points against rank higher,
 *    read backwards: ⚠️ points against never decided a place in the 3 leagues), then roster id; liveWaiverRank =
 *    waiver_position (every roster Sleeper ranks, even where the two agree, as at the reset). ⚠️ With divisions, the overall
 *    standings (no league with divisions was checked), with a warning. Before any game (no record shows one) there are no
 *    standings: waiver_position ("live"), with a warning (WAIVER_RESET_BEFORE_GAMES, which the Import Report's row reads):
 *    until the first games, that order can change as claims go through.
 * 3. waiver_type 0: "live", waiver_position.
 * 4. Missing, or a code we don't know: "live", waiver_position, with a warning (it can change as claims go through).
 * A live order is used only when Sleeper ranks every roster (as the engine reads ranks: league.ts allocationOrder);
 * otherwise waiverOrderUsed is left out with whatever positions Sleeper sent, as before.
 */
import type { ImportWarning, LeagueSettings } from "@/engine/model";

export type WaiverOrderUsed = NonNullable<LeagueSettings["waiverOrderUsed"]>;

/** Sleeper's waiver_type codes (the file header). */
export const WAIVER_TYPE = { rolling: 0, reverseStandings: 1, faab: 2 } as const;

/** Warning code for a waiver_type we can't read (src/lib/importReport.ts words the "Waiver order used" row by it). */
export const WAIVER_TYPE_UNKNOWN = "WAIVER_TYPE_UNKNOWN";

/** Warning code for a reverse-standings league before any game (rule 2; the Import Report's row reads it too). */
export const WAIVER_RESET_BEFORE_GAMES = "WAIVER_RESET_BEFORE_GAMES";

/** rosters[].settings.waiver_position when it is a whole number ≥ 1 (1 = first claim), else undefined. */
export function waiverRankOf(position: number | null | undefined): number | undefined {
  return typeof position === "number" && Number.isInteger(position) && position >= 1 ? position : undefined;
}

/**
 * A FAAB league's remaining budget for a roster: settings.waiver_budget − rosters[].settings.waiver_budget_used, when the
 * league uses FAAB (`budget`: LeagueSettings.faabBudget, set for waiver_type 2) and the amount used is a number (negative
 * after receiving FAAB in a trade, so more than the budget can be left); undefined otherwise, or below 0.
 */
export function faabRemainingOf(budget: number | undefined, used: number | null | undefined): number | undefined {
  if (budget === undefined || typeof used !== "number" || !Number.isFinite(used)) return undefined;
  const left = budget - used;
  return Number.isFinite(left) && left >= 0 ? left : undefined;
}

/** A roster as the waiver order reads it: Sleeper's position as sent, and the normalized record (Team.record, points). */
export interface SleeperWaiverTeam {
  id: string;
  /** rosters[].settings.waiver_position as Sleeper sends it. */
  waiverPosition?: number | null;
  record: { w: number; l: number; t: number };
  pointsFor: number;
  pointsAgainst: number;
}

export interface SleeperWaiverSettings {
  /** settings.waiver_type. */
  waiverType?: number;
  /** The league has 2+ divisions (settings.divisions). */
  divisions: boolean;
}

export interface SleeperWaiverOrder {
  /** LeagueSettings.waiverOrderUsed; undefined when Sleeper doesn't rank every roster. */
  used?: WaiverOrderUsed;
  /** Team id → Team.waiverRank and Team.liveWaiverRank, each when known. */
  ranks: Map<string, { waiverRank?: number; liveWaiverRank?: number }>;
  notes: string[];
  warnings: ImportWarning[];
}

/** Whether any game has been played: a roster's record shows one (wins, losses, ties or points for). */
export function anyGamePlayed(teams: ReadonlyArray<Pick<SleeperWaiverTeam, "record" | "pointsFor">>): boolean {
  return teams.some((t) => t.record.w + t.record.l + t.record.t > 0 || t.pointsFor > 0);
}

const winPct = (r: SleeperWaiverTeam["record"]): number => {
  const games = r.w + r.l + r.t;
  return games ? (r.w + 0.5 * r.t) / games : 0;
};

/** The reverse standings (rule 2): team id → rank, 1 = first claim (the worst team). Never the live position. */
export function reverseStandings(teams: readonly SleeperWaiverTeam[]): Map<string, number> {
  const worstFirst = [...teams].sort((a, b) => winPct(a.record) - winPct(b.record) || a.pointsFor - b.pointsFor || a.pointsAgainst - b.pointsAgainst || Number(a.id) - Number(b.id) || a.id.localeCompare(b.id));
  return new Map(worstFirst.map((t, i) => [t.id, i + 1]));
}

/** The league's waiver order (the file header's rules). */
export function sleeperWaiverOrder(teams: readonly SleeperWaiverTeam[], s: SleeperWaiverSettings): SleeperWaiverOrder {
  const notes: string[] = [];
  const warnings: ImportWarning[] = [];
  const live: SleeperWaiverOrder["ranks"] = new Map();
  let complete = teams.length > 0;
  for (const t of teams) {
    const r = waiverRankOf(t.waiverPosition);
    if (r === undefined) complete = false;
    live.set(t.id, r !== undefined ? { waiverRank: r } : {});
  }
  const asLive = (): SleeperWaiverOrder => ({ ...(complete ? { used: "live" as const } : {}), ranks: live, notes, warnings });

  // 1. FAAB: the position is the tiebreak between equal budgets.
  if (s.waiverType === WAIVER_TYPE.faab) return { used: "faab", ranks: live, notes, warnings };

  // 3. Rolling waivers (⚠️ by elimination).
  if (s.waiverType === WAIVER_TYPE.rolling) return asLive();

  // 4. A code we can't read.
  if (s.waiverType !== WAIVER_TYPE.reverseStandings) {
    if (complete)
      warnings.push({
        code: WAIVER_TYPE_UNKNOWN,
        message: `${s.waiverType === undefined ? "The league doesn't say which waiver type it uses" : `Waiver type code ${s.waiverType} isn't one we know`}, so free agents are handed out in Sleeper's waiver order as it stands today. That order can change as claims go through, so the pickups may depend on the day you import.`,
        platformPath: "settings.waiver_type",
      });
    return asLive();
  }

  // 2. Reverse standings, reset each week; before any game there are no standings to reset to.
  if (!anyGamePlayed(teams)) {
    if (complete)
      warnings.push({
        code: WAIVER_RESET_BEFORE_GAMES,
        message:
          "No games have been played yet, so there are no standings for this league's weekly waiver reset (reverse standings): free agents are handed out in Sleeper's waiver order as it stands today. That order can change as claims go through, so until the first games are played the pickups may depend on the day you import.",
        platformPath: "rosters[].settings",
      });
    return asLive();
  }
  const reset = reverseStandings(teams);
  const ranks: SleeperWaiverOrder["ranks"] = new Map();
  let differs = false;
  for (const t of teams) {
    const waiverRank = reset.get(t.id) as number;
    const liveWaiverRank = waiverRankOf(t.waiverPosition);
    if (liveWaiverRank !== undefined && liveWaiverRank !== waiverRank) differs = true;
    ranks.set(t.id, { waiverRank, ...(liveWaiverRank !== undefined ? { liveWaiverRank } : {}) });
  }
  if (differs)
    notes.push(
      "Waiver order: this league's reverse-standings waivers reset every week to the reverse standings (worst record first, ties to the team with fewer points for), and the order changes as claims go through until the next reset. Free agents are handed out in the reset order, so the pickups don't depend on the day you import; Sleeper's order right now is different.",
    );
  if (s.divisions)
    warnings.push({
      code: "SETTING_INFERRED",
      message: "The weekly waiver reset is read as the reverse of the overall standings, ignoring divisions. We couldn't check a reverse-standings league with divisions, so check your league's waiver order.",
      platformPath: "settings.waiver_type",
    });
  return { used: "weeklyReset", ranks, notes, warnings };
}
