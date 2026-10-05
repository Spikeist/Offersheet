/**
 * The browser's own HTTP client (planner reply to Checkpoint 4c, Part B, B1: "Sleeper: fetch from the browser (CORS
 * verified) to spread the load across users. ESPN public leagues: … fetch them from the browser too"; track BF): the
 * adapters' HttpClient, for the league-data halves when the user's browser reads a public ESPN league or a Sleeper league
 * itself (src/lib/leagueFetch.ts). Each user's reads then count against their own address's limits, not the server's.
 *
 * - No credentials, ever: fetch with credentials "omit" (a logged-in user's ESPN cookies never ride along, and ESPN's
 *   answer can't depend on who's logged in), and a request that asks for a cookie is refused (private leagues stay on the
 *   server). No Referer either.
 * - Polite like the server's client (CLAUDE.md §0.9): one request at a time per host, browserFetchLimits.hostGapMs apart
 *   (ESPN 250 ms, Sleeper 60 ms); backoff with jitter on 429, 5xx and no answer (browserFetchLimits.retries), honouring a
 *   Retry-After up to retryAfterCapMs (a longer one: the answer so far is the answer); each request times out after
 *   timeoutMs. 401, 403, 404 and HTML pages are answers, never retried.
 * - No cache: every read asks the platform (no-store); cache options are ignored, and cacheOnly answers "no response".
 * - The same HttpResponse as the server's client (src/adapters/httpShared.ts): a body transformText rewrites before it's
 *   parsed (ESPN's SWID pseudonyms), 16+ digit integers kept as strings with bigIntsAsStrings (Sleeper), HTML pages told
 *   from data, fetchedAt when it arrived.
 * - A CORS refusal looks like any network failure (status 0), so the caller falls back to the server.
 * - `signal` (the page that asked is gone) aborts the request under way and every one after it: they reject with the
 *   signal's reason, never retried.
 * The ESPN league view goes as a "simple" GET (no custom header, no preflight); the filtered views carry ESPN's
 * X-Fantasy-Filter, which ESPN's CORS answer allows.
 */
import { responseOf, retryAfterMs } from "@/adapters/httpShared";
import type { HttpClient, HttpRequestOptions, HttpResponse } from "@/adapters/types";
import { browserFetchLimits } from "@/server/limits";

/** The client's numbers (src/server/limits.ts browserFetchLimits by default). */
export interface BrowserHttpLimits {
  hostGapMs: Readonly<Record<string, number>>;
  defaultGapMs: number;
  retries: number;
  backoffMs: number;
  backoffJitterMs: number;
  retryAfterCapMs: number;
  timeoutMs: number;
}

export interface BrowserHttpOptions {
  fetchImpl?: typeof fetch;
  /** Aborts the request under way and every later one (the page that asked was left). */
  signal?: AbortSignal;
  /** Test hooks: the clock, waiting, the jitter's randomness, the numbers. */
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  limits?: BrowserHttpLimits;
}

/** The error a request asking for a cookie is refused with (see the header). */
export const COOKIES_REFUSED = "The browser's client never sends cookies: a private league is read by Offer Sheet's server.";

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What came back, before it's parsed: status 0 when nothing did. */
interface Answer {
  status: number;
  contentType: string;
  text: string;
  retryAfter: string | null;
}

export function createBrowserHttpClient(opts: BrowserHttpOptions = {}): HttpClient {
  const limits = opts.limits ?? browserFetchLimits;
  const doFetch = opts.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const clock = opts.clock ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const outer = opts.signal;
  /** Each host's queue: the turn now held (a promise that settles when it's handed on) and when its last request ended. */
  const hosts = new Map<string, { chain: Promise<void>; lastEnd: number }>();

  const abortedReason = (): unknown => outer?.reason ?? new DOMException("The page that asked is gone.", "AbortError");
  const throwIfAborted = () => {
    if (outer?.aborted) throw abortedReason();
  };

  /** The host's turn (one request at a time, the gap after the last one); the returned function hands it on. */
  async function turn(host: string): Promise<() => void> {
    const queue = hosts.get(host) ?? { chain: Promise.resolve(), lastEnd: Number.NEGATIVE_INFINITY };
    hosts.set(host, queue);
    let handOn!: () => void;
    const mine = new Promise<void>((resolve) => {
      handOn = resolve;
    });
    const before = queue.chain;
    queue.chain = before.then(() => mine);
    await before;
    const gap = limits.hostGapMs[host] ?? limits.defaultGapMs;
    const wait = queue.lastEnd + gap - clock();
    if (wait > 0) await sleep(wait);
    return () => {
      queue.lastEnd = clock();
      handOn();
    };
  }

  /** One attempt: the platform's answer, or status 0 when none came (a network error, a CORS refusal, the timeout). */
  async function attempt(url: string, headers: Record<string, string> | undefined): Promise<Answer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("The platform took too long to answer.", "TimeoutError")), limits.timeoutMs);
    const onAbort = () => controller.abort(abortedReason());
    outer?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await doFetch(url, {
        method: "GET",
        ...(headers && Object.keys(headers).length ? { headers } : {}),
        credentials: "omit",
        mode: "cors",
        cache: "no-store",
        redirect: "follow",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      const text = await res.text();
      return { status: res.status, contentType: res.headers.get("content-type") ?? "", text, retryAfter: res.headers.get("retry-after") };
    } catch (err) {
      if (outer?.aborted) throw abortedReason();
      void err;
      return { status: 0, contentType: "", text: "", retryAfter: null };
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    }
  }

  return {
    async get(url: string, ro: HttpRequestOptions = {}): Promise<HttpResponse> {
      if (ro.cookie !== undefined) throw new Error(COOKIES_REFUSED);
      if (ro.cacheOnly) return { status: 0, ok: false, isHtml: false, json: undefined, text: "", fromCache: false };
      const host = new URL(url).host;
      for (let n = 0; ; n++) {
        throwIfAborted();
        const handOn = await turn(host);
        let answer: Answer;
        try {
          throwIfAborted();
          answer = await attempt(url, ro.headers);
        } finally {
          handOn();
        }
        const retryable = answer.status === 0 || answer.status === 429 || answer.status >= 500;
        if (retryable && n < limits.retries) {
          const asked = retryAfterMs(answer.retryAfter, clock());
          if (!(asked !== undefined && asked > limits.retryAfterCapMs)) {
            const wait = asked !== undefined && asked > 0 ? asked : limits.backoffMs * 2 ** n + Math.floor(random() * limits.backoffJitterMs);
            await sleep(wait);
            continue;
          }
        }
        const text = ro.transformText ? ro.transformText(answer.text) : answer.text;
        return responseOf({ status: answer.status, contentType: answer.contentType, text }, { fromCache: false, bigInts: ro.bigIntsAsStrings ?? false, fetchedAt: clock() });
      }
    },
  };
}
