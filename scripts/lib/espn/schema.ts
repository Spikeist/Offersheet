/**
 * FROZEN PHASE 0 EVIDENCE: the probes still use this copy; the app uses src/adapters/espn/schema.ts. A fix here doesn't
 * reach the app (and the reverse); `npm run import:report` is the live check of the shipped adapters.
 *
 * zod shapes for the parts of ESPN's league API the probe reads (verified live 2026-09-29).
 * Fields we don't read are ignored (z.object strips them). The probe validates with safeParse and
 * reports failing JSON paths as ❌/⚠️ instead of crashing; Phase 1 can reuse these at the adapter
 * boundary.
 */
import { z } from "zod";

const numRecord = z.record(z.string(), z.number());

export const StatEntrySchema = z.object({
  /**
   * statSourceId + statSplitTypeId + season/period or game: "002026" season actual, "102026" season
   * projection, "1120264" week-4 projection, "01<gameId>" one game's actuals (externalId = gameId).
   */
  id: z.string().optional(),
  seasonId: z.number(),
  scoringPeriodId: z.number(),
  /** 0 = actual, 1 = projected. */
  statSourceId: z.number(),
  /** 0 = season, 1 = single scoring period, 2 = seen on projections only (not in CLAUDE.md; meaning unknown, unused). */
  statSplitTypeId: z.number(),
  stats: numRecord.optional(),
  appliedStats: numRecord.optional(),
  appliedTotal: z.number().optional(),
  appliedAverage: z.number().optional(),
  proTeamId: z.number().optional(),
  externalId: z.string().optional(),
});
export type StatEntry = z.infer<typeof StatEntrySchema>;

export const PlayerSchema = z.object({
  id: z.number(),
  fullName: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  defaultPositionId: z.number(),
  eligibleSlots: z.array(z.number()),
  proTeamId: z.number(),
  injuryStatus: z.string().optional(),
  injured: z.boolean().optional(),
  active: z.boolean().optional(),
  stats: z.array(StatEntrySchema).optional(),
  ownership: z.object({ percentOwned: z.number().optional(), percentStarted: z.number().optional() }).optional(),
  /** Only on kona_playercard: [year, month, day] expected return, plus outForSeason. */
  injuryDetails: z
    .object({
      expectedReturnDate: z.array(z.number()).optional(),
      outForSeason: z.boolean().optional(),
      type: z.unknown().optional(),
    })
    .optional(),
});
export type Player = z.infer<typeof PlayerSchema>;

export const PlayerPoolEntrySchema = z.object({
  id: z.number(),
  onTeamId: z.number().optional(),
  status: z.string().optional(),
  appliedStatTotal: z.number().optional(),
  player: PlayerSchema,
});

export const RosterEntrySchema = z.object({
  playerId: z.number(),
  lineupSlotId: z.number(),
  acquisitionType: z.string().nullable().optional(),
  status: z.string().optional(),
  injuryStatus: z.string().optional(),
  playerPoolEntry: PlayerPoolEntrySchema,
});
export type RosterEntry = z.infer<typeof RosterEntrySchema>;

const RecordLineSchema = z.object({
  wins: z.number(),
  losses: z.number(),
  ties: z.number(),
  pointsFor: z.number(),
  pointsAgainst: z.number(),
});

export const TransactionCounterSchema = z.object({
  acquisitions: z.number().optional(),
  drops: z.number().optional(),
  trades: z.number().optional(),
  moveToIR: z.number().optional(),
  moveToActive: z.number().optional(),
  acquisitionBudgetSpent: z.number().optional(),
  matchupAcquisitionTotals: numRecord.optional(),
});

export const TeamSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  location: z.string().optional(),
  nickname: z.string().optional(),
  abbrev: z.string().optional(),
  owners: z.array(z.string()).optional(),
  primaryOwner: z.string().optional(),
  divisionId: z.number().optional(),
  playoffSeed: z.number().optional(),
  points: z.number().optional(),
  record: z.object({ overall: RecordLineSchema }).optional(),
  roster: z.object({ entries: z.array(RosterEntrySchema) }).optional(),
  transactionCounter: TransactionCounterSchema.optional(),
  logo: z.string().optional(),
});
export type Team = z.infer<typeof TeamSchema>;

