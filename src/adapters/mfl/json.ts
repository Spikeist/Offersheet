/**
 * Helpers for MyFantasyLeague's JSON=1 output (CLAUDE.md §2.6). MFL converts XML to JSON, which gives
 * three quirks (verified in Phase 0, reports/probe-output/mfl.md):
 * - a repeated element with a single child arrives as an object instead of an array (asArray);
 * - element text sometimes arrives as {"$t": "..."} (text);
 * - every value is a string ("12", "0001", "*.5"), so numbers are parsed explicitly.
 * Errors come back as HTTP 200 with an "error" object (mflError).
 */
import { z } from "zod";
import { LeagueImportError } from "@/adapters/types";

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** One-or-many → array (undefined/null → []). */
export function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Unwrap {"$t": "x"} and stringify scalars; undefined when missing. */
export function text(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (isRecord(v) && "$t" in v) return text(v.$t);
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

/** MFL error bodies: {"error": {"$t": "..."}} or {"error": "..."}, usually with HTTP 200. */
export function mflError(json: unknown): string | undefined {
  if (!isRecord(json) || !("error" in json)) return undefined;
  return text(json.error) ?? "unknown MFL error";
}

/** A text node: "x", 12, or {"$t": "x"}. */
export const textNode = z.union([z.string(), z.number(), z.looseObject({ $t: z.union([z.string(), z.number()]) })]);

/** JSON path of a zod issue under a base path, e.g. rules.positionRules[2].rule[5].event. */
export function joinPath(base: string, sub: ReadonlyArray<PropertyKey>): string {
  let out = base;
  for (const k of sub) out += typeof k === "number" ? `[${k}]` : `${out ? "." : ""}${String(k)}`;
  return out;
}

/**
 * Validate one element at the adapter boundary (CLAUDE.md §3: unknown fields ignored; a missing
 * required field is a clear error naming its JSON path).
 */
export function parseAt<S extends z.ZodType>(schema: S, value: unknown, path: string, what: string): z.infer<S> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const where = joinPath(path, issue?.path ?? []);
  throw new LeagueImportError("BAD_RESPONSE", `MFL ${what}: missing or invalid field at ${where || "(root)"}`, { platform: "mfl", path: where || "(root)" });
}
