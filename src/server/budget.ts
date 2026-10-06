/**
 * Daily budgets (planner reply to Checkpoint 4c, Part B, B1: "Outbound pacing and a daily request budget per platform,
 * especially for ESPN"; Checkpoint 7a, track RL; final review SEC-1, SEC-2, POL-2, F1): what the server may ask of each
 * platform a day (OutboundBudget), and what work it may do for visitors a day (DailyQuota: the work budget, and the
 * feedback route's daily copies).
 *
 * The outbound budgets:
 * - Platforms and limits (limits.budgets.perDay): ESPN (lm-api-reads and fan.api) 4,000 a day, Sleeper 15,000, FantasyCalc
 *   1,500 (sized to its own 3-hour rule's bound: limits.ts), GitHub raw (the DynastyProcess ID map) 100. Other hosts aren't
 *   budgeted (none is used on the server today).
 * - Every live attempt that goes out counts, retries included (src/server/http.ts). It's counted while it waits for its
 *   host's turn, from the moment it's next in line (one its deadline is about to cut only if its turn comes:
 *   limits.budgets.countAheadMinMs), so the count's round trips overlap the request ahead of it and the host's gap
 *   (review of the Checkpoint 7b load-test fixes, finding 1: counted only once its turn had come, it held the turn through
 *   them, and a store answering in 400 ms made each ESPN request hold the turn 800 ms longer); an attempt that doesn't go
 *   out after all (the deadline cut its wait, or its count came back too late to send it) gets its count back (`refund`,
 *   with the receipt `take` filled in; Checkpoint 7b load test, defect 1: counted before it queued and never given back,
 *   82 attempts were counted for 35 sent). A limit this process already knows is reached refuses it before it queues
 *   (OutboundBudget.refusedAlready: nothing counted, nothing asked). Cached copies, joined single-flight fetches and the
 *   browser's own requests don't count. UTC days.
 * - A refused attempt counts nowhere (it doesn't go out): not in the day, not in its client's share, not in the reserve.
 *   The process's own counts check every limit first and count only an attempt they all allow; with Redis each count is
 *   taken as it's checked, and a refusal gives back the counts the attempt already took, in one transaction with their
 *   expiries (giveBack; Checkpoint 7b load test: an attempt the day refused stayed in its client's share, and one its
 *   share refused stayed in the share's count). ⚠️ Until a count goes back (one round trip for a refusal; for an attempt
 *   that didn't go out, the rest of its wait for its turn) other attempts read it: at the very edge of a limit an attempt
 *   can be refused that a moment later would have fit, and this process then remembers that limit as reached (the day
 *   until its allowance next grows). Each attempt counts one, and only the attempts next in line at each host are counted
 *   while they wait, so that edge is a few attempts of a day of thousands. No count is kept, but a give-back or a refund
 *   that fails leaves its count (logged by name; Redis is then left alone a while), and so does a refund the instance
 *   never sends (sent once its count is known: best effort).
 * - In slices (on Vercel only; review SEC-2: a burst can take one slice): by the end of each of the day's
 *   limits.budgets.slices (2 hours each) at most that share of the day may be spent, unused budget carried on, but never
 *   less than budgets.burstShare of it (slicedAllowance). A refusal by the day's slice is said like a refusal by the day;
 *   its Retry-After is when the allowance next grows (msUntilAllowanceGrows).
 * - A reserve for requests that carry a visitor's ESPN cookies (on Vercel only; review SEC-2: private leagues have no
 *   browser path): requests without cookies stop budgets.reservedForCookies short of the day (`take`'s `privileged`).
 *   Anyone can paste cookies (made-up ones pass the format check, a throwaway account's pass ESPN's), so each client may
 *   take at most budgets.reservedPerClientPerDay of the reserve a day (B4 security review): counted once the open part of
 *   the day is spent, `prefix + "budget:reserve:" + platform + ":" + client + ":" + day` with Redis; past it, the attempt is
 *   refused like the day ("day": the beta's capacity message), and this process asks Redis nothing more for that client
 *   while it knows the open part is spent.
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
 *   or "share" (the import answers BUSY: the beta's capacity message, "The beta is at capacity today. It resets at <time>."
 *   (planner reply to Checkpoint 7a, §2 question 7), or for a client's share "Your connection has used today's share of
 *   requests to ESPN. It resets at <time>.": src/app/api/_lib/respond.ts busyResponse); a league-independent
 *   one comes back as "no response", the loaders' usual path (a saved copy stands in, else their warning). Logged once
 *   per process, platform and day (a share: once per process, platform and day, whichever client).
 *
 * The daily quotas (createDailyQuota; limits.workLimits, limits.feedbackLimits; on Vercel only):
 * - The work budget (final review SEC-1, F1: Vercel's Hobby plan pauses the whole project for up to 30 days once a month's
 *   Active CPU or Fast Origin Transfer runs out, and nothing capped the server's work for one client or for everyone): each
 *   import and League page request costs units (admissionUnits, charged by withRoute when it arrives; the handlers charge a
 *   big model build's extra units, chargeWork, and a gzip body's unpacked size past what its compressed size paid,
 *   unpackedExtraUnits, as soon as it's unpacked: B4 security review), counted per UTC day against its client (an IPv4
 *   address or IPv6 /64), its group (an IPv4 /24 or IPv6 /48) and the server's whole day (in slices, as above). Past any of
 *   them the request is refused (src/app/api/_lib/respond.ts workRefusedResponse: BUSY; the server's day or its slice with
 *   the beta's capacity message). Units charged are counted for usage:report (src/server/usage.ts work_units).
 * - The feedback route's copies (final review SEC-3): perClientPerDay and perGroupPerDay copies a client and a group may
 *   send a day (src/app/api/feedback/handler.ts).
 * - Counted in Redis like the budgets: one counter per quota, scope and UTC day (`prefix + name + ":" + day`, `prefix + name
 *   + ":client:" + client + ":" + day`, `prefix + name + ":group:" + group + ":" + day`), all of a charge in one transaction
 *   with their expiry (the day's end plus keyMarginMs). A scope found over its limit is remembered by this process until
 *   it can be used again (a client and a group: the day's end; the server's day: when its slice allowance grows), so a
 *   refused visitor costs no more Redis commands here (withRoute asks the quota before the rate limiter: refusedAlready).
 *   Redis down: this process's own counts, the server's day at limits.workLimits.processShare of it.
 * - A refused charge costs no one anything (Checkpoint 7b load test, defect 2: a charge the client's limit refused still
 *   added its units to its group and to the server's day, 162 units for 27 refused imports, so a visitor already over its
 *   own day could spend everyone's). The process's own counts check every scope first and count a charge only when all
 *   allow it. With Redis (chargeShared) the client's own count comes first, alone, and only a charge it allows goes on to
 *   its group's and the server's day, in one transaction: a charge refused by its client's limit never touches anyone
 *   else's counter (review of the Checkpoint 7b load-test fixes, finding 3: counted with the others in one transaction, a
 *   burst from a visitor over its own day held up to about 900 units, 30 requests at 29 each, in its group's and the
 *   server's counters until each give-back landed, and another visitor's charge that fit could be refused meanwhile, and
 *   that refusal remembered for the whole instance: the server's day until its allowance grew, a group until midnight).
 *   A refusal gives every count it took back in one more transaction (giveBackUnits). A refusal by the client's limit is
 *   remembered at once (4 commands in all). A refusal by the group or the server's day is judged again on the give-back's
 *   own answer, the counters as they stand with this charge's units back: if the charge fits there it's charged again,
 *   once, and only a limit still reached there is remembered. ⚠️ What's left: the units of a charge the group or the day
 *   itself refused stay in those counters until its give-back lands (one round trip; longer while its instance's event
 *   loop is busy, which a League page build can hold about 0.5 s), so another charge at the very edge of that limit can
 *   still be refused, and the limit remembered, when its own give-back lands first; such charges are at the edge already
 *   (each at most one request's units, 29 at most). Nothing refused stays counted, except after a failure: a give-back
 *   that fails leaves its units, and Redis failing between the client's count and the rest leaves the client's (logged by
 *   name; the charge is then counted by this process, and Redis is left alone a while).
 */
