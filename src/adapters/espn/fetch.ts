/**
 * ESPN fetch half (server-side; CLAUDE.md §2.2, §2.10). Talks to ESPN only through the injected
 * HttpClient (polite pacing, bounded backoff on 429/5xx, never retries 401/403/HTML).
 *
 * Requests (all verified in Phase 0, reports/probe-output/espn.md):
 *   1. league   ?view=mSettings&view=mTeam&view=mRoster&view=mMatchup&view=mStatus
 *   2. per scoring period 1…current: ?view=mTransactions2&scoringPeriodId=N with espn-api's type
 *      filter (NOT period 0: it aliases the current period, G.periodZero); rows deduped by id later.
 *      Periods that ended over a week ago are kept TTL.closedTransactions (Refresh doesn't shorten
 *      that); the current and previous period follow the league TTL (an in-review trade is filed
 *      under its proposal period, so one closed period stays fresh).
 *   3. per startable position: ?view=kona_player_info&scoringPeriodId=current with espn-api's
 *      free_agents() filter at limit 500 (espn-api's pool page size), re-ranked by projection later
 *   4. injured rostered players' cards: ?view=kona_playercard with espn-api's get_player_card()
 *      filter (their expected return dates, Phase 0 E.injuryReturn), at most 2 batches of 40
 *   5. /seasons/{season}?view=proTeamSchedules_wl: NFL schedule (trade-deadline and return weeks)
 * Only (1) can fail the import; the others degrade to Import Report warnings.
 *
 * Credentials: the Cookie header goes ONLY through HttpClient's `cookie` option (never in URLs, logs
 * or cache keys). Private (cookie) data is cached under credentialScope(espn_s2, SWID), never under
 * the league ID alone (§2.10). Every SWID in an ESPN league body (members, owners, transaction
 * memberIds) is replaced by a one-way pseudonym BEFORE the body is parsed or cached (review PRIV-1),
 * so no SWID reaches the server cache; "my team" is found by the pseudonym of the cookie's SWID.
 */
import { LeagueImportError, type EspnImportRequest, type HttpClient, type HttpRequestOptions, type HttpResponse } from "@/adapters/types";
import type { ImportWarning, InjuryStatus, Pos } from "@/engine/model";
import { TTL, credentialScope, leagueTtl, sha256 } from "@/server/cache";
import { ESPN_LINEUP_SLOTS } from "./constants";
import { normalizeSwid, summarizeSlots, type EspnRawBundle } from "./normalize";
import { mapInjury, positionOf } from "./positions";
import { LeagueSchema, parseEspn, type EspnLeague } from "./schema";

export const ESPN_READS_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
export const LEAGUE_VIEWS = ["mSettings", "mTeam", "mRoster", "mMatchup", "mStatus"] as const;
/** mTransactions2 row types requested (espn-api's TRANSACTION_TYPES minus lineup/draft bookkeeping), as in Phase 0. */
export const TRANSACTION_TYPES = ["FREEAGENT", "WAIVER", "WAIVER_ERROR", "TRADE_ACCEPT", "TRADE_DECLINE", "TRADE_ERROR", "TRADE_PROPOSAL", "TRADE_UPHOLD", "TRADE_VETO"];
/** espn-api's player-pool page size: each position's free-agent list comes back complete. */
export const FREE_AGENT_LIMIT = 500;
/** Players per kona_playercard request (the Phase 0 probe's verified batch size) and the most requests per import. */
export const PLAYER_CARD_BATCH = 40;
export const PLAYER_CARD_MAX_REQUESTS = 2;
/** The single-position slot used to filter free agents of each Pos (looked up by label). */
const FA_SLOT_LABEL: Readonly<Record<Pos, string>> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", P: "P", DEF: "D/ST", DL: "DL", LB: "LB", DB: "DB" };

/**
 * X-Fantasy-Filter of espn-api's League.free_agents() (cwendt94/espn-api@663d726, MIT;
 * football/league.py), copied verbatim with our size. Phase 0 checked it against upstream.
 */
export function freeAgentFilter(size: number, slotIds: number[]) {
  return {
    players: {
      filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
      filterSlotIds: { value: slotIds },
      limit: size,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
      sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "STANDARD" },
    },
  };
}

/** X-Fantasy-Filter of espn-api's League.transactions() (football/league.py @663d726). */
export function transactionsFilter(types: readonly string[]) {
  return { transactions: { filterType: { value: [...types] } } };
}

