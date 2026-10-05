/**
 * Sleeper players DB (CLAUDE.md §2.3, §2.9). The full DB is 14.7 MB (Phase 0), so it is fetched
 * per position with active=true and reduced server-side; the browser never gets it.
 *
 * Verified live on 2026-09-29: /v1/players/nfl?position=QB&active=true returned 355 players, all
 * active (354 QB and 1 TE whose fantasy_positions include QB), 435 KB instead of 14.7 MB. So the
 * filter works and matches fantasy_positions, like the projections endpoint; a player eligible at
 * two positions comes back twice, and the lists are deduplicated by id. List sizes that day: P 130,
 * K 157, QB 355, TE 647, RB 750, LB 1,253, WR 1,364, DL 1,543, DB 1,808 players; DEF 32 teams.
 */
import { z } from "zod";
import { LeagueImportError, type HttpClient, type HttpResponse } from "@/adapters/types";
import type { SleeperPlayerLite } from "@/data/types";
import { STALE_PUBLIC_RETAIN_MS, TTL } from "@/server/cache";
import { normalizeId } from "./ids";
import { jsonReducer, pickKeys, reducedKey, reducerId } from "./reduce";
import { checkedJson, getPublicSource, sourceError, tooFewRows } from "./source";
import { cleanTeamCode } from "./teamCodes";

/** Positions fetched (Sleeper fantasy_positions): every position a league can start. */
export const SLEEPER_PLAYER_POSITIONS = ["QB", "RB", "WR", "TE", "K", "P", "DEF", "DL", "LB", "DB"] as const;

/**
 * Row floors (review HTTP-1): a player list with fewer rows is an error or a partial answer, so it is
 * neither cached nor used (the smallest real list, P, had 130). The DEF list has one row per NFL team.
 */
export const SLEEPER_LIST_MIN_ROWS = 20;
export const SLEEPER_DEF_ROWS = 32;

/** Per list request (the largest list, DB, is 2.2 MB). With one retry, a hung host costs a minute, not the old 8. */
export const SLEEPER_LIST_TIMEOUT_MS = 30_000;

export function sleeperPlayersUrl(position: string): string {
  return `https://api.sleeper.app/v1/players/nfl?position=${encodeURIComponent(position)}&active=true`;
}

/** A position list's cache key: its URL's, plus the reducer's suffix (src/data/reduce.ts reducedKey; SLEEPER_PLAYERS_REDUCER below). */
export function sleeperPlayersCacheKey(position: string): string {
  return reducedKey(`sleeper:${sleeperPlayersUrl(position)}`, SLEEPER_PLAYERS_REDUCER);
}

/** Everything the crosswalk keeps from a Sleeper player: the public facts plus the platform ids. */
export interface SleeperPlayerRecord extends SleeperPlayerLite {
  /** Team-defense rows: first_name is the location ("Minnesota"), last_name the nickname ("Vikings"). */
  firstName: string | null;
  lastName: string | null;
  espnId: string | null;
  yahooId: string | null;
  sportradarId: string | null;
  gsisId: string | null;
}

// Non-critical fields fall back to null on a type change instead of failing the whole DB; the
// record key (= player_id on 12229/12229 players, Phase 0) is the id, so no field is required.
const text = z.string().nullish().catch(null);
const num = z.number().nullish().catch(null);
const idLike = z.union([z.string(), z.number()]).nullish().catch(null);

const rowSchema = z.object({
  full_name: text,
  first_name: text,
  last_name: text,
  position: text,
  fantasy_positions: z.array(z.string()).nullish().catch(null),
  team: text,
  injury_status: text,
  status: text,
  age: num,
  active: z.boolean().nullish().catch(null),
  years_exp: num,
  espn_id: idLike,
  yahoo_id: idLike,
  sportradar_id: idLike,
  gsis_id: idLike,
});

export const sleeperPlayersSchema = z.record(z.string(), rowSchema);
export type SleeperPlayersResponse = z.infer<typeof sleeperPlayersSchema>;

/** The fields a list's player keeps (rowSchema's: everything the check and reduceSleeperPlayers read). */
export const SLEEPER_PLAYER_FIELDS: readonly string[] = Object.keys(rowSchema.shape);

