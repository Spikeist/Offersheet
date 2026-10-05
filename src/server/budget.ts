/**
 * Daily budgets (planner reply to Checkpoint 4c, Part B, B1: "Outbound pacing and a daily request budget per platform,
 * especially for ESPN"; Checkpoint 7a, track RL; final review SEC-1, SEC-2, POL-2, F1): what the server may ask of each
 * platform a day (OutboundBudget), and what work it may do for visitors a day (DailyQuota: the work budget, and the
 * feedback route's daily copies).
 *
 * The outbound budgets:
 * - Platforms and limits (limits.budgets.perDay): ESPN (lm-api-reads and fan.api) 4,000 a day, Sleeper 15,000, FantasyCalc
 *   200, GitHub raw (the DynastyProcess ID map) 100. Other hosts aren't budgeted (none is used on the server today).
 * - Every live attempt counts, retries included, checked before it goes out (src/server/http.ts); cached copies, joined
 *   single-flight fetches and the browser's own requests don't. UTC days.
 * - In slices (on Vercel only; review SEC-2: a burst can take one slice): by the end of each of the day's
 *   limits.budgets.slices (2 hours each) at most that share of the day may be spent, unused budget carried on, but never
 *   less than budgets.burstShare of it (slicedAllowance). A refusal by the day's slice is said like a refusal by the day;
 *   its Retry-After is when the allowance next grows (msUntilAllowanceGrows).
 * - A reserve for requests that carry a visitor's ESPN cookies (on Vercel only; review SEC-2: private leagues have no
 *   browser path): requests without cookies stop budgets.reservedForCookies short of the day (`take`'s `privileged`).
 * - Each client's share (on Vercel only; limits.budgets.perClientPerDay: ESPN 400, Sleeper 1,500 a day): a league request
 *   made for an API request also counts against that client's share of the platform's day, checked first, so a client over
 *   its share spends nothing of the day's budget and a few clients can't spend it for everyone. The client is the request's
 *   group (src/server/deadline.ts RequestScope.group: withRoute's HMAC of the IP address's /24, or the IPv6 address's /48;
 *   review SEC-2: one person can hold a whole /48), see src/server/http.ts. League-independent data (projections, player
 *   lists, trade values …) is fetched once for everyone and counts against no client. Locally there are no shares, slices
 *   or reserve (Parker's own testing is one client; Part B's ground rules: local runs stay as they were).
 * - With Redis (on Vercel only: off Vercel nothing here contacts Upstash, even with its variables in .env.local): one
 *   counter per platform and day shared by every instance, `prefix + "budget:" + platform + ":" + day`, and one per client,
 *   platform and day, `prefix + "budget:client:" + platform + ":" + client + ":" + day`, each counted with its expiry in one
 *   transaction (RedisLike.incrExpire; review POL-2: no counter, above all no client's, ever exists without its expiry): the
 *   day's counter lives limits.budgets.keyTtlMs past its last count, a client's until its UTC day ends plus
 *   limits.budgets.clientKeyMarginMs. Once a platform's counter passes its allowance, this process remembers it until the
 *   allowance next grows and asks Redis nothing more for it; a client over its share is remembered until its day ends.
 *   Redis down or slower than limits.budgets.timeoutMs: the attempt goes through, counted in this process's own budget and
 *   shares (fail open), and Redis is left alone for limits.budgets.redisRetryAfterMs (logged once).
 * - Without Redis (local, the stable copy, tests, scripts, a preview before Upstash is connected): each process counts its
 *   own, synchronously, so the HTTP client's timing doesn't change.
 * - Over budget, the attempt doesn't go out (src/server/http.ts): a league request throws BudgetExhaustedError, `by` "day"
 *   or "share" (the import answers BUSY: "Offer Sheet has used today's share of requests to ESPN. Try again in about 6
 *   hours.", or for a client's share "Your connection has used today's share of requests to ESPN. …"); a league-independent
 *   one comes back as "no response", the loaders' usual path (a saved copy stands in, else their warning). Logged once
 *   per process, platform and day (a share: once per process, platform and day, whichever client).
 *
 * The daily quotas (createDailyQuota; limits.workLimits, limits.feedbackLimits; on Vercel only):
 * - The work budget (final review SEC-1, F1: Vercel's Hobby plan pauses the whole project for up to 30 days once a month's
 *   Active CPU or Fast Origin Transfer runs out, and nothing capped the server's work for one client or for everyone): each
 *   import and League page request costs units (admissionUnits, charged by withRoute when it arrives; the handlers charge a
 *   big model build's extra units, chargeWork), counted per UTC day against its client (an IPv4 address or IPv6 /64), its
 *   group (an IPv4 /24 or IPv6 /48) and the server's whole day (in slices, as above). Past any of them the request is
 *   refused (src/app/api/_lib/route.ts workRefusedResponse: BUSY).
 * - The feedback route's copies (final review SEC-3): perClientPerDay and perGroupPerDay copies a client and a group may
 *   send a day (src/app/api/feedback/handler.ts).
 * - Counted in Redis like the budgets: one counter per quota, scope and UTC day (`prefix + name + ":" + day`, `prefix + name
 *   + ":client:" + client + ":" + day`, `prefix + name + ":group:" + group + ":" + day`), all of a charge in one transaction
 *   with their expiry (the day's end plus keyMarginMs). A scope found over its limit is remembered by this process until
 *   it can be used again (a client and a group: the day's end; the server's day: when its slice allowance grows), so a
 *   refused visitor costs no more Redis commands here (withRoute asks the quota before the rate limiter: refusedAlready).
 *   Redis down: this process's own counts, the server's day at limits.workLimits.processShare of it.
 */