/**
 * X-Fantasy-Filter of espn-api's get_player_card(playerIds, max_scoring_period)
 * (requests/espn_requests.py @663d726, MIT), as League.player_info() sends it with the league's final
 * scoring period: view=kona_playercard. Copied from the Phase 0 probe (scripts/lib/espn/filters.ts),
 * which checked it against upstream and used it live (J.playerCard, E.injuryReturn).
 */
export function playerCardFilter(playerIds: number[], maxScoringPeriod: number, season: number) {
  return {
    players: {
      filterIds: { value: playerIds },
      filterStatsForTopScoringPeriodIds: { value: maxScoringPeriod, additionalValue: [`00${season}`, `10${season}`] },
    },
  };
}

const FILTER_HEADER = "x-fantasy-filter";

export function leagueUrl(season: number, leagueId: string, params: Array<[string, string | number]>): string {
  const q = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
  return `${ESPN_READS_BASE}/seasons/${season}/segments/0/leagues/${leagueId}${q ? `?${q}` : ""}`;
}

/**
 * The adapter takes a bare ESPN league ID (digits only; surrounding spaces are trimmed), or null.
 * Links are read on the Connect page by src/lib/espnLink.ts, the one ESPN link parser.
 */
export function requireEspnLeagueId(text: string): string | null {
  const t = text.trim();
  return /^\d{1,12}$/.test(t) ? t : null;
}

/** The NFL season in progress at `now` (a season runs September → early February). */
export function currentNflSeason(now: Date): number {
  return now.getUTCMonth() < 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
}

// ---------------------------------------------------------------------------------------------
// SWID pseudonyms (review PRIV-1; CLAUDE.md §0.5: treat the SWID as a secret everywhere)

const GUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** A SWID as ESPN writes it: a braced GUID, literally or %-encoded ({…} / %7B…%7D). */
const BRACED_GUID = new RegExp(`(?:\\{|%7B)(${GUID})(?:\\}|%7D)`, "gi");
const BARE_GUID = new RegExp(`\\b${GUID}\\b`, "gi");
const GUID_ONLY = new RegExp(`^${GUID}$`, "i");

/**
 * A SWID's one-way pseudonym, "{pseudo:<24 hex>}": the same SWID in any case or form always gives the
 * same pseudonym, which can't be mistaken for a SWID (it isn't GUID-shaped) or turned back into one.
 */
export function swidPseudonym(swid: string): string {
  return `{pseudo:${sha256(`espn-swid:${normalizeSwid(swid)}`).slice(0, 24)}}`;
}

/**
 * Replace every SWID in an ESPN body with its pseudonym: braced GUIDs (how ESPN writes SWIDs in
 * members[].id, teams[].owners, primaryOwner and transaction memberIds), %7B…%7D-encoded ones, and
 * any bare copy of a GUID that appears braced in the same body or is one of `known` (the cookie
 * holder's SWID). Other bare GUIDs, such as transaction ids, are left alone.
 */
export function pseudonymizeSwids(text: string, known: readonly string[] = []): string {
  const swids = new Set<string>();
  for (const k of known) {
    const guid = normalizeSwid(k).slice(1, -1);
    if (GUID_ONLY.test(guid)) swids.add(guid);
  }
  let out = text.replace(BRACED_GUID, (_m, guid: string) => {
    swids.add(guid.toUpperCase());
    return swidPseudonym(guid);
  });
  if (swids.size) out = out.replace(BARE_GUID, (m) => (swids.has(m.toUpperCase()) ? swidPseudonym(m).slice(1, -1) : m));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Errors

function errorDetails(json: unknown): { types: string[]; messages: string[] } {
  const types: string[] = [];
  const messages: string[] = [];
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const o = json as { details?: unknown; messages?: unknown };
    if (Array.isArray(o.details))
      for (const d of o.details) {
        if (!d || typeof d !== "object") continue;
        const x = d as { type?: unknown; shortMessage?: unknown; message?: unknown };
        if (typeof x.type === "string") types.push(x.type);
        for (const m of [x.shortMessage, x.message]) if (typeof m === "string") messages.push(m);
      }
    if (Array.isArray(o.messages)) for (const m of o.messages) if (typeof m === "string") messages.push(m);
  }
  return { types, messages };
}

/** Unverified: no live not-activated league was available in Phase 0; matched on ESPN's error text. */
const NOT_ACTIVATED_TEXT = /not[\s_-]*activ|inactive|NOT_ACTIVE/i;

/**
 * Map an ESPN league response to a user-actionable error, or undefined when it's usable JSON.
 * Phase 0: a wrong season is HTTP 404 JSON with details[].type GENERAL_NOT_FOUND. An outage (network
 * failure, 429, 5xx) is SOURCE_DOWN even when ESPN or a CDN answers with an HTML error page (review
 * HTTP-2); only then do 401 / 403 / an HTML login page mean a private league or bad cookies. The
 * private-league paths couldn't be seen live (Parker's league is public) and are covered by mocked
 * tests, as the planner asked.
 */
