/**
 * Yahoo OAuth 2.0 helpers for the Phase 0 probe (CLAUDE.md §2.4). Pure functions; the probe does
 * the HTTP. Endpoints and fields follow Yahoo's authorization-code guide
 * (developer.yahoo.com/oauth2/guide/flows_authcode/, read 2026-09-29):
 *
 * - Authorize: client_id, redirect_uri, response_type=code, optional state and language. The guide
 *   lists no scope parameter: "Fantasy Sports: Read" (fspt-r) is granted by the app's permissions.
 * - Token: POST grant_type + code (or refresh_token) + redirect_uri, with
 *   "Authorization: Basic base64(client_id:client_secret)". Access tokens last 1 hour.
 *
 * Nothing here logs. Callers must register every token with the scrubber before any output.
 */
import { z } from "zod";

export const YAHOO_AUTHORIZE_URL = "https://api.login.yahoo.com/oauth2/request_auth";
export const YAHOO_TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
export const YAHOO_API_BASE = "https://fantasysports.yahooapis.com/fantasy/v2";
/** Must be registered on the Yahoo app and must be HTTPS (§2.4). */
export const YAHOO_REDIRECT_URI = "https://localhost:3001/api/auth/yahoo/callback";
/** The app permission we need ("Fantasy Sports: Read"). */
export const YAHOO_SCOPE = "fspt-r";

/**
 * Extra .env.local variables the OAuth flow uses. They are listed in scripts/lib/env.ts (so the
 * output scrubber knows them) and in .env.example, but not in CLAUDE.md §0.5's list: the probe
 * reports that as a decision for the checkpoint.
 */
export const YAHOO_AUTH_CODE_VAR = "YAHOO_AUTH_CODE";
export const YAHOO_REFRESH_TOKEN_VAR = "YAHOO_REFRESH_TOKEN";

export function authorizeUrl(clientId: string, state: string, redirectUri: string = YAHOO_REDIRECT_URI): string {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", state, language: "en-us" });
  return `${YAHOO_AUTHORIZE_URL}?${q.toString()}`;
}

export function basicAuthHeader(clientId: string, clientSecret: string): string {
  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
}

export function codeGrantBody(code: string, redirectUri: string = YAHOO_REDIRECT_URI): string {
  return new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }).toString();
}

export function refreshGrantBody(refreshToken: string, redirectUri: string = YAHOO_REDIRECT_URI): string {
  return new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, redirect_uri: redirectUri }).toString();
}

/**
 * The code Yahoo appends to the redirect URI. Accepts the bare code or the whole callback URL
 * (people copy the address bar), so a pasted URL still works.
 */
export function extractAuthCode(input: string): string | undefined {
  const t = input.trim();
  if (!t) return undefined;
  if (/^https?:\/\//i.test(t) || t.includes("code=")) {
    try {
      const u = new URL(/^https?:\/\//i.test(t) ? t : `https://x.invalid/?${t.replace(/^\?/, "")}`);
      return u.searchParams.get("code")?.trim() || undefined;
    } catch {
      return undefined;
    }
  }
  return t;
}

const TokenOk = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.coerce.number().optional(),
  refresh_token: z.string().min(1).optional(),
  xoauth_yahoo_guid: z.string().optional(),
});

export type TokenResult =
  | { ok: true; accessToken: string; refreshToken?: string; expiresIn?: number; userGuid?: string }
  | { ok: false; error: string; description?: string };

/** Interpret a token-endpoint response. Error text is Yahoo's, never a credential. */
export function parseTokenResponse(status: number, json: unknown): TokenResult {
  if (status === 200) {
    const parsed = TokenOk.safeParse(json);
    if (parsed.success) {
      const t = parsed.data;
      return { ok: true, accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in, userGuid: t.xoauth_yahoo_guid };
    }
    return { ok: false, error: "unexpected_response", description: `HTTP 200 without access_token (${parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", ")})` };
  }
  const obj = isRecord(json) ? json : {};
  const err = obj.error;
  if (typeof err === "string") return { ok: false, error: err, description: typeof obj.error_description === "string" ? obj.error_description : undefined };
  if (isRecord(err)) {
    const text = [err.description, err.message, err.localizedMessage].find((x): x is string => typeof x === "string");
    return { ok: false, error: `HTTP ${status}`, description: text };
  }
  return { ok: false, error: `HTTP ${status}` };
}

export interface YahooGame {
  gameKey: string;
  season?: string;
  code?: string;
  name?: string;
}

/** fantasy_content.game from `game/nfl?format=json`: an array holding one game object (or the object itself). */
export function extractGame(json: unknown): YahooGame | null {
  const content = isRecord(json) ? json.fantasy_content : undefined;
  const game = isRecord(content) ? content.game : undefined;
  const candidates = Array.isArray(game) ? game : [game];
  for (const g of candidates) {
    if (!isRecord(g)) continue;
    const key = g.game_key;
    if (typeof key === "string" || typeof key === "number") {
      const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : undefined);
      return { gameKey: String(key), season: str(g.season), code: str(g.code), name: str(g.name) };
    }
  }
  return null;
}

/** Characters we allow in a value written to .env.local unquoted ('$' would be expanded by @next/env). */
const SAFE_ENV_VALUE = /^[A-Za-z0-9._~+/=-]+$/;

/**
 * Set NAME=value in .env.local text (pure). Replaces an existing line (with or without `export`)
 * or appends one, keeping the file's line endings. Throws on values that dotenv would alter.
 */
export function upsertEnvLine(text: string, name: string, value: string): string {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error("invalid variable name");
  if (!SAFE_ENV_VALUE.test(value)) throw new Error(`value for ${name} has characters that .env parsing would change; not written`);
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const lines = text.length ? text.split(/\r?\n/) : [];
  const re = new RegExp(`^\\s*(export\\s+)?${name}\\s*=`);
  const idx = lines.findIndex((l) => re.test(l));
  if (idx >= 0) {
    lines[idx] = `${name}=${value}`;
  } else {
    if (lines.length && lines[lines.length - 1] === "") lines.splice(lines.length - 1, 0, `${name}=${value}`);
    else lines.push(`${name}=${value}`);
  }
  const out = lines.join(eol);
  return out.endsWith(eol) ? out : out + eol;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
