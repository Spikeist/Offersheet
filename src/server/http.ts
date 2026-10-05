/**
 * Polite server-side HTTP client (CLAUDE.md §0.9, §2.10), implementing the adapters' HttpClient.
 *
 * - One request at a time per host bucket, with a minimum gap (all *.myfantasyleague.com hosts
 *   share one bucket: MFL's one-second rule is per client).
 * - Exponential backoff with jitter on 429 / 5xx / network errors, honouring Retry-After (a server
 *   asking for more than a minute gets its answer back instead of an early retry).
 *   401 / 403 / 404 and HTML login pages are returned as-is, never retried. MFL: no retries.
 * - Optional cache: only 200, non-HTML bodies the caller's cacheIf accepts; a failed fetch can fall
 *   back to a retained older copy (staleIfError), which then says what the live answer was (HttpResponse.liveFailure: its
 *   status, 0 for none, and whether it was an HTML page); a cache write failure never fails the request. cacheOnly
 *   (HttpRequestOptions) never fetches: the cache's copy (a retained one with staleIfError, marked stale), else a status-0
 *   response without any request.
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
 * - Across server instances (planner reply to Checkpoint 4c, Part B, B1: the shared cache; track CA): with the shared
 *   cache (src/app/api/_lib/deps.ts passes HttpClientOptions.lock only with Redis), the live fetch of a league-independent
 *   entry (cache.public) goes through a Redis lock (src/server/cache.ts RedisCacheLock): one instance fetches and writes
 *   the cache; another that finds the lock taken waits for its release (checked every cacheLimits.lockPollMs, at most
 *   cacheLimits.lockWaitMs and never past the request's deadline), then serves that instance's copy as a cache hit
 *   (fromCache; read with an age bound, so a copy older than the wait and this request's TTL never stands in for it),
 *   or fetches itself when there is none (the holder's answer couldn't be cached) or the wait ran out. League data (no
 *   cache.public) stays in-process single-flight only. Without the lock (this computer, tests, scripts) nothing changes.
 * - Never logs cookies or headers; error messages carry no URL (it may hold a private league ID).
 * - The offline guard (planner reply to Checkpoint 4c, A5: "Verification and report scripts never touch the network
 *   unless given --live"): a script run without --live sets NETWORK_ENV to "off" (scripts/lib/runMode.ts
 *   setNetworkMode), and in such a process every live fetch is refused with NetworkOffError before any request
 *   (refuseIfNetworkOff), said once on stderr so an adapter that turns the error into a warning can't hide it. ⚠️ Our
 *   reading of "never touch the network": the cache is still read (a fresh copy, cacheOnly). The app never sets it, and
 *   the stable copy and check:browser start their servers without "off" (scripts/stable.ts, check-browser).
 * - Entries other versions wrote (planner reply to Checkpoint 4c, A1): the stable copy, an older checkpoint's code, shares
 *   this cache's folder with the development copy (scripts/stable.ts, src/app/api/_lib/deps.ts). So an entry is read only
 *   when it has the shape this version stores (isCachedResponse: else a miss, and no stand-in for staleIfError; never a
 *   thrown error), and what each version stores is filed under its CACHE_FORMAT (cacheStoreKey): a change to what's
 *   stored under a key (Cached's fields, a transformText, what the text holds) bumps CACHE_FORMAT, so each version then
 *   reads and writes only its own entries; the files of either version still go when their retention ends (FileCache's
 *   sweep reads only its own envelope). Format 1, the one before formats existed, keeps its plain keys: no cached copy
 *   is lost on the update. ⚠️ A version that stores a wrong body under the right key and format (a bug in work in
 *   progress, in the development server or a --live report) still reaches the other copy while it's served fresh (up to
 *   10 minutes for league data, 6–24 hours for projections, player lists and value lists), and longer as a stand-in
 *   while its source is down (staleIfError).
 * - The request's deadline (planner reply to Checkpoint 4c, Part B, B1; track RL; src/server/deadline.ts): inside an API
 *   route no attempt starts with less than deadlines.minAttemptMs left, a wait in the host's queue or a backoff wait never
 *   runs past it, and each fetch's timeout is capped at the time left. A request that joins another's fetch
 *   (single-flight) waits no longer than its own deadline; when the deadline of the request that started the fetch cut it
 *   short, a joiner that still has the time asks once more itself. Cache reads and writes get at most
 *   deadlines.cacheGraceMs past the deadline (a read then is a miss; a write goes on behind), and a request's own fetch,
 *   whose cross-instance lock calls Redis too, twice that (a hanging store can't hold a route to its maxDuration; a fetch
 *   stuck there is dropped from the single-flight map, so later requests start their own); a wait that starts past its
 *   bound still gets deadlines.lateFloorMs, so a healthy cache keeps answering a request that ran late (a saved copy
 *   standing in, a background rebuild), until one wait of the request comes back late (src/server/deadline.ts
 *   withinDeadline). An attempt that can't go out, or is cut short, comes back as "no response" (status 0, the adapters'
 *   and loaders' usual path; a retained copy stands in with staleIfError) marked `cut: "deadline"` (ResponseCut: an outage
 *   memory tells it from a source that stopped answering), or as the last answer when it was a retry (the source's own
 *   answer, unmarked); the scope notes why (src/server/deadline.ts CutReason: the source was slow, Offer Sheet's own queue
 *   or store was busy, or no time was left) so the route can say so. Outside a route (scripts, tests) there's no deadline
 *   and nothing changes.
 * - The daily budgets (track RL; src/server/budget.ts): every live attempt to a budgeted host (ESPN, Sleeper, FantasyCalc,
 *   GitHub raw) counts, retries included, before it goes out, and a league request made for an API request also counts
 *   against its client's share of the day (on Vercel). Over a budget, it doesn't go out: a retry returns the last answer;
 *   a first attempt for league-independent data (cache.public, or a staleIfError request: the public sources) is "no
 *   response" like an outage (their saved copy or their warning), marked `cut: "budget"`; any other first attempt throws
 *   BudgetExhaustedError (`by`: the day or the client's share), which the import routes answer with BUSY
 *   (src/app/api/_lib/respond.ts). A joiner of a fetch its starter's share refused asks itself. Without Redis the check is
 *   synchronous, so local timing is as before.
 */
