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

/**
 * Browser uploads of league data (track BF; src/app/api/_lib/upload.ts): the gzip body a browser sends the import routes
 * (the league it read itself) and the model routes (the import it saved, signed), refused unread past compressedBytes and
 * refused while unpacking past unpackedBytes (a zip bomb stops there). Vercel takes at most 4.5 MB a request body.
 * Measured (Checkpoint 7a): an ESPN league's upload about 0.5 MB gzip, a Sleeper league's under 0.1 MB.
 */
export const uploadLimits = {
  compressedBytes: 3_000_000,
  unpackedBytes: 20_000_000,
} as const;

/**
 * What a league the browser read may hold (track BF, review BF-R1; src/adapters/upload.ts uploadShapeProblem, and
 * src/app/api/_lib/upload.ts for the import it makes). The server's work on an upload grows with these counts (the
 * normalizers' grouping and trade matching, and the model build's scoring: every relevant player's projected weeks under
 * every scoring rule), and a size cap alone doesn't bound that. No real league comes near them, so an upload past any of
 * them is refused (BAD_UPLOAD) and the browser asks the server to read the league itself, which then reads it from the
 * platform. Real leagues for comparison: ESPN has at most 20 teams; 1,325 captured Sleeper leagues had at most 32 teams,
 * 148 scoring keys and 65 lineup spots; Parker's ESPN league has 10 teams, 164 rostered players and 9 scoring rules.
 */
export const uploadShapeLimits = {
  /** Entries of any one list or object in any part (the longest real ones: an ESPN free-agent list, 500 players). */
  maxEntries: 2_000,
  /** How deep any part nests (real bodies: about 11). */
  maxDepth: 40,
  espn: { teams: 32, rosterEntries: 1_000, scoringItems: 300, matchupPeriodWeeks: 100, transactions: 5_000 },
  sleeper: { rosters: 40, rosterPlayers: 2_000, scoringKeys: 400, rosterPositions: 150 },
  /**
   * Scoring rules (thresholds, ranges: everything but a per-unit rate) a Sleeper upload's scoring settings make: the
   * import itself scores every free agent's projected weeks under all of them (250 surveyed 2026 leagues: at most 16
   * yardage-tier and points- or yards-allowed keys, the keys that make rules). Checked on the server only
   * (src/app/api/_lib/upload.ts), where the scoring map is.
   */
  sleeperScoringRules: 100,
  /**
   * The model build's work for an import the browser read: the players it scores (rostered and free agents) times the
   * scoring rules, a stepped rule ("every 5 passing yards") counted steppedRuleWeight times (it sums up to about 200
   * terms: about 11 µs against a range rule's 1.4, measured). At the cap a model build's scoring takes 2.4–3.4 s
   * (measured: 3,000 players × 50 rules, 1,500 × 10 stepped, 1,000 × 100 + 5 stepped); Parker's league is about 3,800
   * (0.13 s), a 32-team league of 1,600 players with 25 rules 40,000.
   */
  modelWork: 150_000,
  steppedRuleWeight: 10,
} as const;

/** How long the League page treats a league's data as current, the server's league TTL (§2.10): see browserFetchLimits. */
const REIMPORT_AFTER_MS = 10 * 60_000;

/**
 * Browser fetching (track BF; planner reply to Checkpoint 4c, Part B, B1: "Sleeper: fetch from the browser … ESPN public
 * leagues … fetch them from the browser too"). The browser's own client (src/lib/browserHttp.ts) and what the server
 * accepts from it (src/adapters/upload.ts, src/server/importToken.ts, src/lib/leagueFetch.ts). Browser-safe: plain
 * numbers, read by client code too.
 */
export const browserFetchLimits = {
  /** One request at a time per host, this long apart (ms; the server's own client waits 600 and 120). */
  hostGapMs: { "lm-api-reads.fantasy.espn.com": 250, "api.sleeper.app": 60 } as Readonly<Record<string, number>>,
  /** Any other host (never asked today: the CSP allows only the two above). */
  defaultGapMs: 250,
  /** Retries after a 429, a 5xx or no answer (a network error, a timeout), with backoff and jitter. */
  retries: 2,
  /** The first backoff wait; doubled each retry, plus up to backoffJitterMs. */
  backoffMs: 500,
  backoffJitterMs: 250,
  /** A Retry-After longer than this isn't waited for: the answer so far is the answer (someone is waiting on the page). */
  retryAfterCapMs: 10_000,
  /** Each request's own timeout (ms). */
  timeoutMs: 20_000,
  /** Parts of one upload (ESPN: the league, a period's transactions each, a list per position, the cards; Sleeper ≈ 40). */
  maxParts: 120,
  /**
   * The oldest response an upload may carry, by the browser's own clock (sentAt − a part's time): the browser sends what it
   * read right away, so anything older is refused (the client then asks the server to read the league itself).
   */
  maxPartAgeMs: 10 * 60_000,
  /**
   * How long a signed import stays good for the model route (the issue time, by the server's clock), and the clock skew
   * allowed. The League page sends one back only while its league data is under reimportAfterMs old (src/lib/modelStore.ts
   * modelPlan), so the server takes it that long plus 5 minutes for the request itself (review BF-R7: it took 6 hours);
   * an older token makes the model route read the league itself. (The numbers built from it are reused for up to 6 hours,
   * a rule of their own: src/lib/modelStore.ts MODEL_REUSE_MAX_AGE_MS.)
   */
  tokenMaxAgeMs: REIMPORT_AFTER_MS + 5 * 60_000,
  tokenFutureSkewMs: 60_000,
  /** The League page reads a league again before building its numbers once its data is this old (the server's league TTL, §2.10). */
  reimportAfterMs: REIMPORT_AFTER_MS,
  /** Refresh reads a league again at most this often (§2.10: once a minute, as the server's own copies). */
  refreshEveryMs: 60_000,
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

/**
 * The anonymous feedback store (track FB; src/server/feedbackSink.ts, the route src/app/api/feedback; its rate limit is
 * rateLimits.feedback, its deadline deadlines.feedbackMs). With Redis on Vercel, one list per UTC month of arrival
 * (`prefix + "fb:" + YYYY-MM`): each copy LPUSHed, the list trimmed to its newest maxPerMonth and its expiry reset to
 * retainDays, in one transaction (3 commands a copy; review FB-R5), so a month's list goes a year after the last copy that
 * month (the privacy page's words); `npm run feedback:pull` deletes its downloaded copies by the same rule (review FB-R2).
 * ⚠️ A year is the lead's design, a question for Parker at Checkpoint 7a. At the cap, about 1.1 KB a copy and at most 13
 * month lists alive, the store holds about 75 MB at most: under a third of the free tier's 256 MB (Checkpoint 7a's table).
 */
export const feedbackLimits = {
  maxPerMonth: 5_000,
  retainDays: 365,
  /** The store's write gives up after this long (the copy is dropped; the browser never waits for it, nor retries). */
  writeTimeoutMs: 2_000,
  /**
   * A refused copy is logged at most this often per server instance (review FB-R8): at most 144 lines a day each, well under
   * the error log's day list (logLimits.keepPerDay), so a flood of bad copies can't push the day's other lines out.
   */
  invalidLogEveryMs: 10 * 60_000,
} as const;
