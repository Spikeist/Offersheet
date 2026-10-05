/**
 * The server's numbers for the public beta (planner reply to Checkpoint 4c, Part B; Checkpoint 7a): byte caps, the
 * memory tier, the cross-instance lock, per-IP rate limits, daily outbound budgets, request deadlines, upload caps, the
 * error log and the feedback store. The engine's numbers stay in src/engine/config.ts (CLAUDE.md §15); these belong to
 * the server, one block per part, each documented where it is used. Free-tier arithmetic behind them: Checkpoint 7a.
 */

/**
 * The shared cache (track CA; src/server/cache.ts RedisCache, MemoryLruCache, TieredCache, RedisCacheLock; the lock's
 * hook in src/server/http.ts; the choice in src/app/api/_lib/deps.ts). Retention stays §2.10's (src/server/cache.ts TTL).
 */
export const cacheLimits = {
  /** The largest value written to Redis (base64 of the gzipped envelope); Upstash takes at most 10 MB a request. */
  maxEntryBytes: 8_000_000,
  /** The per-instance memory tier, estimated from the stored text's length. */
  memoryBytes: 64_000_000,
  /** Cross-instance single-flight for league-independent entries: how long a lock lives, how often and how long a waiter polls. */
  lockMs: 20_000,
  lockPollMs: 250,
  lockWaitMs: 8_000,
  /**
   * A waiter takes a copy stored this long before it began waiting as the lock holder's (instances' clocks differ a
   * little): any older copy is one its own cache read already turned down.
   */
  lockClockSkewMs: 1_000,
  /**
   * Redis slow or down (src/server/cache.ts SharedCacheBreaker; review CA-1): each shared-cache command (an entry's read or
   * write, the lock's SET NX, GET and DEL) waits at most redisTimeoutMs, a slower one counting as failed; after a failure
   * or a timeout the process leaves Redis alone for redisRetryAfterMs (its memory tier alone, fetches without the lock).
   * Within one region (Vercel iad1, Upstash US East) a command takes milliseconds, the largest entries (about 1 MB) well
   * under the timeout.
   */
  redisTimeoutMs: 1_000,
  redisRetryAfterMs: 60_000,
  /** An entry Redis holds that doesn't decode is logged at most this often per instance (src/server/cache.ts). */
  errorLogEveryMs: 60_000,
} as const;

/**
 * The Upstash client itself (src/server/redis.ts; every command the process sends: the cache, the rate limits, the
 * budgets, the error log, the feedback store; review CA-1): a network error is retried this many times, after this pause.
 * The SDK's default, 5 retries over about 4 seconds, outlasted every caller's own time limit (each caller still bounds
 * its wait: the cache with cacheLimits.redisTimeoutMs, the limiter and the budget with their timeoutMs).
 */
export const redisClientLimits = {
  retries: 1,
  retryBackoffMs: 50,
} as const;

/**
 * Per-IP rate limits on every API route (track RL; src/server/rateLimit.ts, src/app/api/_lib/route.ts withRoute):
 * requests per fixed window, per client (an HMAC of the IP address, IPv6 by /64), per route kind. Generous on purpose:
 * mobile carriers put many people behind one address. Production's coarse layer in front (one Vercel WAF rule on /api/*)
 * is a Checkpoint 7b step.
 */
export const rateLimits = {
  import: { limit: 30, windowS: 600 },
  model: { limit: 30, windowS: 600 },
  session: { limit: 20, windowS: 600 },
  feedback: { limit: 60, windowS: 3600 },
  /** A Redis check slower than this lets the request through, counted in the process's own window instead (logged). */
  timeoutMs: 1_000,
  /** After Redis fails or times out, the process's own window is used this long before Redis is asked again. */
  redisRetryAfterMs: 60_000,
  /** The process's own windows (no Redis, or Redis down): at most this many clients are tracked; past it, ended windows go. */
  memoryMaxKeys: 20_000,
  /**
   * Clients whose window has ended are dropped from this process's memory (its own windows, and the shared limiter's
   * record of refused clients) at most this long after: a client's hash isn't kept past its window, at most an hour.
   */
  sweepEveryMs: 60_000,
} as const;

