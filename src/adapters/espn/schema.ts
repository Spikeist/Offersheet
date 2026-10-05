/**
 * zod shapes for the ESPN responses the adapter reads (CLAUDE.md §3: validate at the adapter
 * boundary). Ported from the Phase 0 probe (scripts/lib/espn/schema.ts, verified live 2026-09-29)
 * and trimmed to the fields normalize.ts uses. z.object strips unknown fields; optional fields are
 * nullish because ESPN sends null for some of them. A missing required field becomes a
 * LeagueImportError("BAD_RESPONSE") that names its JSON path.
 *
 * The browser builds these too (track BF: it reads public leagues itself), so zod's eval-compiled parsers are turned off
 * there first (src/lib/zodJitless.ts: it must be this module's first import).
 */
import "@/lib/zodJitless";
import { z } from "zod";
import { LeagueImportError } from "@/adapters/types";

const numRecord = z.record(z.string(), z.number());

export const StatEntrySchema = z.object({
  seasonId: z.number(),
  scoringPeriodId: z.number(),
  /** 0 = actual, 1 = projected. */
  statSourceId: z.number(),
  /** 0 = season, 1 = one scoring period, 2 = undocumented (unused). */
  statSplitTypeId: z.number(),
  stats: numRecord.nullish(),
  /** Points under THIS league's scoring. */
  appliedTotal: z.number().nullish(),
});
export type EspnStatEntry = z.infer<typeof StatEntrySchema>;

export const PlayerSchema = z.object({
  id: z.number(),
  fullName: z.string(),
  defaultPositionId: z.number(),
  eligibleSlots: z.array(z.number()),
  proTeamId: z.number(),
  injuryStatus: z.string().nullish(),
  stats: z.array(StatEntrySchema).nullish(),
});
export type EspnPlayer = z.infer<typeof PlayerSchema>;

export const RosterEntrySchema = z.object({
  playerId: z.number(),
  lineupSlotId: z.number(),
  /**
   * How the team got him: DRAFT, ADD or TRADE (both test leagues, mRoster). With acquisitionDate
   * (epoch ms; every player of one trade carries the same instant: Parker's league 2026-10-01, the
   * public test league), the trade refill rebuilds other teams' trades that ESPN lists without players.
   */
  acquisitionType: z.string().nullish(),
  acquisitionDate: z.number().nullish(),
  playerPoolEntry: z.object({ id: z.number(), player: PlayerSchema }),
});

const RecordLineSchema = z.object({ wins: z.number(), losses: z.number(), ties: z.number(), pointsFor: z.number(), pointsAgainst: z.number() });

export const TeamSchema = z.object({
  id: z.number(),
  name: z.string().nullish(),
  location: z.string().nullish(),
  nickname: z.string().nullish(),
  abbrev: z.string().nullish(),
  /** SWIDs: secrets (CLAUDE.md §0.5). fetch.ts turns them into one-way pseudonyms before anything is parsed or cached. */
  owners: z.array(z.string()).nullish(),
  primaryOwner: z.string().nullish(),
  divisionId: z.number().nullish(),
  record: z.object({ overall: RecordLineSchema }).nullish(),
  roster: z.object({ entries: z.array(RosterEntrySchema) }).nullish(),
  /**
   * The team's place in the waiver order as it stands, 1 = first claim (mTeam; Phase 4b). Both test leagues: a 1..10
   * permutation, at the weekly reset (waiverOrderReset; Sep 30, before that week's first waiver run) 11 − playoffSeed for
   * all 10 teams of each: the 0-3 team ranks 1. Mid-week it isn't reverse standings: in Parker's league
   * (WAIVERS_TRADITIONAL) a team whose claim goes through moves to the back until the next reset (./waivers.ts).
   */
  waiverRank: z.number().nullish(),
  /**
   * The team's playoff seed if the season ended today, 1 = best (mTeam; Phase 4c): ESPN's standings with the league's own
   * tiebreaker (Parker's league on Sep 30: win %, then points for, its TOTAL_POINTS_SCORED rule), the division winners
   * first in a league with divisions. A 1..10 permutation in both test leagues; the weekly reset waiver order is
   * numTeams + 1 − playoffSeed (./waivers.ts: ✅ in both, which seed by points for; ⚠️ under another seeding rule).
   */
  playoffSeed: z.number().nullish(),
  /**
   * ESPN's own season counters (mTeam). `trades` counts accepted trades, including one still in review (Parker's fixture).
   * `acquisitionBudgetSpent`: the FAAB the team has spent (the public test league, budget 200: 0–33 a team; 0 in Parker's,
   * which doesn't use FAAB).
   */
  transactionCounter: z.object({ trades: z.number().nullish(), acquisitions: z.number().nullish(), drops: z.number().nullish(), acquisitionBudgetSpent: z.number().nullish() }).nullish(),
});
export type EspnTeam = z.infer<typeof TeamSchema>;

