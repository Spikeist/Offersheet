/**
 * Response checks shared by the data-layer loaders (CLAUDE.md §3: zod at the boundary, clear errors
 * that name the JSON path). All sources here are public, but messages still name the source rather
 * than echo URLs.
 */
import type { ZodError } from "zod";
import { LeagueImportError, type HttpClient, type HttpResponse } from "@/adapters/types";
import type { Platform } from "@/engine/model";
import { STALE_PUBLIC_RETAIN_MS } from "@/server/cache";

/** "[3].sleeperId", "[\"4046\"].fantasy_positions", "(root)". */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  if (!path.length) return "(root)";
  let out = "";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else if (typeof key === "string" && /^[A-Za-z_$][\w$]*$/.test(key)) out += out ? `.${key}` : key;
    else out += `[${JSON.stringify(String(key))}]`;
  }
  return out;
}

/** LeagueImportError("BAD_RESPONSE") for the first zod issue, naming its JSON path. */
export function sourceError(what: string, error: ZodError, platform?: Platform): LeagueImportError {
  const issue = error.issues[0];
  const path = formatIssuePath(issue?.path ?? []);
  return new LeagueImportError("BAD_RESPONSE", `${what}: unexpected response at ${path} (${issue?.message ?? "invalid"})`, { path, platform });
}

/** Throw SOURCE_DOWN for network failures, non-2xx statuses and HTML pages. */
export function checkedResponse(res: HttpResponse, what: string, platform?: Platform): HttpResponse {
  if (res.status === 0) throw new LeagueImportError("SOURCE_DOWN", `${what}: network error`, { platform, status: 0 });
  if (!res.ok) throw new LeagueImportError("SOURCE_DOWN", `${what}: HTTP ${res.status}`, { platform, status: res.status });
  if (res.isHtml) throw new LeagueImportError("SOURCE_DOWN", `${what}: returned an HTML page instead of data`, { platform, status: res.status });
  return res;
}

/** The parsed JSON body of a successful response; BAD_RESPONSE when it isn't JSON. */
export function checkedJson(res: HttpResponse, what: string, platform?: Platform): unknown {
  checkedResponse(res, what, platform);
  if (res.json === undefined) throw new LeagueImportError("BAD_RESPONSE", `${what}: the body is not JSON`, { platform, status: res.status, path: "(root)" });
  return res.json;
}

/** BAD_RESPONSE for a body with fewer rows than its source always has (an error page or a partial answer). */
export function tooFewRows(what: string, rows: number, expected: string, platform?: Platform): LeagueImportError {
  return new LeagueImportError("BAD_RESPONSE", `${what}: ${rows.toLocaleString("en-US")} rows, expected ${expected}`, { platform, path: "(root)" });
}

export interface PublicSourceRequest {
  /** Cache key (public, league-independent data: no credentials in it). */
  key: string;
  /** A saved copy younger than this is used without a request (§2.10). */
  ttlMs: number;
  timeoutMs: number;
  /** Retries of a live request on 429 / 5xx / network errors. */
  maxRetries: number;
  /** Request again (once) when a fresh saved copy fails the check, e.g. one cached before the check existed. Default true. */
  refetchBadCopy?: boolean;
  /**
   * Never ask the source (HttpRequestOptions.cacheOnly; a caller holding off a source it found down): the copy the cache
   * holds, a retained older one standing in (stale), or the check's failure on a status-0 response. No refetch either.
   */
  cacheOnly?: boolean;
  /**
   * A fetch-time reducer (src/data/reduce.ts; HttpRequestOptions.transformText): the body keeps only what the check and
   * its readers use. `key` must then be the reduced form's own (reducedKey), so no copy of the code reads a shape it
   * doesn't expect.
   */
  transformText?: (text: string) => string;
}

/** The response plus the checked value, or the reason the body isn't usable. */
export type PublicSourceResult<T> = { res: HttpResponse; value: T } | { res: HttpResponse; error: unknown };

/**
 * GET a public, league-independent source (player lists, ID maps) with a validity check (review
 * HTTP-1, DATA-2). `check` parses the body and throws a LeagueImportError when it isn't usable: an
 * error status or HTML page (checkedResponse), a changed shape, or fewer rows than the source always
 * has. Then:
 * - only bodies `check` accepts are cached, so a bad 200 is never pinned for the TTL;
 * - every accepted body is kept STALE_PUBLIC_RETAIN_MS: when the live request fails, or its body is
 *   rejected, the saved copy stands in (`res.stale`; `res.fetchedAt` is when that copy was fetched);
 * - whatever comes back (a cache hit, a saved copy, or a live body with no copy to fall back on) goes
 *   through `check` too, and each response object is checked only once;
 * - `cacheOnly` (a caller holding off a source it found down) asks nothing: the cache's copy, a retained one standing in
 *   (stale), or the check's failure on a status-0 response (HttpRequestOptions.cacheOnly).
 * - Every request is league-independent data (cache.public: with the shared cache one server instance fetches it for all,
 *   src/server/http.ts), reduced at fetch time when the caller gives a reducer (`transformText`).
 */
export async function getPublicSource<T>(http: HttpClient, url: string, req: PublicSourceRequest, check: (res: HttpResponse) => T): Promise<PublicSourceResult<T>> {
  const checked = new WeakMap<HttpResponse, { value: T } | { error: unknown }>();
  const run = (res: HttpResponse): { value: T } | { error: unknown } => {
    let result = checked.get(res);
    if (!result) {
      try {
        result = { value: check(res) };
      } catch (error) {
        result = { error };
      }
      checked.set(res, result);
    }
    return result;
  };
  const request = (ttlMs: number) =>
    http.get(url, {
      cache: { key: req.key, ttlMs, retainMs: STALE_PUBLIC_RETAIN_MS, staleIfError: true, public: true },
      cacheIf: (res) => "value" in run(res),
      maxRetries: req.maxRetries,
      timeoutMs: req.timeoutMs,
      ...(req.cacheOnly ? { cacheOnly: true } : {}),
      ...(req.transformText ? { transformText: req.transformText } : {}),
    });
  let res = await request(req.ttlMs);
  // A fresh saved copy that fails the check: no copy is younger than -Infinity, so this is one live
  // request (a good body then replaces the bad copy; a failure falls back to it and fails the check).
  if (res.fromCache && !res.stale && req.refetchBadCopy !== false && !req.cacheOnly && "error" in run(res)) res = await request(Number.NEGATIVE_INFINITY);
  const result = run(res);
  return "value" in result ? { res, value: result.value } : { res, error: result.error };
}

/** "2026-09-28 01:11 UTC": when a saved copy was fetched, for Import Report notes. */
export function utcStamp(epochMs: number): string {
  return `${new Date(epochMs).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
