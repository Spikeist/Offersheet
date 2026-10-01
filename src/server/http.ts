/**
 * Polite server-side HTTP client (CLAUDE.md §0.9, §2.10), implementing the adapters' HttpClient.
 *
 * - One request at a time per host bucket, with a minimum gap (all *.myfantasyleague.com hosts
 *   share one bucket: MFL's one-second rule is per client).
 * - Exponential backoff with jitter on 429 / 5xx / network errors, honouring Retry-After (a server
 *   asking for more than a minute gets its answer back instead of an early retry).
 *   401 / 403 / 404 and HTML login pages are returned as-is, never retried. MFL: no retries.
 * - Optional cache: only 200, non-HTML bodies the caller's cacheIf accepts; a failed fetch can fall
 *   back to a retained older copy (staleIfError); a cache write failure never fails the request.
 * - Single-flight (§2.10, Checkpoint 2): requests that carry a cache key and overlap share ONE live
 *   fetch and its cache write. Each request still reads the cache first with its own TTL (so Refresh's
 *   1-minute TTL is honoured); on a miss it joins the live fetch in flight for the same cache key (and
 *   the same bigIntsAsStrings and transformText presence, which shape the body) or starts one. The
 *   fetch that started it governs the request (URL, headers, cookie, timeout, retries) and the cache
 *   write (its cacheIf and retention): one cache key is one resource, the premise of the cache itself,
 *   and private keys carry credentialScope, so two sets of credentials never share a key. A joiner's
 *   copy, like a cache hit, may have been stored under another request's retention, so a caller that
 *   counts on how long the cache keeps a copy gives every request of the key one retention (weekly
 *   projections: projectionsPolicy, src/adapters/sleeper/fetch.ts). The entry is removed once the
 *   fetch settles, so a later request reads the cache (or fetches) as usual; a failure is shared the
 *   same way. Every caller gets its own response object: the one that started the fetch gets it as
 *   built, each joiner a shallow copy (the parsed json is shared by reference; nothing here mutates
 *   it), judged by the joiner's own cacheIf for its own staleIfError fallback. Requests without a
 *   cache key are never merged (they may carry cookies without a hashed key). A request whose cache
 *   read straddles the end of a shared fetch may fetch again: harmless.
 * - Never logs cookies or headers; error messages carry no URL (it may hold a private league ID).
 */
import type { HttpClient, HttpRequestOptions, HttpResponse } from "@/adapters/types";
import type { Cache, CacheEntry } from "./cache";

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
/** Longest Retry-After we wait for; a longer one returns the response instead of retrying early. */
const RETRY_AFTER_CAP_MS = 60_000;
const MFL_HOST = /(^|\.)myfantasyleague\.com$/;