import { requestScope } from "./deadline";
import { logEvent, errorNameOf, withTimeout } from "./log";
import { budgets, feedbackLimits, rateLimits, signedUploadLimits, uploadLimits, workLimits } from "./limits";
import { getRedis, keyPrefix, type RedisLike } from "./redis";

type Env = Readonly<Record<string, string | undefined>>;

export type BudgetPlatform = keyof typeof budgets.perDay;
export const BUDGET_PLATFORMS = Object.keys(budgets.perDay) as BudgetPlatform[];

/** Which limit refused an attempt: the platform's whole day (or its slice), or the client's share of it. */
export type BudgetLimit = "day" | "share";
/** take()'s answer: the attempt may go out, or the limit that refused it. */
export type BudgetVerdict = "ok" | BudgetLimit;

/** The budget a host's requests count against, or undefined for an unbudgeted host. */
export function budgetPlatformOf(host: string): BudgetPlatform | undefined {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  if (h === "lm-api-reads.fantasy.espn.com" || h === "fan.api.espn.com" || h === "fantasy.espn.com") return "espn";
  if (h === "api.sleeper.app") return "sleeper";
  if (h === "api.fantasycalc.com") return "fantasycalc";
  if (h === "raw.githubusercontent.com") return "github";
  return undefined;
}

/** A league request a budget didn't allow (see the header): the platform's day, or the client's share; never a URL in it. */
export class BudgetExhaustedError extends Error {
  constructor(
    readonly platform: BudgetPlatform,
    readonly by: BudgetLimit = "day",
  ) {
    super(by === "share" ? `this client's share of today's requests to ${platform} is used up` : `today's budget of requests to ${platform} is used up`);
    this.name = "BudgetExhaustedError";
  }
}

export function isBudgetExhaustedError(err: unknown): err is BudgetExhaustedError {
  if (err instanceof BudgetExhaustedError) return true;
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; platform?: unknown; by?: unknown };
  return e.name === "BudgetExhaustedError" && BUDGET_PLATFORMS.includes(e.platform as BudgetPlatform) && (e.by === undefined || e.by === "day" || e.by === "share");
}

/** "2026-10-04": the UTC day a budget counts in. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60_000;

/** Milliseconds until the next UTC midnight, when every budget and share starts again. */
export function msUntilUtcMidnight(now: number): number {
  return Math.floor(now / DAY_MS + 1) * DAY_MS - now;
}

/** Seconds until the next UTC midnight (a BUSY answer's Retry-After), at least 1. */
export function secondsUntilUtcMidnight(now: number): number {
  return Math.max(1, Math.ceil(msUntilUtcMidnight(now) / 1000));
}

/** The slice of the UTC day `now` falls in (0 … slices − 1). */
function sliceOf(now: number, slices: number): number {
  const msIntoDay = ((now % DAY_MS) + DAY_MS) % DAY_MS;
  return Math.min(slices - 1, Math.floor(msIntoDay / (DAY_MS / slices)));
}