import { requestScope } from "./deadline";
import { logEvent, errorNameOf, withTimeout } from "./log";
import { budgets, feedbackLimits, rateLimits, signedUploadLimits, uploadLimits, workLimits } from "./limits";
import { getRedis, keyPrefix, type RedisLike } from "./redis";
import { noteUsage } from "./usage";

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

/**
 * What an attempt `take` allowed counted (TakeOptions.receipt; review of the Checkpoint 7b load-test fixes, finding 1), so
 * `refund` gives back exactly that if the attempt doesn't go out after all: this process's own counts (the day's slot, the
 * client's share and its share of the reserve, as counted that day), or the Redis counters it took with their expiries.
 * Filled in by take only when it answers "ok"; its callers just pass it back.
 */
export interface BudgetReceipt {
  counted?: { where: "local"; day: string; slot: string; share?: string; reserve?: string } | { where: "shared"; taken: ReadonlyArray<{ key: string; ttlMs: number }> };
  /** Set by refund: a receipt is given back at most once. */
  refunded?: boolean;
}

export interface TakeOptions {
  /** The request carries a visitor's ESPN cookies: it may use the reserve (limits.budgets.reservedForCookies). */
  privileged?: boolean;
  /** Filled in when the attempt is allowed: what it counted, for `refund` (BudgetReceipt). */
  receipt?: BudgetReceipt;
}

