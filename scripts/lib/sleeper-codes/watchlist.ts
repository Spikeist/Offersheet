/**
 * Watch list of crawled identities (privacy audit F3). The crawl reads strangers' public leagues;
 * their league names, display names, team names and league/user/draft IDs sit only in git-ignored
 * raw captures. This module harvests them into data-local/sleeper-codes/watchlist.json (also
 * git-ignored), which `npm run check:leaks` loads, so a commit that contains any of them fails.
 * Values are never printed: callers report counts per category only.
 *
 * Left out on purpose: generic phrases ("Dynasty League", "Team 3"), our own placeholder shapes
 * ("user12", "League 4"), bare numbers, and league/team names that are one short word ("Check"):
 * they identify nobody and would only make the leak check fire on ordinary text. Display names
 * stay even when short: on Sleeper they are usernames, which anyone can look up.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../cache";

export type WatchCategory = "username" | "owner-name" | "team-name" | "league-name" | "user-id" | "league-id" | "draft-id" | "other-id";

export interface WatchEntry {
  value: string;
  category: WatchCategory;
}

/** Keys whose (string) value is an ID. */
const ID_KEYS: Record<string, WatchCategory> = {
  league_id: "league-id",
  previous_league_id: "league-id",
  copy_from_league_id: "league-id",
  cloned_from: "league-id",
  latest_cloned_to: "league-id",
  user_id: "user-id",
  owner_id: "user-id",
  creator: "user-id",
  picked_by: "user-id",
  last_author_id: "user-id",
  nominating_user_id: "user-id",
  offering_user_id: "user-id",
  promo_commish: "user-id",
  draft_id: "draft-id",
  avatar: "other-id",
  last_author_avatar: "other-id",
};
/** Keys holding a list of IDs. */
const ID_LIST_KEYS: Record<string, WatchCategory> = { co_owners: "user-id", creators: "user-id" };
/** Keys holding an object keyed by user ID. */
const ID_MAP_KEYS: Record<string, WatchCategory> = { draft_order: "user-id" };
/** Keys holding a name someone chose. */
const NAME_KEYS: Record<string, WatchCategory> = {
  display_name: "username",
  username: "username",
  last_author_display_name: "username",
  team_name: "team-name",
};

const NAME_CATEGORIES = new Set<WatchCategory>(["username", "owner-name", "team-name", "league-name"]);

/** Words that make up generic league/team names; a name made only of these identifies nobody. */
const GENERIC_WORDS = new Set(
  (
    "a an and at by for from in of on or our my the to your us we " +
    "fantasy football league leagues ff ffl fl nfl sleeper official public private test mock draft drafts " +
    "dynasty keeper keepers redraft best ball bestball guillotine chopped chop devy superflex sf 2qb qb idp te tep " +
    "ppr half full standard std premium points point scoring " +
    "team teams club crew squad family friends work office boys guys gang group " +
    "champion champions championship champs bowl super cup trophy title " +
    "year season week new old home away east west north south division conference " +
    "commissioner commish sys system bot admin owner user player players manager managers " +
    // Fantasy/football vocabulary that also appears in the probe's own report text.
    "playoff playoffs consolation bracket seed seeds bye byes median winner winners loser losers toilet sacko " +
    "trade trades trading waiver waivers roster rosters bench lineup lineups starter starters reserve taxi rookie rookies veteran veterans pick picks " +
    "touchdown touchdowns fumble fumbles interception interceptions quarterback quarterbacks receiver receivers running back backs tight end kicker defense " +
    "score scores win wins loss losses tie ties game games match matchup matchups round rounds final finals"
  ).split(/\s+/),
);