/** The share of a day's budget open in slice `i` (see the header). */
function openShare(i: number, slices: number, burstShare: number): number {
  return Math.max((i + 1) / slices, burstShare);
}

/**
 * How much of a day's `limit` may have been spent by `now` (review SEC-2; see the header): (i + 1) / slices of it in slice
 * i, never less than burstShare of it, and all of it in the day's last slice.
 */
export function slicedAllowance(limit: number, now: number, slices: number = budgets.slices, burstShare: number = budgets.burstShare): number {
  return Math.floor(limit * openShare(sliceOf(now, slices), slices, burstShare));
}

/** Milliseconds until the day's allowance next grows (the next slice that opens more of it, else the next UTC midnight). */
export function msUntilAllowanceGrows(now: number, slices: number = budgets.slices, burstShare: number = budgets.burstShare): number {
  const i = sliceOf(now, slices);
  const share = openShare(i, slices, burstShare);
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  for (let j = i + 1; j < slices; j++) if (openShare(j, slices, burstShare) > share) return dayStart + (j * DAY_MS) / slices - now;
  return msUntilUtcMidnight(now);
}

/** Seconds until the day's allowance next grows (a BUSY answer's Retry-After), at least 1. */
export function secondsUntilAllowanceGrows(now: number): number {
  return Math.max(1, Math.ceil(msUntilAllowanceGrows(now) / 1000));
}

export interface TakeOptions {
  /** The request carries a visitor's ESPN cookies: it may use the reserve (limits.budgets.reservedForCookies). */
  privileged?: boolean;
}

export interface OutboundBudget {
  /**
   * Whether one more attempt to `platform` may go out now, counting it if so: "ok", or the limit that refused it. `client`
   * (a league request made for an API request: its group's id, see the header) also counts it against that client's
   * share. A verdict when it's known at once (the process's own counts, or a limit already reached), else a promise
   * (Redis round trips). Never rejects.
   */
  take(platform: BudgetPlatform, now?: number, client?: string, opts?: TakeOptions): BudgetVerdict | Promise<BudgetVerdict>;
}

export interface BudgetOptions {
  redis?: RedisLike | null;
  /** Key prefix (keyPrefix()); default from the environment. */
  prefix?: string;
  perDay?: Readonly<Record<BudgetPlatform, number>>;
  /** Each client's share per platform and day (see the header); absent: no shares. */
  perClient?: Readonly<Partial<Record<BudgetPlatform, number>>>;
  /**
   * The part of a platform's day only requests with cookies may use (see the header). Absent: none (the process's budget,
   * outboundBudget, passes limits.budgets.reservedForCookies).
   */
  reserved?: Readonly<Partial<Record<BudgetPlatform, number>>>;
  /**
   * The day's slices and the least share open (see the header). Absent: no slices (1 and 1; the process's budget passes
   * limits.budgets.slices and burstShare).
   */
  slices?: number;
  burstShare?: number;
  timeoutMs?: number;
  redisRetryAfterMs?: number;
  /** The process's own share counts: at most this many clients a day (limits.budgets.memoryMaxClients). */
  maxClients?: number;
}

