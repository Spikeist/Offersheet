/**
 * Public, league-independent data the Fleaflicker probe needs: Sleeper weekly actual stats (the
 * scoring-oracle preview) and nflverse games (bye-week cross-check).
 *
 * Cache keys/namespaces match scripts/lib/shared/fetch.ts ("stats:<url>", "nfl-schedule:<url>"), so
 * every probe shares one download (CLAUDE.md §2.10). The module is not imported, so edits there
 * can't break this probe.
 */
import { parse } from "csv-parse/sync";
import { TTL } from "../cache";
import { request, type HttpResult } from "../http";

export const SLEEPER_STATS_URL = (season: number, week: number) => `https://api.sleeper.app/stats/nfl/${season}/${week}?season_type=regular`;
export const NFLVERSE_GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
export const DP_IDMAP_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";

/** DynastyProcess ID map rows (only the columns this probe compares). Cache key as in lib/shared. */
export async function getDynastyProcessIds(): Promise<{ res: HttpResult; rows: Array<{ fleaflicker_id: string; sleeper_id: string; sportradar_id: string }> }> {
  const res = await request(DP_IDMAP_URL, { cache: { key: `idmap:${DP_IDMAP_URL}`, ttlMs: TTL.idMap, namespace: "idmap" }, label: "DynastyProcess db_playerids.csv", timeoutMs: 180_000 });
  const raw = parse(res.text, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }) as Array<Record<string, string>>;
  const clean = (v: string | undefined) => (v && v !== "NA" ? v.trim() : "");
  return { res, rows: raw.map((r) => ({ fleaflicker_id: clean(r.fleaflicker_id), sleeper_id: clean(r.sleeper_id), sportradar_id: clean(r.sportradar_id).toLowerCase() })) };
}

export interface WeekStats {
  res: HttpResult;
  bySleeperId: Map<string, Record<string, number>>;
  /** Every stat key seen this week. */
  keys: Set<string>;
}

export async function getSleeperWeekStats(season: number, week: number): Promise<WeekStats> {
  const url = SLEEPER_STATS_URL(season, week);
  const res = await request(url, { cache: { key: `stats:${url}`, ttlMs: TTL.projections, namespace: "stats" }, label: `Sleeper stats ${week} all`, timeoutMs: 180_000 });
  const bySleeperId = new Map<string, Record<string, number>>();
  const keys = new Set<string>();
  const rows = Array.isArray(res.json) ? (res.json as Array<{ player_id?: string; stats?: Record<string, unknown> }>) : [];
  for (const row of rows) {
    if (!row.player_id || !row.stats) continue;
    const stats: Record<string, number> = {};
    for (const [k, v] of Object.entries(row.stats)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        stats[k] = v;
        keys.add(k);
      }
    }
    bySleeperId.set(String(row.player_id), stats);
  }
  return { res, bySleeperId, keys };
}

/** nflverse team codes → the codes Fleaflicker and Sleeper use. */
const TEAM_ALIASES: Record<string, string> = { LA: "LAR", JAC: "JAX", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LAR" };
export function normTeam(code: string | undefined | null): string {
  const c = (code ?? "").toUpperCase();
  return TEAM_ALIASES[c] ?? c;
}

export async function getNflverseByes(season: number): Promise<{ res: HttpResult; byes: Map<string, number[]>; games: number }> {
  const res = await request(NFLVERSE_GAMES_URL, { cache: { key: `nfl-schedule:${NFLVERSE_GAMES_URL}`, ttlMs: TTL.nflSchedule, namespace: "nfl-schedule" }, label: "nflverse games.csv", timeoutMs: 180_000 });
  const rows = parse(res.text, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;
  const weeks = new Map<string, Set<number>>();
  let games = 0;
  let maxWeek = 0;
  for (const r of rows) {
    if (Number(r.season) !== season || r.game_type !== "REG") continue;
    games++;
    const w = Number(r.week);
    maxWeek = Math.max(maxWeek, w);
    for (const t of [r.home_team, r.away_team]) {
      const code = normTeam(t);
      const s = weeks.get(code) ?? new Set<number>();
      s.add(w);
      weeks.set(code, s);
    }
  }
  const byes = new Map<string, number[]>();
  for (const [team, played] of weeks) {
    const missing: number[] = [];
    for (let w = 1; w <= maxWeek; w++) if (!played.has(w)) missing.push(w);
    byes.set(team, missing);
  }
  return { res, byes, games };
}
