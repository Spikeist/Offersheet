/**
 * FantasyCalc market values (CLAUDE.md §2.9, §9, §2.10). Server-side.
 *
 * GET https://api.fantasycalc.com/values/current?isDynasty=…&numQbs=…&numTeams=…&ppr=…[&tep=…], a
 * documented endpoint, fetched at most once a day per format (24 h cache; FantasyCalc's docs allow
 * hourly and its terms ask for server-side caching, "ideally once per day"). Non-commercial use only,
 * and wherever values show, a visible "Values: FantasyCalc" link (§2.9; the UI's job).
 *
 * - One cache key per format: the parameters always go in the same order (fantasyCalcValuesUrl).
 * - getPublicSource: only a body that passes the check (shape and row floor) is cached, a saved copy
 *   stands in for up to 7 days when FantasyCalc fails (the load says `stale`), and a fresh saved copy
 *   that fails the check is fetched again once. A failure throws LeagueImportError.
 * - Row floors (review HTTP-1): 196–198 players in every redraft format and 395–396 in dynasty
 *   (Phase 0); fewer than 150 / 300 is a broken or partial answer.
 * - Draft picks (position PICK, dynasty only: "2027 1st (Early)" …) are kept apart from player values
 *   (`picks`, by name; their id fields hold pick keys such as FP_2027_1, never player ids).
 *
 * Which number (Phase 2 reader, re-analysis of the Phase 0 captures; ⚠️ inferred from equalities):
 * `value` is the value in the REQUESTED format, while `redraftValue` is FantasyCalc's baseline redraft
 * number (same numQbs, 12 teams, PPR, no TE premium) whatever format is asked for, off by up to 3% at
 * QB and TE in Parker's format. So a league always uses `value` from a request in its own format:
 * redraft → isDynasty=false; dynasty → isDynasty=true; keeper → both, dynasty `value` for the future
 * term (MarketInputs.values) and redraft `value` for perception (MarketInputs.redraftValues) (§9).
 *
 * Joining to canonical ids (§4): a Sleeper id (the canonical id when known) joins on the row's
 * sleeperId, which FantasyCalc gives on every row. A platform id (`espn:<id>`, `mfl:<id>`,
 * `fleaflicker:<id>`; players the crosswalk couldn't map) joins on that platform's id only when the
 * name (crosswalk.playerNameKey) and position agree too: FantasyCalc had a namesake's or another
 * player's ESPN id on 8 of 1,761 players (Phase 0 XWALK.sleeperVsOthers). ⚠️ A namesake at the same
 * position still passes that check.
 *
 * src/server/modelInputs.ts loads a league's formats here (one request at a time, each failure a
 * warning; a keeper league's lists each on their own, review DATA-2) and joins them to its players with
 * the pure marketInputsFrom.
 */
import { z } from "zod";
import { LeagueImportError, type HttpClient, type HttpResponse } from "@/adapters/types";
import type { FantasyCalcFormat, MarketInputs } from "@/engine/inputs";
import type { PlayerInfo, Pos } from "@/engine/model";
import { TTL } from "@/server/cache";
import { playerNameKey } from "./crosswalk";
import type { FantasyCalcPlayerIds } from "./fantasyCalcPlayers";
import { normalizeId } from "./ids";
import { checkedJson, getPublicSource, sourceError, tooFewRows, type PublicSourceResult } from "./source";
import { cleanTeamCode } from "./teamCodes";

export const FANTASYCALC_VALUES_URL = "https://api.fantasycalc.com/values/current";

/** Player-row floors (review HTTP-1; Phase 0: redraft 196–198 players, dynasty 395–396). */
export const FANTASYCALC_REDRAFT_MIN_PLAYERS = 150;
export const FANTASYCALC_DYNASTY_MIN_PLAYERS = 300;

/** Bodies are 150–330 KB; one retry. */
export const FANTASYCALC_VALUES_TIMEOUT_MS = 30_000;
export const FANTASYCALC_VALUES_MAX_RETRIES = 1;

