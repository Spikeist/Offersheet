/**
 * Watch list of strangers' identities seen while discovering public leagues (league lists, member
 * lists, rosters) that are never sanitized into fixtures. Saved to fixtures/raw/sleeper/watchlist.json
 * (git-ignored) as [{ value, category }]; `npm run check:leaks` loads it so no committed file can
 * carry one of them. Its contents are never printed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "../cache";
import { RAW_DIR } from "../fixtures";

export type WatchCategory = "username" | "owner-name" | "team-name" | "league-name" | "user-id" | "league-id" | "draft-id" | "other-id";

export const WATCHLIST_FILE = path.join(RAW_DIR, "sleeper", "watchlist.json");

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const NAME_CATEGORIES: ReadonlySet<string> = new Set(["owner-name", "team-name", "league-name"]);

/**
 * Whether a value is worth watching. A single short word used as a name ("home", "Bros") identifies
 * nobody and would only flood check:leaks with soft hits on ordinary text, so names need 5+
 * characters or more than one word/a digit. IDs and usernames are always kept.
 */
export function isUsefulWatchValue(value: string, category: string): boolean {
  const v = value.trim();
  if (!v || v === "0") return false;
  if (NAME_CATEGORIES.has(category)) return !(v.length < 5 && /^\p{L}+$/u.test(v));
  return true;
}

export class Watchlist {
  private readonly entries = new Map<string, { value: string; category: WatchCategory }>();

  constructor(private readonly file: string = WATCHLIST_FILE) {}

  get size(): number {
    return this.entries.size;
  }

  add(value: unknown, category: WatchCategory): void {
    if (typeof value !== "string" && typeof value !== "number") return;
    const v = String(value).trim();
    if (!isUsefulWatchValue(v, category)) return;
    this.entries.set(`${category}\u0000${v}`, { value: v, category });
  }

  /** A league object (e.g. an entry of /user/{id}/leagues or /league/{id}). */
  addLeague(l: unknown): void {
    if (!isRecord(l)) return;
    this.add(l.league_id, "league-id");
    this.add(l.previous_league_id, "league-id");
    this.add(l.draft_id, "draft-id");
    this.add(l.name, "league-name");
    this.add(l.last_author_id, "user-id");
    // Sleeper's own bot often posts last; its display name is a product word, not a person.
    if (l.last_author_is_bot !== true) this.add(l.last_author_display_name, "owner-name");
    for (const k of ["last_message_id", "last_read_id", "last_pinned_message_id", "last_transaction_id", "bracket_id", "loser_bracket_id", "group_id"]) this.add(l[k], "other-id");
    const md = isRecord(l.metadata) ? l.metadata : {};
    for (const [k, v] of Object.entries(md)) if (/^division_\d+$/.test(k)) this.add(v, "team-name");
  }

  /** League members (/league/{id}/users) or a /user lookup. */
  addUser(u: unknown): void {
    if (!isRecord(u)) return;
    this.add(u.user_id, "user-id");
    this.add(u.username, "username");
    this.add(u.display_name, "owner-name");
    const md = isRecord(u.metadata) ? u.metadata : {};
    this.add(md.team_name, "team-name");
  }

  /** Roster owners and co-owners (/league/{id}/rosters). */
  addRoster(r: unknown): void {
    if (!isRecord(r)) return;
    this.add(r.owner_id, "user-id");
    if (Array.isArray(r.co_owners)) for (const c of r.co_owners) this.add(c, "user-id");
  }

  /** Merge with the saved list (entries are only ever added, except ones isUsefulWatchValue now rejects) and write it back. */
  async save(): Promise<number> {
    let existing: Array<{ value?: unknown; category?: unknown }> = [];
    try {
      existing = JSON.parse(readFileSync(this.file, "utf8")) as typeof existing;
    } catch {
      // first run
    }
    const merged = new Map<string, { value: string; category: string }>();
    for (const e of existing) if (typeof e.value === "string" && typeof e.category === "string" && isUsefulWatchValue(e.value, e.category)) merged.set(`${e.category}\u0000${e.value}`, { value: e.value, category: e.category });
    for (const [k, e] of this.entries) merged.set(k, e);
    await writeFileAtomic(this.file, JSON.stringify([...merged.values()], null, 1));
    return merged.size;
  }
}