/**
 * The fetch-time reducer of a players list (planner reply to Checkpoint 4c, Part B, B1; src/data/reduce.ts): each player
 * keeps rowSchema's fields as they came (about a quarter of a list's bytes; the rest, from news stamps to birth cities,
 * nothing reads). Consumers: sleeperListCheck (the schema, its row count) and reduceSleeperPlayers, which the crosswalk
 * builds on. A list the schema doesn't take stays as it is (the check's error, word for word). The id's fingerprint
 * follows SLEEPER_PLAYER_FIELDS, so a field added to rowSchema files the new form under a new key by itself (review
 * CA-7: the old form, without it, is never read for the new code); its version names the code.
 */
export const SLEEPER_PLAYERS_REDUCER = jsonReducer(reducerId("sleeper-players", 1, [SLEEPER_PLAYER_FIELDS]), (json) => {
  if (!sleeperPlayersSchema.safeParse(json).success) return undefined;
  return Object.fromEntries(Object.entries(json as Record<string, object>).map(([id, player]) => [id, pickKeys(player, SLEEPER_PLAYER_FIELDS)]));
});

function blankToNull(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

function isTeamDefenseId(id: string): boolean {
  return /^[A-Z]{2,3}$/.test(id);
}

/** Reduce one parsed response to records (pure). */
export function reduceSleeperPlayers(response: SleeperPlayersResponse): SleeperPlayerRecord[] {
  const out: SleeperPlayerRecord[] = [];
  for (const [key, p] of Object.entries(response)) {
    const id = key.trim();
    if (!normalizeId("sleeper", id) && !isTeamDefenseId(id)) continue;
    const firstName = blankToNull(p.first_name);
    const lastName = blankToNull(p.last_name);
    const name = blankToNull(p.full_name) ?? blankToNull([firstName, lastName].filter(Boolean).join(" ")) ?? id;
    out.push({
      id,
      name,
      position: blankToNull(p.position),
      fantasyPositions: (p.fantasy_positions ?? []).map((x) => x.trim()).filter(Boolean),
      team: cleanTeamCode(p.team),
      injuryStatus: blankToNull(p.injury_status),
      status: blankToNull(p.status),
      age: p.age ?? null,
      // Rows from the active=true lists are active; keep the flag when the source says otherwise.
      active: p.active ?? true,
      yearsExp: p.years_exp ?? null,
      firstName,
      lastName,
      espnId: normalizeId("espn", p.espn_id),
      yahooId: normalizeId("yahoo", p.yahoo_id),
      sportradarId: normalizeId("sportradar", p.sportradar_id),
      gsisId: normalizeId("gsis", p.gsis_id),
    });
  }
  return out;
}

/** The public SleeperPlayerLite view of a record (no platform ids). */
export function toLite(r: SleeperPlayerRecord): SleeperPlayerLite {
  return {
    id: r.id,
    name: r.name,
    position: r.position,
    fantasyPositions: [...r.fantasyPositions],
    team: r.team,
    injuryStatus: r.injuryStatus,
    status: r.status,
    age: r.age,
    active: r.active,
    yearsExp: r.yearsExp,
  };
}

export interface SleeperPlayersLoad {
  players: SleeperPlayerRecord[];
  /** Positions whose list failed, came back below its row floor, or wasn't requested (circuit breaker). Their players are missing. */
  failed: { position: string; reason: string }[];
  /**
   * Positions whose list loaded fully from Sleeper (live, or from the 24 h cache). Only when every
   * player list is here may a player missing from them be called "not active" (see crosswalk.ts).
   */
  complete: string[];
  /** Positions served from a saved copy because Sleeper couldn't be refreshed (with when that copy was fetched). */
  staleLists: { position: string; fetchedAt?: number }[];
  /** True when every successful list came from the server cache. */
  fromCache: boolean;
  /** When the oldest list was fetched from Sleeper (epoch ms), when the client reports it. */
  fetchedAt?: number;
}

function sleeperListCheck(position: string): (res: HttpResponse) => SleeperPlayersResponse {
  const what = `Sleeper players (${position})`;
  return (res) => {
    const parsed = sleeperPlayersSchema.safeParse(checkedJson(res, what, "sleeper"));
    if (!parsed.success) throw sourceError(what, parsed.error, "sleeper");
    const rows = Object.keys(parsed.data).length;
    if (position === "DEF" ? rows !== SLEEPER_DEF_ROWS : rows < SLEEPER_LIST_MIN_ROWS) throw tooFewRows(what, rows, position === "DEF" ? `exactly ${SLEEPER_DEF_ROWS}` : `at least ${SLEEPER_LIST_MIN_ROWS}`, "sleeper");
    return parsed.data;
  };
}

/** Sleeper isn't serving data: a network error or timeout, 429, 5xx, or an HTML page. */
function sourceDown(res: HttpResponse): boolean {
  return res.status === 0 || res.status === 429 || res.status >= 500 || res.isHtml;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Fetch every position list (one request at a time; the HttpClient paces the host), validate and
 * merge. Throws only when every position failed.
 *
 * Circuit breaker (review DATA-2): after the first list Sleeper doesn't serve (network error, 429,
 * 5xx, HTML), the remaining lists aren't requested, so an outage costs 2 requests instead of 40.
 * When a saved copy stood in for that list, the remaining lists are read from their saved copies
 * too (up to STALE_PUBLIC_RETAIN_MS old; a live request only for a list with no copy, without retries).
 */
export async function fetchSleeperPlayers(http: HttpClient, positions: readonly string[] = SLEEPER_PLAYER_POSITIONS): Promise<SleeperPlayersLoad> {
  const byId = new Map<string, SleeperPlayerRecord>();
  const failed: SleeperPlayersLoad["failed"] = [];
  const complete: string[] = [];
  const staleLists: SleeperPlayersLoad["staleLists"] = [];
  let firstError: unknown;
  let allCached = true;
  let oldest: number | undefined;
  /** "saved": Sleeper failed but saved copies exist, so read those; "open": Sleeper failed with nothing saved, so stop. */
  let breaker: "closed" | "saved" | "open" = "closed";
  let downBecause = "";
  for (const position of positions) {
    if (breaker === "open") {
      failed.push({ position, reason: `not requested because Sleeper didn't answer (${downBecause})` });
      continue;
    }
    const url = sleeperPlayersUrl(position);
    const savedOnly = breaker === "saved";
    const got = await getPublicSource(
      http,
      url,
      {
        key: sleeperPlayersCacheKey(position),
        ttlMs: savedOnly ? STALE_PUBLIC_RETAIN_MS : TTL.sleeperPlayers,
        timeoutMs: SLEEPER_LIST_TIMEOUT_MS,
        maxRetries: savedOnly ? 0 : 1,
        refetchBadCopy: !savedOnly,
        transformText: SLEEPER_PLAYERS_REDUCER.reduce,
      },
      sleeperListCheck(position),
    );
    const { res } = got;
    if ("error" in got) {
      firstError ??= got.error;
      failed.push({ position, reason: message(got.error) });
      if (res.stale || sourceDown(res)) {
        breaker = "open";
        downBecause = message(got.error);
      }
      continue;
    }
    if (res.stale) breaker = "saved";
    if (res.stale || (savedOnly && res.fromCache)) staleLists.push({ position, ...(res.fetchedAt !== undefined ? { fetchedAt: res.fetchedAt } : {}) });
    else complete.push(position);
    allCached &&= res.fromCache;
    if (res.fetchedAt !== undefined) oldest = Math.min(oldest ?? res.fetchedAt, res.fetchedAt);
    for (const r of reduceSleeperPlayers(got.value)) if (!byId.has(r.id)) byId.set(r.id, r);
  }
  if (failed.length === positions.length && firstError) throw firstError;
  if (!byId.size) throw new LeagueImportError("BAD_RESPONSE", "Sleeper players: every position list was empty", { platform: "sleeper", path: "(root)" });
  return { players: [...byId.values()], failed, complete, staleLists, fromCache: allCached, ...(oldest !== undefined ? { fetchedAt: oldest } : {}) };
}
