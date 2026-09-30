/**
 * Polite server-side HTTP client (CLAUDE.md §0.9, §2.10), implementing the adapters' HttpClient.
 *
 * - One request at a time per host bucket, with a minimum gap (all *.myfantasyleague.com hosts
 *   share one bucket: MFL's one-second rule is per client).
 * - Exponential backoff with jitter on 429 / 5xx / network errors, honouring Retry-After.
 *   401 / 403 / 404 and HTML login pages are returned as-is, never retried. MFL: no retries.
 * - Optional cache (only 200, non-HTML bodies).
 * - Never logs cookies or headers; error messages carry no URL (it may hold a private league ID).
 */
import type { HttpClient, HttpRequestOptions, HttpResponse } from "@/adapters/types";
import type { Cache } from "./cache";

export const USER_AGENT = "OfferSheet/0.1 (non-commercial fantasy trade helper; read-only)";

const HOST_GAP_MS: Record<string, number> = {
  "api.sleeper.app": 120,
  "lm-api-reads.fantasy.espn.com": 600,
  "fan.api.espn.com": 1000,
  "api.fantasycalc.com": 1500,
  "raw.githubusercontent.com": 300,
  "www.fleaflicker.com": 600,
  "myfantasyleague.com": 1200,
  "www.fantrax.com": 1200,
  "fantasysports.yahooapis.com": 1500,
};
const DEFAULT_GAP_MS = 800;
const MFL_HOST = /(^|\.)myfantasyleague\.com$/;

function bucketFor(host: string): string {
  return MFL_HOST.test(host) ? "myfantasyleague.com" : host;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function looksLikeHtml(contentType: string, text: string): boolean {
  if (/text\/html/i.test(contentType)) return true;
  const head = text.slice(0, 200).trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** Quote bare integers of 16+ digits (outside strings) so JSON.parse keeps every digit. */
export function quoteBigInts(text: string, minDigits = 16): string {
  let out = "";
  let last = 0;
  let inString = false;
  for (let i = 0; i < text.length; ) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i += 2;
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
    if (c === 45 || isDigit(c)) {
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

function parseJson(text: string, bigInts: boolean): unknown {
  const t = text.trimStart();
  if (!(t.startsWith("{") || t.startsWith("[") || t === "null")) return undefined;
  try {
    return JSON.parse(bigInts ? quoteBigInts(text) : text);
  } catch {
    return undefined;
  }
}

interface Cached {
  status: number;
  contentType: string;
  text: string;
}

export interface HttpClientOptions {
  cache?: Cache;
  userAgent?: string;
  /** Test hook. */
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const chains = new Map<string, Promise<void>>();
  const last = new Map<string, number>();
  const doFetch = options.fetchImpl ?? fetch;

  async function acquire(host: string): Promise<() => void> {
    const bucket = bucketFor(host);
    const previous = chains.get(bucket) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    chains.set(bucket, previous.then(() => mine));
    await previous;
    const wait = (last.get(bucket) ?? 0) + (HOST_GAP_MS[bucket] ?? DEFAULT_GAP_MS) - Date.now();
    if (wait > 0) await sleep(wait);
    return () => {
      last.set(bucket, Date.now());
      release();
    };
  }

  async function live(url: string, opts: HttpRequestOptions): Promise<Cached> {
    const host = new URL(url).host;
    const maxRetries = MFL_HOST.test(host) ? 0 : (options.maxRetries ?? 3);
    const headers: Record<string, string> = { "User-Agent": options.userAgent ?? USER_AGENT, Accept: "application/json, text/plain, */*", ...opts.headers };
    if (opts.cookie) headers.Cookie = opts.cookie;
    for (let attempt = 0; ; attempt++) {
      const release = await acquire(host);
      let res: Response | undefined;
      let text = "";
      let failed = false;
      try {
        res = await doFetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
        text = await res.text();
      } catch {
        failed = true;
      } finally {
        release();
      }
      const retryable = failed || (res !== undefined && (res.status === 429 || res.status >= 500));
      if (retryable && attempt < maxRetries) {
        const retryAfter = Number(res?.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(60_000, retryAfter * 1000) : Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 300));
        continue;
      }
      if (failed || !res) return { status: 0, contentType: "", text: "" };
      return { status: res.status, contentType: res.headers.get("content-type") ?? "", text };
    }
  }

  const toResponse = (c: Cached, fromCache: boolean, bigInts: boolean): HttpResponse => ({
    status: c.status,
    ok: c.status >= 200 && c.status < 300,
    isHtml: looksLikeHtml(c.contentType, c.text),
    json: parseJson(c.text, bigInts),
    text: c.text,
    fromCache,
  });

  return {
    async get(url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
      const bigInts = opts.bigIntsAsStrings ?? false;
      if (opts.cache && options.cache) {
        const hit = await options.cache.get<Cached>(opts.cache.key, opts.cache.ttlMs);
        if (hit) return toResponse(hit, true, bigInts);
      }
      const fresh = await live(url, opts);
      const response = toResponse(fresh, false, bigInts);
      if (opts.cache && options.cache && fresh.status === 200 && !response.isHtml) await options.cache.set(opts.cache.key, fresh);
      return response;
    },
  };
}
