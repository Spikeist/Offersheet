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
 * /api/health's check of the shared store (planner reply to Checkpoint 7a, §1; src/app/api/health/handler.ts): one SET, GET
 * and DEL of a random key, each waiting at most stepTimeoutMs; the key expires after keyTtlMs if its DEL never arrives.
 */
export const healthLimits = {
  stepTimeoutMs: 2_000,
  keyTtlMs: 60_000,
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
  /** /api/health (planner reply to Checkpoint 7a, §1): a check by hand, so a few a minute is plenty. */
  health: { limit: 12, windowS: 600 },
  /**
   * /api/cron/snapshot (planner reply to Checkpoint 7a, §6.3): Vercel's cron calls it once a day, and a local test a few
   * times; anything more is someone guessing at CRON_SECRET (the route answers 401 and does nothing).
   */
  cron: { limit: 10, windowS: 600 },
  /**
   * IPv6 (review SEC-2): a /64 is one client, but a household gets a /56 and a free tunnel broker a /48 (65,536 /64s), so
   * each IPv6 request also counts against its address's /48, at this many times the /64's limit (a phone carrier's pool can
   * put many subscribers in one /48, so it can't be one client's limit). IPv4 addresses are scarce: one address, one count.
   */
  groupFactor: 10,
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
  /**
   * FantasyCalc (planner reply to Checkpoint 7a, §5.4; reports/fantasycalc-permission.md): its own rule, each format's list
   * at most once every 3 hours and only on demand, is kept per format by the cache (src/server/cache.ts TTL.fantasyCalc)
   * and its single-flight lock, and by the gate's memory of answers the checks turned down (src/data/fantasyCalcValues.ts).
   * So this day's budget is only the guard against a bug, sized to that rule's own bound (review of Checkpoint 7b's server
   * work: at 400, anyone could spend the day's budget by asking for League pages in format after format, each refresh within
   * the rule, and leave everyone's builds without values): the 144 formats a league can ask for (src/server/snapshots.ts
   * parseFormatKey) refreshed every 3 hours are at most 144 × (⌊h / 3⌋ + 1) requests by hour h of a UTC day, 1,152 by its
   * end, and the day's slices (below) open max((⌊h / 2⌋ + 1) / 12, 1/4) of the budget by then, so the budget must be at least
   * 1,383 (the tightest moment: 9:00 UTC, 576 requests against 5 slices' share); 1,500 leaves room for retries. It was 200
   * while a list was kept a day, then 400.
   */
  perDay: { espn: 4_000, sleeper: 15_000, fantasycalc: 1_500, github: 100 },
  /**
   * On Vercel only: each client's share of a platform's day, counted on league requests only (league-independent data is
   * fetched once for everyone), so a few clients can't spend the whole day's budget for everyone. About 30 cold server-side
   * imports of either kind a day. A client here is its address's group (review SEC-2: an IPv4 /24, an IPv6 /48; one person
   * can hold a whole /48), the same group id as the daily work budget's (workLimits).
   */
  perClientPerDay: { espn: 400, sleeper: 1_500 },
  /**
   * Kept for requests that carry a visitor's ESPN cookies (review SEC-2): a private league has no browser path, so reads
   * without cookies (public leagues the server reads itself) stop this far short of the day's budget, and an attacker's
   * cookie-less imports can't leave private leagues unreadable for the rest of the day.
   */
  reservedForCookies: { espn: 1_000 },
  /**
   * The day in slices (review SEC-2: "so a burst can only take one slice"): by the end of slice i of `slices` (2 hours each)
   * at most (i + 1) / slices of a day's budget may have been spent, unused budget carried on, but never less than
   * burstShare of it, so the first hours of a UTC day (the US evening) still have a quarter of the day.
   */
  slices: 12,
  burstShare: 0.25,
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
 * The daily work budget (final review SEC-1, F1; src/server/budget.ts workBudget, charged by withRoute and the import and
 * model handlers): what the server's own work for visitors may cost a day, on Vercel only. Vercel's Hobby plan pauses
 * the whole project for up to 30 days once a month's Active CPU (4 hours) or Fast Origin Transfer (10 GB: request and
 * response bytes) runs out, and the per-IP windows alone let one client spend that in days. So every import and League
 * page request costs units, counted per UTC day against the client (its IPv4 address or IPv6 /64), its group (the IPv4 /24
 * or IPv6 /48 it's in) and the whole server; past any of them the request is refused with BUSY (Retry-After: when the
 * day, or for the server's day the next slice, starts).
 *
 * A unit is about 100 ms of the server's CPU or about 75 KB of request body, as measured at Checkpoint 7a's final review
 * (i9 desktop; ⚠️ Vercel's CPUs may be slower, so the day's 4,000 units are about 400 CPU-seconds, under the 480 a month's
 * 4 hours allow a day, and about 300 MB of transfer, under its 333): a Sleeper import read by the browser about 3 units,
 * an ESPN one about 10, a League page build 5, a league the server reads itself 6 (a build with it 10). Real use is far
 * below a client's 500 a day (about 33 ESPN imports with their League page builds, 60 Sleeper ones).
 */
export const workLimits = {
  /** Request-body bytes per unit (Content-Length; a body without one costs its cap). */
  unitBytes: 75_000,
  /** What a request costs when it arrives, besides its body's bytes, by what it asks for (src/server/budget.ts admissionUnits). */
  units: {
    /** A league the browser read, to the import route. */
    importUpload: 2,
    /** A league the server reads itself (the import route's JSON body, or an upload while ESPN cookies are connected). */
    importServer: 6,
    /** A League page build from the import the browser saved, signed (a replay of the same import costs the same: memoized). */
    modelSigned: 4,
    /** A League page build that reads the league itself first. */
    modelServer: 10,
  },
  /** A model build costs one more unit for every modelWorkPerUnit of its work (modelWorkOf) past modelWorkIncluded. */
  modelWorkIncluded: 15_000,
  modelWorkPerUnit: 5_000,
  perClientPerDay: 500,
  perGroupPerDay: 2_000,
  /** The whole server's day, in slices like the outbound budgets (budgets.slices, budgets.burstShare). */
  perDay: 4_000,
  /**
   * Redis down or slow: each process counts its own and may spend at most this share of the day (fail open, but a
   * process can't spend the whole server's day; ⚠️ many processes together still can).
   */
  processShare: 0.25,
  /** A day's counter lives until its UTC day ends and this margin (instances' clocks differ a little). */
  keyMarginMs: 60_000,
  /** The process's own counts and its record of refused clients: at most this many a day; past it, the oldest go. */
  memoryMaxKeys: 20_000,
  /** A Redis count slower than this lets the request through, counted in the process's own budget instead (logged). */
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
  healthMs: 10_000,
  /**
   * The daily snapshot cron (planner reply to Checkpoint 7a, §6.3; src/server/snapshots.ts): Sleeper's NFL state and the NFL
   * schedule (usually cached), two weeks of Sleeper's projections and at most snapshotLimits.fantasyCalcFormatsPerDay
   * FantasyCalc lists, one request at a time; well under a minute when the sources answer.
   */
  cronMs: 110_000,
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
 * (the league it read itself), refused unread past compressedBytes and refused while unpacking past unpackedBytes (a zip
 * bomb stops there). Vercel takes at most 4.5 MB a request body. Measured (Checkpoint 7a): Parker's ESPN league's upload
 * 0.55 MB gzip, 2.26 MB unpacked; a Sleeper league's under 0.1 MB. Final review SEC-1: the caps were 3 and 20 MB, and a
 * 19 KB body unpacking to 20 MB cost 1.3–1.9 s of CPU before it was refused; at 6 MB about a third of that.
 */
export const uploadLimits = {
  compressedBytes: 2_000_000,
  unpackedBytes: 6_000_000,
} as const;

/**
 * The import the browser saved, signed, posted to the model routes (final review SEC-1: its own caps; Parker's is 25 KB
 * gzip, 113 KB unpacked). Reading it and checking its signature hashes the whole snapshot, so its size is the cost.
 */
export const signedUploadLimits = {
  compressedBytes: 1_000_000,
  unpackedBytes: 4_000_000,
} as const;

/**
 * The model routes' memory of answers they built from a signed import (final review SEC-1; src/app/api/model/memo.ts): the
 * same signed import posted again within its token's life (browserFetchLimits.tokenMaxAgeMs) gets the answer already built
 * on this instance instead of a new build. At most this many bytes of answers per instance (about 145 KB each).
 */
export const modelMemoLimits = {
  maxBytes: 24_000_000,
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
   * terms: about 11 µs against a range rule's 1.4, measured). At 150,000 a model build's scoring took 2.4–3.4 s
   * (measured: 3,000 players × 50 rules, 1,500 × 10 stepped, 1,000 × 100 + 5 stepped), so the cap is 60,000 since the
   * final review (SEC-1: about 1.4 s); Parker's league is about 3,800 (0.13 s), a 32-team league of 1,600 players with 25
   * rules 40,000. A bigger real league is read by the server itself (the browser's upload is refused).
   */
  modelWork: 60_000,
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
 * The beta's usage counters (planner reply to Checkpoint 7a, §2 question 7: "Usage check: add npm run usage:report"; §5.4:
 * FantasyCalc's sessions; src/server/usage.ts, read by `npm run usage:report -- --live`, scripts/usage-report.ts): one key per
 * counter and UTC day in the shared store (Vercel only), no identifiers. A request that counts something costs one more
 * transaction after its answer, two Upstash commands per counter it touched (a League page build usually 2 counters, an
 * import 2: about 8 commands a session).
 */
export const usageLimits = {
  /** A counter's key lives this long after its day's last count (the report reads 30 days and the month to date). */
  retainDays: 400,
  /** The after-response write gives up after this long (it never delays an answer; its counts are then dropped). */
  writeTimeoutMs: 2_000,
  /**
   * Counts this process holds (every refusal; whatever is counted after a request's write) go out with the next request
   * that writes anyway, else with the first request at least this long after their last write: a flood of refused requests
   * costs at most one write this often per instance.
   */
  heldWriteEveryMs: 5 * 60_000,
  /**
   * FantasyCalc's free use (reports/fantasycalc-permission.md, their reply of 2026-10-05): about 10,000 sessions a month
   * (a session: a League page model build answered); the report warns from 8,000, so Parker can write to them first.
   */
  fantasyCalcSessionsPerMonth: 10_000,
  fantasyCalcSessionsWarnAt: 8_000,
} as const;

/**
 * The daily snapshot cron (planner reply to Checkpoint 7a, §6.3: "a daily Vercel cron at 0 20 * * * … checks CRON_SECRET,
 * takes a lock, and is idempotent … Upstash, compressed, kept up to 2 seasons"; src/server/snapshots.ts, the route
 * src/app/api/cron/snapshot, its rate limit rateLimits.cron and its deadline deadlines.cronMs). Public data only: Sleeper's
 * weekly projections and FantasyCalc's value lists, nothing about any league.
 *
 * Storage (gzip, then base64 in a string value; measured offline on the local archives and the Phase 0 captures): a week of
 * projections for all nine positions is 37–39 KB gzip, about 52 KB stored, and one key per NFL week holds it, so at most
 * about 0.95 MB a season; a list is about 6.2 KB stored (redraft, about 197 players) or 11.6 KB (dynasty, about 395), so a
 * day at the cap is 74–139 KB. Two seasons at the cap every single day, dynasty lists only, would be about 105 MB of the
 * free plan's 256 MB (next to the feedback store's bound, about 75 MB, and the cache's few MB). ⚠️ Real use is far less: a
 * format is saved only on a day after someone's League page read it (yesterday or today), so about 12 lists a day in season
 * and a few out of it come to about 20 MB a year, about 40 MB for the two seasons kept.
 */
export const snapshotLimits = {
  /** A run's lock (SET NX PX), longer than any run (the route's maxDuration), so an overlapping delivery finds it taken. */
  lockMs: 10 * 60_000,
  /**
   * FantasyCalc formats looked at a UTC day at most (each a list read, from the cache when it holds today's, and saved); past
   * it the formats in use take turns, the longest unsaved first (src/server/snapshots.ts formatsToSave).
   */
  fantasyCalcFormatsPerDay: 12,
  /** A saved snapshot is kept this long after its last write: two seasons. */
  retainDays: 730,
  /** The model builds' record of the formats they read, a set per UTC day, kept this long (the cron reads today's and yesterday's). */
  formatsInUseRetainDays: 3,
  /** Each store command (GET, SET, SMEMBERS …) waits at most this long; a slower one fails it and the run's later ones. */
  redisTimeoutMs: 5_000,
  /**
   * No FantasyCalc format is started with less of the run's deadline (deadlines.cronMs) left than this: one list's request
   * (FantasyCalc's own timeout is longer, but the HTTP client caps it at the time left) and its save; the rest wait a day.
   */
  listMinTimeLeftMs: 15_000,
  /** The largest value written (base64 of the gzip; a real week of projections is about 52 KB): an unexpected giant isn't stored. */
  maxValueChars: 1_000_000,
} as const;

/**
 * The anonymous feedback store (track FB; src/server/feedbackSink.ts, the route src/app/api/feedback; its rate limit is
 * rateLimits.feedback, its deadline deadlines.feedbackMs). With Redis on Vercel, one list per UTC day of arrival
 * (`prefix + "fb:" + YYYY-MM-DD`; final review SEC-3: a month's list kept its newest 5,000, so 84 IPv6 /64s at the hourly
 * limit could push a month's real outcomes out with forged copies; now a flood crowds out its own day at most): each copy
 * LPUSHed, the list trimmed to its newest maxPerDay and its expiry reset to retainDays, in one transaction (3 commands a
 * copy; review FB-R5), so a day's list goes a year after that day (the privacy page's words; planner reply to Checkpoint
 * 7a, §4 privacy item 3: "up to 12 months, then delete it"); `npm run feedback:report -- --live` reads the lists straight from
 * the store and saves only aggregate counts (never a copy), flagging days with unusual counts for Phase 6 to drop or
 * down-weight. Each client (an IPv4 address or IPv6 /64) may send perClientPerDay copies a UTC day and each group (an IPv4
 * /24 or IPv6 /48) perGroupPerDay; past either the route answers RATE_LIMITED until the day ends.
 * ⚠️ A year is the lead's design, a question for Parker at Checkpoint 7a. The store's bound (final review F4): at most
 * maxPerDay copies of at most maxStoredBytes in each of the 366 days alive, about 75 MB, under a third of the free tier's
 * 256 MB, which the cache, the limits, the budgets and the log share; real copies (about 1.0–1.2 KB, Parker's top 10) a
 * full year of full days would make about 45 MB.
 */
export const feedbackLimits = {
  maxPerDay: 100,
  retainDays: 365,
  /**
   * The largest copy stored, as stored (JSON with its day; final review F4: the schema accepts copies up to about 3.3 KB,
   * real ones are about 1.0–1.2 KB); a bigger copy is refused (400, never stored).
   */
  maxStoredBytes: 2_048,
  perClientPerDay: 30,
  perGroupPerDay: 60,
  /** The store's write gives up after this long (the copy is dropped; the browser never waits for it, nor retries). */
  writeTimeoutMs: 2_000,
  /**
   * A refused copy is logged at most this often per server instance (review FB-R8): at most 144 lines a day each, well under
   * the error log's day list (logLimits.keepPerDay), so a flood of bad copies can't push the day's other lines out.
   */
  invalidLogEveryMs: 10 * 60_000,
} as const;
