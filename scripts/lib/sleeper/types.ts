/**
 * Shapes of the Sleeper responses the probe relies on, as zod schemas (CLAUDE.md §3: validate at
 * the boundary, ignore unknown fields, name the JSON path of anything missing). Only the fields
 * Phase 1 needs are required; everything else passes through untouched.
 */
import { z } from "zod";

const id = z.union([z.string(), z.number()]).transform(String);
const nullableRecord = <T extends z.ZodType>(v: T) => z.record(z.string(), v).nullable().optional();

export const StateSchema = z.looseObject({
  week: z.number(),
  display_week: z.number().optional(),
  season: z.string(),
  season_type: z.string(),
  leg: z.number().optional(),
  league_season: z.string().optional(),
  season_start_date: z.string().optional(),
});
export type SleeperState = z.infer<typeof StateSchema>;

export const LeagueSchema = z.looseObject({
  league_id: z.string(),
  name: z.string().optional(),
  season: z.string(),
  season_type: z.string().optional(),
  sport: z.string().optional(),
  status: z.string(),
  total_rosters: z.number(),
  settings: z.record(z.string(), z.unknown()),
  scoring_settings: z.record(z.string(), z.number()),
  roster_positions: z.array(z.string()),
  previous_league_id: z.string().nullable().optional(),
  draft_id: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type SleeperLeague = z.infer<typeof LeagueSchema>;

export const UserSchema = z.looseObject({
  user_id: z.string(),
  display_name: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  is_owner: z.boolean().nullable().optional(),
  is_bot: z.boolean().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type SleeperUser = z.infer<typeof UserSchema>;

export const RosterSchema = z.looseObject({
  roster_id: z.number(),
  owner_id: z.string().nullable().optional(),
  co_owners: z.array(z.string()).nullable().optional(),
  players: z.array(z.string()).nullable().optional(),
  starters: z.array(z.string()).nullable().optional(),
  reserve: z.array(z.string()).nullable().optional(),
  taxi: z.array(z.string()).nullable().optional(),
  keepers: z.array(z.string()).nullable().optional(),
  settings: z.looseObject({
    wins: z.number().optional(),
    losses: z.number().optional(),
    ties: z.number().optional(),
    fpts: z.number().optional(),
    fpts_decimal: z.number().optional(),
    fpts_against: z.number().optional(),
    fpts_against_decimal: z.number().optional(),
    division: z.number().optional(),
  }),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type SleeperRoster = z.infer<typeof RosterSchema>;

export const MatchupSchema = z.looseObject({
  roster_id: z.number(),
  matchup_id: z.number().nullable(),
  points: z.number().nullable().optional(),
  custom_points: z.number().nullable().optional(),
  players: z.array(z.string()).nullable().optional(),
  starters: z.array(z.string()).nullable().optional(),
  players_points: nullableRecord(z.number()),
  starters_points: z.array(z.number()).nullable().optional(),
});
export type SleeperMatchup = z.infer<typeof MatchupSchema>;

export const PickSchema = z.looseObject({
  season: id,
  round: z.number(),
  roster_id: z.number(),
  previous_owner_id: z.number().nullable().optional(),
  owner_id: z.number(),
});
export type SleeperTradedPick = z.infer<typeof PickSchema>;

export const TransactionSchema = z.looseObject({
  transaction_id: z.string(),
  type: z.string(),
  status: z.string(),
  leg: z.number(),
  created: z.number(),
  status_updated: z.number().nullable().optional(),
  roster_ids: z.array(z.number()).nullable().optional(),
  consenter_ids: z.array(z.number()).nullable().optional(),
  creator: z.string().nullable().optional(),
  adds: nullableRecord(z.number()),
  drops: nullableRecord(z.number()),
  draft_picks: z.array(PickSchema).nullable().optional(),
  waiver_budget: z.array(z.looseObject({ sender: z.number(), receiver: z.number(), amount: z.number() })).nullable().optional(),
  settings: z.record(z.string(), z.unknown()).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type SleeperTransaction = z.infer<typeof TransactionSchema>;

export const DraftSchema = z.looseObject({
  draft_id: z.string(),
  league_id: z.string().nullable().optional(),
  season: z.string(),
  status: z.string(),
  type: z.string(),
  settings: z.record(z.string(), z.unknown()).nullable().optional(),
  draft_order: nullableRecord(z.number()),
  slot_to_roster_id: nullableRecord(z.number()),
  creators: z.array(z.string()).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type SleeperDraft = z.infer<typeof DraftSchema>;

export const DraftPickSchema = z.looseObject({
  player_id: z.string(),
  picked_by: z.string().nullable().optional(),
  roster_id: id.nullable().optional(),
  round: z.number(),
  draft_slot: z.number().optional(),
  pick_no: z.number(),
  is_keeper: z.boolean().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type SleeperDraftPick = z.infer<typeof DraftPickSchema>;

export const BracketSchema = z.looseObject({
  r: z.number(),
  m: z.number(),
  t1: z.number().nullable().optional(),
  t2: z.number().nullable().optional(),
  w: z.number().nullable().optional(),
  l: z.number().nullable().optional(),
  p: z.number().nullable().optional(),
});
export type SleeperBracketMatch = z.infer<typeof BracketSchema>;

/** One row of /projections/nfl/{season}/{week} or /stats/nfl/{season}/{week} (undocumented). */
export const StatRowSchema = z.looseObject({
  player_id: z.string(),
  week: z.number().nullable().optional(),
  season: z.string().optional(),
  category: z.string().optional(),
  team: z.string().nullable().optional(),
  opponent: z.string().nullable().optional(),
  game_id: z.string().nullable().optional(),
  last_modified: z.number().nullable().optional(),
  company: z.string().nullable().optional(),
  stats: z.record(z.string(), z.number()).nullable(),
  player: z.looseObject({ position: z.string().nullable().optional(), team: z.string().nullable().optional() }).nullable().optional(),
});
export type SleeperStatRow = z.infer<typeof StatRowSchema>;

export interface ParseReport<T> {
  value: T[];
  /** "path: message" for the first few problems, e.g. "[3].settings.wins: expected number". */
  problems: string[];
  bad: number;
}

/** Validate each element of an array response on its own, so one odd row doesn't hide the rest. */
export function parseArray<T>(schema: z.ZodType<T>, data: unknown, max = 5): ParseReport<T> {
  if (!Array.isArray(data)) return { value: [], problems: ["(root): expected array"], bad: 1 };
  const value: T[] = [];
  const problems: string[] = [];
  let bad = 0;
  data.forEach((row, i) => {
    const r = schema.safeParse(row);
    if (r.success) value.push(r.data);
    else {
      bad++;
      if (problems.length < max) problems.push(...r.error.issues.slice(0, 2).map((iss) => `[${i}].${iss.path.join(".")}: ${iss.message}`));
    }
  });
  return { value, problems, bad };
}

export function parseOne<T>(schema: z.ZodType<T>, data: unknown): { value: T | null; problems: string[] } {
  const r = schema.safeParse(data);
  return r.success ? { value: r.data, problems: [] } : { value: null, problems: r.error.issues.slice(0, 5).map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`) };
}