export const MemberSchema = z.object({
  id: z.string(),
  displayName: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  isLeagueManager: z.boolean().optional(),
});

const ScheduleSideSchema = z.object({
  teamId: z.number(),
  totalPoints: z.number().optional(),
  pointsByScoringPeriod: numRecord.optional(),
});

export const MatchupSchema = z.object({
  id: z.number().optional(),
  matchupPeriodId: z.number(),
  home: ScheduleSideSchema.optional(),
  away: ScheduleSideSchema.optional(),
  /** HOME / AWAY / TIE / UNDECIDED. */
  winner: z.string().optional(),
  /** Absent on regular-season matchups; e.g. WINNERS_BRACKET on playoff games. */
  playoffTierType: z.string().optional(),
});
export type Matchup = z.infer<typeof MatchupSchema>;

export const ScoringItemSchema = z.object({
  statId: z.number(),
  points: z.number(),
  /**
   * defaultPositionId → points that REPLACE `points` for players of that position (e.g. "16" = D/ST,
   * "4" = TE). Not lineupSlotId as CLAUDE.md §2.2 assumed; evidence: probe check K.overrideKeys.
   */
  pointsOverrides: numRecord.nullable().optional(),
  isReverseItem: z.boolean().optional(),
});
export type ScoringItem = z.infer<typeof ScoringItemSchema>;

