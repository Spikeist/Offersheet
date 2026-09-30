/**
 * Fleaflicker public API (CLAUDE.md §2.5): URL builders, the response shapes we rely on, and
 * helpers for proto3 JSON.
 *
 * Observed on 2026-09-29 (differs from https://www.fleaflicker.com/api-docs/index.html):
 * - Live JSON keys are camelCase (`maxKeepers`, `recordOverall`), the docs show snake_case.
 * - proto3 JSON omits default values: missing numbers are 0, missing booleans false, and a
 *   missing enum is the enum's FIRST value (RosterPosition.group → BENCH, TransactionType →
 *   TRANSACTION_ADD, LeagueType → FP_H2H, ExternalIdType → SPORTRADAR …). See ENUM_DEFAULTS.
 * - A scoring rule's `rangeType` says which bounds apply; a bound of 0 is omitted
 *   ("≤ 0 points allowed" has RANGE_UPPER_BOUND and no `boundUpper`).
 *
 * Schemas are deliberately loose: they document the fields the probe reads and report a JSON path
 * when something is missing, without rejecting extra fields.
 */
import { z } from "zod";

export const API_BASE = "https://www.fleaflicker.com/api";
export const WEB_BASE = "https://www.fleaflicker.com/nfl/leagues";

type ParamValue = string | number | boolean | ReadonlyArray<string | number> | undefined;

/** Build an API URL. Placeholder values like "{leagueId}" are kept readable (not %-encoded). */
export function apiUrl(endpoint: string, params: Record<string, ParamValue>): string {
  const parts: string[] = ["sport=NFL"];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    const values = Array.isArray(v) ? v : [v];
    for (const x of values) {
      const s = String(x);
      parts.push(`${k}=${/^\{[A-Za-z]+\}$/.test(s) ? s : encodeURIComponent(s)}`);
    }
  }
  return `${API_BASE}/${endpoint}?${parts.join("&")}`;
}

/** Public HTML page of a league (rules, trades …). Used only for settings the API lacks. */
export function webUrl(leagueId: string, page = ""): string {
  return `${WEB_BASE}/${leagueId}${page ? `/${page}` : ""}`;
}

/** proto3 enum defaults: the value a missing enum field stands for. */
export const ENUM_DEFAULTS = {
  RosterPositionGroup: "BENCH",
  TransactionType: "TRANSACTION_ADD",
  LeagueType: "FP_H2H",
  DraftStatus: "NOT_YET_DRAFTED",
  InjurySeverity: "HEALTHY",
  GameResult: "UNDECIDED",
  TradeStatus: "TRADE_STATUS_OPEN",
  ExternalIdType: "SPORTRADAR",
  WaiverResolutionType: "PRIORITY",
} as const;

export function enumOr<K extends keyof typeof ENUM_DEFAULTS>(value: string | undefined, kind: K): string {
  return value ?? ENUM_DEFAULTS[kind];
}

