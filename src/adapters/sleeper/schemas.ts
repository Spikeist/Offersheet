/**
 * Shapes of the Sleeper responses the adapter reads (CLAUDE.md §2.3, §3: zod at the adapter
 * boundary). Only the fields the normalizer uses are declared; unknown fields are stripped. A
 * missing or mistyped required field becomes LeagueImportError("BAD_RESPONSE") naming its JSON path.
 *
 * Browser-safe: no node: imports (planner: the normalizer may later run in the browser, §2.3). The browser builds these
 * (track BF: it reads Sleeper leagues itself), so zod's eval-compiled parsers are turned off there first
 * (src/lib/zodJitless.ts: it must be this module's first import).
 */
import "@/lib/zodJitless";
import { z } from "zod";
import { LeagueImportError } from "@/adapters/types";

/** Sleeper IDs arrive as strings, except a few 19-digit ones sent as bare numbers (Phase 0). */
const id = z.union([z.string(), z.number()]).transform(String);
const nullishRecord = <T extends z.ZodType>(v: T) => z.record(z.string(), v).nullish();

export const StateSchema = z.object({
  week: z.number(),
  season: z.union([z.string(), z.number()]).transform(String),
  season_type: z.string().nullish(),
  display_week: z.number().nullish(),
  leg: z.number().nullish(),
});
export type SleeperState = z.infer<typeof StateSchema>;

export const UserSchema = z.object({
  user_id: id,
  username: z.string().nullish(),
  display_name: z.string().nullish(),
});

export const LeagueSchema = z.object({
  league_id: id,
  name: z.string().nullish(),
  season: z.union([z.string(), z.number()]).transform(String),
  sport: z.string().nullish(),
  status: z.string().nullish(),
  total_rosters: z.number().nullish(),
  /**
   * Every setting is kept (the normalizer reads them by name: num()). Declared: trade_review_days (Phase 7b; the trade review
   * period, LeagueSettings.tradeReviewHours), the length of a league's veto vote in days: 0, 1 or 2 in the 250 crawled 2026
   * leagues (33 / 40 / 177; reports/probe-output/sleeper-codes.json). A value that isn't a number reads as missing rather than
   * failing the import (.catch): it's an optional setting.
   */
  settings: z.looseObject({ trade_review_days: z.number().nullish().catch(undefined) }),
  scoring_settings: z.record(z.string(), z.unknown()),
  roster_positions: z.array(z.string()),
});
export type SleeperLeague = z.infer<typeof LeagueSchema>;

/** One entry of /user/{id}/leagues/nfl/{season} (for the league picker). */
export const LeagueListItemSchema = z.object({
  league_id: id,
  name: z.string().nullish(),
  season: z.union([z.string(), z.number()]).transform(String),
  status: z.string().nullish(),
  total_rosters: z.number().nullish(),
  settings: z.object({ type: z.number().nullish(), best_ball: z.number().nullish() }).nullish(),
});

export const LeagueUserSchema = z.object({
  user_id: id,
  display_name: z.string().nullish(),
  metadata: nullishRecord(z.unknown()),
});
export type SleeperLeagueUser = z.infer<typeof LeagueUserSchema>;

export const RosterSchema = z.object({
  roster_id: z.number(),
  owner_id: id.nullish(),
  co_owners: z.array(id).nullish(),
  players: z.array(id).nullish(),
  reserve: z.array(id).nullish(),
  taxi: z.array(id).nullish(),
  settings: z
    .object({
      wins: z.number().nullish(),
      losses: z.number().nullish(),
      ties: z.number().nullish(),
      fpts: z.number().nullish(),
      fpts_decimal: z.number().nullish(),
      fpts_against: z.number().nullish(),
      fpts_against_decimal: z.number().nullish(),
      division: z.number().nullish(),
      /**
       * The roster's place in the waiver order, 1 = first claim (Phase 4b): a 1..n permutation in all 18 surveyed 2026
       * leagues and the public test league; ρ(position, standings rank) = −1.00 in two reverse-standings leagues.
       */
      waiver_position: z.number().nullish(),
      /** FAAB spent this season (waiver_type 2 leagues); negative after receiving FAAB in a trade (one league: 205 left of 100). */
      waiver_budget_used: z.number().nullish(),
    })
    .nullish(),
});
export type SleeperRoster = z.infer<typeof RosterSchema>;

