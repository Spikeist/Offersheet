/**
 * Daily budgets of the server's own outbound requests per platform (planner reply to Checkpoint 4c, Part B, B1:
 * "Outbound pacing and a daily request budget per platform, especially for ESPN"; Checkpoint 7a, track RL).
 *
 * - Platforms and limits (limits.budgets.perDay): ESPN (lm-api-reads and fan.api) 4,000 a day, Sleeper 15,000, FantasyCalc
 *   200, GitHub raw (the DynastyProcess ID map) 100. Other hosts aren't budgeted (none is used on the server today).
 * - Every live attempt counts, retries included, checked before it goes out (src/server/http.ts); cached copies, joined
 *   single-flight fetches and the browser's own requests don't. UTC days.
 * - Each client's share (on Vercel only; limits.budgets.perClientPerDay: ESPN 400, Sleeper 1,500 a day): a league request
 *   made for an API request (src/server/deadline.ts: the client is withRoute's rate-limit id, an HMAC of the IP address's
 *   bucket) also counts against that client's share of the platform's day, checked first, so a client over its share
 *   spends nothing of the day's budget and a few clients can't spend it for everyone. League-independent data (projections,
 *   player lists, trade values …) is fetched once for everyone and counts against no client. Locally there are no shares
 *   (Parker's own testing is one client), so nothing changes there.
 * - With Redis (on Vercel only: off Vercel nothing here contacts Upstash, even with its variables in .env.local): one
 *   counter per platform and day shared by every instance, `prefix + "budget:" + platform + ":" + day` (INCR per attempt;
 *   PEXPIRE limits.budgets.keyTtlMs on the first of the day and every 100th, so a lost expiry can't keep a key), and one per
 *   client, platform and day, `prefix + "budget:client:" + platform + ":" + client + ":" + day`, deleted when its UTC day
 *   ends (plus limits.budgets.clientKeyMarginMs). Once a platform's counter passes its limit, this process remembers it
 *   until the day ends and asks Redis nothing more for it. Redis down or slower than limits.budgets.timeoutMs: the attempt
 *   goes through, counted in this process's own budget and shares (fail open), and Redis is left alone for
 *   limits.budgets.redisRetryAfterMs (logged once).
 * - Without Redis (local, the stable copy, tests, scripts, a preview before Upstash is connected): each process counts its
 *   own, synchronously, so the HTTP client's timing doesn't change.
 * - Over budget, the attempt doesn't go out (src/server/http.ts): a league request throws BudgetExhaustedError, `by` "day"
 *   or "share" (the import answers BUSY: "Offer Sheet has used today's share of requests to ESPN. Try again in about 6
 *   hours.", or for a client's share "Your connection has used today's share of requests to ESPN. …"); a league-independent
 *   one comes back as "no response", the loaders' usual path (a saved copy stands in, else their warning). Logged once
 *   per process, platform and day (a share: once per process, platform and day, whichever client).
 */
import { logEvent, errorNameOf, withTimeout } from "./log";
import { budgets } from "./limits";
import { getRedis, keyPrefix, type RedisLike } from "./redis";

type Env = Readonly<Record<string, string | undefined>>;

export type BudgetPlatform = keyof typeof budgets.perDay;
export const BUDGET_PLATFORMS = Object.keys(budgets.perDay) as BudgetPlatform[];

/** Which limit refused an attempt: the platform's whole day, or the client's share of it. */
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

export interface OutboundBudget {
  /**
   * Whether one more attempt to `platform` may go out now, counting it if so: "ok", or the limit that refused it. `client`
   * (a league request made for an API request: its client's id) also counts it against that client's share. A verdict
   * when it's known at once (the process's own counts, or a platform already over for the day), else a promise (Redis
   * round trips). Never rejects.
   */
  take(platform: BudgetPlatform, now?: number, client?: string): BudgetVerdict | Promise<BudgetVerdict>;
}

export interface BudgetOptions {
  redis?: RedisLike | null;
  /** Key prefix (keyPrefix()); default from the environment. */
  prefix?: string;
  perDay?: Readonly<Record<BudgetPlatform, number>>;
  /** Each client's share per platform and day (see the header); absent: no shares. */
  perClient?: Readonly<Partial<Record<BudgetPlatform, number>>>;
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
  const timeoutMs = opts.timeoutMs ?? budgets.timeoutMs;
  const retryAfterMs = opts.redisRetryAfterMs ?? budgets.redisRetryAfterMs;
  const maxClients = opts.maxClients ?? budgets.memoryMaxClients;
  /** The process's own counts ("platform:day" → attempts), for no Redis and Redis down. */
  const local = new Map<string, number>();
  /** Platforms known to be over for a day ("platform:day"). */
  const over = new Set<string>();
  /** The process's own share counts for `shareDay` ("platform\0client" → attempts), for no Redis and Redis down. */
  const localShares = new Map<string, number>();
  let shareDay = "";
  /** Shares refusals already logged ("platform:day"). */
  const sharesLogged = new Set<string>();
  /** Redis is left alone until then, after a failure. */
  let redisDownUntil = Number.NEGATIVE_INFINITY;

