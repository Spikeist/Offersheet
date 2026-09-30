/**
 * Fleaflicker public API response shapes used by the adapter (CLAUDE.md §2.5), and proto3 JSON helpers.
 *
 * Observed live on 2026-09-29 (reports/probe-output/fleaflicker.md; differs from the API docs):
 * - Live JSON keys are camelCase (the docs show snake_case).
 * - proto3 JSON omits default values: a missing number is 0, a missing boolean false, a missing
 *   enum its FIRST value, a missing repeated field empty.
 * - A scoring rule's `rangeType` says which bounds apply; a bound of 0 is omitted
 *   ("≤ 0 points allowed" has RANGE_UPPER_BOUND and no `boundUpper`).
 * - `points` is a FormattedDecimal ({value, formatted}); `pointsPer` is only a float32 display copy.
 *
 * Schemas are loose: unknown fields are ignored; a missing required field is a LeagueImportError
 * naming its JSON path.
 */
import { z } from "zod";
import { LeagueImportError } from "@/adapters/types";

/** A number field (missing = 0). */
export function num(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

export const formattedDecimal = z.looseObject({ value: z.number().optional(), formatted: z.string().optional() });
export type FormattedDecimal = z.infer<typeof formattedDecimal>;

/** A FormattedDecimal: `value` is omitted when 0; `formatted` is a fallback ("—" = no value → 0). */
export function fd(x: FormattedDecimal | undefined): number {
  if (!x) return 0;
  if (typeof x.value === "number") return x.value;
  const f = Number(x.formatted);
  return Number.isFinite(f) ? f : 0;
}

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
  points: formattedDecimal.optional(),
  forEvery: z.number().optional(),
  boundLower: z.number().optional(),
  boundUpper: z.number().optional(),
  description: z.string().optional(),
  applyTo: z.array(z.string()).optional(),
  applyToAll: z.boolean().optional(),
  isBonus: z.boolean().optional(),
  rangeType: z.string().optional(),
});
export type FfRule = z.infer<typeof scoringRuleSchema>;

export const scoringGroupSchema = z.looseObject({ label: z.string().optional(), scoringRules: z.array(scoringRuleSchema).optional() });
export type FfScoringGroup = z.infer<typeof scoringGroupSchema>;

/** FetchLeagueRules, as far as the scoring map reads it (proto3: no groups = no scoring rules). */
export const leagueRulesSchema = z.looseObject({ groups: z.array(scoringGroupSchema).optional() });
export type FfLeagueRules = z.infer<typeof leagueRulesSchema>;

function issuePath(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const k of path) out += typeof k === "number" ? `[${k}]` : `${out ? "." : ""}${String(k)}`;
  return out || "(root)";
}

/** Validate a FetchLeagueRules body at the adapter boundary. */
export function parseLeagueRules(json: unknown): FfLeagueRules {
  const r = leagueRulesSchema.safeParse(json);
  if (r.success) return r.data;
  const path = issuePath(r.error.issues[0]?.path ?? []);
  throw new LeagueImportError("BAD_RESPONSE", `Fleaflicker league rules: missing or invalid field at ${path}`, { platform: "fleaflicker", path });
}
