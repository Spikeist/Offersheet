/**
 * Budgeted, cached Sleeper client for the settings-code crawl (CLAUDE.md §0.9, §2.3, §2.10).
 *
 * - The main Sleeper probe uses the same 1,000 calls/minute allowance at the same time, so this
 *   process keeps at least 400 ms between its own requests (at most ~150 a minute).
 * - Every call counts against a hard budget, cached or not, so a rerun crawls the same sample.
 * - Responses are cached for 24 h (7 days for finished seasons). This is sampling for code
 *   meanings, not live league data; the 10-minute league TTL is only a floor.
 * - A 404 for a finished season can be cached too (cacheNotFound), so a rerun never asks again.
 * - Log labels are templates ("league/{leagueId}/users"), so no ID reaches the console; the probe
 *   registers every ID that goes into a URL with its Redactor as a second line of defence.
 */
import { DAY } from "../cache";
import { request, setHostGap, type HttpResult } from "../http";

export const SLEEPER_API = "https://api.sleeper.app/v1";
export const SLEEPER_HOST = "api.sleeper.app";
export const CRAWL_GAP_MS = 400;
/** 2026 lists and /state/nfl share one TTL so they form one snapshot; finished seasons don't change. */
export const CRAWL_TTL = { crawl: DAY, finished: 7 * DAY, docs: 7 * DAY } as const;

export class BudgetExhausted extends Error {
  constructor(max: number) {
    super(`request budget of ${max} reached`);
    this.name = "BudgetExhausted";
  }
}

export interface CrawlResponse<T> {
  status: number;
  /** Parsed body for HTTP 2xx JSON responses, else undefined. */
  data: T | undefined;
  /** 404 or a literal `null` body (Sleeper's answer for an unknown league). */
  missing: boolean;
  fromCache: boolean;
}

export type RawSink = (path: string, template: string, res: HttpResult) => Promise<void>;

/** Cache 200 JSON (the default), plus 404 when the caller knows the answer can't change. */
export function crawlCacheIf(cacheNotFound: boolean): (res: HttpResult) => boolean {
  return (res) => (res.status === 200 && !res.isHtml) || (cacheNotFound && res.status === 404);
}

export class SleeperCrawlClient {
  calls = 0;
  live = 0;
  cached = 0;
  readonly statusCounts: Record<string, number> = {};
  readonly byTemplate: Record<string, number> = {};

  constructor(
    readonly maxRequests: number,
    private readonly sink?: RawSink,
  ) {
    setHostGap(SLEEPER_HOST, CRAWL_GAP_MS);
  }

  get remaining(): number {
    return this.maxRequests - this.calls;
  }

  /** GET {SLEEPER_API}{path}. `template` is the placeholder-only form used in logs and reports. */
  async get<T>(path: string, template: string, ttlMs: number, opts: { cacheNotFound?: boolean } = {}): Promise<CrawlResponse<T>> {
    if (this.calls >= this.maxRequests) throw new BudgetExhausted(this.maxRequests);
    this.calls++;
    this.byTemplate[template] = (this.byTemplate[template] ?? 0) + 1;
    const res = await request(SLEEPER_API + path, {
      cache: { key: `sleeper-codes:${path}`, ttlMs, namespace: "sleeper-codes" },
      cacheIf: crawlCacheIf(opts.cacheNotFound ?? false),
      label: `sleeper ${template}`,
    });
    if (res.fromCache) this.cached++;
    else this.live++;
    this.statusCounts[String(res.status)] = (this.statusCounts[String(res.status)] ?? 0) + 1;
    await this.sink?.(path, template, res);
    return {
      status: res.status,
      data: res.ok && !res.isHtml ? (res.json as T | undefined) : undefined,
      missing: res.status === 404 || res.text.trim() === "null",
      fromCache: res.fromCache,
    };
  }
}
