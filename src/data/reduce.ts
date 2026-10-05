/**
 * Fetch-time reducers (planner reply to Checkpoint 4c, Part B, B1: the shared cache; track CA): the big league-independent
 * bodies keep only what our code reads, before they're parsed or cached (HttpRequestOptions.transformText), so the shared
 * cache (Upstash) holds and sends several times less and every read parses less. League bodies (ESPN's, Sleeper's league
 * data) are never reduced: only league-independent data, the same for every user.
 *
 * The rule: a reduced body must give every consumer exactly what the raw body gives it. So a reducer
 * - recognizes its body first, with the consumers' own schema, parsed the way they parse it (Sleeper's lists with
 *   bigIntsAsStrings): any text it doesn't recognize (an error, an HTML page, a changed shape, a row the consumers would
 *   skip) comes back unchanged, so their errors and warnings stay word for word;
 * - keeps every field some consumer reads, as it came (null and absent stay apart), and drops a row only when every
 *   consumer skips it the same way it skips a missing one, never all of them (a non-empty list is cached; an empty one
 *   isn't: projectionsPolicy's cacheIf);
 * - hands back the raw text when a number it keeps wouldn't read back the same in either parse mode (an integer of 16+
 *   digits, -0, or an exponent past a double's range that JSON.parse reads as Infinity and JSON.stringify writes as
 *   null: jsonSafeNumbers).
 * Each reducer's consumers are listed where it's defined; tests run each consumer on raw and reduced bodies and compare
 * (src/data/reduce.test.ts on the committed samples; `npm run measure:cache` on every full-size body in .cache/app).
 *
 * Versions: a reduced body is filed under its own cache key, the request's key plus "#" + the reducer's id (reducedKey),
 * "<name>-r<version>-<fingerprint>" (reducerId), so no copy of the code (the stable copy shares this computer's cache
 * folder; preview deployments share one Redis) reads a shape it doesn't expect. The fingerprint follows the lists that
 * name what a reducer keeps (its fields, its columns: a schema gaining a field, which the players lists follow by
 * themselves, files the new form under a new key with no one remembering to; review CA-7); bump the version whenever the
 * reducer's code changes what it keeps in any other way.
 *
 * Where they're used: Sleeper's weekly projections (two forms: the model's loader and the Sleeper import read different
 * parts), season projections and weekly stats here; the Sleeper players lists (src/data/sleeperPlayers.ts) and the
 * DynastyProcess ID map (src/data/dynastyProcess.ts) next to their schemas. ⚠️ Not reduced, on purpose: FantasyCalc's
 * lists and /players (a new key would let the stable copy and the development copy each fetch them, and FantasyCalc's
 * terms ask for one fetch a day per format), and ESPN's NFL schedule (its cache entry is shared with the ESPN import,
 * whose request this track doesn't own; ~6 KB a read to gain).
 */
import { quoteBigInts } from "@/adapters/httpShared";
import { hasProjection } from "@/adapters/sleeper/normalize";
import { StatRowSchema } from "@/adapters/sleeper/schemas";

/** A fetch-time reducer (see the header). */
export interface BodyReducer {
  /** Names the reduced form, its version and what it keeps (reducerId: "sleeper-proj-model-r1-1a2b3c4d"): the cache key's suffix (reducedKey). */
  readonly id: string;
  /** The reduced text, or the text unchanged when it isn't a body this reducer recognizes (HttpRequestOptions.transformText). */
  readonly reduce: (text: string) => string;
}

/** The cache key a reduced body is filed under: the request's own key plus "#" + the reducer's id (see the header). */
export function reducedKey(key: string, reducer: BodyReducer): string {
  return `${key}#${reducer.id}`;
}

/** A reducer id's shape (reducerId), as it ends a reduced body's cache key. */
export const REDUCER_ID = /^[a-z][a-z0-9-]*-r\d+-[0-9a-f]{8}$/;

/** 32-bit FNV-1a of a text's UTF-16 code units, as 8 hex digits: a fingerprint (not a secret; no node: import, so it runs anywhere). */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * A reducer's id (see the header): "<name>-r<version>-<fingerprint of `kept`>", where `kept` lists what the reducer keeps
 * (field names, columns; data, never a function's text, which a bundler may rewrite). A change to those lists changes the
 * id, and so the cache key, by itself; bump `version` for any other change to what the reducer keeps.
 */
export function reducerId(name: string, version: number, kept: ReadonlyArray<ReadonlyArray<string>>): string {
  return `${name}-r${version}-${fingerprint(JSON.stringify(kept))}`;
}

/**
 * True when every number in `value` reads back the same from JSON text in both parse modes (plain, and with
 * bigIntsAsStrings): finite (JSON writes Infinity as null; JSON.parse reads an exponent past a double's range as
 * Infinity, review CA-6), no integer of 16+ digits (quoteBigInts would turn it into a string) and no -0 (JSON writes 0).
 */
export function jsonSafeNumbers(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0) && !(Number.isInteger(value) && Math.abs(value) >= 1e15);
  if (Array.isArray(value)) return value.every(jsonSafeNumbers);
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) if (!jsonSafeNumbers(v)) return false;
  }
  return true;
}