/** The request parameters of a format (FantasyCalcFormat.substitutions only explains them). */
export type FantasyCalcRequest = Pick<FantasyCalcFormat, "isDynasty" | "numQbs" | "numTeams" | "ppr" | "tep">;

/**
 * The values URL for a format, parameters in a fixed order (one cache key per format), encoded by
 * URLSearchParams: te+ is sent as tep=te%2B (a literal "+" would read as a space). tep is left out
 * when the league has no TE premium (FantasyCalc's default is none).
 */
export function fantasyCalcValuesUrl(f: FantasyCalcRequest): string {
  const q = new URLSearchParams({ isDynasty: String(f.isDynasty), numQbs: String(f.numQbs), numTeams: String(f.numTeams), ppr: String(f.ppr) });
  if (f.tep) q.set("tep", f.tep);
  return `${FANTASYCALC_VALUES_URL}?${q.toString()}`;
}

/**
 * The formats a league requests (§9): `values` in its own list (redraft → the redraft list, dynasty and
 * keeper → the dynasty list), plus the redraft list for keeper leagues (perception).
 * src/server/modelInputs.ts marketFormats builds them with src/engine/market.ts fantasyCalcFormat.
 */
export interface MarketFormats {
  values: FantasyCalcFormat;
  redraft?: FantasyCalcFormat;
}

const idLike = z.union([z.string(), z.number()]).nullish().catch(null);

const valueRowSchema = z.object({
  player: z.object({
    id: z.union([z.number(), z.string()]),
    name: z.string(),
    position: z.string(),
    sleeperId: idLike,
    espnId: idLike,
    mflId: idLike,
    fleaflickerId: idLike,
    maybeTeam: z.string().nullish().catch(null),
  }),
  value: z.number(),
  redraftValue: z.number().nullish().catch(null),
});

export const fantasyCalcValuesSchema = z.array(valueRowSchema);
export type FantasyCalcValuesResponse = z.infer<typeof fantasyCalcValuesSchema>;

/** Who a FantasyCalc row says the player is (value rows and /players rows alike). */
export interface FantasyCalcIdentity {
  name: string;
  /** QB, RB, WR or TE. */
  position: string;
  sleeperId: string | null;
  espnId: string | null;
  mflId: string | null;
  fleaflickerId: string | null;
}

export interface FantasyCalcValueRow extends FantasyCalcIdentity {
  fantasyCalcId: string;
  /** maybeTeam, Sleeper-style code; null for free agents. */
  team: string | null;
  /** The value in the requested format (§9 v_i). */
  value: number;
  /** FantasyCalc's baseline redraft number (12 teams, PPR, no TE premium): never a league's value (see the header). */
  redraftValue: number | null;
}

export interface FantasyCalcPickValue {
  /** "2027 1st", "2027 1st (Early)", … */
  name: string;
  value: number;
}

export interface FantasyCalcValues {
  players: FantasyCalcValueRow[];
  picks: FantasyCalcPickValue[];
}

/** Split a parsed response into player values and draft-pick values (pure). */
export function reduceFantasyCalcValues(response: FantasyCalcValuesResponse): FantasyCalcValues {
  const players: FantasyCalcValueRow[] = [];
  const picks: FantasyCalcPickValue[] = [];
  for (const row of response) {
    const p = row.player;
    const position = p.position.trim().toUpperCase();
    if (position === "PICK") {
      picks.push({ name: p.name.trim(), value: row.value });
      continue;
    }
    players.push({
      fantasyCalcId: String(p.id),
      name: p.name.trim(),
      position,
      sleeperId: normalizeId("sleeper", p.sleeperId),
      espnId: normalizeId("espn", p.espnId),
      mflId: normalizeId("mfl", p.mflId),
      fleaflickerId: normalizeId("fleaflicker", p.fleaflickerId),
      team: cleanTeamCode(p.maybeTeam),
      value: row.value,
      redraftValue: row.redraftValue ?? null,
    });
  }
  return { players, picks };
}

function whatOf(f: FantasyCalcRequest): string {
  return `FantasyCalc ${f.isDynasty ? "dynasty" : "redraft"} values`;
}

