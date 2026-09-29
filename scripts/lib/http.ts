/**
 * Polite HTTP client for probe scripts (CLAUDE.md §0.9, §2.10).
 *
 * - One request at a time per host, with a minimum gap between requests (no parallel floods).
 * - Exponential backoff with jitter on 429 / 5xx / network errors; honours Retry-After.
 *   401/403/404 and HTML login pages are NOT retried — they are reported as-is.
 * - Optional file cache with TTL and cross-process single-flight (see cache.ts).
 * - Cookies and request headers are never logged; URLs in results and errors are scrubbed.
 */
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
  "api.myfantasyleague.com": 1200,
  "www.fantrax.com": 1200,
  "fantasysports.yahooapis.com": 1500,
};
const DEFAULT_GAP_MS = 800;
const MYFANTASYLEAGUE_HOST = /(^|\.)myfantasyleague\.com$/;

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** Cookie header value. Never logged or cached in keys. */
  cookie?: string;
  body?: string;
  timeoutMs?: number;
  /** Max retries for 429/5xx/network errors (default 4). */
  retries?: number;
  /** Cache the response body when status is 200 and it isn't an HTML page. */
  cache?: { key: string; ttlMs: number; namespace?: string };
  /** Label used in the request log instead of the URL (useful when the URL has private parts). */
  label?: string;
}

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

const SAFE_RESPONSE_HEADERS = ["content-type", "content-length", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "last-modified", "etag", "age", "cache-control"];

const hostChains = new Map<string, Promise<void>>();
const hostLast = new Map<string, number>();

function gapFor(host: string): number {
  if (HOST_GAP_MS[host] !== undefined) return HOST_GAP_MS[host];
  if (MYFANTASYLEAGUE_HOST.test(host)) return 1200;
  return DEFAULT_GAP_MS;
}

/** Serialize requests per host and enforce the minimum gap. */
async function acquireHost(host: string): Promise<() => void> {
  const previous = hostChains.get(host) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  hostChains.set(host, previous.then(() => mine));
  await previous;
  const wait = (hostLast.get(host) ?? 0) + gapFor(host) - Date.now();
  if (wait > 0) await sleep(wait);
  return () => {
    hostLast.set(host, Date.now());
    release();
  };
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

function tryParseJson(text: string): unknown {
  const t = text.trimStart();
  if (!(t.startsWith("{") || t.startsWith("["))) return undefined;
  try {
    return JSON.parse(text);
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
    const hit = await readCache<CachedResponse>(cacheNs, opts.cache.key, opts.cache.ttlMs);
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
      json: tryParseJson(r.text),
      headers: r.headers,
      elapsedMs: Date.now() - started,
      fromCache: true,
      attempts: 0,
    };
    requestLog.push({ url: safeUrl, status: r.status, ms: result.elapsedMs, fromCache: true, attempts: 0, label: opts.label });
    return result;
  };

  const cached = await fromCache();
  if (cached) return cached;
  if (!opts.cache) return fetchLive(url, safeUrl, opts, started);

  return withLock(cacheNs, opts.cache.key, async () => {
    const again = await fromCache(); // another process may have filled it while we waited
    if (again) return again;
    const live = await fetchLive(url, safeUrl, opts, started);
    if (live.status === 200 && !live.isHtml && opts.cache) {
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
  const maxRetries = opts.retries ?? 4;
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
        redirect: "follow",
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
      json: tryParseJson(text),
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

export class HttpError extends Error {
  constructor(
    public readonly res: HttpResult,
    reason: string,
  ) {
    super(`${reason} from ${res.url} (content-type: ${res.contentType || "none"})`);
    this.name = "HttpError";
  }
}