/** A budget (see the header): shared through `redis` when given, else this process's own. */
export function createBudget(opts: BudgetOptions = {}): OutboundBudget {
  const redis = opts.redis ?? null;
  const prefix = opts.prefix ?? keyPrefix();
  const perDay = opts.perDay ?? budgets.perDay;
  const perClient = opts.perClient ?? {};
  const reserved: Readonly<Partial<Record<BudgetPlatform, number>>> = opts.reserved ?? {};
  const slices = opts.slices ?? 1;
  const burstShare = opts.burstShare ?? 1;
  const timeoutMs = opts.timeoutMs ?? budgets.timeoutMs;
  const retryAfterMs = opts.redisRetryAfterMs ?? budgets.redisRetryAfterMs;
  const maxClients = opts.maxClients ?? budgets.memoryMaxClients;
  /** The process's own counts ("platform:day" → attempts), for no Redis and Redis down. */
  const local = new Map<string, number>();
  /** Allowances known to be reached, until when ("platform\0open" without cookies, "platform\0all" with them). */
  const overUntil = new Map<string, number>();
  /** The process's own share counts for `shareDay` ("platform\0client" → attempts), for no Redis and Redis down. */
  const localShares = new Map<string, number>();
  /** Clients known to be over their share for `shareDay` ("platform\0client"; with Redis: no more commands for them today). */
  const sharesOver = new Set<string>();
  let shareDay = "";
  /** Refusals already logged ("event:platform:day"). */
  const logged = new Set<string>();
  /** Redis is left alone until then, after a failure. */
  let redisDownUntil = Number.NEGATIVE_INFINITY;

  const allowanceOf = (platform: BudgetPlatform, privileged: boolean, now: number): number =>
    slicedAllowance(Math.max(0, perDay[platform] - (privileged ? 0 : (reserved[platform] ?? 0))), now, slices, burstShare);

  const logOnce = (event: "budget_exhausted" | "budget_share_exhausted", platform: BudgetPlatform, day: string): void => {
    const mark = `${event}:${platform}:${day}`;
    if (logged.has(mark)) return;
    for (const m of logged) if (!m.endsWith(`:${day}`)) logged.delete(m); // the old days' marks go
    logged.add(mark);
    logEvent({ event, platform });
  };

  const refuseDay = (platform: BudgetPlatform, privileged: boolean, now: number): "day" => {
    // Until the allowance grows (the next slice that opens more, or the next day), this process asks nothing more.
    overUntil.set(`${platform}\u0000${privileged ? "all" : "open"}`, now + msUntilAllowanceGrows(now, slices, burstShare));
    logOnce("budget_exhausted", platform, utcDay(now));
    return "day";
  };

  const dayKnownOver = (platform: BudgetPlatform, privileged: boolean, now: number): boolean => {
    const all = overUntil.get(`${platform}\u0000all`) ?? Number.NEGATIVE_INFINITY;
    const open = overUntil.get(`${platform}\u0000open`) ?? Number.NEGATIVE_INFINITY;
    return now < all || (!privileged && now < open);
  };

  const newShareDay = (day: string): void => {
    if (shareDay === day) return;
    localShares.clear(); // a new day: every share starts again
    sharesOver.clear();
    shareDay = day;
  };

  /** `remember`: Redis said so (it's remembered, so the client costs no more commands today; the process's own counts refuse anyway). */
  const refuseShare = (platform: BudgetPlatform, client: string, day: string, remember = false): "share" => {
    newShareDay(day);
    if (remember && sharesOver.size < maxClients) sharesOver.add(`${platform}\u0000${client}`);
    logOnce("budget_share_exhausted", platform, day);
    return "share";
  };

  const takeLocal = (platform: BudgetPlatform, slot: string, privileged: boolean, now: number): "ok" | "day" => {
    const n = (local.get(slot) ?? 0) + 1;
    if (local.size > 64) for (const k of local.keys()) if (!k.endsWith(slot.slice(slot.indexOf(":")))) local.delete(k);
    // A refused attempt isn't counted (it didn't go out), so one without cookies never eats into the reserve.
    if (n > allowanceOf(platform, privileged, now)) return refuseDay(platform, privileged, now);
    local.set(slot, n);
    return "ok";
  };

  /** One more attempt in the client's share, counted in this process (whether it's within the share). */
  const takeShareLocal = (platform: BudgetPlatform, client: string, day: string, share: number): boolean => {
    newShareDay(day);
    const k = `${platform}\u0000${client}`;
    const n = (localShares.get(k) ?? 0) + 1;
    if (!localShares.has(k) && localShares.size >= maxClients) {
      // Full: the client counted longest ago starts again (memory stays bounded).
      const oldest = localShares.keys().next().value;
      if (oldest !== undefined) localShares.delete(oldest);
    }
    localShares.set(k, n);
    return n <= share;
  };

  /** One more attempt in the client's share, counted in Redis with its expiry (whether it's within the share). Rejects on Redis trouble. */
  const takeShareShared = async (store: RedisLike, platform: BudgetPlatform, client: string, day: string, share: number, now: number): Promise<boolean> => {
    const key = `${prefix}budget:client:${platform}:${client}:${day}`;
    const [n] = await withTimeout(store.incrExpire([{ key, by: 1, ttlMs: msUntilUtcMidnight(now) + budgets.clientKeyMarginMs }]), timeoutMs);
    return (n ?? Number.POSITIVE_INFINITY) <= share;
  };

  const takeShared = async (store: RedisLike, platform: BudgetPlatform, slot: string, day: string, now: number, client: string | undefined, share: number | undefined, privileged: boolean): Promise<BudgetVerdict> => {
    const key = `${prefix}budget:${platform}:${day}`;
    try {
      // The client's share first: a client over it spends nothing of the day's budget.
      if (client !== undefined && share !== undefined && !(await takeShareShared(store, platform, client, day, share, now))) return refuseShare(platform, client, day, true);
      const [n] = await withTimeout(store.incrExpire([{ key, by: 1, ttlMs: budgets.keyTtlMs }]), timeoutMs);
      return (n ?? Number.POSITIVE_INFINITY) <= allowanceOf(platform, privileged, now) ? "ok" : refuseDay(platform, privileged, now);
    } catch (err) {
      redisDownUntil = now + retryAfterMs;
      logEvent({ event: "budget_redis_error", platform: "upstash", errorName: errorNameOf(err) });
      if (client !== undefined && share !== undefined && !takeShareLocal(platform, client, day, share)) return refuseShare(platform, client, day);
      return takeLocal(platform, slot, privileged, now);
    }
  };

  return {
    take(platform, now = Date.now(), client, takeOpts) {
      const day = utcDay(now);
      const slot = `${platform}:${day}`;
      const privileged = takeOpts?.privileged === true;
      if (dayKnownOver(platform, privileged, now)) return "day";
      const share = client !== undefined ? perClient[platform] : undefined;
      if (client !== undefined && share !== undefined) {
        newShareDay(day);
        // Known over its share from Redis today: refused without another command.
        if (sharesOver.has(`${platform}\u0000${client}`)) return "share";
      }
      if (!redis || now < redisDownUntil) {
        if (client !== undefined && share !== undefined && !takeShareLocal(platform, client, day, share)) return refuseShare(platform, client, day);
        return takeLocal(platform, slot, privileged, now);
      }
      return takeShared(redis, platform, slot, day, now, client, share, privileged);
    },
  };
}