function bucketFor(host: string): string {
  return MFL_HOST.test(host) ? "myfantasyleague.com" : host;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function looksLikeHtml(contentType: string, text: string): boolean {
  if (/text\/html|application\/xhtml\+xml/i.test(contentType)) return true;
  const head = text.slice(0, 1024).trimStart();
  if (head.startsWith("{") || head.startsWith("[")) return false;
  return /<(!doctype\s+html|html[\s>])/i.test(head);
}

/** Retry-After in ms (delta-seconds or an HTTP date), or undefined. */
export function retryAfterMs(value: string | null | undefined, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
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
  /** Epoch ms of the live fetch (absent in entries written before it was recorded). */
  fetchedAt?: number;
}

/** A live fetch's result, shared by every request that joined it (single-flight). */
interface LiveResult {
  response: HttpResponse;
  /** unusable() by the starting request's cacheIf (it decided the cache write). */
  unusable: boolean;
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
    const maxRetries = MFL_HOST.test(host) ? 0 : (opts.maxRetries ?? options.maxRetries ?? 3);
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
      const waitAsked = retryAfterMs(res?.headers.get("retry-after"), Date.now());
      if (retryable && attempt < maxRetries && !(waitAsked !== undefined && waitAsked > RETRY_AFTER_CAP_MS)) {
        await sleep(waitAsked !== undefined && waitAsked > 0 ? waitAsked : Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 300));
        continue;
      }
      if (failed || !res) return { status: 0, contentType: "", text: "", fetchedAt: Date.now() };
      return { status: res.status, contentType: res.headers.get("content-type") ?? "", text, fetchedAt: Date.now() };
    }
  }

  const toResponse = (c: Cached, fromCache: boolean, bigInts: boolean, fetchedAt: number | undefined): HttpResponse => ({
    status: c.status,
    ok: c.status >= 200 && c.status < 300,
    isHtml: looksLikeHtml(c.contentType, c.text),
    json: parseJson(c.text, bigInts),
    text: c.text,
    fromCache,
    ...(fetchedAt !== undefined ? { fetchedAt } : {}),
  });
  const fromEntry = (e: CacheEntry<Cached>, bigInts: boolean) => toResponse(e.value, true, bigInts, e.value.fetchedAt ?? e.storedAt);

  async function readCache(key: string, maxAgeMs: number): Promise<CacheEntry<Cached> | undefined> {
    try {
      return await options.cache?.get<Cached>(key, maxAgeMs);
    } catch {
      return undefined; // an unreadable cache is a miss, never a failed request
    }
  }

  /**
   * A live answer the caller can't use: no response, 429, 5xx, or a 200 that is an HTML page or that
   * the caller's cacheIf rejects. It isn't cached, and staleIfError serves a retained copy instead.
   */
  const unusable = (res: HttpResponse, cacheIf: HttpRequestOptions["cacheIf"]): boolean =>
    res.status === 0 || res.status === 429 || res.status >= 500 || (res.status === 200 && (res.isHtml || (cacheIf ? !cacheIf(res) : false)));

  /** One live fetch, parsed, and cached when usable (by the starting request's options; see the header). */
  async function fetchLive(url: string, opts: HttpRequestOptions, retainMs: number, bigInts: boolean): Promise<LiveResult> {
    const fresh = await live(url, opts);
    if (opts.transformText) fresh.text = opts.transformText(fresh.text);
    const response = toResponse(fresh, false, bigInts, fresh.fetchedAt);
    const bad = unusable(response, opts.cacheIf);
    const c = opts.cache;
    if (c && options.cache && fresh.status === 200 && !bad) {
      try {
        await options.cache.set(c.key, fresh, retainMs);
      } catch (err) {
        // The fresh response is still good; log only the error's name (never the key or URL).
        console.error(`[offer-sheet] cache write failed (${err instanceof Error ? err.name : typeof err}); serving the response uncached`);
      }
    }
    return { response, unusable: bad };
  }

  /** Live fetches in flight by flight key (single-flight; see the header). */
  const flights = new Map<string, Promise<LiveResult>>();
  const flightKey = (cacheKey: string, bigInts: boolean, transform: boolean) => `${bigInts ? "b" : "-"}${transform ? "t" : "-"}\u0000${cacheKey}`;

  return {
    async get(url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
      const bigInts = opts.bigIntsAsStrings ?? false;
      const c = options.cache ? opts.cache : undefined;
      const retainMs = c ? Math.max(c.ttlMs, c.retainMs ?? c.ttlMs) : 0;
      if (c) {
        const hit = await readCache(c.key, c.ttlMs);
        if (hit) return fromEntry(hit, bigInts);
      }
      let response: HttpResponse;
      let bad: boolean;
      const key = c ? flightKey(c.key, bigInts, opts.transformText !== undefined) : undefined;
      const running = key !== undefined ? flights.get(key) : undefined;
      if (running) {
        // Another request's live fetch of the same resource is in flight: share it (its own response object).
        response = { ...(await running).response };
        bad = unusable(response, opts.cacheIf);
      } else {
        const flight = fetchLive(url, opts, retainMs, bigInts);
        if (key !== undefined) {
          flights.set(key, flight);
          const settled = () => {
            if (flights.get(key) === flight) flights.delete(key);
          };
          void flight.then(settled, settled);
        }
        ({ response, unusable: bad } = await flight);
      }
      if (c && bad && c.staleIfError) {
        const old = await readCache(c.key, retainMs);
        if (old) return { ...fromEntry(old, bigInts), stale: true };
      }
      return response;
    },
  };
}