function valuesCheck(f: FantasyCalcRequest): (res: HttpResponse) => FantasyCalcValues {
  const what = whatOf(f);
  const floor = f.isDynasty ? FANTASYCALC_DYNASTY_MIN_PLAYERS : FANTASYCALC_REDRAFT_MIN_PLAYERS;
  return (res) => {
    const parsed = fantasyCalcValuesSchema.safeParse(checkedJson(res, what));
    if (!parsed.success) throw sourceError(what, parsed.error);
    const reduced = reduceFantasyCalcValues(parsed.data);
    if (reduced.players.length < floor) throw tooFewRows(what, reduced.players.length, `at least ${floor} player rows`);
    return reduced;
  };
}

export interface FantasyCalcValuesLoad extends FantasyCalcValues {
  format: FantasyCalcFormat;
  /** The highest player value in this format (valueFloor and waiverCreditMin are fractions of it, §9). */
  topValue: number;
  fromCache: boolean;
  /** A saved copy stood in because FantasyCalc couldn't be refreshed (fetchedAt is when that copy was fetched). */
  stale: boolean;
  /** When FantasyCalc served these values (epoch ms), when the client reports it. */
  fetchedAt?: number;
}

/**
 * Fetch and check one format's values (24 h cache, a saved copy for up to 7 days). Throws LeagueImportError.
 * `maxRetries` overrides the one retry, e.g. 0 for a second list right after FantasyCalc didn't answer the
 * first (a saved copy still stands in).
 */
export async function loadFantasyCalcValues(http: HttpClient, format: FantasyCalcFormat, opts: { maxRetries?: number } = {}): Promise<FantasyCalcValuesLoad> {
  const url = fantasyCalcValuesUrl(format);
  let got: PublicSourceResult<FantasyCalcValues>;
  try {
    const request = { key: `fantasycalc:${url}`, ttlMs: TTL.fantasyCalc, timeoutMs: FANTASYCALC_VALUES_TIMEOUT_MS, maxRetries: opts.maxRetries ?? FANTASYCALC_VALUES_MAX_RETRIES };
    got = await getPublicSource(http, url, request, valuesCheck(format));
  } catch (err) {
    // The real client never throws; any other client's error text could hold a URL, so it isn't echoed.
    if (err instanceof LeagueImportError) throw err;
    throw new LeagueImportError("SOURCE_DOWN", `${whatOf(format)}: couldn't be reached`);
  }
  if ("error" in got) throw got.error;
  const { res, value } = got;
  let topValue = 0;
  for (const p of value.players) topValue = Math.max(topValue, p.value);
  return { format, ...value, topValue, fromCache: res.fromCache, stale: res.stale === true, ...(res.fetchedAt !== undefined ? { fetchedAt: res.fetchedAt } : {}) };
}

// ---------------------------------------------------------------------------------------------
// Joining FantasyCalc rows to canonical ids

type IdField = "sleeperId" | "espnId" | "mflId" | "fleaflickerId";

/** Platforms whose ids FantasyCalc carries, by canonical-id prefix. */
const PLATFORM_ID_FIELD: ReadonlyMap<string, IdField> = new Map([
  ["espn", "espnId"],
  ["mfl", "mflId"],
  ["fleaflicker", "fleaflickerId"],
]);
const ID_FIELDS: readonly IdField[] = ["sleeperId", "espnId", "mflId", "fleaflickerId"];

/** The snapshot facts the join checks a platform-id match against. */
export type JoinPlayer = Pick<PlayerInfo, "name" | "pos" | "eligible">;

function samePerson(row: FantasyCalcIdentity, player: JoinPlayer | undefined): boolean {
  if (!player) return false;
  const key = playerNameKey(row.name);
  if (!key || key !== playerNameKey(player.name)) return false;
  return row.position === player.pos || player.eligible.includes(row.position as Pos);
}

/**
 * A lookup from canonical id to its FantasyCalc row (pure; the first row per id wins):
 * - a canonical Sleeper id (no ":") → the row with that sleeperId;
 * - `espn:<id>` / `mfl:<id>` / `fleaflicker:<id>` → the row with that platform id, when its name key and
 *   position match the player's (a row carrying another player's id is no match; ⚠️ a namesake at the
 *   same position is);
 * - anything else (team defenses, other platforms) → undefined: FantasyCalc values QB/RB/WR/TE only.
 */
