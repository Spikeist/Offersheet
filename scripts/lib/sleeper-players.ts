/**
 * Sleeper players DB (~5 MB). CLAUDE.md §2.3: fetch at most once per day — the 24h cache and
 * cross-process lock make every probe share one download.
 */
import { TTL } from "./cache";
import { getJson, type HttpResult } from "./http";

export interface SleeperPlayer {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string | null;
  fantasy_positions?: string[] | null;
  team?: string | null;
  injury_status?: string | null;
  status?: string | null;
  age?: number | null;
  espn_id?: string | number | null;
  yahoo_id?: string | number | null;
  fantasy_data_id?: number | null;
  gsis_id?: string | null;
  [key: string]: unknown;
}

export const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";

export async function getSleeperPlayers(): Promise<{ data: Record<string, SleeperPlayer>; res: HttpResult }> {
  return getJson<Record<string, SleeperPlayer>>(SLEEPER_PLAYERS_URL, {
    cache: { key: `sleeper:${SLEEPER_PLAYERS_URL}`, ttlMs: TTL.sleeperPlayers, namespace: "sleeper-players" },
    timeoutMs: 180_000,
    label: "Sleeper players DB",
  });
}
