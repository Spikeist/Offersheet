/**
 * Helpers for MFL's JSON=1 output. MFL converts XML to JSON, which gives two quirks:
 * - a repeated element with a single child becomes an object instead of an array (asArray fixes it);
 * - element text sometimes arrives as {"$t": "..."} (text() unwraps it).
 * Every value is a string ("12", "0001", "YES"), so numbers must be parsed explicitly.
 */

export type Json = unknown;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** One-or-many → array (undefined/null → []). */
export function asArray<T = unknown>(v: T | T[] | undefined | null): T[] {
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

export function num(v: unknown): number | undefined {
  const t = text(v);
  if (t === undefined || t.trim() === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Read a nested value by a dotted path ("league.franchises.franchise"). */
export function at(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const k of dotted.split(".")) {
    if (!isRecord(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** MFL error bodies: {"error": {"$t": "..."}} or {"error": "..."} — usually with HTTP 200. */
export function mflError(json: unknown): string | undefined {
  if (!isRecord(json) || !("error" in json)) return undefined;
  return text(json.error) ?? JSON.stringify(json.error).slice(0, 200);
}
