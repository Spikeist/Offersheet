/**
 * Polite HTTP client for probe scripts (CLAUDE.md §0.9, §2.10).
 *
 * - One request at a time per host, with a minimum gap between requests (no parallel floods).
 *   All *.myfantasyleague.com hosts share one pacing bucket: MFL's 1-second rule is per client.
 * - Exponential backoff with jitter on 429 / 5xx / network errors; honours Retry-After.
 *   401/403/404 and HTML login pages are NOT retried — they are reported as-is. MFL: no retries.
 * - Optional file cache with TTL and cross-process single-flight (see cache.ts).
 * - Cookies and request headers are never logged; URLs in results and errors are scrubbed.
 * - The offline guard (planner reply to Checkpoint 4c, A5): in a script run without --live (runMode.ts setNetworkMode)
 *   every live fetch is refused before any request (src/server/http.ts refuseIfNetworkOff); cached copies still serve.
 */
import { refuseIfNetworkOff } from "@/server/http";
import { readCache, withLock, writeCache } from "./cache";
import { scrubEverything } from "./redact";

export const USER_AGENT = "fantasy-trade-finder/0.1 (personal, non-commercial, read-only)";

/** Minimum milliseconds between requests to the same host. */
const HOST_GAP_MS: Record<string, number> = {
  "api.sleeper.app": 120, // documented limit: stay under 1000 calls/minute
  "lm-api-reads.fantasy.espn.com": 600,
  "fantasy.espn.com": 1000,
  "fan.api.espn.com": 1000,
  "site.api.espn.com": 600,
  "api.fantasycalc.com": 1500,
  "raw.githubusercontent.com": 300,
  "www.fleaflicker.com": 600,
  "myfantasyleague.com": 1200, // shared bucket for api.* and every wwwNN league host
  "www.fantrax.com": 1200,
  "fantasysports.yahooapis.com": 1500,
};
const DEFAULT_GAP_MS = 800;
const MYFANTASYLEAGUE_HOST = /(^|\.)myfantasyleague\.com$/;

/** Hosts that must be paced together (MFL: "wait one second between making requests", per client). */
function bucketFor(host: string): string {
  return MYFANTASYLEAGUE_HOST.test(host) ? "myfantasyleague.com" : host;
}

/** MFL's api_info: "If a request fails, don't retry". Callers can still override per request. */
function defaultRetriesFor(host: string): number {
  return MYFANTASYLEAGUE_HOST.test(host) ? 0 : 4;
}

/** Slow a host down further for this process (e.g. a crawler sharing Sleeper's rate limit). Never lowers the gap. */
export function setHostGap(host: string, ms: number): void {
  const bucket = bucketFor(host);
  HOST_GAP_MS[bucket] = Math.max(ms, HOST_GAP_MS[bucket] ?? DEFAULT_GAP_MS);
}

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** Cookie header value. Never logged or cached in keys. */
  cookie?: string;
  body?: string;
  timeoutMs?: number;
  /** Max retries for 429/5xx/network errors (default 4; 0 for MFL hosts). */
  retries?: number;
  /** Cache the response body (by default only when status is 200 and it isn't an HTML page). */
  cache?: { key: string; ttlMs: number; namespace?: string };
  /**
   * Decide whether a live response may be cached. Default: status 200 and not HTML. Use it to cache
   * docs/HTML pages or a known 404, or to refuse caching HTTP-200 error bodies (Fantrax, MFL).
   */
  cacheIf?: (res: HttpResult) => boolean;
  /** Parse integers with 16+ digits as strings (Sleeper sends some 19-digit IDs as bare numbers). */
  bigIntsAsStrings?: boolean;
  /**
   * "manual" returns 3xx responses as-is (Location is in headers). Needed when a cookie must
   * survive a cross-host redirect: Node's fetch drops the Cookie header on cross-origin redirects.
   */
  redirect?: "follow" | "manual";
  /**
   * Never touch the network: serve the cached copy whatever its age, or throw OfflineCacheMiss.
   * Used for strangers' leagues when crawling isn't allowed (CLAUDE.md §0.6: no new crawls
   * without asking Parker first).
   */
  offline?: boolean;
  /** Label used in the request log instead of the URL (useful when the URL has private parts). */
  label?: string;
}

const defaultCacheIf = (res: HttpResult) => res.status === 200 && !res.isHtml;

export interface HttpResult {
  /** Scrubbed request URL (safe to print). */
  url: string;
  /** Scrubbed final URL after redirects (safe to print). */
  finalUrl: string;
  status: number;
  ok: boolean;
  contentType: string;
  /** True when the body is an HTML page (e.g. ESPN login page) rather than data. */
  isHtml: boolean;
  text: string;
  /** Parsed JSON body, or undefined if the body isn't JSON. */
  json: unknown;
  headers: Record<string, string>;
  elapsedMs: number;
  fromCache: boolean;
  /** When a cached response was originally fetched (epoch ms); undefined for live responses. */
  cachedAt?: number;
  attempts: number;
}