let processBudget: OutboundBudget | undefined;

/**
 * The process's budget (see the header): on Vercel, shared through Redis when it's configured (src/server/redis.ts), with
 * the clients' shares; anywhere else, this process's own counts without shares, whatever .env.local holds. A Redis client
 * that can't be built (a malformed address) is logged by its error's name only, and the process counts its own.
 */
export function outboundBudget(env: Env = process.env): OutboundBudget {
  if (env !== process.env) return budgetFor(env); // tests: never memoized
  processBudget ??= budgetFor(env);
  return processBudget;
}

/** The process's Redis client on Vercel (null elsewhere, or when it can't be built: logged by the error's name only). */
function vercelRedis(env: Env): RedisLike | null {
  if (!env.VERCEL) return null;
  try {
    return getRedis(env);
  } catch (err) {
    logEvent({ event: "redis_config_invalid", platform: "upstash", errorName: errorNameOf(err) });
    return null;
  }
}

function budgetFor(env: Env): OutboundBudget {
  const onVercel = Boolean(env.VERCEL);
  // Locally the budget stays as it was (Part B's ground rules): the process's own day, no shares, slices or reserve.
  return createBudget({
    redis: vercelRedis(env),
    prefix: keyPrefix(env),
    ...(onVercel ? { perClient: budgets.perClientPerDay, reserved: budgets.reservedForCookies, slices: budgets.slices, burstShare: budgets.burstShare } : {}),
  });
}

/** Test hook: forget the process's budget (the next outboundBudget() reads the environment again). */
export function resetOutboundBudgetForTests(): void {
  processBudget = undefined;
}

// ---------------------------------------------------------------------------------------------
// The daily quotas: the work budget and the feedback route's copies (see the header)

/** Which limit refused a charge: the client's day, its group's, or the server's whole day (its slice). */
export type QuotaLimit = "client" | "group" | "day";
export type QuotaVerdict = "ok" | QuotaLimit;

/** Who a charge is for: the request's client and group ids (src/server/rateLimit.ts clientIds; none outside a route). */
export interface QuotaWho {
  client?: string;
  group?: string;
}