/**
 * Daily budgets of the server's own outbound requests per platform (track RL; src/server/budget.ts; UTC days; every
 * attempt counts, retries included; the browser's own fetches don't). A Redis counter per platform and day shared by
 * every instance; without Redis (local, or Redis down) each process counts its own.
 */
export const budgets = {
  perDay: { espn: 4_000, sleeper: 15_000, fantasycalc: 200, github: 100 },
  /**
   * On Vercel only: each client's share of a platform's day (the same client id as the rate limits), counted on league
   * requests only (league-independent data is fetched once for everyone), so a few clients can't spend the whole day's
   * budget for everyone. About 30 cold server-side imports of either kind a day.
   */
  perClientPerDay: { espn: 400, sleeper: 1_500 },
  /** How long a day's counter key lives in Redis (a day and a margin). */
  keyTtlMs: 2 * 24 * 60 * 60_000,
  /** A client's share counter lives until its UTC day ends and this margin (instances' clocks differ a little). */
  clientKeyMarginMs: 60_000,
  /** The process's own share counts (no Redis, or Redis down): at most this many clients a day; past it, the oldest go. */
  memoryMaxClients: 20_000,
  /** A Redis count slower than this lets the attempt through, counted in the process's own budget instead (logged). */
  timeoutMs: 1_000,
  /** After Redis fails or times out, the process's own count is used this long before Redis is asked again. */
  redisRetryAfterMs: 60_000,
} as const;

/**
 * Each route's overall deadline (track RL; src/server/deadline.ts, read by src/server/http.ts); `export const maxDuration`
 * in each route.ts sits a little above it (route.test.ts checks). The model route's 120 s maxDuration needs Fluid compute
 * on the Hobby plan (60 s at most without it).
 */
export const deadlines = {
  importMs: 45_000,
  modelMs: 90_000,
  sessionMs: 10_000,
  feedbackMs: 10_000,
  /** No outbound attempt starts with less time than this left (it couldn't finish anyway); the answer so far is used. */
  minAttemptMs: 1_000,
  /**
   * Cache reads and writes may run this long past the deadline (so a saved copy can still stand in for a request the
   * deadline cut), and a request's own fetch, whose cross-instance lock calls Redis too, twice this; never longer: a
   * hanging store can't hold a route to its maxDuration (at least deadline + 5 s, route.test.ts).
   */
  cacheGraceMs: 2_000,
  /**
   * A wait that starts when its bound has already passed still gets this long (a healthy cache, or a fetch about to settle,
   * answers in it: a saved copy can still stand in, a background rebuild still reads the cache), unless something the
   * request waited for already came back late (src/server/deadline.ts withinDeadline): then nothing more is waited for.
   */
  lateFloorMs: 500,
  /**
   * A request whose wait in a host's queue runs out while another request has held the host's turn this long was waiting
   * for a slow answer (the source is slow); a shorter turn means the queue itself was long (Offer Sheet is busy).
   */
  slowAnswerMs: 5_000,
} as const;

/** Browser uploads of league data (src/app/api/_lib/upload.ts). */
export const uploadLimits = {
  compressedBytes: 3_000_000,
  unpackedBytes: 20_000_000,
} as const;

/**
 * The error log (track RL; src/server/log.ts): with Redis on Vercel, one list per UTC day, its newest entries kept, each
 * day's list deleted `retainDays` after the day began (so no entry is kept longer: the privacy page's "14 days").
 */
export const logLimits = {
  keepPerDay: 1_000,
  retainDays: 14,
  /** The after-response write gives up after this long (it never delays a response). */
  writeTimeoutMs: 2_000,
} as const;

/** The anonymous feedback store (src/server/feedbackSink.ts). */
export const feedbackLimits = {
  maxPerMonth: 5_000,
  retainDays: 365,
} as const;