/**
 * A reducer of JSON bodies: parses the text as its consumers do (`bigInts`: as with bigIntsAsStrings), hands it to
 * `reduceJson`, and writes what that returns; the text comes back unchanged when it isn't JSON, when `reduceJson` returns
 * undefined (not a body it recognizes) or throws, or when a kept number wouldn't read back the same (jsonSafeNumbers).
 */
export function jsonReducer(id: string, reduceJson: (json: unknown) => unknown, opts: { bigInts?: boolean } = {}): BodyReducer {
  return {
    id,
    reduce(text: string): string {
      const head = text.trimStart();
      if (!(head.startsWith("{") || head.startsWith("["))) return text;
      let json: unknown;
      try {
        json = JSON.parse(opts.bigInts ? quoteBigInts(text) : text);
      } catch {
        return text;
      }
      let out: unknown;
      try {
        out = reduceJson(json);
      } catch {
        return text;
      }
      if (out === undefined || !jsonSafeNumbers(out)) return text;
      return JSON.stringify(out);
    },
  };
}

/** `obj`'s own properties named in `keys`, in that order, as they are (null and absent stay apart). */
export function pickKeys(obj: object, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (Object.hasOwn(obj, k)) out[k] = (obj as Record<string, unknown>)[k];
  return out;
}