export const MatchupSchema = z.object({
  roster_id: z.number(),
  matchup_id: z.number().nullish(),
  /** The team's score that week (the starters' points); 0 for weeks not played yet. */
  points: z.number().nullish(),
  /** An override of `points`, used instead of it when it's a number (read as a commissioner's manual score; null in every captured league). */
  custom_points: z.number().nullish(),
  players: z.array(id).nullish(),
  players_points: nullishRecord(z.number()),
});
export type SleeperMatchup = z.infer<typeof MatchupSchema>;

export const TradedPickSchema = z.object({
  season: z.union([z.string(), z.number()]).transform(String),
  round: z.number(),
  /** The original owner's roster. */
  roster_id: z.number(),
  previous_owner_id: z.number().nullish(),
  /** The current owner's roster. */
  owner_id: z.number(),
});
export type SleeperTradedPick = z.infer<typeof TradedPickSchema>;

export const TransactionSchema = z.object({
  transaction_id: id,
  type: z.string(),
  status: z.string(),
  leg: z.number(),
  created: z.number(),
  status_updated: z.number().nullish(),
  roster_ids: z.array(z.number()).nullish(),
  adds: nullishRecord(z.number()),
  drops: nullishRecord(z.number()),
  draft_picks: z.array(TradedPickSchema).nullish(),
});
export type SleeperTransaction = z.infer<typeof TransactionSchema>;

export const DraftSchema = z.object({
  draft_id: id,
  season: z.union([z.string(), z.number()]).transform(String),
  status: z.string().nullish(),
  type: z.string().nullish(),
  settings: nullishRecord(z.unknown()),
});
export type SleeperDraft = z.infer<typeof DraftSchema>;

/** A row of the undocumented /projections (or /stats) endpoint. Rows that don't fit are skipped. */
export const StatRowSchema = z.object({
  player_id: id,
  week: z.number().nullish(),
  stats: nullishRecord(z.unknown()),
  player: z
    .object({
      position: z.string().nullish(),
      fantasy_positions: z.array(z.string()).nullish(),
      team: z.string().nullish(),
      first_name: z.string().nullish(),
      last_name: z.string().nullish(),
      injury_status: z.string().nullish(),
      years_exp: z.number().nullish(),
    })
    .nullish(),
});
export type SleeperStatRow = z.infer<typeof StatRowSchema>;

// ---------------------------------------------------------------------------------------------

function pathText(prefix: string, path: ReadonlyArray<PropertyKey>): string {
  let out = prefix;
  for (const p of path) out += typeof p === "number" ? `[${p}]` : `.${String(p)}`;
  return out;
}

/**
 * Parse a required response; throws BAD_RESPONSE naming the first bad JSON path, e.g.
 * "rosters[3].roster_id". `what` names the response in the message ("league", "rosters").
 */
export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown, what: string): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const path = pathText(what, issue?.path ?? []);
  throw new LeagueImportError("BAD_RESPONSE", `Sleeper sent an unexpected ${what} response: ${issue?.message ?? "invalid"} at ${path}.`, { platform: "sleeper", path });
}

/** Parse a required array response element by element (the error names the element's index). */
export function parseArrayOrThrow<S extends z.ZodType>(schema: S, data: unknown, what: string): z.infer<S>[] {
  if (!Array.isArray(data)) throw new LeagueImportError("BAD_RESPONSE", `Sleeper sent an unexpected ${what} response: expected a list.`, { platform: "sleeper", path: what });
  return data.map((row, i) => parseOrThrow(schema, row, `${what}[${i}]`));
}

/** Parse an optional array response leniently: rows that don't fit are counted, not fatal. */
export function parseArrayLenient<S extends z.ZodType>(schema: S, data: unknown): { rows: z.infer<S>[]; bad: number; firstBadPath?: string } {
  if (!Array.isArray(data)) return { rows: [], bad: data === undefined || data === null ? 0 : 1, firstBadPath: data === undefined || data === null ? undefined : "(root)" };
  const rows: z.infer<S>[] = [];
  let bad = 0;
  let firstBadPath: string | undefined;
  data.forEach((row, i) => {
    const r = schema.safeParse(row);
    if (r.success) rows.push(r.data);
    else {
      bad++;
      firstBadPath ??= pathText(`[${i}]`, r.error.issues[0]?.path ?? []);
    }
  });
  return { rows, bad, firstBadPath };
}

/** Numeric setting, or undefined when absent / not a number. */
export function num(record: Record<string, unknown> | null | undefined, key: string): number | undefined {
  const v = record?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