export interface DailyQuota {
  /**
   * Charges `units` to `who` and the server's day: "ok", or the limit that refused it. A verdict when it's known at once
   * (the process's own counts, or a limit this process knows is reached), else a promise (one Redis round trip). Never
   * rejects.
   */
  charge(units: number, who: QuotaWho, now?: number): QuotaVerdict | Promise<QuotaVerdict>;
  /** The limit this process already knows refuses `who` now (nothing is counted, nothing asked), or null. */
  refusedAlready(who: QuotaWho, now?: number): QuotaLimit | null;
}

export interface DailyQuotaOptions {
  /** The quota's key segment ("work", "fbq") and log name. */
  name: string;
  redis?: RedisLike | null;
  prefix?: string;
  perClient: number;
  perGroup: number;
  /** The server's whole day, in slices (absent: none). */
  perDay?: number;
  slices?: number;
  burstShare?: number;
  /** Redis down: the share of perDay this process may spend on its own count. */
  processShare?: number;
  keyMarginMs?: number;
  maxKeys?: number;
  timeoutMs?: number;
  redisRetryAfterMs?: number;
}

/** A daily quota (see the header): shared through `redis` when given, else this process's own counts. */
export function createDailyQuota(opts: DailyQuotaOptions): DailyQuota & { remembered(): number } {
  const redis = opts.redis ?? null;
  const prefix = opts.prefix ?? keyPrefix();
  const slices = opts.slices ?? budgets.slices;
  const burstShare = opts.burstShare ?? budgets.burstShare;
  const processShare = opts.processShare ?? workLimits.processShare;
  const keyMarginMs = opts.keyMarginMs ?? workLimits.keyMarginMs;
  const maxKeys = opts.maxKeys ?? workLimits.memoryMaxKeys;
  const timeoutMs = opts.timeoutMs ?? workLimits.timeoutMs;
  const retryAfterMs = opts.redisRetryAfterMs ?? workLimits.redisRetryAfterMs;
  /** Scopes known to be over, until when ("c\0client", "g\0group", "day"). */
  const blocked = new Map<string, number>();
  /** The process's own counts for `countDay` ("c\0client", "g\0group", "day" → units). */
  const counts = new Map<string, number>();
  let countDay = "";
  const logged = new Set<string>();
  let redisDownUntil = Number.NEGATIVE_INFINITY;

  const dayAllowance = (now: number, share = 1): number => (opts.perDay === undefined ? Number.POSITIVE_INFINITY : slicedAllowance(Math.floor(opts.perDay * share), now, slices, burstShare));

  const remember = (scope: string, until: number, now: number): void => {
    if (!blocked.has(scope) && blocked.size >= maxKeys) {
      for (const [k, t] of blocked) if (t <= now) blocked.delete(k);
      // Still full: the oldest record goes (memory stays bounded; that scope is asked about again).
      if (blocked.size >= maxKeys) {
        const oldest = blocked.keys().next().value;
        if (oldest !== undefined) blocked.delete(oldest);
      }
    }
    blocked.set(scope, until);
  };

  const refuse = (limit: QuotaLimit, who: QuotaWho, now: number): QuotaLimit => {
    if (limit === "day") remember("day", now + msUntilAllowanceGrows(now, slices, burstShare), now);
    else remember(limit === "client" ? `c\u0000${who.client}` : `g\u0000${who.group}`, now + msUntilUtcMidnight(now), now);
    const mark = `${limit}:${utcDay(now)}`;
    if (!logged.has(mark)) {
      for (const m of logged) if (!m.endsWith(utcDay(now))) logged.delete(m);
      logged.add(mark);
      logEvent({ event: limit === "day" ? `${opts.name}_day_exhausted` : `${opts.name}_${limit}_exhausted` });
    }
    return limit;
  };

  /** The first limit `values` break (client, then group, then the day), or null. */
  const verdictOf = (values: { client?: number; group?: number; day?: number }, now: number, share = 1): QuotaLimit | null => {
    if (values.client !== undefined && values.client > opts.perClient) return "client";
    if (values.group !== undefined && values.group > opts.perGroup) return "group";
    if (values.day !== undefined && values.day > dayAllowance(now, share)) return "day";
    return null;
  };

  const chargeLocal = (units: number, who: QuotaWho, now: number): QuotaVerdict => {
    const day = utcDay(now);
    if (countDay !== day) {
      counts.clear(); // a new day: every count starts again
      countDay = day;
    }
    const add = (k: string): number => {
      if (!counts.has(k) && counts.size >= maxKeys) {
        const oldest = counts.keys().next().value;
        if (oldest !== undefined && oldest !== "day") counts.delete(oldest);
      }
      const n = (counts.get(k) ?? 0) + units;
      counts.set(k, n);
      return n;
    };
    const values = {
      ...(who.client !== undefined ? { client: add(`c\u0000${who.client}`) } : {}),
      ...(who.group !== undefined ? { group: add(`g\u0000${who.group}`) } : {}),
      ...(opts.perDay !== undefined ? { day: add("day") } : {}),
    };
    // The process's own count of the server's day: at most processShare of it (another instance may be counting too).
    const limit = verdictOf(values, now, processShare);
    return limit ? refuse(limit, who, now) : "ok";
  };

  const chargeShared = async (store: RedisLike, units: number, who: QuotaWho, now: number): Promise<QuotaVerdict> => {
    const day = utcDay(now);
    const ttlMs = msUntilUtcMidnight(now) + keyMarginMs;
    const entries: Array<{ key: string; by: number; ttlMs: number; scope: "client" | "group" | "day" }> = [];
    if (who.client !== undefined) entries.push({ key: `${prefix}${opts.name}:client:${who.client}:${day}`, by: units, ttlMs, scope: "client" });
    if (who.group !== undefined) entries.push({ key: `${prefix}${opts.name}:group:${who.group}:${day}`, by: units, ttlMs, scope: "group" });
    if (opts.perDay !== undefined) entries.push({ key: `${prefix}${opts.name}:${day}`, by: units, ttlMs, scope: "day" });
    if (!entries.length) return "ok";
    try {
      const got = await withTimeout(
        store.incrExpire(entries.map(({ key, by, ttlMs: t }) => ({ key, by, ttlMs: t }))),
        timeoutMs,
      );
      const values: { client?: number; group?: number; day?: number } = {};
      entries.forEach((e, i) => (values[e.scope] = got[i] ?? Number.POSITIVE_INFINITY));
      const limit = verdictOf(values, now);
      return limit ? refuse(limit, who, now) : "ok";
    } catch (err) {
      redisDownUntil = now + retryAfterMs;
      logEvent({ event: `${opts.name}_redis_error`, platform: "upstash", errorName: errorNameOf(err) });
      return chargeLocal(units, who, now);
    }
  };

  /**
   * Forgets what's past, at most once every rateLimits.sweepEveryMs whenever the quota is asked: the scopes whose refusal
   * has run out, and the process's own counts of a day that has ended (no client's or group's hash is kept past its day
   * while requests come).
   */
  let nextSweep = Number.NEGATIVE_INFINITY;
  const sweep = (now: number): void => {
    if (now < nextSweep) return;
    nextSweep = now + rateLimits.sweepEveryMs;
    for (const [k, until] of blocked) if (until <= now) blocked.delete(k);
    if (countDay && countDay !== utcDay(now)) {
      counts.clear();
      countDay = "";
    }
  };

  const refusedAlready = (who: QuotaWho, now: number): QuotaLimit | null => {
    sweep(now);
    const at = (k: string) => blocked.get(k) ?? Number.NEGATIVE_INFINITY;
    if (who.client !== undefined && now < at(`c\u0000${who.client}`)) return "client";
    if (who.group !== undefined && now < at(`g\u0000${who.group}`)) return "group";
    if (opts.perDay !== undefined && now < at("day")) return "day";
    return null;
  };

  return {
    /** Clients, groups and days this process remembers, refused or counted (tests: none kept past its day). */
    remembered: () => blocked.size + counts.size,
    refusedAlready: (who, now = Date.now()) => refusedAlready(who, now),
    charge(units, who, now = Date.now()) {
      const known = refusedAlready(who, now);
      if (known) return known;
      if (!(units > 0)) return "ok";
      if (!redis || now < redisDownUntil) return chargeLocal(units, who, now);
      return chargeShared(redis, units, who, now);
    },
  };
}