export interface OutboundBudget {
  /**
   * Whether one more attempt to `platform` may go out now, counting it if so: "ok", or the limit that refused it (a refused
   * attempt counts nowhere: see the header). `client` (a league request made for an API request: its group's id, see the
   * header) also counts it against that client's share. A verdict when it's known at once (the process's own counts, or a
   * limit already reached), else a promise (Redis round trips). Never rejects. The HTTP client asks it while the attempt
   * waits for its host's turn, once it's next in line (src/server/http.ts), and gives the count back (`refund`, with
   * `opts.receipt`) if the attempt doesn't go out after all.
   */
  take(platform: BudgetPlatform, now?: number, client?: string, opts?: TakeOptions): BudgetVerdict | Promise<BudgetVerdict>;
  /**
   * The limit this process already knows refuses one more attempt now (a day or a slice seen spent, a client seen over its
   * share or its share of the reserve), or null: nothing is counted and nothing asked. The HTTP client asks it before an
   * attempt waits for its host's turn, so a request a known limit refuses doesn't queue (Checkpoint 7b load test, defect 1).
   * Optional: a budget without it is asked only by `take`.
   */
  refusedAlready?(platform: BudgetPlatform, now?: number, client?: string, opts?: TakeOptions): BudgetLimit | null;
  /**
   * Gives back what an attempt `take` allowed counted (its receipt), when it didn't go out after all (src/server/http.ts:
   * the deadline cut its wait for its host's turn, or its count came back too late to send it; review of the Checkpoint 7b
   * load-test fixes, finding 1): this process's own counts at once, Redis's in one transaction with their expiries, as a
   * refusal's give-back. At most once per receipt; nothing for an empty one (the attempt was refused) or one whose day's
   * counts have started again. Never rejects. With Redis left alone after a failure it's skipped: the count stays, as a
   * failed give-back's does. Optional: a budget without it keeps every count.
   */
  refund?(receipt: BudgetReceipt, now?: number): void | Promise<void>;
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
   * Each client's share of that reserve a day (see the header; B4 security review). Absent: none (the process's budget on
   * Vercel passes limits.budgets.reservedPerClientPerDay).
   */
  reservedPerClient?: Readonly<Partial<Record<BudgetPlatform, number>>>;
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
  const reservedPerClient: Readonly<Partial<Record<BudgetPlatform, number>>> = opts.reservedPerClient ?? {};
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
  /** The process's own counts of each client's attempts in the reserve for `shareDay` ("platform\0client" → attempts). */
  const localReserve = new Map<string, number>();
  /**
   * Clients known to be past their share of the reserve for `shareDay` ("platform\0client"; with Redis: no command for them
   * while this process knows the open part of the day is spent).
   */
  const reserveOver = new Set<string>();
  let shareDay = "";
  /** Refusals already logged ("event:platform:day"). */
  const logged = new Set<string>();
  /** Redis is left alone until then, after a failure. */
  let redisDownUntil = Number.NEGATIVE_INFINITY;

  const allowanceOf = (platform: BudgetPlatform, privileged: boolean, now: number): number =>
    slicedAllowance(Math.max(0, perDay[platform] - (privileged ? 0 : (reserved[platform] ?? 0))), now, slices, burstShare);

  const logOnce = (event: "budget_exhausted" | "budget_share_exhausted" | "budget_reserve_share_exhausted", platform: BudgetPlatform, day: string): void => {
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

  /** The open part of the day (what requests without cookies may spend) known spent in this process, until it grows. */
  const openKnownSpent = (platform: BudgetPlatform, now: number): boolean => now < (overUntil.get(`${platform}\u0000open`) ?? Number.NEGATIVE_INFINITY);

  /** Seen spent: requests without cookies are refused without a command until the allowance grows (refuseDay's rule). */
  const markOpenSpent = (platform: BudgetPlatform, now: number): void => {
    if (openKnownSpent(platform, now)) return;
    overUntil.set(`${platform}\u0000open`, now + msUntilAllowanceGrows(now, slices, burstShare));
    logOnce("budget_exhausted", platform, utcDay(now));
  };

  const newShareDay = (day: string): void => {
    if (shareDay === day) return;
    localShares.clear(); // a new day: every share starts again
    sharesOver.clear();
    localReserve.clear();
    reserveOver.clear();
    shareDay = day;
  };

  /** The client and its share of the reserve, when one applies: an attempt with cookies, made for a client, on a platform with one. */
  const reserveOf = (platform: BudgetPlatform, privileged: boolean, client: string | undefined): { client: string; share: number } | undefined => {
    const share = reservedPerClient[platform];
    return privileged && client !== undefined && share !== undefined ? { client, share } : undefined;
  };

  /**
   * A client past its share of the reserve (see the header): refused like the day (the beta's capacity message; the open
   * part grows again with the next slice). `remember`: Redis said so (no command for it while the open part is known spent).
   */
  const refuseReserve = (platform: BudgetPlatform, client: string, day: string, remember = false): "day" => {
    newShareDay(day);
    if (remember && reserveOver.size < maxClients) reserveOver.add(`${platform}\u0000${client}`);
    logOnce("budget_reserve_share_exhausted", platform, day);
    return "day";
  };

  /** `remember`: Redis said so (it's remembered, so the client costs no more commands today; the process's own counts refuse anyway). */
  const refuseShare = (platform: BudgetPlatform, client: string, day: string, remember = false): "share" => {
    newShareDay(day);
    if (remember && sharesOver.size < maxClients) sharesOver.add(`${platform}\u0000${client}`);
    logOnce("budget_share_exhausted", platform, day);
    return "share";
  };

  /** One more in `counts` under `k`, keeping at most maxClients keys (full: the one counted longest ago starts again). */
  const countIn = (counts: Map<string, number>, k: string): void => {
    if (!counts.has(k) && counts.size >= maxClients) {
      const oldest = counts.keys().next().value;
      if (oldest !== undefined) counts.delete(oldest);
    }
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };

  /**
   * The process's own counts (no Redis, or Redis down): the client's share, the day (its open part without cookies) and,
   * past the open part, the client's share of the reserve, checked in that order; the attempt is counted in each only when
   * all of them allow it (see the header: a refused attempt counts nowhere, so one without cookies never eats into the
   * reserve, and one the day refuses spends nothing of its client's share).
   */
  const takeLocal = (platform: BudgetPlatform, slot: string, privileged: boolean, now: number, client: string | undefined, share: number | undefined, receipt?: BudgetReceipt): BudgetVerdict => {
    const day = utcDay(now);
    const shareKey = client !== undefined && share !== undefined ? `${platform}\u0000${client}` : undefined;
    if (shareKey !== undefined) {
      newShareDay(day);
      if ((localShares.get(shareKey) ?? 0) + 1 > (share as number)) return refuseShare(platform, client as string, day);
    }
    const n = (local.get(slot) ?? 0) + 1;
    if (n > allowanceOf(platform, privileged, now)) return refuseDay(platform, privileged, now);
    // Past the open part, an attempt with cookies is the reserve's: within its client's share of it (see the header).
    const reserve = reserveOf(platform, privileged, client);
    const reserveKey = reserve && n > allowanceOf(platform, false, now) ? `${platform}\u0000${reserve.client}` : undefined;
    if (reserve && reserveKey !== undefined) {
      newShareDay(day);
      if ((localReserve.get(reserveKey) ?? 0) + 1 > reserve.share) return refuseReserve(platform, reserve.client, day);
    }
    if (local.size > 64) for (const k of local.keys()) if (!k.endsWith(slot.slice(slot.indexOf(":")))) local.delete(k);
    local.set(slot, n);
    if (shareKey !== undefined) countIn(localShares, shareKey);
    if (reserveKey !== undefined) countIn(localReserve, reserveKey);
    if (receipt) receipt.counted = { where: "local", day, slot, ...(shareKey !== undefined ? { share: shareKey } : {}), ...(reserveKey !== undefined ? { reserve: reserveKey } : {}) };
    return "ok";
  };

  /** One less in `counts` under `k` (a refund), never below 0; nothing for a key no longer kept. */
  const countOut = (counts: Map<string, number>, k: string | undefined): void => {
    const n = k === undefined ? undefined : counts.get(k);
    if (k !== undefined && n !== undefined && n > 0) counts.set(k, n - 1);
  };

  /**
   * Gives back the counts a refused attempt took in Redis (see the header), all in one transaction with the expiries they
   * were taken with (a counter never exists without its expiry). Never rejects: a store that fails here leaves the counts
   * (logged by the error's name) and is left alone for redisRetryAfterMs, as after any failure.
   */
  const giveBack = async (store: RedisLike, taken: ReadonlyArray<{ key: string; ttlMs: number }>, now: number): Promise<void> => {
    if (!taken.length) return;
    try {
      await withTimeout(store.incrExpire(taken.map(({ key, ttlMs }) => ({ key, by: -1, ttlMs }))), timeoutMs);
    } catch (err) {
      redisDownUntil = now + retryAfterMs;
      logEvent({ event: "budget_redis_error", platform: "upstash", errorName: errorNameOf(err) });
    }
  };

  const takeShared = async (store: RedisLike, platform: BudgetPlatform, slot: string, day: string, now: number, client: string | undefined, share: number | undefined, privileged: boolean, receipt?: BudgetReceipt): Promise<BudgetVerdict> => {
    const reserve = reserveOf(platform, privileged, client);
    const reserveKey = reserve ? `${prefix}budget:reserve:${platform}:${reserve.client}:${day}` : "";
    const clientTtlMs = msUntilUtcMidnight(now) + budgets.clientKeyMarginMs;
    /** The counts this attempt has taken so far: a refusal gives them back (see the header). */
    const taken: Array<{ key: string; ttlMs: number }> = [];
    /** One more in `key`, with its expiry (one transaction); the count after it. Rejects on Redis trouble. */
    const count = async (key: string, ttlMs: number): Promise<number> => {
      const [n] = await withTimeout(store.incrExpire([{ key, by: 1, ttlMs }]), timeoutMs);
      taken.push({ key, ttlMs });
      return n ?? Number.POSITIVE_INFINITY;
    };
    const refused = async (limit: BudgetLimit): Promise<BudgetLimit> => {
      await giveBack(store, taken, now);
      return limit;
    };
    try {
      // The client's share first: a client over it spends nothing of the day's budget.
      if (client !== undefined && share !== undefined && (await count(`${prefix}budget:client:${platform}:${client}:${day}`, clientTtlMs)) > share) return refused(refuseShare(platform, client, day, true));
      // The open part known spent: an attempt with cookies is the reserve's, and a client past its share of the reserve is
      // refused before the day's counter is touched (see the header).
      const reserveFirst = reserve !== undefined && openKnownSpent(platform, now);
      if (reserve && reserveFirst && (await count(reserveKey, clientTtlMs)) > reserve.share) return refused(refuseReserve(platform, reserve.client, day, true));
      const n = await count(`${prefix}budget:${platform}:${day}`, budgets.keyTtlMs);
      if (n > allowanceOf(platform, privileged, now)) return refused(refuseDay(platform, privileged, now));
      if (privileged && n > allowanceOf(platform, false, now)) {
        // In the reserve: the open part is spent (this process now refuses attempts without cookies without asking), and the
        // attempt counts against its client's share of the reserve, unless it already did (above).
        markOpenSpent(platform, now);
        if (reserve && !reserveFirst && (await count(reserveKey, clientTtlMs)) > reserve.share) return refused(refuseReserve(platform, reserve.client, day, true));
      }
      if (receipt) receipt.counted = { where: "shared", taken: [...taken] };
      return "ok";
    } catch (err) {
      redisDownUntil = now + retryAfterMs;
      logEvent({ event: "budget_redis_error", platform: "upstash", errorName: errorNameOf(err) });
      return takeLocal(platform, slot, privileged, now, client, share, receipt);
    }
  };

  /** What this process already knows refuses an attempt now (OutboundBudget.refusedAlready): nothing counted, nothing asked. */
  const knownRefusal = (platform: BudgetPlatform, now: number, client: string | undefined, privileged: boolean): BudgetLimit | null => {
    if (dayKnownOver(platform, privileged, now)) return "day";
    if (client !== undefined) {
      newShareDay(utcDay(now));
      // Known over its share from Redis today: refused without another command.
      if (perClient[platform] !== undefined && sharesOver.has(`${platform}\u0000${client}`)) return "share";
      // Known past its share of the reserve while the open part is known spent: likewise (see the header).
      if (privileged && reserveOver.has(`${platform}\u0000${client}`) && openKnownSpent(platform, now)) return "day";
    }
    return null;
  };

  return {
    take(platform, now = Date.now(), client, takeOpts) {
      const day = utcDay(now);
      const slot = `${platform}:${day}`;
      const privileged = takeOpts?.privileged === true;
      const known = knownRefusal(platform, now, client, privileged);
      if (known) return known;
      const share = client !== undefined ? perClient[platform] : undefined;
      if (!redis || now < redisDownUntil) return takeLocal(platform, slot, privileged, now, client, share, takeOpts?.receipt);
      return takeShared(redis, platform, slot, day, now, client, share, privileged, takeOpts?.receipt);
    },
    refusedAlready(platform, now = Date.now(), client, takeOpts) {
      return knownRefusal(platform, now, client, takeOpts?.privileged === true);
    },
    refund(receipt, now = Date.now()) {
      const counted = receipt.counted;
      if (!counted || receipt.refunded) return;
      receipt.refunded = true;
      if (counted.where === "local") {
        countOut(local, counted.slot);
        // The shares and the reserve start again each day (newShareDay): another day's counts went with them.
        if (shareDay === counted.day) {
          countOut(localShares, counted.share);
          countOut(localReserve, counted.reserve);
        }
        return;
      }
      // Redis left alone after a failure: skipped, and the count stays (as a give-back that fails).
      if (!redis || now < redisDownUntil) return;
      return giveBack(redis, counted.taken, now);
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
    ...(onVercel ? { perClient: budgets.perClientPerDay, reserved: budgets.reservedForCookies, reservedPerClient: budgets.reservedPerClientPerDay, slices: budgets.slices, burstShare: budgets.burstShare } : {}),
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

/** A charge's counter values by scope (createDailyQuota). */
type QuotaValues = { client?: number; group?: number; day?: number };

/** One of a charge's scopes (createDailyQuota): the limit it is, its key in this process's own counts and in Redis. */
type QuotaScope = { scope: QuotaLimit; local: string; key: (day: string) => string };

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
  const verdictOf = (values: QuotaValues, now: number, share = 1): QuotaLimit | null => {
    if (values.client !== undefined && values.client > opts.perClient) return "client";
    if (values.group !== undefined && values.group > opts.perGroup) return "group";
    if (values.day !== undefined && values.day > dayAllowance(now, share)) return "day";
    return null;
  };

  /** A charge's scopes for `who`: the client's, the group's and the server's day (when the quota has one). */
  const scopesOf = (who: QuotaWho): QuotaScope[] => [
    ...(who.client !== undefined ? [{ scope: "client" as const, local: `c\u0000${who.client}`, key: (day: string) => `${prefix}${opts.name}:client:${who.client}:${day}` }] : []),
    ...(who.group !== undefined ? [{ scope: "group" as const, local: `g\u0000${who.group}`, key: (day: string) => `${prefix}${opts.name}:group:${who.group}:${day}` }] : []),
    ...(opts.perDay !== undefined ? [{ scope: "day" as const, local: "day", key: (day: string) => `${prefix}${opts.name}:${day}` }] : []),
  ];

  /**
   * The process's own counts (no Redis, or Redis down): every scope checked first, and the charge counted only when all of
   * them allow it (see the header: a refused charge costs no one anything).
   */
  const chargeLocal = (units: number, who: QuotaWho, now: number): QuotaVerdict => {
    const day = utcDay(now);
    if (countDay !== day) {
      counts.clear(); // a new day: every count starts again
      countDay = day;
    }
    const scopes = scopesOf(who);
    const values: QuotaValues = {};
    for (const s of scopes) values[s.scope] = (counts.get(s.local) ?? 0) + units;
    // The process's own count of the server's day: at most processShare of it (another instance may be counting too).
    const limit = verdictOf(values, now, processShare);
    if (limit) return refuse(limit, who, now);
    for (const s of scopes) {
      if (!counts.has(s.local) && counts.size >= maxKeys) {
        const oldest = counts.keys().next().value;
        if (oldest !== undefined && oldest !== "day") counts.delete(oldest);
      }
      counts.set(s.local, values[s.scope] as number);
    }
    return "ok";
  };

  /**
   * Gives a refused charge's units back to every counter it added them to (see the header), in one transaction with the same
   * expiries: the counters' values after it, in `entries`' order (the re-judging below reads them). Never rejects: a store
   * that fails here leaves them counted (logged by the error's name) and is left alone for redisRetryAfterMs, as after any
   * failure; then undefined.
   */
  const giveBackUnits = async (store: RedisLike, entries: ReadonlyArray<{ key: string; by: number; ttlMs: number }>, now: number): Promise<number[] | undefined> => {
    try {
      return await withTimeout(store.incrExpire(entries.map(({ key, by, ttlMs }) => ({ key, by: -by, ttlMs }))), timeoutMs);
    } catch (err) {
      redisDownUntil = now + retryAfterMs;
      logEvent({ event: `${opts.name}_redis_error`, platform: "upstash", errorName: errorNameOf(err) });
      return undefined;
    }
  };

  /**
   * The charge with Redis (see the header): the client's own count first, alone; only a charge it allows goes on to the
   * group's and the server's day, in one transaction. A refusal gives back every count it took (giveBackUnits). One by the
   * client's own limit is remembered at once; one by the group or the server's day is judged again on the counters as the
   * give-back left them, with this charge's units added back: a charge that fits there was refused only for units another
   * refused charge held in flight, so it's charged again (once) and nothing is remembered for it; a limit still reached
   * there is remembered (refuse).
   */
  const chargeShared = async (store: RedisLike, units: number, who: QuotaWho, now: number): Promise<QuotaVerdict> => {
    const day = utcDay(now);
    const ttlMs = msUntilUtcMidnight(now) + keyMarginMs;
    const entryOf = (s: QuotaScope) => ({ key: s.key(day), by: units, ttlMs });
    const scopes = scopesOf(who);
    const stages = [scopes.filter((s) => s.scope === "client"), scopes.filter((s) => s.scope !== "client")].filter((stage) => stage.length > 0);
    if (!stages.length) return "ok";
    try {
      for (let round = 0; ; round++) {
        const counted: QuotaScope[] = [];
        const values: QuotaValues = {};
        let limit: QuotaLimit | null = null;
        for (const stage of stages) {
          const got = await withTimeout(store.incrExpire(stage.map(entryOf)), timeoutMs);
          stage.forEach((s, i) => (values[s.scope] = got[i] ?? Number.POSITIVE_INFINITY));
          counted.push(...stage);
          limit = verdictOf(values, now);
          if (limit) break;
        }
        if (!limit) return "ok";
        if (limit === "client") {
          // The client's own limit (its count never reached the group or the day): remembered at once, so this instance
          // refuses its next requests without a command, then its count goes back.
          refuse(limit, who, now);
          await giveBackUnits(store, counted.map(entryOf), now);
          return limit;
        }
        const after = await giveBackUnits(store, counted.map(entryOf), now);
        if (!after) return refuse(limit, who, now); // the give-back failed: its units stay counted, and the refusal stands
        const fits: QuotaValues = {};
        counted.forEach((s, i) => (fits[s.scope] = (after[i] ?? Number.POSITIVE_INFINITY) + units));
        const again = verdictOf(fits, now);
        if (again) return refuse(again, who, now);
        // It fits on the counters as they stand: charged again, once; refused again, it isn't remembered.
        if (round > 0) return limit;
      }
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

/**
 * What a gzip body still owes once it's unpacked (B4 security review; limits.workLimits.unpackedUnitBytes): its unpacked
 * size's units past the units its compressed size paid when it arrived (admissionUnits: by Content-Length, else its cap
 * `capBytes`), so a body pays for whichever is more. 0 for a body that compresses as real uploads do.
 */
export function unpackedExtraUnits(request: Request, capBytes: number, unpackedBytes: number): number {
  const owed = Math.ceil(Math.max(0, unpackedBytes) / workLimits.unpackedUnitBytes);
  return Math.max(0, owed - bodyUnits(request, capBytes));
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
 * request or for no units; never rejects (a budget that throws anyway lets the work go on). Units charged are counted for
 * usage:report (src/server/usage.ts work_units).
 */
export async function chargeWork(units: number, now: number = Date.now(), budget: DailyQuota | null = workBudget()): Promise<QuotaVerdict> {
  const scope = requestScope();
  if (!budget || !scope || !(units > 0)) return "ok";
  try {
    const who: QuotaWho = { ...(scope.client !== undefined ? { client: scope.client } : {}), ...(scope.group !== undefined ? { group: scope.group } : {}) };
    const charged = budget.charge(units, who, now);
    const verdict = typeof charged === "string" ? charged : await charged;
    if (verdict === "ok") noteUsage("work_units", units, now);
    return verdict;
  } catch {
    return "ok";
  }
}