/** The number-valued entries of a stats object (every consumer ignores the rest), less the keys `drop` names. */
export function numericEntries(stats: unknown, drop?: (key: string) => boolean): Record<string, number> {
  const out: Record<string, number> = {};
  if (!stats || typeof stats !== "object") return out;
  for (const [k, v] of Object.entries(stats)) if (typeof v === "number" && !(drop && drop(k))) out[k] = v;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Sleeper's projections and stats (/projections/nfl/…, /stats/nfl/…: lists of stat rows)

type RawRow = Record<string, unknown>;

/**
 * A list every row of which fits StatRowSchema (parseArrayLenient would skip none), else undefined: a row the consumers
 * skip is counted and named in their warning by its index, so such a body stays as it is. An empty list too.
 */
function statRows(json: unknown): RawRow[] | undefined {
  if (!Array.isArray(json) || json.length === 0) return undefined;
  for (const row of json) if (!StatRowSchema.safeParse(row).success) return undefined;
  return json as RawRow[];
}

/** A row's `player` as `keys` of it: absent stays absent, null stays null. */
function playerOf(row: RawRow, keys: readonly string[]): { player?: unknown } {
  if (!Object.hasOwn(row, "player")) return {};
  const p = row.player;
  return { player: p && typeof p === "object" ? pickKeys(p, keys) : p };
}

/** The stand-in row of a list whose rows were all dropped: the first row's id alone, a row every consumer skips (no stats). */
function standIn(rows: readonly RawRow[]): RawRow[] {
  return [{ player_id: (rows[0] as RawRow).player_id }];
}

/** The player fields the model's loader and the pre-game archive read (sleeperPositionOf, projectionArchive rowGroups). */
export const MODEL_PLAYER_FIELDS = ["position", "fantasy_positions"] as const;

/**
 * Sleeper's weekly projections as the model build reads them (src/data/sleeperProjections.ts loadSleeperWeeklyProjections).
 * Consumers: projectionLines (each player's first real row: hasProjection, sleeperPositionOf, normalizeProjectionStats),
 * the row check's count and first path (parseArrayLenient), and the pre-game archive through the loader's onWeek hook
 * (src/server/projectionArchive.ts: archivedGroups reads real rows' stats and player positions, lastModifiedById every raw
 * row's last_modified). Kept: the real rows (hasProjection), in order, with player_id, their numeric stats, player
 * position and fantasy_positions, and last_modified as the latest any row of that player carried (the archive's
 * lastModifiedById, which takes the latest per player over all rows). Dropped: stub rows (every consumer skips them, a
 * missing row the same way) and every other field (no consumer reads them). A week with no real row keeps one stand-in
 * row, so it is cached as before.
 */
export const MODEL_PROJECTIONS_REDUCER = jsonReducer(
  reducerId("sleeper-proj-model", 1, [MODEL_PLAYER_FIELDS]),
  (json) => {
    const rows = statRows(json);
    if (!rows) return undefined;
    const latest = new Map<string, number>();
    for (const r of rows) {
      const at = r.last_modified;
      if (typeof at !== "number" || !Number.isFinite(at)) continue;
      const id = String(r.player_id);
      latest.set(id, Math.max(latest.get(id) ?? at, at));
    }
    const out: RawRow[] = [];
    for (const r of rows) {
      if (!hasProjection(r.stats as Record<string, unknown> | null | undefined)) continue;
      const at = latest.get(String(r.player_id));
      out.push({ player_id: r.player_id, stats: numericEntries(r.stats), ...playerOf(r, MODEL_PLAYER_FIELDS), ...(at !== undefined ? { last_modified: at } : {}) });
    }
    return out.length ? out : standIn(rows);
  },
  { bigInts: true },
);

/** The player fields the Sleeper import reads from a projection row (StatRowSchema's `player`; reduce.test.ts pins the two together). */
export const IMPORT_PLAYER_FIELDS = ["position", "fantasy_positions", "team", "first_name", "last_name", "injury_status", "years_exp"] as const;

/**
 * Sleeper's weekly projections as the Sleeper import reads them (src/adapters/sleeper/fetch.ts: this week and the next two;
 * src/adapters/sleeper/normalize.ts). Consumers: the row check (parseArrayLenient), each player's first row with a player
 * object across the weeks (his team and injury status, or his whole facts: lookupPlayer, liteFromRow, withRowFacts; stub
 * rows included: an injured player's row is a stub), the free-agent ranking (real rows' stats: hasProjection,
 * normalizeProjectionStats) and which weeks hold a real projection. Kept: every row with a player object, in order, with
 * player_id, the player object's schema fields as they came, and real rows' numeric stats; a stub row without a player
 * object is dropped (nothing reads it; never all of them). A stub's stats are dropped: every consumer reads them only to
 * see it's a stub.
 */
export const IMPORT_PROJECTIONS_REDUCER = jsonReducer(
  reducerId("sleeper-proj-import", 1, [IMPORT_PLAYER_FIELDS]),
  (json) => {
    const rows = statRows(json);
    if (!rows) return undefined;
    const out: RawRow[] = [];
    for (const r of rows) {
      const real = hasProjection(r.stats as Record<string, unknown> | null | undefined);
      if (!real && !r.player) continue;
      out.push({ player_id: r.player_id, ...(real ? { stats: numericEntries(r.stats) } : {}), ...playerOf(r, IMPORT_PLAYER_FIELDS) });
    }
    return out.length ? out : standIn(rows);
  },
  { bigInts: true },
);

/** Stat keys seasonPerGameLine drops from a season row (gp, and ADP keys by this pattern), which normalizeProjectionStats never reads either. */
const SEASON_DROPPED_KEYS = ["gp"] as const;
const SEASON_DROPPED_PATTERN = /^(pos_)?adp_/;
const SEASON_DROPPED_STAT = (key: string): boolean => (SEASON_DROPPED_KEYS as readonly string[]).includes(key) || SEASON_DROPPED_PATTERN.test(key);

/** The player field the season loader reads (sleeperPositionOf). */
const SEASON_PLAYER_FIELDS = ["position"] as const;

/**
 * Sleeper's season projections (src/data/sleeperProjections.ts loadSleeperSeasonProjections). Consumers: the row check and
 * seasonPerGameLines (each player's first real row: hasProjection, sleeperPositionOf, normalizeProjectionStats, then gp
 * and ADP keys dropped). Kept: real rows, in order, with player_id, numeric stats less gp and ADP keys, and the player's
 * position. A list with no real row keeps one stand-in row.
 */
export const SEASON_PROJECTIONS_REDUCER = jsonReducer(
  reducerId("sleeper-season", 1, [SEASON_PLAYER_FIELDS, [...SEASON_DROPPED_KEYS, SEASON_DROPPED_PATTERN.source]]),
  (json) => {
    const rows = statRows(json);
    if (!rows) return undefined;
    const out = rows
      .filter((r) => hasProjection(r.stats as Record<string, unknown> | null | undefined))
      .map((r) => ({ player_id: r.player_id, stats: numericEntries(r.stats, SEASON_DROPPED_STAT), ...playerOf(r, SEASON_PLAYER_FIELDS) }));
    return out.length ? out : standIn(rows);
  },
  { bigInts: true },
);

/**
 * Sleeper's weekly stats (src/data/sleeperProjections.ts loadSleeperStats). Consumers: the row check and playedStatLines
 * (each player's first row with gp > 0, its numeric stats). Kept: the rows with gp > 0, in order, with player_id and
 * numeric stats (a row without a game never counts and never blocks a later one, so dropping it is the same). A week
 * with no game keeps one stand-in row.
 */
export const STATS_REDUCER = jsonReducer(
  reducerId("sleeper-stats", 1, []),
  (json) => {
    const rows = statRows(json);
    if (!rows) return undefined;
    const out: RawRow[] = [];
    for (const r of rows) {
      const stats = numericEntries(r.stats);
      if ((stats.gp ?? 0) > 0) out.push({ player_id: r.player_id, stats });
    }
    return out.length ? out : standIn(rows);
  },
  { bigInts: true },
);