export function classifyEspnResponse(res: HttpResponse, ctx: { withCookies: boolean; season: number }): LeagueImportError | undefined {
  const detail = { platform: "espn" as const, status: res.status };
  const { types, messages } = errorDetails(res.json);
  const text = [...types, ...messages].join(" ");
  if (!res.isHtml && res.ok && res.json !== undefined) return undefined;
  if (res.status === 404) return new LeagueImportError("LEAGUE_NOT_FOUND", `League not found for that season. Check the league ID and the season (${ctx.season}); a league that hasn't been renewed for ${ctx.season} also shows this.`, detail);
  if (res.status === 0 || res.status === 429 || res.status >= 500) return new LeagueImportError("SOURCE_DOWN", `ESPN isn't responding right now${res.status ? ` (HTTP ${res.status})` : ""}. Try again in a few minutes.`, detail);
  if (!res.isHtml && NOT_ACTIVATED_TEXT.test(text)) return new LeagueImportError("NOT_ACTIVATED", `This league hasn't been activated for ${ctx.season} yet. Ask your commissioner to renew it on ESPN, or pick an earlier season.`, detail);
  if (res.isHtml || res.status === 401 || res.status === 403) {
    return ctx.withCookies
      ? new LeagueImportError("BAD_CREDENTIALS", `ESPN didn't accept your cookies. They may have expired or been copied incompletely, or this account isn't in the league: copy espn_s2 and SWID again from a browser where you're logged in to ESPN. (A league that isn't activated for ${ctx.season} can look the same.)`, detail)
      : new LeagueImportError("PRIVATE_LEAGUE", `This ESPN league is private. Ask your commissioner to turn on “Make League Viewable to Public”, or connect with your ESPN cookies. (A league that isn't activated for ${ctx.season} can look the same.)`, detail);
  }
  return new LeagueImportError("BAD_RESPONSE", `ESPN sent something we couldn't read (HTTP ${res.status}).`, detail);
}

// ---------------------------------------------------------------------------------------------
// Fetch

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

/** Injured first by how long they're likely out: the order player cards are requested in. */
const CARD_PRIORITY: Readonly<Record<InjuryStatus, number>> = { IR: 0, PUP: 0, SUSPENDED: 1, OUT: 2, NA: 3, DOUBTFUL: 4, QUESTIONABLE: 5, PROBABLE: 6, ACTIVE: 9 };

