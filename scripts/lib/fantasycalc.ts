/**
 * FantasyCalc market values for the probes (CLAUDE.md §2.9). FantasyCalc's conditions for free use (their reply of
 * 2026-10-05, reports/fantasycalc-permission.md): call only /values/current, and refresh each format's list at most once
 * every 3 hours; non-commercial, and a visible link to FantasyCalc.com wherever values are shown.
 *
 * - Only /values/current: the probes no longer ask for /players (review of Checkpoint 7b's server work; the app stopped at
 *   the same time, src/data/load.ts).
 * - The 3-hour rule across the probes AND the app (the same review: the probes kept their own 24-hour cache in
 *   .cache/fantasycalc, so a format the app had refreshed minutes before was asked again): every list is read through the
 *   app's own HTTP client and cache entry (src/server/http.ts, src/server/cache.ts FileCache in .cache/app, the folder the
 *   stable copy shares; key `fantasycalc:<url>`, TTL.fantasyCalc, kept FANTASYCALC_RETAIN_MS: src/data/fantasyCalcValues.ts
 *   loadFantasyCalcValues), so a copy any of them fetched within 3 hours is served without a request, and what a probe
 *   fetches spares the app its next request. Only a body the app's own check accepts is cached (fantasyCalcValuesCheck),
 *   so a probe never pins a list the app would turn down. A failed request throws (no saved copy stands in: a probe
 *   reports what FantasyCalc answers). The probes' own cross-process lock stays, so two probes never ask at once.
 *
 * Verified in Phase 0 (reports/probe-output/shared.md): numTeams outside 8/10/12/14 silently returns 12-team values, so
 * pick the nearest supported size; tep is "te+" / "te++" and must be percent-encoded (URLSearchParams does this).
 */
import path from "node:path";
import type { HttpClient } from "@/adapters/types";
import { ROOT } from "./env";
import { HttpError, requestLog, type HttpResult } from "./http";
import { withLock } from "./cache";

export interface FcFormat {
  isDynasty: boolean;
  numQbs: 1 | 2;
  numTeams: number;
  ppr: 0 | 0.5 | 1;
  /** TE premium. Omit when the league has none (the API default is none). */
  tep?: "te+" | "te++";
  /** Extra query parameters under test. */
  extra?: Record<string, string>;
}

export interface FcPlayer {
  id: number;
  name: string;
  position: string;
  sleeperId?: string | null;
  espnId?: string | number | null;
  mflId?: string | number | null;
  fleaflickerId?: string | number | null;
  [key: string]: unknown;
}

export interface FcEntry {
  player: FcPlayer;
  value: number;
  redraftValue?: number;
  [key: string]: unknown;
}

/** numTeams values the planner saw supported; use the nearest. */
export const FC_TEAM_SIZES = [8, 10, 12, 14] as const;

export function nearest<T extends number>(values: readonly T[], x: number): T {
  let best = values[0] as T;
  for (const v of values) if (Math.abs(v - x) < Math.abs(best - x)) best = v;
  return best;
}

export function fantasyCalcUrl(f: FcFormat): string {
  const q = new URLSearchParams({ isDynasty: String(f.isDynasty), numQbs: String(f.numQbs), numTeams: String(f.numTeams), ppr: String(f.ppr) });
  if (f.tep) q.set("tep", f.tep);
  for (const [k, v] of Object.entries(f.extra ?? {})) q.set(k, v);
  return `https://api.fantasycalc.com/values/current?${q.toString()}`;
}

let appClient: Promise<HttpClient> | undefined;

/** The app's own HTTP client on the app's file cache (.cache/app), made once per process (server modules load on first use). */
function defaultAppClient(): Promise<HttpClient> {
  appClient ??= (async () => {
    const [{ FileCache }, { createHttpClient }] = await Promise.all([import("@/server/cache"), import("@/server/http")]);
    return createHttpClient({ cache: new FileCache(path.join(ROOT, ".cache", "app")) });
  })();
  return appClient;
}

