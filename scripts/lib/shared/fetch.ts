/**
 * Cached fetchers for the shared (league-independent) data sources: DynastyProcess ID map, nflverse
 * games, ESPN pro-team schedules and league-default projections, Sleeper state, projections and
 * stats, and the FantasyCalc site pages that hold its API docs and terms. Every call goes through
 * the polite HTTP client with the CLAUDE.md §2.10 TTLs. None of these requests carries credentials;
 * they are public data. The season always comes from the caller (Sleeper /state/nfl), never a constant.
 */
import { readCache, TTL, writeCache } from "../cache";
import { request, type HttpResult } from "../http";

export const DP_IDMAP_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";
/** GitHub commit history for the ID map (raw.githubusercontent.com sends no Last-Modified header). */
export const DP_COMMITS_URL = "https://api.github.com/repos/dynastyprocess/data/commits?path=files/db_playerids.csv&per_page=1";
export const NFLVERSE_GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
export const ESPN_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
export const SLEEPER_BASE = "https://api.sleeper.app";
export const SLEEPER_STATE_URL = `${SLEEPER_BASE}/v1/state/nfl`;
export const FANTASYCALC_SITE = "https://fantasycalc.com";

export const espnProTeamsUrl = (season: number) => `${ESPN_BASE}/seasons/${season}?view=proTeamSchedules_wl`;

export const espnLeagueDefaultsUrl = (season: number, week: number) =>
  `${ESPN_BASE}/seasons/${season}/segments/0/leaguedefaults/3?scoringPeriodId=${week}&view=kona_player_info`;

/**
 * X-Fantasy-Filter copied from cwendt94/espn-api (espn_api/requests/espn_requests.py,
 * EspnFantasyRequests.get_player_pool_ids): the player-pool filter — all statuses, sorted by
 * percent owned, with an explicit limit/offset to raise ESPN's default page size.
 */
export function espnPoolFilter(limit: number, offset = 0): string {
  return JSON.stringify({
    players: {
      filterStatus: { value: ["FREEAGENT", "WAIVERS", "ONTEAM"] },
      limit,
      offset,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    },
  });
}

/** Sleeper undocumented projections: one position, or several via repeated position[] params. */
export function sleeperProjectionsUrl(season: number, week: number | null, positions: string[], opts: { multi?: boolean } = {}): string {
  const base = week === null ? `${SLEEPER_BASE}/projections/nfl/${season}` : `${SLEEPER_BASE}/projections/nfl/${season}/${week}`;
  const pos = opts.multi ? positions.map((p) => `position[]=${p}`).join("&") : `position=${positions[0] ?? ""}`;
  return `${base}?season_type=regular&${pos}`;
}

export function sleeperStatsUrl(season: number, week: number, positions: string[] = [], opts: { multi?: boolean } = {}): string {
  const base = `${SLEEPER_BASE}/stats/nfl/${season}/${week}?season_type=regular`;
  if (!positions.length) return base;
  return opts.multi ? `${base}&${positions.map((p) => `position[]=${p}`).join("&")}` : `${base}&position=${positions[0]}`;
}

interface CacheSlot {
  namespace: string;
  key: string;
}

/**
 * Reuse a fresh copy of the same URL that another probe cached under its own key (CLAUDE.md §0.9:
 * don't fetch the same resource twice). The copy keeps the original storedAt, so the TTL still runs
 * from the real fetch time. Only fills an empty or expired slot; never overwrites a fresh one.
 */
export async function adoptSiblingCache(target: CacheSlot, siblings: CacheSlot[], ttlMs: number): Promise<boolean> {
  if (await readCache(target.namespace, target.key, ttlMs)) return false;
  for (const s of siblings) {
    const hit = await readCache<unknown>(s.namespace, s.key, ttlMs);
    if (!hit) continue;
    await writeCache(target.namespace, target.key, hit.value, hit.storedAt);
    return true;
  }
  return false;
}

export async function fetchText(url: string, namespace: string, ttlMs: number, label: string, headers?: Record<string, string>): Promise<HttpResult> {
  return request(url, { cache: { key: `${namespace}:${url}`, ttlMs, namespace }, label, headers, timeoutMs: 180_000 });
}

