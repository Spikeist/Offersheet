/**
 * ESPN fetch, the server's side (CLAUDE.md §2.2, §2.10). Talks to ESPN only through the injected
 * HttpClient (polite pacing, bounded backoff on 429/5xx, never retries 401/403/HTML).
 *
 * The league's own responses (the league view, transactions, free agents, injured players' cards) are read by
 * ./leagueData.ts, the half that also runs in the browser (planner reply to Checkpoint 4c, Part B, B1: browser fetching;
 * track BF); this module gives it the server's cache, the cookie and the SWID pseudonyms (fetchEspnLeague), and adds
 * what only the server reads: ESPN's NFL schedule, the same for every league (fetchEspnSchedule, also used for a league
 * the browser read: src/adapters/espn/index.ts importEspnUpload).
 *
 * Requests: ./leagueData.ts (1–4), then
 *   5. /seasons/{season}?view=proTeamSchedules_wl: NFL schedule (trade-deadline and return weeks), league-independent
 *      (cache.public: with the shared cache one server instance fetches it for all, and over the day's budget it's an
 *      outage like the other public sources, not a BUSY answer: src/server/http.ts).
 * Only the league view can fail the import; the others degrade to Import Report warnings.
 *
 * Credentials: the Cookie header goes ONLY through HttpClient's `cookie` option (never in URLs, logs
 * or cache keys). Private (cookie) data is cached under credentialScope(espn_s2, SWID), never under
 * the league ID alone (§2.10). Every SWID in an ESPN league body (members, owners, transaction
 * memberIds) is replaced by a one-way pseudonym BEFORE the body is parsed or cached (review PRIV-1; ./swid.ts),
 * so no SWID reaches the server cache; "my team" is found by the pseudonym of the cookie's SWID.
 */
import { LeagueImportError, type EspnImportRequest, type HttpClient, type HttpRequestOptions } from "@/adapters/types";
import type { ImportWarning } from "@/engine/model";
import { TTL, credentialScope, leagueTtl } from "@/server/cache";
import { ESPN_READS_BASE, classifyEspnResponse, fetchEspnLeagueData, filterHeaderOf, requireEspnLeagueId, type EspnGet } from "./leagueData";
import type { EspnRawBundle } from "./normalize";
import { normalizeSwid, pseudonymizeSwids, swidPseudonym } from "./swid";

export {
  ESPN_READS_BASE,
  FILTER_HEADER,
  FREE_AGENT_LIMIT,
  LEAGUE_VIEWS,
  PLAYER_CARD_BATCH,
  PLAYER_CARD_MAX_REQUESTS,
  TRANSACTION_TYPES,
  classifyEspnResponse,
  currentNflSeason,
  freeAgentFilter,
  injuredRosteredIds,
  leagueUrl,
  playerCardFilter,
  requireEspnLeagueId,
  transactionsFilter,
} from "./leagueData";
export { pseudonymizeSwids, swidPseudonym } from "./swid";

export interface EspnFetchResult {
  leagueId: string;
  season: number;
  raw: EspnRawBundle;
  warnings: ImportWarning[];
  withCredentials: boolean;
  /** The cookie holder's SWID as it appears in the fetched bodies (its pseudonym), for "my team"; never the SWID itself. */
  ownerKey?: string;
  /** When ESPN served the league response (epoch ms; for a cached copy, the original fetch). */
  fetchedAt?: number;
}

function cleanCredential(value: string, name: string): string {
  return value.trim().replace(new RegExp(`^${name}=`, "i"), "").trim();
}

/** The NFL schedule's cache key (shared with src/data/nflSchedule.ts's loader of the same body). */
export function espnScheduleKey(season: number): string {
  return `espn:proTeamSchedules:${season}`;
}

/**
 * ESPN's NFL schedule (public, league-independent; request 5 of the header): the body, or a warning when it didn't load.
 * Always the server's own copy, also for a league the browser read (the server never takes public facts from a browser).
 */
export async function fetchEspnSchedule(season: number, http: HttpClient): Promise<{ proTeamSchedules?: unknown; warnings: ImportWarning[] }> {
  const res = await http.get(`${ESPN_READS_BASE}/seasons/${season}?view=proTeamSchedules_wl`, { cache: { key: espnScheduleKey(season), ttlMs: TTL.nflSchedule, public: true } });
  if (!classifyEspnResponse(res, { withCookies: false, season })) return { proTeamSchedules: res.json, warnings: [] };
  return { warnings: [{ code: "ESPN_SCHEDULE_UNAVAILABLE", message: `ESPN's NFL schedule didn't load, so the trade deadline and injury return dates have no week number (HTTP ${res.status}).`, platformPath: "seasons/{season}?view=proTeamSchedules_wl" }] };
}

/** Fetch everything the normalizer needs. Throws LeagueImportError when the league itself can't be read. */
export async function fetchEspnLeague(req: EspnImportRequest, http: HttpClient, now: Date): Promise<EspnFetchResult> {
  const leagueId = requireEspnLeagueId(req.leagueId);
  if (!leagueId) throw new LeagueImportError("LEAGUE_NOT_FOUND", "That doesn't look like an ESPN league ID (it's a number, like 12345678).", { platform: "espn" });
  const season = req.season;
  if (!Number.isInteger(season) || season < 2000 || season > 2100) throw new LeagueImportError("LEAGUE_NOT_FOUND", "League not found for that season: the season must be a year like 2026.", { platform: "espn" });

  const creds = req.credentials;
  const espnS2 = creds ? cleanCredential(creds.espnS2, "espn_s2") : "";
  const swidRaw = creds ? cleanCredential(creds.swid, "SWID") : "";
  const withCookies = !!(espnS2 && swidRaw);
  // SWIDs are sent with their braces (§2.2); add them if the user copied only the GUID.
  const swid = withCookies ? (swidRaw.startsWith("{") ? swidRaw : `{${swidRaw.replace(/\}$/, "")}}`) : "";
  const cookie = withCookies ? `espn_s2=${espnS2}; SWID=${swid}` : undefined;
  const scope = withCookies ? credentialScope(espnS2, normalizeSwid(swid)) : "public";
  const keyBase = `espn:${scope}:${season}:${leagueId}`;
  // League data: served for 10 minutes (1 after Refresh) and deleted after 10 (Refresh never shortens retention).
  const leagueCache = { ttlMs: leagueTtl(req.refresh), retainMs: TTL.league };
  const closedCache = { ttlMs: TTL.closedTransactions, retainMs: TTL.closedTransactions };
  const transformText = (text: string) => pseudonymizeSwids(text, withCookies ? [swid] : []);

  const get: EspnGet = (url, request) => {
    const opts: HttpRequestOptions = { cache: { key: `${keyBase}:${request.part}`, ...(request.freshness === "closed" ? closedCache : leagueCache) }, transformText };
    if (cookie) opts.cookie = cookie;
    const headers = filterHeaderOf(request);
    if (headers) opts.headers = headers;
    return http.get(url, opts);
  };

  const data = await fetchEspnLeagueData({ leagueId, season }, get, { now, withCookies });
  const schedule = await fetchEspnSchedule(season, http);

  return {
    leagueId,
    season,
    raw: { ...data.raw, ...(schedule.proTeamSchedules !== undefined ? { proTeamSchedules: schedule.proTeamSchedules } : {}) },
    warnings: [...data.warnings, ...schedule.warnings],
    withCredentials: withCookies,
    ...(withCookies ? { ownerKey: swidPseudonym(swid) } : {}),
    ...(data.fetchedAt !== undefined ? { fetchedAt: data.fetchedAt } : {}),
  };
}
