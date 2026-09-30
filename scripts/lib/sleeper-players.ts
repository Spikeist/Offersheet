/**
 * Sleeper players DB. CLAUDE.md §2.3 says ~5 MB; Phase 0 measured 14.6 MB / 12,229 players
 * (2026-09-29). Fetch at most once per day — the 24h cache and cross-process lock make every probe
 * share one download. espn_id / yahoo_id are sparse numbers here; prefer the DynastyProcess map.
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
  active?: boolean;
  age?: number | null;
  years_exp?: number | null;
  search_rank?: number | null;
  depth_chart_order?: number | null;
  college?: string | null;
  sportradar_id?: string | null;
  rotowire_id?: number | null;
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