/** ESPN ids of rostered players with an injury status (not ACTIVE), most serious first. */
export function injuredRosteredIds(L: Pick<EspnLeague, "teams">): number[] {
  const byId = new Map<number, InjuryStatus>();
  for (const t of L.teams)
    for (const e of t.roster?.entries ?? []) {
      const p = e.playerPoolEntry.player;
      const injury = mapInjury(p.injuryStatus);
      if (!positionOf(p.defaultPositionId).pos || !injury.known || injury.injury === "ACTIVE") continue;
      byId.set(p.id, injury.injury);
    }
  return [...byId].sort(([a, x], [b, y]) => CARD_PRIORITY[x] - CARD_PRIORITY[y] || a - b).map(([id]) => id);
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
  const warnings: ImportWarning[] = [];

  const get = (url: string, cacheKey: string, cache: { ttlMs: number; retainMs: number }, filter?: unknown) => {
    const opts: HttpRequestOptions = { cache: { key: cacheKey, ...cache }, transformText };
    if (cookie) opts.cookie = cookie;
    if (filter) opts.headers = { [FILTER_HEADER]: JSON.stringify(filter) };
    return http.get(url, opts);
  };

  // 1. The league (settings, teams, rosters, schedule, status).
  const leagueRes = await get(leagueUrl(season, leagueId, LEAGUE_VIEWS.map((v) => ["view", v])), `${keyBase}:league`, leagueCache);
  const error = classifyEspnResponse(leagueRes, { withCookies, season });
  if (error) throw error;
  const L = parseEspn(LeagueSchema, leagueRes.json, "the league");
  if (L.status.isActive === false && season >= currentNflSeason(now))
    throw new LeagueImportError("NOT_ACTIVATED", `This league hasn't been activated for ${season} yet. Ask your commissioner to renew it on ESPN, or pick an earlier season.`, { platform: "espn", status: leagueRes.status, path: "status.isActive" });

  const current = L.status.latestScoringPeriod;
  const secondary = (res: HttpResponse, code: string, message: string, path: string): boolean => {
    if (!classifyEspnResponse(res, { withCookies, season })) return true;
    if (!warnings.some((w) => w.code === code)) warnings.push({ code, message: `${message} (HTTP ${res.status}).`, platformPath: path });
    return false;
  };

  // 2. Transactions, one scoring period at a time.
  const transactions: unknown[] = [];
  const txFilter = transactionsFilter(TRANSACTION_TYPES);
  for (let sp = 1; sp <= current; sp++) {
    const res = await get(leagueUrl(season, leagueId, [["view", "mTransactions2"], ["scoringPeriodId", sp]]), `${keyBase}:tx:${sp}`, sp < current - 1 ? closedCache : leagueCache, txFilter);
    if (secondary(res, "ESPN_TRANSACTIONS_UNAVAILABLE", "ESPN didn't return every week's transactions, so trade and activity history may be incomplete", `view=mTransactions2&scoringPeriodId=${sp}`)) transactions.push(res.json);
  }

  // 3. Free agents for every position the lineup can start.
  const freeAgents: unknown[] = [];
  const slotWarnings: ImportWarning[] = [];
  const slots = summarizeSlots(L.settings.rosterSettings.lineupSlotCounts, slotWarnings);
  for (const pos of slots.positions) {
    const label = pos === "QB" && slots.scoringCtx.qbSource === "TQB" ? "TQB" : FA_SLOT_LABEL[pos];
    const slotId = Object.entries(ESPN_LINEUP_SLOTS).find(([, l]) => l === label)?.[0];
    if (slotId === undefined) continue;
    const res = await get(leagueUrl(season, leagueId, [["view", "kona_player_info"], ["scoringPeriodId", current]]), `${keyBase}:fa:${current}:${slotId}`, leagueCache, freeAgentFilter(FREE_AGENT_LIMIT, [Number(slotId)]));
    if (secondary(res, "ESPN_FREE_AGENTS_UNAVAILABLE", "ESPN didn't return every position's free agents", `view=kona_player_info (free agents, slot ${slotId})`)) freeAgents.push(res.json);
  }

  // 4. Player cards of injured rostered players: their expected return dates (§6 injuryReturnWeek).
  const playerCards: unknown[] = [];
  const injured = injuredRosteredIds(L);
  const finalPeriod = L.status.finalScoringPeriod ?? Math.max(current, ...Object.values(L.settings.scheduleSettings.matchupPeriods).flat());
  for (let i = 0; i < Math.min(injured.length, PLAYER_CARD_BATCH * PLAYER_CARD_MAX_REQUESTS); i += PLAYER_CARD_BATCH) {
    const batch = injured.slice(i, i + PLAYER_CARD_BATCH);
    const res = await get(leagueUrl(season, leagueId, [["view", "kona_playercard"]]), `${keyBase}:cards:${sha256(batch.join(",")).slice(0, 16)}`, leagueCache, playerCardFilter(batch, finalPeriod, season));
    if (secondary(res, "ESPN_PLAYER_CARDS_UNAVAILABLE", "ESPN's player cards didn't load, so injured players have no expected return week and the default recovery times apply", "view=kona_playercard")) playerCards.push(res.json);
  }
  if (injured.length > PLAYER_CARD_BATCH * PLAYER_CARD_MAX_REQUESTS)
    warnings.push({ code: "ESPN_PLAYER_CARDS_PARTIAL", message: `${injured.length} rostered players are injured; expected return weeks were fetched for the ${PLAYER_CARD_BATCH * PLAYER_CARD_MAX_REQUESTS} most serious, and the rest use the default recovery times.`, platformPath: "view=kona_playercard" });

  // 5. The NFL schedule (public, league-independent).
  let proTeamSchedules: unknown;
  const schedRes = await http.get(`${ESPN_READS_BASE}/seasons/${season}?view=proTeamSchedules_wl`, { cache: { key: `espn:proTeamSchedules:${season}`, ttlMs: TTL.nflSchedule } });
  if (secondary(schedRes, "ESPN_SCHEDULE_UNAVAILABLE", "ESPN's NFL schedule didn't load, so the trade deadline and injury return dates have no week number", "seasons/{season}?view=proTeamSchedules_wl")) proTeamSchedules = schedRes.json;

  return {
    leagueId,
    season,
    raw: { league: leagueRes.json, transactions, freeAgents, playerCards, proTeamSchedules },
    warnings,
    withCredentials: withCookies,
    ...(withCookies ? { ownerKey: swidPseudonym(swid) } : {}),
    ...(leagueRes.fetchedAt !== undefined ? { fetchedAt: leagueRes.fetchedAt } : {}),
  };
}