function tokens(v: string): string[] {
  return v
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Only generic words, numbers and years ("2026 Fantasy Football League", "Team 3"). */
export function isGenericName(v: string): boolean {
  return tokens(v).every((t) => GENERIC_WORDS.has(t) || /^\d+$/.test(t) || /^\d+(st|nd|rd|th)$/.test(t));
}

/** Shapes our sanitizers use as placeholders ("user12", "Team 3", "League 4", "T7", "[text 2]"). */
export function looksLikePlaceholder(v: string): boolean {
  return /^(user|owner|team|league|name|first|last|draft|player|custom player)\s*\d+$/i.test(v) || /^T\d+$/.test(v) || /^\[text \d+\]$/.test(v);
}

/** Whether a value is worth watching (see the module comment for what is left out). */
export function isWatchable(v: string, category: WatchCategory): boolean {
  if (category === "league-id" || category === "user-id" || category === "draft-id") return /^\d{5,}$/.test(v) && !/^0+$/.test(v);
  if (category === "other-id") return /^[0-9A-Za-z]{16,}$/.test(v) || /^https?:\/\/\S{8,}$/.test(v);
  if (!NAME_CATEGORIES.has(category)) return false;
  if (v.length < 3 || /^\d+$/.test(v) || isGenericName(v) || looksLikePlaceholder(v)) return false;
  const oneShortWord = v.length < 8 && /^\p{L}+$/u.test(v);
  return !(oneShortWord && (category === "league-name" || category === "team-name"));
}

/** Every identity in one Sleeper API response (league lists, users, drafts, rosters, picks, transactions…). */
export function harvestIdentities(json: unknown): WatchEntry[] {
  const out = new Map<string, WatchEntry>();
  const add = (raw: unknown, category: WatchCategory) => {
    const value = typeof raw === "number" && Number.isSafeInteger(raw) ? String(raw) : raw;
    if (typeof value !== "string") return;
    const v = value.trim();
    if (isWatchable(v, category)) out.set(`${category}\u0000${v}`, { value: v, category });
  };
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const x of node) visit(x);
      return;
    }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    // A league object names the league; a draft's metadata.name is the draft (usually league) name.
    if ("league_id" in o && typeof o.name === "string") add(o.name, "league-name");
    if ("draft_id" in o && o.metadata && typeof o.metadata === "object") add((o.metadata as Record<string, unknown>).name, "league-name");
    for (const [k, v] of Object.entries(o)) {
      const idCat = ID_KEYS[k];
      if (idCat) add(v, idCat);
      const listCat = ID_LIST_KEYS[k];
      if (listCat && Array.isArray(v)) for (const x of v) add(x, listCat);
      const mapCat = ID_MAP_KEYS[k];
      if (mapCat && v && typeof v === "object" && !Array.isArray(v)) for (const key of Object.keys(v)) add(key, mapCat);
      const nameCat = NAME_KEYS[k];
      if (nameCat) add(v, nameCat);
      if (v && typeof v === "object") visit(v);
    }
  };
  visit(json);
  return [...out.values()];
}

/** Union by (category, value), in a stable order. */
export function mergeWatchEntries(...lists: ReadonlyArray<readonly WatchEntry[]>): WatchEntry[] {
  const out = new Map<string, WatchEntry>();
  for (const list of lists) for (const e of list) out.set(`${e.category}\u0000${e.value}`, e);
  return [...out.values()].sort((a, b) => a.category.localeCompare(b.category) || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

export function countByCategory(entries: readonly WatchEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) out[e.category] = (out[e.category] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Harvest every JSON capture in a raw-fixture folder (skipping index/map/watch files). */
export async function harvestFolder(dir: string): Promise<{ files: number; entries: WatchEntry[] }> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".json") && !["index.json", "redaction-map.json", "watchlist.json"].includes(n));
  const lists: WatchEntry[][] = [];
  for (const n of names) {
    try {
      lists.push(harvestIdentities(JSON.parse(await readFile(path.join(dir, n), "utf8")) as unknown));
    } catch {
      // not JSON (or being rewritten by another process): skip
    }
  }
  return { files: names.length, entries: mergeWatchEntries(...lists) };
}

/** Values already covered by a redaction map (check:leaks loads those too), to keep the list lean. */
export async function redactedValues(mapFile: string): Promise<Set<string>> {
  try {
    const entries = JSON.parse(await readFile(mapFile, "utf8")) as Array<{ raw?: unknown }>;
    return new Set(entries.map((e) => e.raw).filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

/**
 * Merge with the existing (cumulative) watch list and write it. The current rules are applied to
 * the older entries too, so a tightened rule also cleans them. Returns counts only.
 */
export async function writeWatchlist(
  file: string,
  fresh: readonly WatchEntry[],
  skip: ReadonlySet<string> = new Set(),
): Promise<{ total: number; added: number; dropped: number; byCategory: Record<string, number> }> {
  let stored: WatchEntry[] = [];
  try {
    stored = (JSON.parse(await readFile(file, "utf8")) as WatchEntry[]).filter((e) => typeof e?.value === "string" && typeof e?.category === "string");
  } catch {
    // first run
  }
  const existing = stored.filter((e) => isWatchable(e.value, e.category));
  const before = new Set(existing.map((e) => `${e.category}\u0000${e.value}`));
  const merged = mergeWatchEntries(
    existing,
    fresh.filter((e) => !skip.has(e.value)),
  );
  await writeFileAtomic(file, JSON.stringify(merged, null, 1));
  return {
    total: merged.length,
    added: merged.filter((e) => !before.has(`${e.category}\u0000${e.value}`)).length,
    dropped: stored.length - existing.length,
    byCategory: countByCategory(merged),
  };
}
