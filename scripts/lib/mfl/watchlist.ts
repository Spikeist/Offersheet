/**
 * Git-ignored watch list for check:leaks (privacy audit F3): identities of strangers' leagues this
 * probe looked at but never sanitizes into fixtures (leagueSearch candidates). Format read by
 * scripts/check-leaks.ts: [{ "value": "...", "category": "league-id" | "league-name" | … }].
 *
 * Only leagues whose data was actually requested go here, not every search hit: thousands of
 * 5-digit league IDs would collide with MFL player IDs (4–5 digits) and generic league names
 * ("Dynasty League") would become hard needles everywhere. Never print this file.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../cache";
import { RAW_DIR } from "./search";

export const WATCHLIST_FILE = path.join(RAW_DIR, "watchlist.json");

export type WatchCategory = "username" | "owner-name" | "team-name" | "league-name" | "user-id" | "league-id" | "draft-id" | "other-id";

export interface WatchEntry {
  value: string;
  category: WatchCategory;
}

/** Merge entries into the watch list (deduplicated). Returns how many were new. */
export async function addToWatchlist(entries: Array<{ value: string | undefined; category: WatchCategory }>, file = WATCHLIST_FILE): Promise<number> {
  let list: WatchEntry[] = [];
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (Array.isArray(parsed)) list = parsed.filter((e): e is WatchEntry => typeof e?.value === "string" && typeof e?.category === "string");
  } catch {
    // first run
  }
  const seen = new Set(list.map((e) => `${e.category}\u0000${e.value}`));
  let added = 0;
  for (const e of entries) {
    const value = e.value?.trim();
    if (!value) continue;
    const k = `${e.category}\u0000${value}`;
    if (seen.has(k)) continue;
    seen.add(k);
    list.push({ value, category: e.category });
    added++;
  }
  if (added) await writeFileAtomic(file, JSON.stringify(list, null, 1));
  return added;
}