  const dayOf = (slot: string): string => slot.slice(slot.indexOf(":"));

  const refuseDay = (platform: BudgetPlatform, slot: string): "day" => {
    if (!over.has(slot)) {
      over.add(slot);
      // Once per process, platform and day; the old days' marks go with it.
      for (const s of over) if (!s.endsWith(dayOf(slot))) over.delete(s);
      logEvent({ event: "budget_exhausted", platform });
    }
    return "day";
  };

  const refuseShare = (platform: BudgetPlatform, slot: string): "share" => {
    if (!sharesLogged.has(slot)) {
      sharesLogged.add(slot);
      for (const s of sharesLogged) if (!s.endsWith(dayOf(slot))) sharesLogged.delete(s);
      logEvent({ event: "budget_share_exhausted", platform });
    }
    return "share";
  };

  const takeLocal = (platform: BudgetPlatform, slot: string): "ok" | "day" => {
    const n = (local.get(slot) ?? 0) + 1;
    if (local.size > 64) for (const k of local.keys()) if (!k.endsWith(dayOf(slot))) local.delete(k);
    local.set(slot, n);
    return n <= perDay[platform] ? "ok" : refuseDay(platform, slot);
  };

  /** One more attempt in the client's share, counted in this process (whether it's within the share). */
  const takeShareLocal = (platform: BudgetPlatform, client: string, day: string, share: number): boolean => {
    if (shareDay !== day) {
      localShares.clear(); // a new day: every share starts again
      shareDay = day;
    }
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

  /** One more attempt in the client's share, counted in Redis (whether it's within the share). Rejects on Redis trouble. */
  const takeShareShared = async (store: RedisLike, platform: BudgetPlatform, client: string, day: string, share: number, now: number): Promise<boolean> => {
    const key = `${prefix}budget:client:${platform}:${client}:${day}`;
    const ttl = msUntilUtcMidnight(now) + budgets.clientKeyMarginMs;
    const n = await withTimeout(store.incr(key), timeoutMs);
    // The share's first attempt of the day sets its expiry (the day's end), awaited; every 100th renews it.
    if (n === 1) await withTimeout(store.pexpire(key, ttl), timeoutMs).catch(() => 0);
    else if (n % 100 === 0) void store.pexpire(key, ttl).catch(() => 0);
    return n <= share;
  };

  const takeShared = async (store: RedisLike, platform: BudgetPlatform, slot: string, day: string, now: number, client: string | undefined, share: number | undefined): Promise<BudgetVerdict> => {
    const key = `${prefix}budget:${platform}:${day}`;
    try {
      // The client's share first: a client over it spends nothing of the day's budget.
      if (client !== undefined && share !== undefined && !(await takeShareShared(store, platform, client, day, share, now))) return refuseShare(platform, slot);
      const n = await withTimeout(store.incr(key), timeoutMs);
      // The day's first attempt sets the expiry (awaited, so it isn't lost when an instance pauses); every 100th renews it.
      if (n === 1) await withTimeout(store.pexpire(key, budgets.keyTtlMs), timeoutMs).catch(() => 0);
      else if (n % 100 === 0) void store.pexpire(key, budgets.keyTtlMs).catch(() => 0);
      return n <= perDay[platform] ? "ok" : refuseDay(platform, slot);
    } catch (err) {
      redisDownUntil = now + retryAfterMs;
      logEvent({ event: "budget_redis_error", platform: "upstash", errorName: errorNameOf(err) });
      if (client !== undefined && share !== undefined && !takeShareLocal(platform, client, day, share)) return refuseShare(platform, slot);
      return takeLocal(platform, slot);
    }
  };

  return {
    take(platform, now = Date.now(), client) {
      const day = utcDay(now);
      const slot = `${platform}:${day}`;
      if (over.has(slot)) return "day";
      const share = client !== undefined ? perClient[platform] : undefined;
      if (!redis || now < redisDownUntil) {
        if (client !== undefined && share !== undefined && !takeShareLocal(platform, client, day, share)) return refuseShare(platform, slot);
        return takeLocal(platform, slot);
      }
      return takeShared(redis, platform, slot, day, now, client, share);
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

function budgetFor(env: Env): OutboundBudget {
  const onVercel = Boolean(env.VERCEL);
  let redis: RedisLike | null = null;
  if (onVercel) {
    try {
      redis = getRedis(env);
    } catch (err) {
      logEvent({ event: "redis_config_invalid", platform: "upstash", errorName: errorNameOf(err) });
    }
  }
  return createBudget({ redis, prefix: keyPrefix(env), ...(onVercel ? { perClient: budgets.perClientPerDay } : {}) });
}

/** Test hook: forget the process's budget (the next outboundBudget() reads the environment again). */
export function resetOutboundBudgetForTests(): void {
  processBudget = undefined;
}
