/**
 * MyFantasyLeague export client for the probe (CLAUDE.md §2.6), following MFL's own rules from
 * https://api.myfantasyleague.com/2026/api_info (read 2026-09-29):
 * - URL: https://{host}/{year}/export?TYPE=…&L=…&JSON=1. League requests go to the league's wwwNN
 *   host; requests without L= must use api.myfantasyleague.com.
 * - "Wait one second between making requests": every *.myfantasyleague.com request (api host, league
 *   hosts, docs pages) shares one pacing bucket in lib/http.ts (≥ 1.2 s apart).
 * - "If a request fails, don't retry … check for the 429 status and cool things down": retries are
 *   off, and after one 429 this client refuses further requests for the rest of the run.
 * - Redirects are followed by hand (redirect: "manual"): Node's fetch drops the Cookie header on a
 *   cross-host redirect (api.* → wwwNN), so the client re-sends the request to the Location itself,
 *   re-attaching the cookie only for https *.myfantasyleague.com locations.
 * - Credentials: the MFL_USER_ID cookie from a POST login (never the APIKEY query parameter, which
 *   would put a credential in a URL). Private data is cached under a credential-scoped key.
 * - MFL reports most errors as HTTP 200 + {"error": …}; such bodies are never cached.
 */
import { request, type HttpResult, type RequestOptions } from "../http";
import { secrets } from "../redact";
import { canonical } from "./canonical";
import { docRequestOptions } from "./docs";
import { mflError } from "./json";

export const MFL_API_HOST = "api.myfantasyleague.com";
const MFL_HOST = /(^|\.)myfantasyleague\.com$/i;
export const MAX_REDIRECTS = 3;

/**
 * Docs pages. (API client registration lives on a league-host page linked from api_info; no wwwNN
 * host literal is kept in code, so a shard number here can never collide with a test league's host.)
 */
export const MFL_DOCS = {
  general: "https://api.myfantasyleague.com/2026/api_info",
  reference: "https://api.myfantasyleague.com/2026/api_info?STATE=details",
} as const;

export class MflThrottledError extends Error {
  constructor(label: string) {
    super(`MFL returned 429 earlier in this run; skipped ${label} to let MFL cool down`);
    this.name = "MflThrottledError";
  }
}

export interface RedirectHop {
  status: number;
  /** Hosts are templated: api.myfantasyleague.com, {leagueHost} or {otherMflHost}. */
  from: string;
  to: string;
}

export interface MflCall {
  /** Placeholder-only URL for reports: host and league ID replaced ({leagueHost}, {leagueId}). */
  template: string;
  res: HttpResult;
  /** Parsed body in canonical order (object keys and id-keyed arrays sorted; see canonical.ts). */
  json: unknown;
  /** Parsed body exactly as MFL sent it (for fixtures/raw). */
  rawJson: unknown;
  /** MFL error message from the body (MFL reports most errors as HTTP 200 + {"error": …}). */
  error?: string;
  /** Redirects MFL answered with before the final response. */
  redirects: RedirectHop[];
}

export interface CallOptions {
  /** League host (wwwNN.myfantasyleague.com) for league requests; default api host. */
  host?: string;
  ttlMs: number;
  namespace: string;
  /** Short placeholder-only label for the request log. */
  label: string;
  timeoutMs?: number;
}

export interface MflLogEntry {
  kind: "export" | "file" | "page" | "redirect";
  label: string;
  status: number;
  fromCache: boolean;
}

export type RequestFn = (url: string, opts: RequestOptions) => Promise<HttpResult>;

export interface MflClientOptions {
  /** HTTP function (default lib/http request); tests inject a fake. */
  request?: RequestFn;
  /** false: no file cache (tests). */
  cache?: boolean;
}

export const isRedirect = (res: HttpResult): boolean => res.status >= 300 && res.status < 400 && Boolean(res.headers.location);

/** Cache a real data response or a redirect; never an HTML page or an HTTP-200 MFL error body. */
export const cacheMflResponse = (res: HttpResult): boolean => (res.status === 200 && !res.isHtml && res.json !== undefined && mflError(res.json) === undefined) || isRedirect(res);

/**
 * Where to go next after a 3xx: the Location resolved against the current URL, only when it is an
 * *.myfantasyleague.com host (http is upgraded to https; MFL serves every host over https).
 * Anything else is refused, so the cookie can never travel to another site or in clear text.
 */
export function nextMflUrl(current: string, location: string | undefined): string | undefined {
  if (!location) return undefined;
  let u: URL;
  try {
    u = new URL(location, current);
  } catch {
    return undefined;
  }
  if (!MFL_HOST.test(u.hostname)) return undefined;
  if (u.protocol === "http:") u.protocol = "https:";
  return u.protocol === "https:" ? u.toString() : undefined;
}

/**
 * api_info: "the cookie value is a Base64 string. That means it may contain the special symbols
 * '+', '/' and/or '='. Depending on your environment, you may need to explicitly URL-escape these
 * symbols before passing them back to us (e.g. converting '=' to '%3D')." Node sends the header
 * verbatim, so escape exactly those three symbols (a '%' already in the value is left alone).
 */
export function escapeCookieValue(value: string): string {
  return value.replace(/[+/=]/g, (ch) => encodeURIComponent(ch));
}

export class MflClient {
  throttled = false;
  readonly calls: MflCall[] = [];
  /** Every MFL HTTP exchange of the run (exports, files, docs pages, redirect hops). */
  readonly log: MflLogEntry[] = [];
  /** The league's own host once known, for templating redirect hops. */
  leagueHost?: string;
  private readonly req: RequestFn;

  constructor(
    readonly year: number,
    /** "public", or a credential scope (see cache.credentialScope) when a login cookie is used. */
    readonly scope: string = "public",
    private readonly cookie?: string,
    private readonly options: MflClientOptions = {},
  ) {
    this.req = options.request ?? request;
  }