import { responseOf, retryAfterMs } from "@/adapters/httpShared";
import type { HttpClient, HttpRequestOptions, HttpResponse } from "@/adapters/types";
import { BudgetExhaustedError, budgetPlatformOf, isBudgetExhaustedError, outboundBudget, type OutboundBudget } from "./budget";
import type { Cache, CacheEntry, CacheLock } from "./cache";
import { LATE, nextArrival, noteCut, requestScope, timeLeftMs, withinDeadline } from "./deadline";
import { deadlines } from "./limits";
import { errorNameOf, logEvent } from "./log";

/**
 * The parse helpers live in src/adapters/httpShared.ts (track BF: the browser's own client reads answers the same way);
 * these two stay importable from here, as before.
 */
export { quoteBigInts, retryAfterMs } from "@/adapters/httpShared";

export const USER_AGENT = "OfferSheet/0.1 (non-commercial fantasy trade helper; read-only)";

/** The offline guard's environment variable (see the header): "off" refuses every live fetch in the process. */
export const NETWORK_ENV = "OFFERSHEET_NETWORK";

/** A live fetch refused by the offline guard (see the header): the host only, never a URL. */
export class NetworkOffError extends Error {
  constructor(host: string) {
    super(`offline: a request to ${host} was refused (this script runs without --live, so it never touches the network)`);
    this.name = "NetworkOffError";
  }
}

let refusalSaid = false;

/** Throws NetworkOffError when this process runs with the network off (NETWORK_ENV "off"); the first refusal is also said on stderr. */
export function refuseIfNetworkOff(host: string, env: Readonly<Record<string, string | undefined>> = process.env): void {
  if (env[NETWORK_ENV] !== "off") return;
  const err = new NetworkOffError(host);
  if (!refusalSaid) {
    refusalSaid = true;
    console.error(`[offer-sheet] ${err.message}. Pass --live to allow the network.`);
  }
  throw err;
}

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

/** What the cache holds under a key (see the header: a change here bumps CACHE_FORMAT). */
interface Cached {
  status: number;
  contentType: string;
  text: string;
  /** Epoch ms of the live fetch (absent in entries written before it was recorded). */
  fetchedAt?: number;
}

