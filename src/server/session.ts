import "server-only";
/**
 * Credentials a user types in (ESPN cookies now; MFL logins and Yahoo tokens in Phase 5) live only
 * in an encrypted, httpOnly, SESSION-ONLY cookie (CLAUDE.md §3 Credentials, Phase 1):
 *
 * - Sealed with iron-session (AES-256-CBC + HMAC-SHA-256, keyed by SESSION_SECRET). Nothing is stored
 *   on the server; the browser holds the only copy.
 * - Session-only: the Set-Cookie header never carries Max-Age or Expires, so the browser forgets the
 *   cookie when it closes. iron-session 9 always derives a Max-Age from `ttl`, and its documented
 *   switch for session cookies (`cookieOptions: { maxAge: undefined }`) also forces ttl = 0, a seal
 *   that never expires and can't be revoked. So we keep a finite seal `ttl` (the server stops
 *   accepting the seal after SESSION_SEAL_TTL_SECONDS, even if a browser restores its session) and
 *   strip Max-Age/Expires in the cookie jar instead. Deletions keep Max-Age=0.
 * - httpOnly, SameSite=Lax, Path=/, Secure in production.
 * - Never logged, never echoed back, never in a URL, localStorage or an error message.
 *
 * Development only: Parker's own ESPN cookies can come from .env.local for his league (Phase 1).
 */
import { getIronSession, webCookies, type CookieJar, type IronSession, type SessionOptions } from "iron-session";
import { z } from "zod";
import { ESPN_S2_MAX_LENGTH } from "@/lib/espnCredentials";

export const SESSION_COOKIE_NAME = "offersheet_session";
/** Server-side lifetime of the sealed credentials: 12 hours, however long the browser session lasts. */
export const SESSION_SEAL_TTL_SECONDS = 12 * 60 * 60;
const MIN_SECRET_LENGTH = 32;

export interface EspnCredentials {
  espnS2: string;
  swid: string;
}

export interface SessionData {
  espn?: EspnCredentials;
}

export type EnvLike = Readonly<Record<string, string | undefined>>;

const espnCredentialsSchema = z.object({
  espnS2: z.string().min(1).max(ESPN_S2_MAX_LENGTH),
  swid: z.string().min(1).max(100),
});

/** SESSION_SECRET is missing or too short, so credentials can't be kept. */
export class SessionUnavailableError extends Error {
  constructor() {
    super("Session storage is not configured.");
    this.name = "SessionUnavailableError";
  }
}

export function sessionAvailable(env: EnvLike = process.env): boolean {
  return (env.SESSION_SECRET?.trim().length ?? 0) >= MIN_SECRET_LENGTH;
}

export function sessionOptions(env: EnvLike = process.env): SessionOptions {
  const password = env.SESSION_SECRET?.trim();
  if (!password || password.length < MIN_SECRET_LENGTH) throw new SessionUnavailableError();
  return {
    cookieName: SESSION_COOKIE_NAME,
    password,
    ttl: SESSION_SEAL_TTL_SECONDS,
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: env.NODE_ENV === "production", path: "/" },
  };
}

/**
 * Reads cookies from the request and appends Set-Cookie headers to `responseHeaders`, dropping any
 * Max-Age or Expires so the cookie lasts only for the browser session. A Max-Age of 0 (a deletion)
 * is kept, or "Forget my credentials" couldn't remove the cookie.
 */
export function sessionOnlyJar(request: Request, responseHeaders: Headers): CookieJar {
  const base = webCookies(request, responseHeaders);
  return {
    read: base.read,
    ...(base.names ? { names: base.names } : {}),
    write: (name, value, options) => {
      const { maxAge, expires, ...rest } = options;
      void expires;
      base.write(name, value, maxAge === 0 ? { ...rest, maxAge: 0 } : rest);
    },
  };
}

export async function openSession(request: Request, responseHeaders: Headers, env: EnvLike = process.env): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(sessionOnlyJar(request, responseHeaders), sessionOptions(env));
}

/** ESPN cookies saved in this browser session, if any (read-only: sets no cookie). */
export async function readEspnCredentials(request: Request, env: EnvLike = process.env): Promise<EspnCredentials | undefined> {
  if (!sessionAvailable(env)) return undefined;
  const session = await openSession(request, new Headers(), env);
  const parsed = espnCredentialsSchema.safeParse(session.espn);
  return parsed.success ? parsed.data : undefined;
}

export async function saveEspnCredentials(request: Request, responseHeaders: Headers, credentials: EspnCredentials, env: EnvLike = process.env): Promise<void> {
  const session = await openSession(request, responseHeaders, env);
  session.espn = { espnS2: credentials.espnS2, swid: credentials.swid };
  await session.save();
}

/** "Forget my credentials": drops the ESPN cookies, and the whole cookie once nothing else is in it. */
export async function forgetEspnCredentials(request: Request, responseHeaders: Headers, env: EnvLike = process.env): Promise<void> {
  if (!sessionAvailable(env)) {
    // No secret, so no readable session; still expire any cookie left over from before.
    responseHeaders.append("set-cookie", `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${env.NODE_ENV === "production" ? "; Secure" : ""}`);
    return;
  }
  const session = await openSession(request, responseHeaders, env);
  delete session.espn;
  if (Object.keys(session).length === 0) session.destroy();
  else await session.save();
}

/**
 * Development only: Parker's own cookies from .env.local, for his own league (CLAUDE.md Phase 1).
 * Never in production or tests, and never for any other league ID. `npm run dev` binds 127.0.0.1,
 * so other devices on the network can't reach it (a request URL or Host check couldn't tell them
 * apart). The import response says the cookies came from here (espnCookieSource "dev-env"), and
 * the Import Report says so instead of "this browser session".
 */
export function devFallbackEspnCredentials(leagueId: string, env: EnvLike = process.env): EspnCredentials | undefined {
  if (env.NODE_ENV !== "development") return undefined;
  const ownLeague = env.ESPN_LEAGUE_ID?.trim();
  const espnS2 = env.ESPN_S2?.trim();
  const swid = env.ESPN_SWID?.trim();
  if (!ownLeague || ownLeague !== leagueId.trim() || !espnS2 || !swid) return undefined;
  return { espnS2, swid };
}

export type CredentialSource = "session" | "dev-env" | "none";

/** The ESPN cookies to send for this league: the browser session's first, then the development fallback. */
export async function espnCredentialsFor(request: Request, leagueId: string, env: EnvLike = process.env): Promise<{ credentials?: EspnCredentials; source: CredentialSource }> {
  const fromSession = await readEspnCredentials(request, env);
  if (fromSession) return { credentials: fromSession, source: "session" };
  const fromEnv = devFallbackEspnCredentials(leagueId, env);
  if (fromEnv) return { credentials: fromEnv, source: "dev-env" };
  return { source: "none" };
}