export const MemberSchema = z.object({
  /** The member's SWID: a secret. */
  id: z.string(),
  displayName: z.string().nullish(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
});

const ScheduleSideSchema = z.object({
  teamId: z.number(),
  /** The side's score over the whole matchup period (all its NFL weeks), under this league's scoring; live while it's played. */
  totalPoints: z.number().nullish(),
});

export const MatchupSchema = z.object({
  matchupPeriodId: z.number(),
  home: ScheduleSideSchema.nullish(),
  away: ScheduleSideSchema.nullish(),
  /**
   * HOME / AWAY / TIE once ESPN has decided the matchup, UNDECIDED before (Parker's league on
   * 2026-09-29: periods 1–3 decided, 4–14 UNDECIDED). The four values are ESPN's own list
   * (settings.typeNames.winnerTypes of GET /seasons/{season}?view=proTeamSchedules_wl). A string, not
   * an enum: a value ESPN adds later mustn't fail the whole import (normalize.ts warns instead).
   */
  winner: z.string().nullish(),
  /** Absent before the playoffs (Phase 0); WINNERS_BRACKET / consolation ladders once seeded. */
  playoffTierType: z.string().nullish(),
});
export type EspnMatchup = z.infer<typeof MatchupSchema>;

export const ScoringItemSchema = z.object({
  statId: z.number(),
  points: z.number(),
  /** defaultPositionId → points that REPLACE `points` for that position (Phase 0 K.overrideKeys). */
  pointsOverrides: numRecord.nullish(),
  isReverseItem: z.boolean().nullish(),
});

export const SettingsSchema = z.object({
  name: z.string().nullish(),
  size: z.number(),
  isPublic: z.boolean().nullish(),
  scoringSettings: z.object({
    scoringItems: z.array(ScoringItemSchema),
    scoringType: z.string().nullish(),
    scoringEnhancementType: z.string().nullish(),
    /** Points added to the home team's score (regular season / playoffs); 0 in both test leagues. */
    homeTeamBonus: z.number().nullish(),
    playoffHomeTeamBonus: z.number().nullish(),
  }),
  rosterSettings: z.object({
    lineupSlotCounts: numRecord,
    positionLimits: numRecord.nullish(),
    isBenchUnlimited: z.boolean().nullish(),
  }),
  scheduleSettings: z.object({
    matchupPeriodCount: z.number(),
    matchupPeriods: z.record(z.string(), z.array(z.number())),
    playoffTeamCount: z.number(),
    /** NFL weeks per playoff round; matchupPeriods is authoritative, this is only cross-checked. */
    playoffMatchupPeriodLength: z.number().nullish(),
    /** Per-round lengths when variablePlayoffMatchupPeriodLength (key meaning unverified: {} in both test leagues). */
    playoffMatchupPeriodLengthByRound: z.record(z.string(), z.number()).nullish(),
    variablePlayoffMatchupPeriodLength: z.boolean().nullish(),
    playoffReseed: z.boolean().nullish(),
    /**
     * The seeding tiebreaker after win percentage. ESPN's own list of values (settings.typeNames.
     * recordSeedingRuleTypes of GET /seasons/{season}?view=proTeamSchedules_wl): UNKNOWN, H2H_RECORD,
     * TOTAL_POINTS_SCORED, INTRA_DIVISION_RECORD, TOTAL_POINTS_AGAINST, RAW_STAT. UNKNOWN is a
     * placeholder (no rule reported; normalize.ts reads it like a missing value). Both test leagues
     * use TOTAL_POINTS_SCORED.
     */
    playoffSeedingRule: z.string().nullish(),
    divisions: z.array(z.object({ id: z.number(), size: z.number().nullish() })).nullish(),
  }),
  tradeSettings: z.object({
    /** Epoch ms. */
    deadlineDate: z.number().nullish(),
    vetoVotesRequired: z.number().nullish(),
    revisionHours: z.number().nullish(),
  }),
  /** keeperCountFuture: read as next season's keeper count (inferred from its name; no ESPN keeper league was probed). */
  draftSettings: z.object({ keeperCount: z.number().nullish(), keeperCountFuture: z.number().nullish() }).nullish(),
  acquisitionSettings: z
    .object({
      isUsingAcquisitionBudget: z.boolean().nullish(),
      acquisitionBudget: z.number().nullish(),
      /**
       * FREEAGENCY / WAIVERS_TRADITIONAL / WAIVERS_CONTINUOUS: ESPN's own list (settings.typeNames.acquisitionTypes of GET
       * /seasons/{season}?view=proTeamSchedules_wl). WAIVERS_TRADITIONAL in Parker's league, WAIVERS_CONTINUOUS in the public
       * test league. A string, not an enum: a value ESPN adds later mustn't fail the import (./waivers.ts reads it).
       */
      acquisitionType: z.string().nullish(),
      /** The waiver order resets every week to reverse standings (true in both test leagues; ./waivers.ts, Phase 4c). */
      waiverOrderReset: z.boolean().nullish(),
    })
    .nullish(),
});

export const StatusSchema = z.object({
  currentMatchupPeriod: z.number(),
  /** The current NFL week (scoring period). */
  latestScoringPeriod: z.number(),
  firstScoringPeriod: z.number().nullish(),
  finalScoringPeriod: z.number().nullish(),
  isActive: z.boolean().nullish(),
  /** When the league was activated for this season (epoch ms; both test leagues): anything acquired before it is from an earlier season. */
  activatedDate: z.number().nullish(),
  /** ⚠️ Read as "the commissioner has edited the waiver order" from its name (false in both test leagues; ./waivers.ts, Phase 4c). */
  isWaiverOrderEdited: z.boolean().nullish(),
});

/** view=mSettings&view=mTeam&view=mRoster&view=mMatchup&view=mStatus */
export const LeagueSchema = z.object({
  id: z.number(),
  seasonId: z.number(),
  settings: SettingsSchema,
  status: StatusSchema,
  teams: z.array(TeamSchema),
  members: z.array(MemberSchema).nullish(),
  schedule: z.array(MatchupSchema).nullish(),
});
export type EspnLeague = z.infer<typeof LeagueSchema>;

export const TransactionItemSchema = z.object({
  playerId: z.number(),
  /** ADD / DROP / LINEUP / TRADE; null on some TRADE_DECLINE rows. */
  type: z.string().nullish(),
  fromTeamId: z.number().nullish(),
  toTeamId: z.number().nullish(),
  /**
   * The lineup slot he left / went to (−1 = none: free agency). Items carry no position (926 of 926
   * items in Parker's league, 2026-10-01), so a single-position slot (K, D/ST, QB …) is the last hint of
   * a move's position when the player is on no roster and in no free-agent list.
   */
  fromLineupSlotId: z.number().nullish(),
  toLineupSlotId: z.number().nullish(),
});
export type EspnTransactionItem = z.infer<typeof TransactionItemSchema>;

export const TransactionSchema = z.object({
  id: z.string(),
  type: z.string(),
  /** EXECUTED / PENDING / CANCELED / FAILED_*; ABSENT on a TRADE_ACCEPT row while the trade is in its review period (seen live 2026-09-29). */
  status: z.string().nullish(),
  /** The row this one answers (a TRADE_ACCEPT / TRADE_UPHOLD → its proposal); bare GUIDs, not SWIDs. */
  relatedTransactionId: z.string().nullish(),
  scoringPeriodId: z.number(),
  teamId: z.number(),
  proposedDate: z.number().nullish(),
  processDate: z.number().nullish(),
  items: z.array(TransactionItemSchema).nullish(),
  teamActions: z.record(z.string(), z.string()).nullish(),
});
export type EspnTransaction = z.infer<typeof TransactionSchema>;

/** view=mTransactions2&scoringPeriodId=N; rows are validated one by one (TransactionSchema) so one odd row can't hide a week. */
export const TransactionsResponseSchema = z.object({ transactions: z.array(z.unknown()).nullish() });

export const PoolPlayerSchema = z.object({
  id: z.number(),
  onTeamId: z.number().nullish(),
  status: z.string().nullish(),
  player: PlayerSchema,
});
export type EspnPoolPlayer = z.infer<typeof PoolPlayerSchema>;

/** view=kona_player_info (free agents, player pool) and view=kona_playercard; rows are validated one by one. */
export const PlayerListResponseSchema = z.object({ players: z.array(z.unknown()) });

/**
 * One row of view=kona_playercard, trimmed to what normalize.ts reads: the expected return of an
 * injured player (Phase 0 E.injuryReturn: [year, month (1-based), day] on 22/22 injured rostered
 * players; the league view never carries it).
 */
export const PlayerCardSchema = z.object({
  id: z.number(),
  player: z.object({
    id: z.number(),
    injuryStatus: z.string().nullish(),
    injuryDetails: z.object({ expectedReturnDate: z.array(z.number()).nullish(), outForSeason: z.boolean().nullish() }).nullish(),
  }),
});
export type EspnPlayerCard = z.infer<typeof PlayerCardSchema>;

export const ProGameSchema = z.object({ date: z.number(), homeProTeamId: z.number(), awayProTeamId: z.number() });
export type EspnProGame = z.infer<typeof ProGameSchema>;

/** GET /seasons/{season}?view=proTeamSchedules_wl */
export const ProTeamSchedulesSchema = z.object({
  settings: z.object({
    proTeams: z.array(
      z.object({
        id: z.number(),
        abbrev: z.string().nullish(),
        byeWeek: z.number().nullish(),
        proGamesByScoringPeriod: z.record(z.string(), z.array(ProGameSchema)).nullish(),
      }),
    ),
  }),
});
export type EspnProTeam = z.infer<typeof ProTeamSchedulesSchema>["settings"]["proTeams"][number];

/** "teams[3].roster.entries[0].playerPoolEntry.player.fullName" */
export function formatZodPath(path: ReadonlyArray<PropertyKey>): string {
  return (
    path
      .map((k) => (typeof k === "number" ? `[${k}]` : `.${String(k)}`))
      .join("")
      .replace(/^\./, "") || "(root)"
  );
}

/** Validate an ESPN response; a mismatch throws BAD_RESPONSE naming the first failing JSON path. */
export function parseEspn<S extends z.ZodType>(schema: S, json: unknown, what: string): z.infer<S> {
  const r = schema.safeParse(json);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const where = issue ? formatZodPath(issue.path) : "(root)";
  throw new LeagueImportError("BAD_RESPONSE", `ESPN sent ${what} in a shape we don't recognize (at ${where}${issue ? `: ${issue.message}` : ""}). ESPN's API is unofficial and may have changed.`, { platform: "espn", path: where });
}