/**
 * Sleeper projections/stats. The key "<namespace>:<url>" is shared with the MFL and Fleaflicker
 * probes ("stats:<url>"); the Sleeper probe caches the same URLs as "sleeper:<url>" in
 * "sleeper-<kind>", so a fresh copy there is adopted instead of fetching again.
 */
async function fetchSleeperData(url: string, kind: "projections" | "stats", label: string): Promise<HttpResult> {
  await adoptSiblingCache({ namespace: kind, key: `${kind}:${url}` }, [{ namespace: `sleeper-${kind}`, key: `sleeper:${url}` }], TTL.projections);
  return fetchText(url, kind, TTL.projections, label);
}

export const fetchIdMapCsv = () => fetchText(DP_IDMAP_URL, "idmap", TTL.idMap, "DynastyProcess db_playerids.csv");
export const fetchIdMapCommits = () =>
  fetchText(DP_COMMITS_URL, "idmap", TTL.idMap, "GitHub commits for db_playerids.csv", { Accept: "application/vnd.github+json" });
export const fetchNflGamesCsv = () => fetchText(NFLVERSE_GAMES_URL, "nfl-schedule", TTL.nflSchedule, "nflverse games.csv");
export const fetchEspnProTeams = (season: number) => fetchText(espnProTeamsUrl(season), "nfl-schedule", TTL.nflSchedule, "ESPN proTeamSchedules_wl");

/**
 * Sleeper /state/nfl, cached for 10 minutes under the same key the Sleeper probe uses for it
 * (p.leagueCache: "sleeper:public:<url>" in "league-sleeper"), so the two probes share one fetch.
 */
export function fetchSleeperState(): Promise<HttpResult> {
  return request(SLEEPER_STATE_URL, { cache: { key: `sleeper:public:${SLEEPER_STATE_URL}`, ttlMs: TTL.league, namespace: "league-sleeper" }, label: "Sleeper /state/nfl", timeoutMs: 60_000 });
}

export function fetchSleeperProjections(season: number, week: number | null, positions: string[], multi = false): Promise<HttpResult> {
  return fetchSleeperData(sleeperProjectionsUrl(season, week, positions, { multi }), "projections", `Sleeper projections ${week ?? "season"} ${positions.join(",")}`);
}

export function fetchSleeperStats(season: number, week: number, positions: string[] = [], multi = false): Promise<HttpResult> {
  return fetchSleeperData(sleeperStatsUrl(season, week, positions, { multi }), "stats", `Sleeper stats ${week} ${positions.join(",") || "all"}`);
}

/** ESPN league-default player pool for one scoring period. The filter is part of the cache key. */
export function fetchEspnLeagueDefaults(season: number, week: number, filter: string | null): Promise<HttpResult> {
  const url = espnLeagueDefaultsUrl(season, week);
  const namespace = "projections";
  return request(url, {
    headers: filter ? { "X-Fantasy-Filter": filter } : undefined,
    cache: { key: `${namespace}:${url}#filter=${filter ?? "none"}`, ttlMs: TTL.projections, namespace },
    label: `ESPN leaguedefaults week ${week}${filter ? "" : " (no filter)"}`,
    timeoutMs: 120_000,
  });
}

/**
 * A page or script from the FantasyCalc website (not the API): the docs and terms are client-rendered,
 * so their text lives in the site's JS bundles. HTML pages are cached for a day; hashed bundle files
 * never change, so they are cached for the docs TTL. Only HTTP 200 bodies are cached.
 */
export function fetchFantasyCalcSite(pathName: string, immutable: boolean): Promise<HttpResult> {
  const url = `${FANTASYCALC_SITE}/${pathName.replace(/^\//, "")}`;
  return request(url, {
    cache: { key: `fantasycalc-site:${url}`, ttlMs: immutable ? TTL.docs : TTL.fantasyCalc, namespace: "docs" },
    cacheIf: (res) => res.status === 200,
    headers: { Accept: immutable ? "*/*" : "text/html,*/*" },
    label: `FantasyCalc site ${pathName}`,
    timeoutMs: 60_000,
  });
}
