/**
 * Watch list for the leak checker (scripts/check-leaks.ts): identities of strangers' public leagues
 * that the probe screens or reads but never sanitizes into fixtures (candidate and rule-coverage
 * leagues). Saved git-ignored at fixtures/raw/fleaflicker/watchlist.json as [{ value, category }],
 * merged across runs, never printed.
 *
 * Left out on purpose (only counts are reported), because as leak-check needles they would fire on
 * ordinary text in every unit's reports and code:
 * - numeric ids shorter than 6 digits (they collide with player ids and other platforms' ids);
 * - names shaped like an ordinary word: one word of letters only, at most an initial capital (a
 *   display name can be a dictionary word). Handles with digits, underscores or inner capitals and
 *   names of several words are kept.
 * The rules are re-applied to entries saved by earlier runs.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "../cache";
import { ROOT } from "../env";
import type { FfStandings } from "./api";

export type WatchCategory = "username" | "owner-name" | "team-name" | "league-name" | "user-id" | "league-id" | "draft-id" | "other-id";
export interface WatchEntry {
  value: string;
  category: WatchCategory;
}

export const WATCHLIST_FILE = path.join(ROOT, "fixtures", "raw", "fleaflicker", "watchlist.json");

/** Our own placeholders and redaction markers: never identities. */
const PLACEHOLDER = /^(team|owner|league|division|name|user)\s*\d+$|^\[text \d+\]$|^\[redacted\]$|@example\.invalid$/i;
const MIN_ID_DIGITS = 6;
/** One word of letters with at most an initial capital: could be an ordinary word. */
const WORD_SHAPED = /^\p{L}\p{Ll}*$/u;
const NAME_CATEGORIES = new Set<WatchCategory>(["username", "owner-name", "team-name", "league-name"]);

/** Whether an entry is worth watching (see the file comment). */
export function watchable(value: string, category: WatchCategory, isPublic: (v: string) => boolean = () => false): boolean {
  const v = value.trim();
  if (!NAME_CATEGORIES.has(category)) return /^\d+$/.test(v) && v.length >= MIN_ID_DIGITS;
  return v.length >= 3 && !PLACEHOLDER.test(v) && !WORD_SHAPED.test(v) && !isPublic(v);
}

export class WatchList {
  private readonly entries = new Map<string, WatchEntry>();
  /** Numeric ids left out because they are shorter than 6 digits. */
  skippedShortIds = 0;
  /** Names left out as public data or placeholders. */
  skippedNames = 0;

  constructor(private readonly isPublic: (value: string) => boolean = () => false) {}

  get size(): number {
    return this.entries.size;
  }

  private put(value: string, category: WatchCategory): void {
    this.entries.set(`${category}\u0000${value}`, { value, category });
  }

  addId(value: unknown, category: "user-id" | "league-id" | "draft-id" | "other-id"): void {
    if (typeof value !== "number" && typeof value !== "string") return;
    const v = String(value).trim();
    if (!/^\d+$/.test(v)) return;
    if (v.length < MIN_ID_DIGITS) {
      this.skippedShortIds++;
      return;
    }
    this.put(v, category);
  }

  addName(value: unknown, category: "username" | "owner-name" | "team-name" | "league-name"): void {
    if (typeof value !== "string" || !value.trim()) return;
    const v = value.trim();
    if (!watchable(v, category, this.isPublic)) {
      this.skippedNames++;
      return;
    }
    this.put(v, category);
  }

  /** League, teams and owners in a FetchLeagueStandings response. */
  addStandings(data: FfStandings | null | undefined, leagueId: string): void {
    this.addId(leagueId, "league-id");
    if (!data) return;
    this.addId(data.league?.id, "league-id");
    this.addName(data.league?.name, "league-name");
    for (const d of data.divisions ?? []) {
      this.addId(d.id, "other-id");
      for (const t of d.teams ?? []) {
        this.addId(t.id, "other-id");
        this.addName(t.name, "team-name");
        for (const o of t.owners ?? []) {
          this.addId(o.id, "user-id");
          this.addName(o.displayName, "owner-name");
        }
      }
    }
  }

  /** Merge with the saved list and write it back (git-ignored). */
  async save(file = WATCHLIST_FILE): Promise<number> {
    let existing: WatchEntry[] = [];
    try {
      if (existsSync(file)) existing = JSON.parse(readFileSync(file, "utf8")) as WatchEntry[];
    } catch {
      existing = [];
    }
    const merged = new Map<string, WatchEntry>();
    // Current rules apply to earlier entries too (an entry that would now be skipped is dropped).
    for (const e of [...existing, ...this.entries.values()]) if (e && typeof e.value === "string" && watchable(e.value, e.category, this.isPublic)) merged.set(`${e.category}\u0000${e.value}`, { value: e.value, category: e.category });
    const list = [...merged.values()].sort((a, b) => a.category.localeCompare(b.category) || a.value.localeCompare(b.value));
    await writeFileAtomic(file, JSON.stringify(list, null, 1));
    return list.length;
  }
}
