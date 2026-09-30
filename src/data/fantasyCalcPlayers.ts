/**
 * FantasyCalc GET /players (CLAUDE.md §2.9): a documented endpoint, fetched at most once a day
 * (24 h cache), used here only for its platform ids. Phase 0: 4045 QB/RB/WR/TE, every one with a
 * sleeperId, ten times the players that carry values, so it is FantasyCalc's widest ID source.
 * FantasyCalc has no Yahoo id. Placeholders ("UNK", "RESERVED", "empty_ff_id") are dropped by
 * normalizeId(); team codes follow Sleeper's convention (LAR, WAS, JAX, LV).
 */
import { z } from "zod";
import type { HttpClient, HttpResponse } from "@/adapters/types";
import { TTL } from "@/server/cache";
import { normalizeId } from "./ids";
import { checkedJson, getPublicSource, sourceError, tooFewRows } from "./source";
import { cleanTeamCode } from "./teamCodes";

export const FANTASYCALC_PLAYERS_URL = "https://api.fantasycalc.com/players";

/** Row floor (review HTTP-1): /players had 4,045 rows on 2026-09-29; fewer than this is a broken or partial answer. */
export const FANTASYCALC_MIN_ROWS = 1_000;

/** The list is 1.3 MB. With one retry a failing FantasyCalc gets 2 requests per crosswalk rebuild, and rebuilds back off (load.ts). */
export const FANTASYCALC_TIMEOUT_MS = 30_000;

export interface FantasyCalcPlayerIds {
  /** FantasyCalc's own player id. */
  fantasyCalcId: string;
  name: string;
  position: string;
  sleeperId: string | null;
  espnId: string | null;
  mflId: string | null;
  fleaflickerId: string | null;
  /** maybeTeam, Sleeper-style code; null for free agents. */
  team: string | null;
}

const idLike = z.union([z.string(), z.number()]).nullish().catch(null);

const playerSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  position: z.string(),
  sleeperId: idLike,
  espnId: idLike,
  mflId: idLike,
  fleaflickerId: idLike,
  maybeTeam: z.string().nullish().catch(null),
});

export const fantasyCalcPlayersSchema = z.array(playerSchema);
export type FantasyCalcPlayersResponse = z.infer<typeof fantasyCalcPlayersSchema>;

/** Reduce a parsed response (pure). Draft-pick rows (position PICK) carry no player ids. */
export function reduceFantasyCalcPlayers(response: FantasyCalcPlayersResponse): FantasyCalcPlayerIds[] {
  return response
    .filter((p) => p.position.trim().toUpperCase() !== "PICK")
    .map((p) => ({
      fantasyCalcId: String(p.id),
      name: p.name.trim(),
      position: p.position.trim().toUpperCase(),
      sleeperId: normalizeId("sleeper", p.sleeperId),
      espnId: normalizeId("espn", p.espnId),
      mflId: normalizeId("mfl", p.mflId),
      fleaflickerId: normalizeId("fleaflicker", p.fleaflickerId),
      team: cleanTeamCode(p.maybeTeam),
    }));
}

const WHAT = "FantasyCalc players";

function checkFantasyCalcPlayers(res: HttpResponse): FantasyCalcPlayersResponse {
  const parsed = fantasyCalcPlayersSchema.safeParse(checkedJson(res, WHAT));
  if (!parsed.success) throw sourceError(WHAT, parsed.error);
  if (parsed.data.length < FANTASYCALC_MIN_ROWS) throw tooFewRows(WHAT, parsed.data.length, `at least ${FANTASYCALC_MIN_ROWS.toLocaleString("en-US")}`);
  return parsed.data;
}

export interface FantasyCalcPlayersLoad {
  players: FantasyCalcPlayerIds[];
  fromCache: boolean;
  /** A saved copy stood in because /players couldn't be refreshed (fetchedAt is when that copy was fetched). */
  stale: boolean;
  fetchedAt?: number;
}

/** Fetch and check /players: only a complete list is cached (24 h), and a saved copy stands in for up to 7 days when FantasyCalc fails. */
export async function fetchFantasyCalcPlayers(http: HttpClient): Promise<FantasyCalcPlayersLoad> {
  const got = await getPublicSource(http, FANTASYCALC_PLAYERS_URL, { key: `fantasycalc:${FANTASYCALC_PLAYERS_URL}`, ttlMs: TTL.fantasyCalc, timeoutMs: FANTASYCALC_TIMEOUT_MS, maxRetries: 1 }, checkFantasyCalcPlayers);
  if ("error" in got) throw got.error;
  const { res } = got;
  return { players: reduceFantasyCalcPlayers(got.value), fromCache: res.fromCache, stale: res.stale === true, ...(res.fetchedAt !== undefined ? { fetchedAt: res.fetchedAt } : {}) };
}
