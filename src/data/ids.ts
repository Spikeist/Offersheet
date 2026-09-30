/**
 * Player ID normalization for the crosswalk sources (CLAUDE.md §2.9). Pure.
 *
 * Sources mark "no ID" in different ways, so each kind of ID is accepted only in its known format
 * instead of filtering a list of known placeholders. Seen live (2026-09-29):
 * - DynastyProcess writes "NA" for a blank cell, and 3 gsis_id cells hold a non-GSIS code.
 * - FantasyCalc /players uses "UNK" (mflId, 1224 rows), "RESERVED" (sleeperId and mflId, 4 rows) and
 *   "empty_ff_id" (fleaflickerId, 226 rows); its value rows put draft-pick keys ("FP_2027_1") in the
 *   ID fields of PICK rows.
 * - The Sleeper players DB pads 671 gsis_id values with spaces and sends espn_id/yahoo_id as numbers.
 */

/** ID kinds the crosswalk reads. */
export type IdKind = "sleeper" | "espn" | "yahoo" | "mfl" | "fleaflicker" | "sportradar" | "gsis";

const FORMATS: Record<IdKind, RegExp> = {
  // Sleeper player ids are digits; team-defense ids are team codes and are handled by teamCodes.ts.
  sleeper: /^\d+$/,
  espn: /^\d+$/,
  yahoo: /^\d+$/,
  // Leading zeros are significant (MFL team defenses are "0501" … "0532"), so ids stay strings.
  mfl: /^\d+$/,
  fleaflicker: /^\d+$/,
  sportradar: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  gsis: /^\d{2}-\d{7}$/,
};

/**
 * The canonical string form of an ID, or null when the value is blank, a placeholder, a draft-pick
 * key or otherwise not an ID of this kind. Sportradar UUIDs are lower-cased; everything is trimmed.
 */
export function normalizeId(kind: IdKind, raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  if (typeof raw === "number" && !Number.isSafeInteger(raw)) return null;
  const text = String(raw).trim();
  const value = kind === "sportradar" ? text.toLowerCase() : text;
  return FORMATS[kind].test(value) ? value : null;
}

/** True for a non-blank value that normalizeId() rejects (a placeholder such as "UNK"), for counts. */
export function isRejectedId(kind: IdKind, raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  const text = String(raw).trim();
  if (text === "" || text === "NA") return false;
  return normalizeId(kind, raw) === null;
}
