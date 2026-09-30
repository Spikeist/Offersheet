/**
 * ESPN fantasy football read client for the probe (CLAUDE.md §2.2).
 *
 * - Host: lm-api-reads.fantasy.espn.com (the old fantasy.espn.com host often returns HTML).
 * - Repeated `view` params combine views.
 * - Cookies go only in the Cookie header (never in league-API URLs, logs or cache keys); private-data
 *   cache keys include a hash of the credentials. (The optional fan API needs the SWID in its URL
 *   path; the probe scrubs and templates that URL.)
 * - Every call returns a safe URL template ("{leagueId}", "{season}") for reports.
 * - Cache TTLs follow §2.10: league data 10 min by default; projection-only calls pass ttlMs
 *   (projections: 6 h).
 */
import { sha256 } from "../cache";
import type { HttpResult, RequestOptions } from "../http";
import { classifyEspnResponse, type EspnOutcome } from "./errors";
import { filterHeaders } from "./filters";

export const ESPN_READS_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

export type Params = Array<[string, string | number]>;

export interface EspnAuth {
  s2?: string;
  swid?: string;
}

export function hasCookies(auth: EspnAuth | undefined): auth is Required<EspnAuth> {
  return !!auth?.s2 && !!auth.swid;
}

/** "espn_s2=<s2>; SWID=<swid>". ESPN_S2 is already %-encoded; the SWID keeps its braces. */
export function cookieHeader(auth: EspnAuth | undefined): string | undefined {
  return hasCookies(auth) ? `espn_s2=${auth.s2}; SWID=${auth.swid}` : undefined;
}

export function query(params: Params): string {
  return params.length ? "?" + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
}

export function leaguePath(season: number | string, leagueId: string, extend = ""): string {
  return `${ESPN_READS_BASE}/seasons/${season}/segments/0/leagues/${leagueId}${extend}`;
}

export interface EspnCall {
  /** Short label for logs and fixture labels (no IDs). */
  label: string;
  url: string;
  /** Safe template for reports, e.g. …/leagues/{leagueId}?view=mSettings. */
  template: string;
  filter?: unknown;
  auth?: EspnAuth;
  /** Cache TTL bucket: league data (10 min) unless given. */
  ttlMs?: number;
}

export interface EspnResult<T = unknown> {
  call: EspnCall;
  res: HttpResult;
  outcome: EspnOutcome;
  data: T | undefined;
  withCookies: boolean;
}

export interface ClientDeps {
  request: (url: string, opts?: RequestOptions) => Promise<HttpResult>;
  leagueCache: (key: string, credential?: string[]) => NonNullable<RequestOptions["cache"]>;
}

export function leagueCall(opts: { label: string; season: number; leagueId: string; params: Params; extend?: string; filter?: unknown; auth?: EspnAuth; templateLeague?: string; ttlMs?: number }): EspnCall {
  const q = query(opts.params);
  return {
    label: opts.label,
    url: leaguePath(opts.season, opts.leagueId, opts.extend) + q,
    template: leaguePath(opts.season, opts.templateLeague ?? "{leagueId}", opts.extend) + q,
    filter: opts.filter,
    auth: opts.auth,
    ttlMs: opts.ttlMs,
  };
}

export async function espnGet<T = unknown>(deps: ClientDeps, call: EspnCall, season: number): Promise<EspnResult<T>> {
  const withCookies = hasCookies(call.auth);
  const credential = withCookies ? [call.auth!.s2!, call.auth!.swid!] : undefined;
  // The cache key covers the URL and the filter; credentials only as a hash (leagueCache does that).
  const key = `${call.url}#${call.filter ? sha256(JSON.stringify(call.filter)).slice(0, 16) : "-"}`;
  const cache = call.ttlMs ? { ...deps.leagueCache(key, credential), ttlMs: call.ttlMs } : deps.leagueCache(key, credential);
  const res = await deps.request(call.url, {
    cookie: cookieHeader(call.auth),
    headers: call.filter ? filterHeaders(call.filter) : undefined,
    cache,
    label: `ESPN ${call.label}${withCookies ? " (cookies)" : ""}`,
    retries: 3,
  });
  const outcome = classifyEspnResponse(res, { withCookies, season });
  return { call, res, outcome, data: outcome.ok ? (res.json as T) : undefined, withCookies };
}
