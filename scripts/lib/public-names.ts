/**
 * Public NFL names (from the cached Sleeper players DB), used by the leak checker to discount soft
 * hits that are really part of a player's name: an owner called "Zorblax" vs a player "Zorblax Quintavious" in public
 * player data. Reads the cache only — never fetches — and returns null when it isn't cached yet.
 */
import { readCache } from "./cache";
import { SLEEPER_PLAYERS_URL, type SleeperPlayer } from "./sleeper-players";

export interface PublicNames {
  players: Set<string>;
  /**
   * NFL team cities/nicknames ("Dallas", "Cowboys") and colleges ("Georgia Tech"): a fantasy team or
   * division named like that identifies nobody.
   */
  publicWords: Set<string>;
}

/** Lowercase, accents/periods/apostrophes removed, suffixes (Jr., III…) dropped. */
export function normName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildPublicNames(db: Record<string, SleeperPlayer>): PublicNames {
  const players = new Set<string>();
  const publicWords = new Set<string>();
  for (const p of Object.values(db)) {
    const full = p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(" ");
    if (full) players.add(normName(full));
    if (p.first_name && p.last_name) players.add(normName(`${p.first_name} ${p.last_name}`));
    if (p.position === "DEF") {
      for (const w of [p.first_name, p.last_name]) if (w) publicWords.add(normName(w));
      if (p.first_name && p.last_name) publicWords.add(normName(`${p.first_name} ${p.last_name}`));
    }
    if (typeof p.college === "string" && p.college) publicWords.add(normName(p.college));
  }
  players.delete("");
  publicWords.delete("");
  return { players, publicWords };
}

export async function loadPublicNames(): Promise<PublicNames | null> {
  const hit = await readCache<{ text: string }>("sleeper-players", `sleeper:${SLEEPER_PLAYERS_URL}`, Number.POSITIVE_INFINITY);
  if (!hit) return null;
  try {
    return buildPublicNames(JSON.parse(hit.value.text) as Record<string, SleeperPlayer>);
  } catch {
    return null;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function wordRegExp(value: string, flags = "u"): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(value)}(?![\\p{L}\\p{N}])`, flags);
}

/** "Zorblax Quintavious", "Quintavious, Zorblax" (Fantrax/MFL) and "D'Varnox Blerp" all count as player names. */
export function isPlayerName(s: string, names: PublicNames): boolean {
  if (names.players.has(normName(s))) return true;
  const lastFirst = /^(.+?),\s*(.+)$/.exec(s);
  return !!lastFirst && names.players.has(normName(`${lastFirst[2]} ${lastFirst[1]}`));
}

/** Name fields of an object that describe a player (never owner fields such as displayName). */
function playerNamesOf(o: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of ["full_name", "fullName", "name", "nameFull", "player_name", "playerName"]) {
    const v = o[k];
    if (typeof v === "string") out.push(v);
  }
  const first = o.first_name ?? o.firstName ?? o.nameFirst;
  const last = o.last_name ?? o.lastName ?? o.nameLast;
  if (typeof first === "string" && typeof last === "string") out.push(`${first} ${last}`);
  return out;
}

/**
 * Count whole-word occurrences of `value` in a parsed JSON document (string values and keys),
 * skipping those that are part of a public player's name: the string is itself a player's name,
 * or it sits in an object whose own name fields name a player containing the word
 * ({"first_name": "Zorblax", "last_name": "Quintavious"}).
 */
export function countOutsidePlayerNames(json: unknown, value: string, names: PublicNames): number {
  const word = wordRegExp(value);
  const wordAll = wordRegExp(value, "gu");
  let count = 0;
  const walk = (v: unknown, parent: Record<string, unknown> | null): void => {
    if (typeof v === "string") {
      if (!v.includes(value) || !word.test(v)) return;
      if (isPlayerName(v, names)) return;
      if (parent && playerNamesOf(parent).some((n) => word.test(n) && isPlayerName(n, names))) return;
      // Free text such as "Zorblax Quintavious: 320.76" or "Quintavious, Zorblax (WR)": check each occurrence's neighbours.
      for (const m of v.matchAll(wordAll)) if (!inPlayerName(v, m.index ?? 0, value, names)) count++;
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x, parent);
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const [k, x] of Object.entries(o)) {
        if (k.includes(value) && word.test(k) && !isPlayerName(k, names)) count++;
        walk(x, o);
      }
    }
  };
  walk(json, null);
  return count;
}

/** For non-JSON text a quoted player name must be close by (e.g. a TS test literal). */
const QUOTED_WINDOW = 300;

/** True when the occurrence of `value` at `index` in plain text (Markdown, CSV, code) is part of a public NFL player's name. */
export function inPlayerName(text: string, index: number, value: string, names: PublicNames): boolean {
  const v = normName(value);
  if (!v) return false;
  // 1) A quoted string nearby is a player's full name containing the word, using the same word
  //    boundaries as the leak scan ("Varnox" inside "D'Varnox Blerp").
  const word = wordRegExp(value);
  const window = text.slice(Math.max(0, index - QUOTED_WINDOW), Math.min(text.length, index + value.length + QUOTED_WINDOW));
  for (const m of window.matchAll(/"([^"\\\r\n]{3,80})"/g)) {
    const raw = m[1] ?? "";
    if (normName(raw) !== v && word.test(raw) && isPlayerName(raw, names)) return true;
  }
  // 2) Neighbouring words form a player's name (Markdown, CSV, "Last, First" lists). The hit is
  //    widened to its whole token first, so "Varnox" inside "D'Varnox" is judged as "D'Varnox".
  const tokenChar = /[\p{L}\p{N}.'’-]/u;
  let start = index;
  let end = index + value.length;
  while (start > 0 && tokenChar.test(text[start - 1] ?? "")) start--;
  while (end < text.length && tokenChar.test(text[end] ?? "")) end++;
  const token = text.slice(start, end);
  const words = (s: string) => s.split(/[^\p{L}\p{N}.'’-]+/u).filter(Boolean);
  const before = words(text.slice(Math.max(0, start - 60), start));
  const after = words(text.slice(end, end + 60));
  const [b1, b2, a1, a2] = [before.at(-1), before.at(-2), after[0], after[1]];
  const candidates = [token, value].flatMap((w) => [
    [w, a1],
    [b1, w],
    [w, b1],
    [a1, w],
    [b2, b1, w],
    [b1, w, a1],
    [w, a1, a2],
  ]);
  return candidates.some((c) => c.every(Boolean) && names.players.has(normName(c.join(" "))));
}