let processWork: DailyQuota | null | undefined;
let processFeedbackQuota: DailyQuota | null | undefined;

/**
 * The process's work budget (see the header; limits.workLimits): on Vercel only (shared through Redis when it's
 * configured, else this process's own counts); null anywhere else (this computer: no free tier to protect).
 */
export function workBudget(env: Env = process.env): DailyQuota | null {
  const make = (): DailyQuota | null =>
    env.VERCEL
      ? createDailyQuota({ name: "work", redis: vercelRedis(env), prefix: keyPrefix(env), perClient: workLimits.perClientPerDay, perGroup: workLimits.perGroupPerDay, perDay: workLimits.perDay })
      : null;
  if (env !== process.env) return make(); // tests: never memoized
  if (processWork === undefined) processWork = make();
  return processWork;
}

/** The feedback route's daily copies per client and group (limits.feedbackLimits; see the header): on Vercel only, else null. */
export function feedbackQuota(env: Env = process.env): DailyQuota | null {
  const make = (): DailyQuota | null =>
    env.VERCEL ? createDailyQuota({ name: "fbq", redis: vercelRedis(env), prefix: keyPrefix(env), perClient: feedbackLimits.perClientPerDay, perGroup: feedbackLimits.perGroupPerDay }) : null;
  if (env !== process.env) return make(); // tests: never memoized
  if (processFeedbackQuota === undefined) processFeedbackQuota = make();
  return processFeedbackQuota;
}