export const SettingsSchema = z.object({
  name: z.string().optional(),
  size: z.number(),
  isPublic: z.boolean().optional(),
  scoringSettings: z.object({
    scoringItems: z.array(ScoringItemSchema),
    scoringType: z.string().optional(),
    scoringEnhancementType: z.string().optional(),
    matchupTieRule: z.string().optional(),
    playoffMatchupTieRule: z.string().optional(),
    playerRankType: z.string().optional(),
    homeTeamBonus: z.number().optional(),
    allowOutOfPositionScoring: z.boolean().optional(),
  }),
  rosterSettings: z.object({
    lineupSlotCounts: numRecord,
    positionLimits: numRecord.optional(),
    isBenchUnlimited: z.boolean().optional(),
    moveLimit: z.number().optional(),
  }),
  scheduleSettings: z.object({
    matchupPeriodCount: z.number(),
    matchupPeriodLength: z.number().optional(),
    matchupPeriods: z.record(z.string(), z.array(z.number())),
    playoffTeamCount: z.number(),
    playoffMatchupPeriodLength: z.number().optional(),
    playoffMatchupPeriodLengthByRound: numRecord.optional(),
    variablePlayoffMatchupPeriodLength: z.boolean().optional(),
    playoffSeedingRule: z.string().optional(),
    playoffReseed: z.boolean().optional(),
    consolationLadderDisabled: z.boolean().optional(),
    divisions: z.array(z.object({ id: z.number(), name: z.string().optional(), size: z.number().optional() })).optional(),
  }),
  tradeSettings: z.object({
    deadlineDate: z.number().optional(),
    vetoVotesRequired: z.number().optional(),
    revisionHours: z.number().optional(),
    max: z.number().optional(),
    allowOutOfUniverse: z.boolean().optional(),
  }),
  draftSettings: z
    .object({
      keeperCount: z.number().optional(),
      keeperCountFuture: z.number().optional(),
      keeperOrderType: z.string().optional(),
      leagueSubType: z.string().optional(),
      type: z.string().optional(),
      isTradingEnabled: z.boolean().optional(),
      date: z.number().optional(),
    })
    .optional(),
  acquisitionSettings: z
    .object({
      isUsingAcquisitionBudget: z.boolean().optional(),
      acquisitionBudget: z.number().optional(),
      acquisitionType: z.string().optional(),
    })
    .optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const StatusSchema = z.object({
  currentMatchupPeriod: z.number(),
  latestScoringPeriod: z.number(),
  firstScoringPeriod: z.number().optional(),
  finalScoringPeriod: z.number().optional(),
  isActive: z.boolean().optional(),
  previousSeasons: z.array(z.number()).optional(),
  createdAsLeagueType: z.number().optional(),
  currentLeagueType: z.number().optional(),
});

export const LeagueSchema = z.object({
  id: z.number(),
  seasonId: z.number(),
  scoringPeriodId: z.number().optional(),
  settings: SettingsSchema,
  status: StatusSchema,
  teams: z.array(TeamSchema),
  members: z.array(MemberSchema).optional(),
  schedule: z.array(MatchupSchema).optional(),
  draftDetail: z.object({ drafted: z.boolean().optional(), inProgress: z.boolean().optional() }).optional(),
});
export type League = z.infer<typeof LeagueSchema>;

export const TransactionItemSchema = z.object({
  playerId: z.number(),
  /** ADD / DROP / LINEUP / TRADE; null on some TRADE_DECLINE rows. */
  type: z.string().nullable(),
  fromTeamId: z.number().optional(),
  toTeamId: z.number().optional(),
  fromLineupSlotId: z.number().optional(),
  toLineupSlotId: z.number().optional(),
});

export const TransactionSchema = z.object({
  id: z.string(),
  type: z.string(),
  /** Absent on TRADE_ACCEPT rows (first seen 2026-09-29, when Parker's league had its first accepted trade). */
  status: z.string().optional(),
  scoringPeriodId: z.number(),
  teamId: z.number(),
  proposedDate: z.number().optional(),
  processDate: z.number().optional(),
  acceptedDate: z.number().optional(),
  executionType: z.string().optional(),
  bidAmount: z.number().optional(),
  isPending: z.boolean().optional(),
  relatedTransactionId: z.string().optional(),
  items: z.array(TransactionItemSchema).optional(),
  /** Trade proposals: teamId → ACCEPTED / DECLINED …, and when the offer expires. */
  teamActions: z.record(z.string(), z.string()).optional(),
  expirationDate: z.number().optional(),
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const TransactionsResponseSchema = z.object({ transactions: z.array(TransactionSchema).optional() });

export const DraftPickSchema = z.object({
  overallPickNumber: z.number(),
  roundId: z.number(),
  roundPickNumber: z.number(),
  teamId: z.number(),
  playerId: z.number(),
  keeper: z.boolean().optional(),
  reservedForKeeper: z.boolean().optional(),
  tradeLocked: z.boolean().optional(),
});

export const DraftResponseSchema = z.object({
  draftDetail: z.object({
    drafted: z.boolean().optional(),
    inProgress: z.boolean().optional(),
    completeDate: z.number().optional(),
    picks: z.array(DraftPickSchema).optional(),
  }),
});

export const PlayerListResponseSchema = z.object({
  players: z.array(
    z.object({
      id: z.number(),
      onTeamId: z.number().optional(),
      status: z.string().optional(),
      player: PlayerSchema,
    }),
  ),
});
export type PlayerListResponse = z.infer<typeof PlayerListResponseSchema>;

export const ProTeamSchedulesSchema = z.object({
  settings: z.object({
    /** statId → the pointsOverrides key ESPN uses for it (e.g. D/ST stats → 16, head-coach stats → 14). */
    statIdToOverridePosition: z.record(z.string(), z.number()).optional(),
    /** ESPN's enumerations (moveTypes, injuryStatusTypes, leagueSubTypes, …); values are string lists. */
    typeNames: z.record(z.string(), z.unknown()).optional(),
    proTeams: z.array(
      z.object({
        id: z.number(),
        abbrev: z.string().optional(),
        byeWeek: z.number().optional(),
        proGamesByScoringPeriod: z
          .record(z.string(), z.array(z.object({ id: z.number().optional(), date: z.number(), homeProTeamId: z.number(), awayProTeamId: z.number(), scoringPeriodId: z.number().optional() })))
          .optional(),
      }),
    ),
  }),
});
export type ProTeamSchedules = z.infer<typeof ProTeamSchedulesSchema>;

/** One of ESPN's settings.typeNames enumerations as a string list ([] when absent or malformed). */
export function typeNameList(typeNames: Record<string, unknown> | undefined, name: string): string[] {
  const v = typeNames?.[name];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Readable zod issues: "teams[3].roster.entries[0].playerPoolEntry.player.fullName: Invalid input…". */
export function formatIssues(error: z.ZodError, max = 5): string[] {
  return error.issues.slice(0, max).map((i) => `${i.path.map((k) => (typeof k === "number" ? `[${k}]` : `.${String(k)}`)).join("").replace(/^\./, "") || "(root)"}: ${i.message}`);
}
