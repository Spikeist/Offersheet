/**
 * FantasyCalc GET /players (CLAUDE.md §2.9): no longer called. FantasyCalc's conditions for free use (their reply of
 * 2026-10-05, reports/fantasycalc-permission.md: "call only /values/current") ended the app's two uses of it: the player-ID
 * crosswalk's second source for ESPN, MFL and Fleaflicker ids (src/data/load.ts builds it from the Sleeper players DB and
 * DynastyProcess) and the model inputs' knownIds (src/server/modelInputs.ts: the players a value list names). What's left
 * reads a body already saved (scripts/measure-cache.ts, offline) and fixtures, and types the crosswalk's optional
 * FantasyCalc rows (src/data/crosswalk.ts CrosswalkData.fantasyCalcPlayers): the parse, never a request. Phase 0: 4,045
 * QB/RB/WR/TE, every one with a sleeperId. FantasyCalc has no Yahoo id. Placeholders ("UNK", "RESERVED", "empty_ff_id") are
 * dropped by normalizeId(); team codes follow Sleeper's convention (LAR, WAS, JAX, LV).
 */
import { z } from "zod";
import { normalizeId } from "./ids";
import { cleanTeamCode } from "./teamCodes";

/** The endpoint the app no longer calls (see the header): the key a saved copy is filed under, for offline readers. */
export const FANTASYCALC_PLAYERS_URL = "https://api.fantasycalc.com/players";

/** Row floor (review HTTP-1): /players had 4,045 rows on 2026-09-29; fewer was a broken or partial answer (fixtures pad to it). */
export const FANTASYCALC_MIN_ROWS = 1_000;

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