  get hasCookie(): boolean {
    return Boolean(this.cookie);
  }

  url(type: string, params: Record<string, string | number | undefined>, host: string = MFL_API_HOST): string {
    const q = new URLSearchParams({ TYPE: type });
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
    q.set("JSON", "1");
    return `https://${host}/${this.year}/export?${q.toString()}`;
  }

  template(type: string, params: Record<string, string | number | undefined>, host: string = MFL_API_HOST): string {
    const shown: Record<string, string | number | undefined> = { ...params };
    if (shown.L !== undefined) shown.L = "{leagueId}";
    if (typeof shown.PLAYERS === "string" && shown.PLAYERS.includes(",")) shown.PLAYERS = "{playerIds}";
    if (shown.SEARCH !== undefined) shown.SEARCH = "{term}";
    const u = this.url(type, shown, host === MFL_API_HOST ? host : "{leagueHost}");
    return decodeURIComponent(u);
  }

  hostTemplate(host: string): string {
    if (host === MFL_API_HOST) return host;
    return this.leagueHost && host === this.leagueHost ? "{leagueHost}" : "{otherMflHost}";
  }

  async export(type: string, params: Record<string, string | number | undefined>, o: CallOptions): Promise<MflCall> {
    const { res, hops, refused } = await this.getFollowing(this.url(type, params, o.host), o, true, "export");
    const call = this.toCall(this.template(type, params, o.host), res, hops, refused);
    this.calls.push(call);
    return call;
  }

  /** Non-export JSON files on the api host (e.g. /fflnetdynamic2026/mfl_status.json). Never sends the cookie. */
  async file(pathAndQuery: string, o: CallOptions): Promise<MflCall> {
    const url = `https://${MFL_API_HOST}${pathAndQuery}`;
    const { res, hops, refused } = await this.getFollowing(url, o, false, "file");
    const call = this.toCall(url, res, hops, refused);
    this.calls.push(call);
    return call;
  }

  /** A docs page (HTML, cached 7 days). Paced and counted like every MFL request; never sends the cookie. */
  async page(url: string): Promise<HttpResult> {
    const opts = docRequestOptions(url);
    if (this.throttled) throw new MflThrottledError(opts.label ?? url);
    const res = await this.req(url, { ...opts, cache: this.options.cache === false ? undefined : opts.cache });
    this.note("page", opts.label ?? url, res);
    return res;
  }

  private toCall(template: string, res: HttpResult, hops: RedirectHop[], refused: boolean): MflCall {
    const rawJson = res.json;
    const error = refused ? "redirect to a location outside https *.myfantasyleague.com refused" : hops.length > MAX_REDIRECTS ? "too many redirects" : rawJson === undefined ? undefined : mflError(rawJson);
    return { template, res, json: rawJson === undefined ? undefined : canonical(rawJson), rawJson, error, redirects: hops };
  }

  private note(kind: MflLogEntry["kind"], label: string, res: HttpResult): void {
    this.log.push({ kind, label, status: res.status, fromCache: res.fromCache });
    if (res.status === 429) this.throttled = true;
  }

  /** GET with manual redirects (see the module comment). */
  private async getFollowing(url: string, o: CallOptions, withCookie: boolean, kind: "export" | "file"): Promise<{ res: HttpResult; hops: RedirectHop[]; refused: boolean }> {
    const hops: RedirectHop[] = [];
    let current = url;
    for (;;) {
      if (this.throttled) throw new MflThrottledError(o.label);
      const res = await this.req(current, {
        retries: 0,
        redirect: "manual",
        cookie: withCookie ? this.cookie : undefined,
        timeoutMs: o.timeoutMs ?? 90_000,
        label: hops.length ? `${o.label} (redirect ${hops.length})` : o.label,
        cacheIf: cacheMflResponse,
        cache: this.options.cache === false ? undefined : { key: `mfl:${withCookie ? this.scope : "public"}:${current}`, ttlMs: o.ttlMs, namespace: o.namespace },
      });
      this.note(hops.length ? "redirect" : kind, o.label, res);
      if (!isRedirect(res)) return { res, hops, refused: false };
      const next = nextMflUrl(current, res.headers.location);
      if (!next) return { res, hops, refused: true };
      hops.push({ status: res.status, from: this.hostTemplate(new URL(current).host), to: this.hostTemplate(new URL(next).host) });
      if (hops.length > MAX_REDIRECTS) return { res, hops, refused: false };
      current = next;
    }
  }
}

/**
 * Log in with MFL_USERNAME / MFL_PASSWORD (POST over HTTPS, as the docs recommend) and return the
 * Cookie header value. The cookie (raw and escaped) is added to the output scrubber at once and never
 * printed. Redirects are not followed, so the credentials go to api.myfantasyleague.com only.
 */
export async function mflLogin(year: number, username: string, password: string, req: RequestFn = request): Promise<string> {
  const res = await req(`https://${MFL_API_HOST}/${year}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ USERNAME: username, PASSWORD: password, XML: "1" }).toString(),
    retries: 0,
    redirect: "manual",
    label: "MFL login (POST)",
  });
  const m = /MFL_USER_ID="([^"]+)"/.exec(res.text);
  if (!m?.[1]) throw new Error(`MFL login failed (HTTP ${res.status}); check MFL_USERNAME and MFL_PASSWORD in .env.local`);
  const escaped = escapeCookieValue(m[1]);
  secrets.add(m[1], "[REDACTED:MFL_USER_ID]");
  if (escaped !== m[1]) secrets.add(escaped, "[REDACTED:MFL_USER_ID]");
  return `MFL_USER_ID=${escaped}`;
}