/** A number field (missing = 0). */
export function num(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

const fdSchema = z.looseObject({ value: z.number().optional(), formatted: z.string().optional() });
export type FormattedDecimal = z.infer<typeof fdSchema>;

/** A FormattedDecimal ({value, formatted}); `value` is omitted when 0. */
export function fd(x: FormattedDecimal | undefined): number {
  if (!x) return 0;
  if (typeof x.value === "number") return x.value;
  const f = Number(x.formatted);
  return Number.isFinite(f) ? f : 0;
}

/** int64 values arrive as strings (epoch millis, game ids). */
export function int64(x: string | number | undefined): number {
  const v = typeof x === "number" ? x : Number(x ?? 0);
  return Number.isFinite(v) ? v : 0;
}

const recordSchema = z.looseObject({ wins: z.number().optional(), losses: z.number().optional(), ties: z.number().optional(), rank: z.number().optional(), formatted: z.string().optional() });
const userSchema = z.looseObject({ id: z.number().optional(), displayName: z.string().optional(), avatarUrl: z.string().optional(), initials: z.string().optional() });
export const teamSchema = z.looseObject({
  id: z.number(),
  name: z.string().optional(),
  logoUrl: z.string().optional(),
  recordOverall: recordSchema.optional(),
  recordDivision: recordSchema.optional(),
  recordPostseason: recordSchema.optional(),
  pointsFor: fdSchema.optional(),
  pointsAgainst: fdSchema.optional(),
  waiverPosition: z.number().optional(),
  waiverAcquisitionBudget: fdSchema.optional(),
  owners: z.array(userSchema).optional(),
  initials: z.string().optional(),
});
export type FfTeam = z.infer<typeof teamSchema>;
export type FfUser = z.infer<typeof userSchema>;

export const rosterPositionSchema = z.looseObject({
  label: z.string().optional(),
  group: z.string().optional(),
  eligibility: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  start: z.number().optional(),
});
export type FfRosterPosition = z.infer<typeof rosterPositionSchema>;

export const leagueSchema = z.looseObject({
  id: z.number(),
  name: z.string().optional(),
  activeForCurrentSeason: z.boolean().optional(),
  draftStatus: z.string().optional(),
  type: z.string().optional(),
  maxKeepers: z.number().optional(),
  size: z.number().optional(),
  capacity: z.number().optional(),
  waiverType: z.string().optional(),
  defaultWaiverBudget: z.number().optional(),
  hasPlayoffs: z.boolean().optional(),
  singleDivision: z.boolean().optional(),
  rosterRequirements: z
    .looseObject({
      positions: z.array(rosterPositionSchema).optional(),
      /** Positions the league allows (a scoring rule's applyToAll list equals this). */
      eligibility: z.array(z.string()).optional(),
      rosterSize: z.number().optional(),
      starterCount: z.number().optional(),
      benchCount: z.number().optional(),
      reserveCount: z.number().optional(),
    })
    .optional(),
});
export type FfLeague = z.infer<typeof leagueSchema>;

export const standingsSchema = z.looseObject({
  divisions: z.array(z.looseObject({ id: z.number().optional(), name: z.string().optional(), teams: z.array(teamSchema).optional() })).optional(),
  season: z.number().optional(),
  league: leagueSchema,
});
export type FfStandings = z.infer<typeof standingsSchema>;

export const statCategorySchema = z.looseObject({
  id: z.number(),
  abbreviation: z.string().optional(),
  nameSingular: z.string().optional(),
  namePlural: z.string().optional(),
  multiValue: z.boolean().optional(),
  lowerIsBetter: z.boolean().optional(),
});
export type FfStatCategory = z.infer<typeof statCategorySchema>;

export const scoringRuleSchema = z.looseObject({
  category: statCategorySchema,
  points: fdSchema.optional(),
  forEvery: z.number().optional(),
  boundLower: z.number().optional(),
  boundUpper: z.number().optional(),
  description: z.string().optional(),
  pointsPer: fdSchema.optional(),
  applyTo: z.array(z.string()).optional(),
  applyToAll: z.boolean().optional(),
  isBonus: z.boolean().optional(),
  rangeType: z.string().optional(),
});
export type FfRule = z.infer<typeof scoringRuleSchema>;

export const rulesSchema = z.looseObject({
  rosterPositions: z.array(rosterPositionSchema),
  groups: z.array(z.looseObject({ label: z.string().optional(), scoringRules: z.array(scoringRuleSchema).optional() })),
  numStarters: z.number().optional(),
  numBench: z.number().optional(),
  maxActive: z.number().optional(),
  maxRosterSize: z.number().optional(),
});
export type FfRules = z.infer<typeof rulesSchema>;

const injurySchema = z.looseObject({ typeAbbreviaition: z.string().optional(), description: z.string().optional(), severity: z.string().optional(), typeFull: z.string().optional() });
export type FfInjury = z.infer<typeof injurySchema>;

export const proPlayerSchema = z.looseObject({
  id: z.number(),
  nameFull: z.string().optional(),
  position: z.string().optional(),
  positionEligibility: z.array(z.string()).optional(),
  proTeamAbbreviation: z.string().optional(),
  nflByeWeek: z.number().optional(),
  injury: injurySchema.optional(),
  externalIds: z.array(z.looseObject({ type: z.string().optional(), id: z.string().optional() })).optional(),
  isRookie: z.boolean().optional(),
});
export type FfProPlayer = z.infer<typeof proPlayerSchema>;

const statValueSchema = z.looseObject({ category: statCategorySchema, value: fdSchema.optional() });
export const leaguePlayerSchema = z.looseObject({
  proPlayer: proPlayerSchema,
  owner: teamSchema.optional(),
  viewingActualPoints: fdSchema.optional(),
  viewingProjectedPoints: fdSchema.optional(),
  viewingActualStats: z.array(statValueSchema).optional(),
  viewingProjectedStats: z.array(statValueSchema).optional(),
  isKeeper: z.boolean().optional(),
  displayGroup: z.string().optional(),
  /** League-scored points so far this season, and per game played (undocumented; seen in FetchRoster). */
  seasonTotal: fdSchema.optional(),
  seasonAverage: fdSchema.optional(),
});
export type FfLeaguePlayer = z.infer<typeof leaguePlayerSchema>;

export const leagueRostersSchema = z.looseObject({ rosters: z.array(z.looseObject({ team: teamSchema, players: z.array(leaguePlayerSchema).optional() })) });
export type FfLeagueRosters = z.infer<typeof leagueRostersSchema>;

const slotSchema = z.looseObject({ position: rosterPositionSchema.optional(), leaguePlayer: leaguePlayerSchema.optional() });
export const rosterSchema = z.looseObject({ groups: z.array(z.looseObject({ group: z.string().optional(), slots: z.array(slotSchema).optional() })) });
export type FfRoster = z.infer<typeof rosterSchema>;

const scoringPeriodSchema = z.looseObject({ ordinal: z.number().optional(), startEpochMilli: z.string().optional(), isNow: z.boolean().optional(), season: z.number().optional() });
export const periodRangeSchema = z.looseObject({
  ordinal: z.number().optional(),
  low: scoringPeriodSchema.optional(),
  high: scoringPeriodSchema.optional(),
  containsNow: z.boolean().optional(),
  value: z.number().optional(),
});
export type FfPeriodRange = z.infer<typeof periodRangeSchema>;

const lineScoreSchema = z.looseObject({ score: fdSchema.optional(), projected: fdSchema.optional() });
export const gameSchema = z.looseObject({
  id: z.string(),
  away: teamSchema.optional(),
  home: teamSchema.optional(),
  awayScore: lineScoreSchema.optional(),
  homeScore: lineScoreSchema.optional(),
  homeResult: z.string().optional(),
  awayResult: z.string().optional(),
  isFinalScore: z.boolean().optional(),
  isInProgress: z.boolean().optional(),
  isPlayoffs: z.boolean().optional(),
  isConsolation: z.boolean().optional(),
  isDivisional: z.boolean().optional(),
  isChampionshipGame: z.boolean().optional(),
  isThirdPlaceGame: z.boolean().optional(),
});
export type FfGame = z.infer<typeof gameSchema>;

export const scoreboardSchema = z.looseObject({
  schedulePeriod: periodRangeSchema.optional(),
  eligibleSchedulePeriods: z.array(periodRangeSchema).optional(),
  games: z.array(gameSchema).optional(),
});
export type FfScoreboard = z.infer<typeof scoreboardSchema>;

export const boxscoreSchema = z.looseObject({
  game: gameSchema.optional(),
  lineups: z.array(z.looseObject({ group: z.string().optional(), slots: z.array(z.looseObject({ position: rosterPositionSchema.optional(), away: leaguePlayerSchema.optional(), home: leaguePlayerSchema.optional() })).optional() })).optional(),
});
export type FfBoxscore = z.infer<typeof boxscoreSchema>;

const draftSlotSchema = z.looseObject({ round: z.number().optional(), slot: z.number().optional(), overall: z.number().optional() });
export const draftPickSchema = z.looseObject({
  ownedBy: teamSchema.optional(),
  originalOwner: teamSchema.optional(),
  slot: draftSlotSchema.optional(),
  season: z.number().optional(),
  traded: z.boolean().optional(),
  lost: z.boolean().optional(),
});
export type FfDraftPick = z.infer<typeof draftPickSchema>;
export const teamPicksSchema = z.looseObject({ picks: z.array(draftPickSchema).optional() });

export const transactionsSchema = z.looseObject({
  items: z
    .array(
      z.looseObject({
        timeEpochMilli: z.string().optional(),
        transaction: z
          .looseObject({
            type: z.string().optional(),
            player: leaguePlayerSchema.optional(),
            team: teamSchema.optional(),
            bidAmount: z.number().optional(),
            tradeId: z.number().optional(),
            draftPick: z.looseObject({ season: z.number().optional(), round: z.number().optional() }).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  resultOffsetNext: z.number().optional(),
  resultTotal: z.number().optional(),
});
export type FfTransactions = z.infer<typeof transactionsSchema>;

export const tradesSchema = z.looseObject({
  trades: z
    .array(
      z.looseObject({
        id: z.number(),
        teams: z.array(z.looseObject({ team: teamSchema.optional(), playersObtained: z.array(leaguePlayerSchema).optional(), picksObtained: z.array(draftPickSchema).optional(), playersReleased: z.array(leaguePlayerSchema).optional() })).optional(),
        status: z.string().optional(),
        proposedOn: z.string().optional(),
        approvedOn: z.string().optional(),
        tentativeExecutionTime: z.string().optional(),
        numVetoes: z.number().optional(),
        numVetoesRequired: z.number().optional(),
      }),
    )
    .optional(),
  resultOffsetNext: z.number().optional(),
  resultTotal: z.number().optional(),
  deadlinePassed: z.boolean().optional(),
});
export type FfTrades = z.infer<typeof tradesSchema>;

export const playerListingSchema = z.looseObject({ players: z.array(leaguePlayerSchema).optional(), resultOffsetNext: z.number().optional(), resultTotal: z.number().optional() });
export type FfPlayerListing = z.infer<typeof playerListingSchema>;

export const draftBoardSchema = z.looseObject({
  draftOrder: z.array(teamSchema).optional(),
  rows: z.array(z.looseObject({ round: z.number().optional(), cells: z.array(z.looseObject({ team: teamSchema.optional(), player: leaguePlayerSchema.optional(), slot: draftSlotSchema.optional(), tradeId: z.number().optional(), fromOtherTeam: z.boolean().optional(), keeper: z.boolean().optional() })).optional() })).optional(),
});
export type FfDraftBoard = z.infer<typeof draftBoardSchema>;

/** Validate a response; returns human-readable issues ("path: message"), [] when it fits. */
export function shapeIssues(schema: z.ZodType, data: unknown): string[] {
  const r = schema.safeParse(data);
  if (r.success) return [];
  return r.error.issues.slice(0, 8).map((i) => `${i.path.map((k) => (typeof k === "number" ? `[${k}]` : `.${String(k)}`)).join("").replace(/^\./, "") || "(root)"}: ${i.message}`);
}

/** Current Sportradar id from `externalIds` (type omitted = SPORTRADAR, the only enum value). */
export function sportradarId(p: FfProPlayer): string | undefined {
  const e = (p.externalIds ?? []).find((x) => enumOr(x.type, "ExternalIdType") === "SPORTRADAR" && x.id);
  return e?.id?.toLowerCase();
}