/** Test hook: forget the process's quotas. */
export function resetQuotasForTests(): void {
  processWork = undefined;
  processFeedbackQuota = undefined;
}

/** A request body's units (limits.workLimits.unitBytes) by its Content-Length; a body without one costs its cap's. */
function bodyUnits(request: Request, capBytes: number): number {
  const declared = Number(request.headers.get("content-length"));
  const bytes = request.headers.get("content-length") !== null && Number.isFinite(declared) && declared >= 0 ? Math.min(declared, capBytes) : capBytes;
  return Math.ceil(bytes / workLimits.unitBytes);
}

/** Whether a request's body is gzip (the browser's uploads: src/app/api/_lib/upload.ts isGzipRequest's rule). */
function isGzipBody(request: Request): boolean {
  const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  return type === "application/gzip" || type === "application/x-gzip";
}

/**
 * What a request costs when it arrives (limits.workLimits.units; see the header), by its route kind and body: an import or
 * a League page build from what the browser sent (gzip: plus its body's units), or one the server reads the league for
 * (JSON). Session and feedback requests cost no work units.
 */
export function admissionUnits(kind: string, request: Request): number {
  const u = workLimits.units;
  if (kind === "import") return isGzipBody(request) ? u.importUpload + bodyUnits(request, uploadLimits.compressedBytes) : u.importServer;
  if (kind === "model") return isGzipBody(request) ? u.modelSigned + bodyUnits(request, signedUploadLimits.compressedBytes) : u.modelServer;
  return 0;
}

/** A model build's extra units past what its request paid (limits.workLimits.modelWorkIncluded; modelWorkOf's units). */
export function modelBuildExtraUnits(modelWork: number): number {
  const over = modelWork - workLimits.modelWorkIncluded;
  return over > 0 ? Math.ceil(over / workLimits.modelWorkPerUnit) : 0;
}

/**
 * Charges `units` more of the current request's work (a handler's extra: a big model build, a league the server reads
 * itself after the request paid for less) to its client, its group and the server's day (src/server/deadline.ts: the
 * request's scope), with `budget` (the process's work budget by default: on Vercel only). "ok" without a budget, outside a
 * request or for no units; never rejects (a budget that throws anyway lets the work go on).
 */
export async function chargeWork(units: number, now: number = Date.now(), budget: DailyQuota | null = workBudget()): Promise<QuotaVerdict> {
  const scope = requestScope();
  if (!budget || !scope || !(units > 0)) return "ok";
  try {
    const who: QuotaWho = { ...(scope.client !== undefined ? { client: scope.client } : {}), ...(scope.group !== undefined ? { group: scope.group } : {}) };
    const verdict = budget.charge(units, who, now);
    return typeof verdict === "string" ? verdict : await verdict;
  } catch {
    return "ok";
  }
}