/**
 * One format's /values/current list, through the app's cache entry and TTL (the file header): a copy fetched within
 * TTL.fantasyCalc (3 hours) by the app, the stable copy or a probe is served without a request. Throws HttpError for an
 * error status, an HTML page or a body that isn't JSON, as getJson did. `deps.http`: a test's client (default: the app's,
 * on .cache/app).
 */
export async function getFantasyCalc(f: FcFormat, deps: { http?: HttpClient } = {}): Promise<{ data: FcEntry[]; res: HttpResult }> {
  const url = fantasyCalcUrl(f);
  const label = `FantasyCalc ${url.split("?")[1]}`;
  const [{ FANTASYCALC_RETAIN_MS, TTL: APP_TTL }, { FANTASYCALC_VALUES_MAX_RETRIES, FANTASYCALC_VALUES_TIMEOUT_MS, fantasyCalcValuesCheck }] = await Promise.all([import("@/server/cache"), import("@/data/fantasyCalcValues")]);
  const check = fantasyCalcValuesCheck({ isDynasty: f.isDynasty, numQbs: f.numQbs, numTeams: f.numTeams, ppr: f.ppr, ...(f.tep ? { tep: f.tep } : {}) });
  const http = deps.http ?? (await defaultAppClient());
  const key = `fantasycalc:${url}`;
  const started = Date.now();
  const ask = () =>
    http.get(url, {
      cache: { key, ttlMs: APP_TTL.fantasyCalc, retainMs: FANTASYCALC_RETAIN_MS, public: true },
      cacheIf: (res) => {
        try {
          check(res);
          return true;
        } catch {
          return false;
        }
      },
      maxRetries: FANTASYCALC_VALUES_MAX_RETRIES,
      timeoutMs: FANTASYCALC_VALUES_TIMEOUT_MS,
    });
  // With the app's client, the probes' cross-process lock too (scripts/lib/cache.ts): two probes run at once never ask for
  // the same list together (the client reads the cache again inside it). A test's own client needs none.
  const got = deps.http ? await ask() : await withLock("fantasycalc", key, ask);
  const res: HttpResult = {
    url,
    finalUrl: url,
    status: got.status,
    ok: got.ok,
    contentType: got.json !== undefined ? "application/json" : "",
    isHtml: got.isHtml,
    text: got.text,
    json: got.json,
    headers: {},
    elapsedMs: Date.now() - started,
    fromCache: got.fromCache,
    ...(got.fromCache && got.fetchedAt !== undefined ? { cachedAt: got.fetchedAt } : {}),
    attempts: got.fromCache ? 0 : 1,
  };
  requestLog.push({ url, status: res.status, ms: res.elapsedMs, fromCache: res.fromCache, attempts: res.attempts, label });
  if (!res.ok) throw new HttpError(res, `HTTP ${res.status}`);
  if (res.isHtml) throw new HttpError(res, "got an HTML page instead of JSON");
  if (!Array.isArray(res.json)) throw new HttpError(res, "response body is not a JSON list");
  return { data: res.json as FcEntry[], res };
}

export type FcIdField = "sleeperId" | "espnId" | "mflId" | "fleaflickerId";

export interface RosteredPlayer {
  id: string;
  name: string;
  pos: string;
}

export interface MatchResult {
  eligible: number;
  matched: number;
  rate: number;
  misses: RosteredPlayer[];
}

/** Share of rostered QB/RB/WR/TE whose platform ID appears in FantasyCalc (check M, target ≥ 98%). */
export function matchRate(rostered: RosteredPlayer[], fc: FcEntry[], idField: FcIdField): MatchResult {
  // Dynasty pick rows carry pick keys ("FP_2027_1") in the id fields; "UNK" means unknown.
  const ids = new Set(
    fc
      .map((e) => e.player[idField])
      .filter((v) => v !== null && v !== undefined && v !== "" && v !== "UNK" && !String(v).startsWith("FP_"))
      .map(String),
  );
  const eligible = rostered.filter((p) => ["QB", "RB", "WR", "TE"].includes(p.pos));
  const misses = eligible.filter((p) => !ids.has(String(p.id)));
  const matched = eligible.length - misses.length;
  return { eligible: eligible.length, matched, rate: eligible.length ? matched / eligible.length : 0, misses };
}