/**
 * The format of what this version stores under a key (Cached; see the header). Bump it whenever that changes, so the
 * stable copy (an older checkpoint) and the development copy, which share one cache folder, never read each other's
 * entries. http.test.ts pins Cached's fields to it. (scripts/minimize/espn-trade-refill.ts reads format 1's files
 * directly, by their plain keys: a bump moves it too.)
 */
export const CACHE_FORMAT = 1;

/** The key an entry is filed under in the cache: the request's own key for format 1 (as before formats existed), else prefixed with the format. */
export function cacheStoreKey(key: string, format: number = CACHE_FORMAT): string {
  return format === 1 ? key : `http-format-${format}\u0000${key}`;
}

/** An entry this version can read (Cached's shape); anything else (another version's, or damaged) is a miss. */
export function isCachedResponse(value: unknown): value is Cached {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.status === "number" &&
    Number.isInteger(v.status) &&
    typeof v.contentType === "string" &&
    typeof v.text === "string" &&
    (v.fetchedAt === undefined || (typeof v.fetchedAt === "number" && Number.isFinite(v.fetchedAt)))
  );
}

/**
 * Why a response is "no response" though its source may be fine (the header; src/server/deadline.ts): "deadline", the
 * request's deadline cut it (never asked, cut short, or a wait for another request's fetch ran out); "budget", a daily
 * budget refused it. Carried on the HttpResponse as `cut` (responseCut reads it), also on a saved copy standing in for it,
 * so an outage memory (src/data/sleeperProjections.ts sleeperGate, src/data/fantasyCalcValues.ts fantasyCalcGate) can tell
 * a request that ran out of time from a source that stopped answering. Never on a source's own answer (a 503, an HTML
 * page, a network error or its own timeout).
 */
export type ResponseCut = "deadline" | "budget";

/** An HttpResponse with its cut, when it has one (ResponseCut). */
export type CutHttpResponse = HttpResponse & { cut?: ResponseCut };

/** The response's cut (ResponseCut), or undefined for an answer from the source or the cache (any response-like object). */
export function responseCut(res: object): ResponseCut | undefined {
  const cut = (res as { cut?: unknown }).cut;
  return cut === "deadline" || cut === "budget" ? cut : undefined;
}

/** A live fetch's result, shared by every request that joined it (single-flight). */
interface LiveResult {
  response: CutHttpResponse;
  /** unusable() by the starting request's cacheIf (it decided the cache write). */
  unusable: boolean;
}

/** One live fetch's answer, or why there is none though the source may be fine (ResponseCut). */
interface LiveAnswer {
  answer: Cached;
  cut?: ResponseCut;
}

/** A "no response" the deadline or a budget made (ResponseCut). */
function cutResponse(cut: ResponseCut): CutHttpResponse {
  return { status: 0, ok: false, isHtml: false, json: undefined, text: "", fromCache: false, fetchedAt: Date.now(), cut };
}

export interface HttpClientOptions {
  cache?: Cache;
  userAgent?: string;
  /** Test hook. */
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  /** The daily outbound budget (src/server/budget.ts; the header): the process's by default, null for none (a test hook). */
  budget?: OutboundBudget | null;
  /**
   * Cross-instance single-flight for league-independent entries (cache.public; the header's shared-cache bullet): set only
   * with the shared cache (src/app/api/_lib/deps.ts: Redis), so locally nothing changes.
   */
  lock?: CacheLock;
}

/**
 * League-independent data (the header's budget rule): a request marked cache.public (src/adapters/types.ts), or one that
 * asks for a saved copy when its source fails (staleIfError: only the public sources do, src/data/source.ts).
 */
export function isLeagueIndependent(opts: HttpRequestOptions): boolean {
  const cache = opts.cache as (HttpRequestOptions["cache"] & { public?: boolean }) | undefined;
  return cache?.public === true || cache?.staleIfError === true;
}

