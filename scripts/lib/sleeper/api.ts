/**
 * Sleeper endpoints used by the Phase 0 probe (CLAUDE.md §2.3), with URL templates for reports.
 *
 * Every helper returns both the real URL and a placeholder-only template ("{leagueId}") so evidence
 * never depends on the scrubber catching an ID.
 */
import { TTL } from "../cache";
import type { HttpResult } from "../http";
import type { ProbeContext } from "../probe";
import { parseJsonKeepingBigInts } from "./json";

export const API = "https://api.sleeper.app/v1";
export const PROJ = "https://api.sleeper.app/projections/nfl";
export const STATS = "https://api.sleeper.app/stats/nfl";
export const SCHEDULE = "https://api.sleeper.app/schedule/nfl";
export const DOCS_URL = "https://docs.sleeper.com/";

export interface Endpoint {
  url: string;
  /** Placeholder-only URL for reports, e.g. https://api.sleeper.app/v1/league/{leagueId}/rosters */
  template: string;
}

const ep = (url: string, template: string): Endpoint => ({ url, template });

export const endpoints = {
  state: () => ep(`${API}/state/nfl`, `${API}/state/nfl`),
  userByName: (username: string) => ep(`${API}/user/${encodeURIComponent(username)}`, `${API}/user/{username}`),
  userById: (userId: string) => ep(`${API}/user/${userId}`, `${API}/user/{userId}`),
  userLeagues: (userId: string, season: number) => ep(`${API}/user/${userId}/leagues/nfl/${season}`, `${API}/user/{userId}/leagues/nfl/${season}`),
  league: (id: string) => ep(`${API}/league/${id}`, `${API}/league/{leagueId}`),
  rosters: (id: string) => ep(`${API}/league/${id}/rosters`, `${API}/league/{leagueId}/rosters`),
  users: (id: string) => ep(`${API}/league/${id}/users`, `${API}/league/{leagueId}/users`),
  matchups: (id: string, week: number) => ep(`${API}/league/${id}/matchups/${week}`, `${API}/league/{leagueId}/matchups/${week}`),
  transactions: (id: string, week: number) => ep(`${API}/league/${id}/transactions/${week}`, `${API}/league/{leagueId}/transactions/${week}`),
  tradedPicks: (id: string) => ep(`${API}/league/${id}/traded_picks`, `${API}/league/{leagueId}/traded_picks`),
  drafts: (id: string) => ep(`${API}/league/${id}/drafts`, `${API}/league/{leagueId}/drafts`),
  draft: (draftId: string) => ep(`${API}/draft/${draftId}`, `${API}/draft/{draftId}`),
  draftPicks: (draftId: string) => ep(`${API}/draft/${draftId}/picks`, `${API}/draft/{draftId}/picks`),
  draftTradedPicks: (draftId: string) => ep(`${API}/draft/${draftId}/traded_picks`, `${API}/draft/{draftId}/traded_picks`),
  winnersBracket: (id: string) => ep(`${API}/league/${id}/winners_bracket`, `${API}/league/{leagueId}/winners_bracket`),
  losersBracket: (id: string) => ep(`${API}/league/${id}/losers_bracket`, `${API}/league/{leagueId}/losers_bracket`),
  /** Undocumented. `positions` uses the repeated position[] form (verified to combine positions). */
  projections: (season: number, week: number, positions: string[]) => {
    const q = `season_type=regular&${positions.map((p) => `position[]=${encodeURIComponent(p)}`).join("&")}`;
    return ep(`${PROJ}/${season}/${week}?${q}`, `${PROJ}/${season}/${week}?${q}`);
  },
  /** Undocumented; CLAUDE.md §2.3 lists it as unverified. */
  stats: (season: number, week: number) => ep(`${STATS}/${season}/${week}?season_type=regular`, `${STATS}/${season}/${week}?season_type=regular`),
  /** Undocumented; tried once for check L. */
  schedule: (season: number) => ep(`${SCHEDULE}/regular/${season}`, `${SCHEDULE}/regular/${season}`),
};

export type CacheKind = "league" | "projections" | "stats" | "schedule" | "docs";

const TTL_BY_KIND: Record<CacheKind, number> = {
  league: TTL.league,
  projections: TTL.projections,
  stats: TTL.projections,
  schedule: TTL.nflSchedule,
  docs: TTL.docs,
};

export interface Fetched<T> {
  ok: boolean;
  data: T | null;
  status: number;
  /** Why the call failed (HTTP status, HTML page, non-JSON body), scrubbed. */
  error?: string;
  res?: HttpResult;
  template: string;
}

/**
 * GET a Sleeper URL through the polite, cached client without throwing: failures come back as
 * { ok: false, error } so the probe can report them as ❌ with evidence. Sleeper answers unknown
 * IDs with HTTP 200 and a literal `null` body, which is returned as data = null.
 *
 * Some Sleeper responses carry 19-digit IDs as bare JSON numbers (e.g. /draft/{id}/traded_picks
 * draft_id, league lists' last_transaction_id), which plain JSON.parse rounds. Every body is parsed
 * with parseJsonKeepingBigInts (./json.ts), so integers of 16+ digits keep all their digits as
 * strings. (Not http.ts bigIntsAsStrings: it breaks floats with 16+ fractional digits.)
 */
export async function fetchJson<T>(p: ProbeContext, e: Endpoint, kind: CacheKind = "league"): Promise<Fetched<T>> {
  const cache = kind === "league" ? p.leagueCache(e.url) : { key: `sleeper:${e.url}`, ttlMs: TTL_BY_KIND[kind], namespace: `sleeper-${kind}` };
  try {
    const res = await p.request(e.url, { cache, label: e.template, timeoutMs: 120_000 });
    if (!res.ok) return { ok: false, data: null, status: res.status, error: `HTTP ${res.status}`, res, template: e.template };
    if (res.isHtml) return { ok: false, data: null, status: res.status, error: "HTML page instead of JSON", res, template: e.template };
    if (res.text.trim() === "null") return { ok: true, data: null, status: res.status, res, template: e.template };
    const json = parseJsonKeepingBigInts(res.text);
    if (json === undefined) return { ok: false, data: null, status: res.status, error: "body is not JSON", res, template: e.template };
    return { ok: true, data: json as T, status: res.status, res, template: e.template };
  } catch (err) {
    return { ok: false, data: null, status: 0, error: err instanceof Error ? err.message : String(err), template: e.template };
  }
}
