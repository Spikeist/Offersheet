/**
 * Fleaflicker API client for the probe: polite cached GETs (10-minute league cache, CLAUDE.md
 * §2.10), identity registration for every response, raw capture, shape check, and sanitized
 * fixtures. Fleaflicker needs no login, so league data is keyed by URL (public scope). Client
 * errors (4xx except 429) are cached for the same 10 minutes, so a missing league isn't asked for
 * again on every run.
 */
import { HttpError, type HttpResult } from "../http";
import type { ProbeContext } from "../probe";
import { apiUrl, shapeIssues } from "./api";
import { TRIM_KEYS, protectPublic, type FleaIdentities } from "./identities";
import type { z } from "zod";

type ParamValue = string | number | boolean | ReadonlyArray<string | number> | undefined;

export interface Fetched<T> {
  data: T | null;
  res: HttpResult | null;
  /** URL template for reports ({leagueId}, placeholder team ids …). */
  url: string;
  /** Schema problems as "json.path: message" (empty when the shape fits). */
  issues: string[];
  error?: string;
}

export type Role = "primary" | "oracle" | "screen" | "coverage";

/** Cache 200 responses (JSON, or HTML for the public rules/listing pages) and 4xx answers except 429. */
export function cacheableStatus(res: HttpResult): boolean {
  return res.status === 200 || (res.status >= 400 && res.status < 500 && res.status !== 429);
}

/** Like cacheableStatus, but a 200 must be JSON (an HTML page from an API URL is an error). */
export function cacheableApi(res: HttpResult): boolean {
  return res.status === 200 ? !res.isHtml : cacheableStatus(res);
}

export class FfClient {
  constructor(
    private readonly p: ProbeContext,
    private readonly ids: FleaIdentities,
    readonly leagueId: string,
    readonly role: Role,
  ) {}

  template(endpoint: string, params: Record<string, ParamValue>): string {
    return apiUrl(endpoint, { league_id: "{leagueId}", ...params });
  }

  async get<T>(endpoint: string, params: Record<string, ParamValue>, schema: z.ZodType, opts: { tmpl?: Record<string, ParamValue>; sweep?: boolean } = {}): Promise<Fetched<T>> {
    const url = apiUrl(endpoint, { league_id: this.leagueId, ...params });
    const tUrl = this.template(endpoint, opts.tmpl ?? params);
    try {
      const { data, res } = await this.p.getJson<T>(url, { cache: this.p.leagueCache(url), cacheIf: cacheableApi, label: `${this.role} ${endpoint}` });
      if (opts.sweep !== false) this.ids.sweep(data);
      await this.p.saveRaw(`${this.role}:${url}`, data, res);
      return { data, res, url: tUrl, issues: shapeIssues(schema, data) };
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      await this.p.saveRaw(`${this.role}:${url}`, err.res.text, err.res, err.res.isHtml ? ".html" : ".txt");
      return { data: null, res: err.res, url: tUrl, issues: [], error: err.message };
    }
  }

  /**
   * Save a sanitized copy: identities replaced by key (FleaIdentities.prepare), then the Redactor
   * pass and leak check (p.saveSanitized). Returns null when there is nothing to save; throws
   * LeakError when something sensitive would remain.
   */
  async fixture(label: string, f: Fetched<unknown>, opts: { trim?: boolean; dropStats?: boolean; note?: string } = {}): Promise<string | null> {
    if (f.data === null || !f.res) return null;
    const prepared = this.ids.prepare(f.data, { trim: opts.trim, dropStats: opts.dropStats });
    const note = [
      opts.note,
      opts.trim ? `trimmed keys: ${[...TRIM_KEYS].join(", ")}; owner reduced to {id}; lineup slot position reduced to {label, group}` : "",
      opts.dropStats ? "display-stat arrays (viewingActualStats, viewingProjectedStats) removed" : "",
    ]
      .filter(Boolean)
      .join("; ");
    return this.p.saveSanitized(`${this.role}/${label}`, prepared, { url: f.url, status: f.res.status, contentType: f.res.contentType, note: note || undefined }, { protect: protectPublic });
  }
}