/** One request waiting for its host's turn (createHttpClient's acquire). */
interface Waiter {
  /** Its place: the epoch ms its API request started (or it arrived, outside one), then the arrival order. */
  time: number;
  order: number;
  grant: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * A host's turn (createHttpClient's acquire): its release, or why the request's deadline came first (src/server/deadline.ts
 * CutReason): "slow", another request's answer held the turn deadlines.slowAnswerMs or more (the source is slow); "busy",
 * the queue of other requests was long (Offer Sheet's own pacing); "skipped", there was no time to wait at all.
 */
type Turn = { release: () => void } | { cut: "slow" | "busy" | "skipped" };

/** Whether `a` is served before `b`: the request that reached Offer Sheet first (see acquire). */
function before(a: Waiter, b: Waiter): boolean {
  return a.time < b.time || (a.time === b.time && a.order < b.order);
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  /**
   * Each host bucket's turn: whether a request holds it (and since when), who waits (in serving order), and a hand-over set
   * for after the gap.
   */
  const queues = new Map<string, { busy: boolean; heldSince?: number; waiting: Waiter[]; handOver?: ReturnType<typeof setTimeout> }>();
  const last = new Map<string, number>();
  const doFetch = options.fetchImpl ?? fetch;
  const budgetOf = (): OutboundBudget | null => (options.budget === undefined ? outboundBudget() : options.budget);

  /**
   * Gives the bucket's free turn to the first waiter once the host's gap since the last request has passed. The gap is
   * waited out before choosing, so a request that comes back for its next one meanwhile (an import reading its last
   * answer) is in the queue when the choice is made.
   */
  function dispatch(bucket: string): void {
    const q = queues.get(bucket);
    if (!q || q.busy || q.handOver || !q.waiting.length) return;
    const due = (last.get(bucket) ?? 0) + (HOST_GAP_MS[bucket] ?? DEFAULT_GAP_MS) - Date.now();
    if (due > 0) {
      q.handOver = setTimeout(() => {
        q.handOver = undefined;
        dispatch(bucket);
      }, due);
      return;
    }
    const next = q.waiting.shift() as Waiter;
    if (next.timer) clearTimeout(next.timer);
    q.busy = true;
    q.heldSince = Date.now();
    next.grant();
  }

  /** Ends a turn (`made`: a request went out, so the gap counts from now) and passes it on. */
  function finish(bucket: string, made: boolean): void {
    if (made) last.set(bucket, Date.now());
    const q = queues.get(bucket);
    if (q) {
      q.busy = false;
      q.heldSince = undefined;
    }
    dispatch(bucket);
  }

  /**
   * The host's turn: one request at a time per bucket, with its gap. Requests are served in the order they reached Offer
   * Sheet: an API request's outbound requests by when that request started (src/server/deadline.ts; its later requests
   * keep its place, so an import that started first finishes first instead of every import queueing behind every other's
   * requests), anything outside a request by when it asked (first come, first served, as before the deadline existed).
   * Inside a route (the header's deadline) the turn isn't waited for past the time an attempt needs: then the Turn says
   * why it wasn't given (whose time it was: a slow answer holding the turn, or a long queue).
   */
  async function acquire(host: string): Promise<Turn> {
    const bucket = bucketFor(host);
    let q = queues.get(bucket);
    if (!q) {
      q = { busy: false, waiting: [] };
      queues.set(bucket, q);
    }
    const queue = q;
    const scope = requestScope();
    const queueMs = timeLeftMs() - deadlines.minAttemptMs;
    return new Promise<Turn>((resolve) => {
      const grant = () => resolve({ release: () => finish(bucket, true) });
      const me: Waiter = scope ? { time: scope.startedAt, order: scope.order, grant } : { time: Date.now(), order: nextArrival(), grant };
      const at = queue.waiting.findIndex((w) => before(me, w));
      queue.waiting.splice(at < 0 ? queue.waiting.length : at, 0, me);
      if (queueMs !== Number.POSITIVE_INFINITY) {
        me.timer = setTimeout(
          () => {
            const i = queue.waiting.indexOf(me);
            if (i >= 0) queue.waiting.splice(i, 1);
            const heldMs = queue.busy && queue.heldSince !== undefined ? Date.now() - queue.heldSince : 0;
            resolve({ cut: queueMs <= 0 ? "skipped" : heldMs >= deadlines.slowAnswerMs ? "slow" : "busy" });
          },
          Math.max(0, queueMs),
        );
      }
      dispatch(bucket);
    });
  }

  async function live(url: string, opts: HttpRequestOptions): Promise<LiveAnswer> {
    const host = new URL(url).host;
    refuseIfNetworkOff(host); // the offline guard (the header), before any request
    const platform = budgetPlatformOf(host);
    const cutAs = platform ?? "other";
    const maxRetries = MFL_HOST.test(host) ? 0 : (opts.maxRetries ?? options.maxRetries ?? 3);
    const headers: Record<string, string> = { "User-Agent": options.userAgent ?? USER_AGENT, Accept: "application/json, text/plain, */*", ...opts.headers };
    if (opts.cookie) headers.Cookie = opts.cookie;
    const noResponse = (): Cached => ({ status: 0, contentType: "", text: "", fetchedAt: Date.now() });
    const independent = isLeagueIndependent(opts);
    // A league request made for an API request also counts against its client's share (the header; src/server/budget.ts).
    const client = independent ? undefined : requestScope()?.client;
    /** The answer a retry would have replaced: what the caller gets when the retry can't go out (deadline or budget). */
    let previous: Cached | undefined;
    /**
     * No time for this attempt, for the reason given (src/server/deadline.ts CutReason; `label`: whose time it was, the
     * source's platform by default): the source's last answer stands; with none, it's "no response" cut by the deadline.
     */
    const outOfTime = (why: "slow" | "busy" | "skipped", label: string = cutAs): LiveAnswer => {
      if (previous) return { answer: previous };
      noteCut(why, label);
      return { answer: noResponse(), cut: "deadline" };
    };
    for (let attempt = 0; ; attempt++) {
      // The request's deadline (the header): no attempt without the time for one.
      if (timeLeftMs() < deadlines.minAttemptMs) return outOfTime("skipped");
      // The day's budget and the client's share (the header): every attempt counts, before it goes out.
      const budget = platform ? budgetOf() : null;
      if (budget && platform) {
        const asked = budget.take(platform, Date.now(), client);
        // A shared count (Redis) is waited for no longer than the deadline (each of its commands has its own timeout too).
        const verdict = typeof asked === "string" ? asked : await withinDeadline(asked);
        if (verdict === LATE) return outOfTime("busy", "upstash");
        if (verdict !== "ok") {
          noteCut(verdict === "share" ? "share" : "budget", platform);
          if (previous) return { answer: previous };
          if (independent) return { answer: noResponse(), cut: "budget" };
          throw new BudgetExhaustedError(platform, verdict);
        }
      }
      const turn = await acquire(host);
      if (!("release" in turn)) return outOfTime(turn.cut);
      const askedMs = opts.timeoutMs ?? 30_000;
      const timeoutMs = Math.max(1, Math.min(askedMs, timeLeftMs()));
      let res: Response | undefined;
      let text = "";
      let failed = false;
      try {
        res = await doFetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
        text = await res.text();
      } catch {
        failed = true;
      } finally {
        turn.release();
      }
      // The deadline cut this attempt short: its timeout was the time left (shorter than asked), and that ran out.
      if (failed && timeoutMs < askedMs && timeLeftMs() < deadlines.minAttemptMs) return outOfTime("slow");
      const answer: Cached = failed || !res ? noResponse() : { status: res.status, contentType: res.headers.get("content-type") ?? "", text, fetchedAt: Date.now() };
      const retryable = failed || (res !== undefined && (res.status === 429 || res.status >= 500));
      const waitAsked = retryAfterMs(res?.headers.get("retry-after"), Date.now());
      if (retryable && attempt < maxRetries && !(waitAsked !== undefined && waitAsked > RETRY_AFTER_CAP_MS)) {
        const wait = waitAsked !== undefined && waitAsked > 0 ? waitAsked : Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 300);
        // Never a backoff wait past the deadline: the answer so far (the source's own) is the answer.
        if (wait + deadlines.minAttemptMs > timeLeftMs()) return { answer };
        await sleep(wait);
        previous = answer;
        continue;
      }
      return { answer };
    }
  }

  const toResponse = (c: Cached, fromCache: boolean, bigInts: boolean, fetchedAt: number | undefined): HttpResponse => responseOf(c, { fromCache, bigInts, fetchedAt });
  const fromEntry = (e: CacheEntry<Cached>, bigInts: boolean) => toResponse(e.value, true, bigInts, e.value.fetchedAt ?? e.storedAt);

  async function readCache(key: string, maxAgeMs: number): Promise<CacheEntry<Cached> | undefined> {
    if (!options.cache) return undefined;
    let entry: CacheEntry<unknown> | undefined;
    try {
      // Inside a route, at most deadlines.cacheGraceMs past its deadline (the header): a hanging store is a miss.
      const got = await withinDeadline(options.cache.get<unknown>(cacheStoreKey(key), maxAgeMs), deadlines.cacheGraceMs);
      if (got === LATE) {
        noteCut("busy", "cache");
        return undefined;
      }
      entry = got;
    } catch {
      return undefined; // an unreadable cache is a miss, never a failed request
    }
    // An entry of another shape (another version's, or damaged) is a miss too (see the header).
    return entry && isCachedResponse(entry.value) ? (entry as CacheEntry<Cached>) : undefined;
  }

  /**
   * A live answer the caller can't use: no response, 429, 5xx, or a 200 that is an HTML page or that
   * the caller's cacheIf rejects. It isn't cached, and staleIfError serves a retained copy instead.
   */
  const unusable = (res: HttpResponse, cacheIf: HttpRequestOptions["cacheIf"]): boolean =>
    res.status === 0 || res.status === 429 || res.status >= 500 || (res.status === 200 && (res.isHtml || (cacheIf ? !cacheIf(res) : false)));

  /** One live fetch, parsed, and cached when usable (by the starting request's options; see the header). */
  async function fetchLive(url: string, opts: HttpRequestOptions, retainMs: number, bigInts: boolean): Promise<LiveResult> {
    const { answer: fresh, cut } = await live(url, opts);
    if (opts.transformText) fresh.text = opts.transformText(fresh.text);
    const response: CutHttpResponse = { ...toResponse(fresh, false, bigInts, fresh.fetchedAt), ...(cut ? { cut } : {}) };
    const bad = unusable(response, opts.cacheIf);
    const c = opts.cache;
    if (c && options.cache && fresh.status === 200 && !bad) {
      try {
        // Inside a route, at most deadlines.cacheGraceMs past its deadline (the header): the write goes on in the background.
        const wrote = await withinDeadline(options.cache.set(cacheStoreKey(c.key), fresh, retainMs), deadlines.cacheGraceMs);
        if (wrote === LATE) noteCut("busy", "cache");
      } catch (err) {
        // The fresh response is still good, served uncached; the log has only the error's name (never the key or URL).
        logEvent({ event: "cache_write_failed", errorName: errorNameOf(err) });
      }
    }
    return { response, unusable: bad };
  }

  /**
   * fetchLive through the cross-instance lock (the header's shared-cache bullet): with options.lock, a league-independent
   * entry (cache.public) is fetched by one instance at a time; an instance that finds the lock taken serves that instance's
   * copy as a cache hit (stored since it began waiting, or within its own TTL), or fetches itself when there is none.
   */
  function fetchShared(url: string, opts: HttpRequestOptions, retainMs: number, bigInts: boolean): Promise<LiveResult> {
    const c = opts.cache;
    if (!options.lock || !options.cache || !c?.public) return fetchLive(url, opts, retainMs, bigInts);
    // Read with an age bound, so an older copy the cache retains is never taken for the holder's (nor kept in memory).
    const copy = async (since: number): Promise<LiveResult | undefined> => {
      const e = await readCache(c.key, Math.max(c.ttlMs, Date.now() - since));
      return e ? { response: fromEntry(e, bigInts), unusable: false } : undefined;
    };
    return options.lock.run(cacheStoreKey(c.key), copy, () => fetchLive(url, opts, retainMs, bigInts));
  }

  /** Live fetches in flight by flight key (single-flight; see the header). */
  const flights = new Map<string, Promise<LiveResult>>();
  const flightKey = (cacheKey: string, bigInts: boolean, transform: boolean) => `${bigInts ? "b" : "-"}${transform ? "t" : "-"}\u0000${cacheKey}`;

  /**
   * A live fetch this request starts (registered for joiners under `key`, single-flight). Inside a route it's awaited at
   * most twice deadlines.cacheGraceMs past the deadline: its live attempts end at the deadline and its cache write within
   * the grace after it (fetchLive), so a fetch still running then is stuck in the cross-instance lock's own calls (a
   * hanging store). Such a fetch leaves the single-flight map, so later requests start their own rather than joining it,
   * and this request has "no response" (the scope notes the cache).
   */
  async function startFetch(url: string, opts: HttpRequestOptions, retainMs: number, bigInts: boolean, key: string | undefined): Promise<LiveResult> {
    const flight = fetchShared(url, opts, retainMs, bigInts);
    if (key !== undefined) {
      flights.set(key, flight);
      const settled = () => {
        if (flights.get(key) === flight) flights.delete(key);
      };
      void flight.then(settled, settled);
    }
    const result = await withinDeadline(flight, 2 * deadlines.cacheGraceMs);
    if (result !== LATE) return result;
    if (key !== undefined && flights.get(key) === flight) flights.delete(key);
    noteCut("busy", "cache");
    return { response: cutResponse("deadline"), unusable: true };
  }

  /**
   * The live answer for a request the cache didn't serve (single-flight; the header): the fetch in flight for the same
   * entry, joined, else one this request starts. A joiner gets its own response object, judged by its own cacheIf, and
   * waits no longer than its own deadline (then "no response": the source was slow, for all it knows). A joined fetch cut
   * short for reasons of the request that started it (its deadline, or its client's share of a daily budget) is asked for
   * again, once, while this request still has the time; a day's budget is everyone's, so its refusal is shared.
   */
  async function obtain(url: string, opts: HttpRequestOptions, retainMs: number, bigInts: boolean, key: string | undefined): Promise<LiveResult> {
    const cutAs = budgetPlatformOf(new URL(url).host) ?? "other";
    for (let round = 0; ; round++) {
      const running = key !== undefined ? flights.get(key) : undefined;
      if (!running) return startFetch(url, opts, retainMs, bigInts, key);
      const mayAskAgain = () => round === 0 && timeLeftMs() >= deadlines.minAttemptMs;
      let joined: LiveResult | typeof LATE;
      try {
        joined = await withinDeadline(running);
      } catch (err) {
        if (!isBudgetExhaustedError(err)) throw err;
        if (err.by === "share") {
          // The starter's client's share, not this request's.
          if (mayAskAgain()) continue;
          noteCut("skipped", cutAs);
          return { response: cutResponse("deadline"), unusable: true };
        }
        noteCut("budget", err.platform);
        throw err;
      }
      if (joined === LATE) {
        noteCut("slow", cutAs);
        return { response: cutResponse("deadline"), unusable: true };
      }
      const cut = responseCut(joined.response);
      if (cut === "deadline") {
        // The starter ran out of time; this request may not have.
        if (mayAskAgain()) continue;
        noteCut("skipped", cutAs);
      } else if (cut === "budget") noteCut("budget", cutAs);
      // Another request's live fetch of the same resource: its own response object, judged by its own cacheIf.
      const response = { ...joined.response };
      return { response, unusable: unusable(response, opts.cacheIf) };
    }
  }

  return {
    async get(url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
      const bigInts = opts.bigIntsAsStrings ?? false;
      const c = options.cache ? opts.cache : undefined;
      const retainMs = c ? Math.max(c.ttlMs, c.retainMs ?? c.ttlMs) : 0;
      if (c) {
        const hit = await readCache(c.key, c.ttlMs);
        if (hit) return fromEntry(hit, bigInts);
      }
      if (opts.cacheOnly) {
        // Never ask the source (HttpRequestOptions.cacheOnly): a retained older copy with staleIfError, else no response.
        if (c?.staleIfError) {
          const old = await readCache(c.key, retainMs);
          if (old) return { ...fromEntry(old, bigInts), stale: true };
        }
        return { status: 0, ok: false, isHtml: false, json: undefined, text: "", fromCache: false };
      }
      const key = c ? flightKey(c.key, bigInts, opts.transformText !== undefined) : undefined;
      const { response, unusable: bad } = await obtain(url, opts, retainMs, bigInts, key);
      if (c && bad && c.staleIfError) {
        const old = await readCache(c.key, retainMs);
        // A copy standing in for an answer the deadline or a budget cut says so too (ResponseCut).
        const cut = responseCut(response);
        if (old) return { ...fromEntry(old, bigInts), stale: true, liveFailure: { status: response.status, isHtml: response.isHtml }, ...(cut ? { cut } : {}) } satisfies CutHttpResponse;
      }
      return response;
    },
  };
}