export interface RequestLogEntry {
  url: string;
  status: number;
  ms: number;
  fromCache: boolean;
  attempts: number;
  label?: string;
}

/** Every request made by this process (scrubbed), for timing and evidence in reports. */
export const requestLog: RequestLogEntry[] = [];

// "location" is kept for manual redirects; it may contain league IDs, so scrub before printing.
const SAFE_RESPONSE_HEADERS = ["content-type", "content-length", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "last-modified", "etag", "age", "cache-control", "location"];

const hostChains = new Map<string, Promise<void>>();
const hostLast = new Map<string, number>();

function gapFor(bucket: string): number {
  return HOST_GAP_MS[bucket] ?? DEFAULT_GAP_MS;
}

/** Serialize requests per host bucket and enforce the minimum gap. */
async function acquireHost(host: string): Promise<() => void> {
  const bucket = bucketFor(host);
  const previous = hostChains.get(bucket) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  hostChains.set(bucket, previous.then(() => mine));
  await previous;
  const wait = (hostLast.get(bucket) ?? 0) + gapFor(bucket) - Date.now();
  if (wait > 0) await sleep(wait);
  return () => {
    hostLast.set(bucket, Date.now());
    release();
  };
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/**
 * Wrap bare integers of `minDigits`+ digits (outside strings) in quotes so JSON.parse keeps every
 * digit. Plain JSON.parse rounds Sleeper's 19-digit draft IDs to the nearest double.
 */
export function quoteBigInts(text: string, minDigits = 16): string {
  let out = "";
  let last = 0;
  let inString = false;
  for (let i = 0; i < text.length; ) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i += 2; // backslash escape
      else {
        if (c === 34) inString = false;
        i++;
      }
      continue;
    }
    if (c === 34) {
      inString = true;
      i++;
      continue;
    }
    if (c === 45 || (c >= 48 && c <= 57)) {
      // Consume the whole number token -?int(.frac)?([eE][+-]?exp)? so a long fraction such as
      // 0.0303030303030303 is never mistaken for a big integer.
      const start = i;
      let j = c === 45 ? i + 1 : i;
      const intStart = j;
      while (j < text.length && isDigit(text.charCodeAt(j))) j++;
      const intDigits = j - intStart;
      let integer = true;
      if (text[j] === ".") {
        integer = false;
        j++;
        while (j < text.length && isDigit(text.charCodeAt(j))) j++;
      }
      if (text[j] === "e" || text[j] === "E") {
        integer = false;
        j++;
        if (text[j] === "+" || text[j] === "-") j++;
        while (j < text.length && isDigit(text.charCodeAt(j))) j++;
      }
      if (integer && intDigits >= minDigits) {
        out += `${text.slice(last, start)}"${text.slice(start, j)}"`;
        last = j;
      }
      i = Math.max(j, i + 1);
      continue;
    }
    i++;
  }
  return last === 0 ? text : out + text.slice(last);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.min(60_000, Math.max(0, secs * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(60_000, Math.max(0, date - Date.now())) : undefined;
}

function looksLikeHtml(contentType: string, text: string): boolean {
  if (/text\/html/i.test(contentType)) return true;
  const head = text.slice(0, 200).trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

function tryParseJson(text: string, bigIntsAsStrings = false): unknown {
  const t = text.trimStart();
  if (!(t.startsWith("{") || t.startsWith("["))) return undefined;
  try {
    return JSON.parse(bigIntsAsStrings ? quoteBigInts(text) : text);
  } catch {
    return undefined;
  }
}

interface CachedResponse {
  status: number;
  contentType: string;
  finalUrl: string;
  headers: Record<string, string>;
  text: string;
}

export async function request(url: string, opts: RequestOptions = {}): Promise<HttpResult> {
  const safeUrl = scrubEverything(url);
  const cacheNs = opts.cache?.namespace ?? "http";
  const started = Date.now();

  const fromCache = async (): Promise<HttpResult | null> => {
    if (!opts.cache) return null;
    const hit = await readCache<CachedResponse>(cacheNs, opts.cache.key, opts.offline ? Number.POSITIVE_INFINITY : opts.cache.ttlMs);
    if (!hit) return null;
    const r = hit.value;
    const result: HttpResult = {
      url: safeUrl,
      finalUrl: scrubEverything(r.finalUrl),
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      contentType: r.contentType,
      isHtml: looksLikeHtml(r.contentType, r.text),
      text: r.text,
      json: tryParseJson(r.text, opts.bigIntsAsStrings),
      headers: r.headers,
      elapsedMs: Date.now() - started,
      fromCache: true,
      cachedAt: hit.storedAt,
      attempts: 0,
    };
    requestLog.push({ url: safeUrl, status: r.status, ms: result.elapsedMs, fromCache: true, attempts: 0, label: opts.label });
    return result;
  };

  const cached = await fromCache();
  if (cached) return cached;
  if (opts.offline) throw new OfflineCacheMiss(opts.label ?? safeUrl);
  refuseIfNetworkOff(new URL(url).host); // the offline guard, before the cross-process lock (fetchLive checks again)
  if (!opts.cache) return fetchLive(url, safeUrl, opts, started);

  return withLock(cacheNs, opts.cache.key, async () => {
    const again = await fromCache(); // another process may have filled it while we waited
    if (again) return again;
    const live = await fetchLive(url, safeUrl, opts, started);
    if (opts.cache && (opts.cacheIf ?? defaultCacheIf)(live)) {
      await writeCache<CachedResponse>(cacheNs, opts.cache.key, {
        status: live.status,
        contentType: live.contentType,
        finalUrl: live.finalUrl,
        headers: live.headers,
        text: live.text,
      });
    }
    return live;
  });
}

async function fetchLive(url: string, safeUrl: string, opts: RequestOptions, started: number): Promise<HttpResult> {
  const host = new URL(url).host;
  refuseIfNetworkOff(host); // the offline guard (the header), before any request
  const maxRetries = opts.retries ?? defaultRetriesFor(host);
  const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/json, text/plain, */*", ...opts.headers };
  if (opts.cookie) headers.Cookie = opts.cookie;

  let attempt = 0;
  for (;;) {
    attempt++;
    const release = await acquireHost(host);
    let res: Response | undefined;
    let networkError: unknown;
    let text = "";
    try {
      res = await fetch(url, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body,
        redirect: opts.redirect ?? "follow",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });
      text = await res.text();
    } catch (err) {
      networkError = err;
    } finally {
      release();
    }

    const retryable = networkError !== undefined || (res !== undefined && (res.status === 429 || res.status >= 500));
    if (retryable && attempt <= maxRetries) {
      const base = Math.min(30_000, 1000 * 2 ** (attempt - 1));
      const wait = retryAfterMs(res?.headers.get("retry-after") ?? null) ?? base + Math.floor(Math.random() * 300);
      const why = networkError ? `network error (${scrubEverything(errorMessage(networkError))})` : `HTTP ${res?.status}`;
      console.warn(`  ↻ ${why} from ${opts.label ?? safeUrl}; retry ${attempt}/${maxRetries} in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    if (networkError !== undefined || !res) {
      requestLog.push({ url: safeUrl, status: 0, ms: Date.now() - started, fromCache: false, attempts: attempt, label: opts.label });
      throw new Error(`Request failed after ${attempt} attempt(s): ${opts.label ?? safeUrl}: ${scrubEverything(errorMessage(networkError))}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    const safeHeaders: Record<string, string> = {};
    for (const h of SAFE_RESPONSE_HEADERS) {
      const v = res.headers.get(h);
      if (v !== null) safeHeaders[h] = v;
    }
    const result: HttpResult = {
      url: safeUrl,
      finalUrl: scrubEverything(res.url || url),
      status: res.status,
      ok: res.ok,
      contentType,
      isHtml: looksLikeHtml(contentType, text),
      text,
      json: tryParseJson(text, opts.bigIntsAsStrings),
      headers: safeHeaders,
      elapsedMs: Date.now() - started,
      fromCache: false,
      attempts: attempt,
    };
    requestLog.push({ url: safeUrl, status: res.status, ms: result.elapsedMs, fromCache: false, attempts: attempt, label: opts.label });
    return result;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    return cause instanceof Error ? `${err.message} (${cause.message})` : err.message;
  }
  return String(err);
}

/** GET and require a JSON body; throws a scrubbed, descriptive error otherwise. */
export async function getJson<T = unknown>(url: string, opts: RequestOptions = {}): Promise<{ data: T; res: HttpResult }> {
  const res = await request(url, opts);
  if (!res.ok) throw new HttpError(res, `HTTP ${res.status}`);
  if (res.isHtml) throw new HttpError(res, "got an HTML page instead of JSON");
  if (res.json === undefined) throw new HttpError(res, "response body is not JSON");
  return { data: res.json as T, res };
}

/** An offline request had nothing cached (see RequestOptions.offline). */
export class OfflineCacheMiss extends Error {
  constructor(what: string) {
    super(`offline: no cached copy of ${what} (re-run with --allow-crawl after asking Parker)`);
    this.name = "OfflineCacheMiss";
  }
}

export class HttpError extends Error {
  constructor(
    public readonly res: HttpResult,
    reason: string,
  ) {
    super(`${reason} from ${res.url} (content-type: ${res.contentType || "none"})`);
    this.name = "HttpError";
  }
}