export function fantasyCalcMatcher<T extends FantasyCalcIdentity>(rows: readonly T[]): (id: string, player: JoinPlayer | undefined) => T | undefined {
  const index = new Map<IdField, Map<string, T>>(ID_FIELDS.map((f) => [f, new Map<string, T>()]));
  for (const row of rows)
    for (const field of ID_FIELDS) {
      const id = row[field];
      const byId = index.get(field) as Map<string, T>;
      if (id && !byId.has(id)) byId.set(id, row);
    }
  return (id, player) => {
    const colon = id.indexOf(":");
    if (colon < 0) return index.get("sleeperId")?.get(id);
    const field = PLATFORM_ID_FIELD.get(id.slice(0, colon));
    const row = field ? index.get(field)?.get(id.slice(colon + 1)) : undefined;
    return row && samePerson(row, player) ? row : undefined;
  };
}

/** Canonical id → value for the given players FantasyCalc values (pure). */
export function fantasyCalcValuesFor(rows: readonly FantasyCalcValueRow[], players: Readonly<Record<string, JoinPlayer>>, ids: Iterable<string>): Record<string, number> {
  const match = fantasyCalcMatcher(rows);
  const out: Record<string, number> = {};
  for (const id of ids) {
    const row = match(id, players[id]);
    if (row) out[id] = row.value;
  }
  return out;
}

/**
 * The given players FantasyCalc knows (pure): matched in any of `sources` (its /players list, which
 * holds about 4,000 players with no values, and the value rows). In `ids` order, without repeats.
 */
export function fantasyCalcKnownIds(ids: Iterable<string>, players: Readonly<Record<string, JoinPlayer>>, sources: ReadonlyArray<readonly FantasyCalcIdentity[]>): string[] {
  const matchers = sources.map((rows) => fantasyCalcMatcher(rows));
  const out: string[] = [];
  for (const id of new Set(ids)) if (matchers.some((match) => match(id, players[id]))) out.push(id);
  return out;
}

/**
 * ModelInputs.market from loaded values (pure). `values` is the load in the league's format (dynasty
 * for dynasty and keeper leagues); keeper leagues pass the redraft load as `redraft`. A keeper league
 * whose dynasty list couldn't be loaded passes its redraft load as `values` and no `redraft`: the
 * market's format then says isDynasty false, so a reader of the future term can tell that it's missing
 * (src/server/modelInputs.ts, review DATA-2). `fantasyCalcPlayers`
 * (/players, null when it couldn't be loaded) widens knownIds to players FantasyCalc lists without a
 * value. fetchedAt is the oldest load's time (`now` when the client didn't report one).
 */
export function marketInputsFrom(input: {
  values: FantasyCalcValuesLoad;
  redraft?: FantasyCalcValuesLoad;
  fantasyCalcPlayers: readonly FantasyCalcPlayerIds[] | null;
  players: Readonly<Record<string, JoinPlayer>>;
  relevantIds: Iterable<string>;
  now: Date;
}): MarketInputs {
  const ids = [...new Set(input.relevantIds)];
  const sources: Array<readonly FantasyCalcIdentity[]> = [input.values.players];
  if (input.redraft) sources.push(input.redraft.players);
  if (input.fantasyCalcPlayers) sources.push(input.fantasyCalcPlayers);
  const times = [input.values.fetchedAt, input.redraft?.fetchedAt].filter((t): t is number => t !== undefined);
  return {
    format: input.values.format,
    fetchedAt: new Date(times.length ? Math.min(...times) : input.now.getTime()).toISOString(),
    values: fantasyCalcValuesFor(input.values.players, input.players, ids),
    ...(input.redraft ? { redraftValues: fantasyCalcValuesFor(input.redraft.players, input.players, ids) } : {}),
    knownIds: fantasyCalcKnownIds(ids, input.players, sources),
    topValue: input.values.topValue,
  };
}
