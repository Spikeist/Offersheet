/**
 * Error codes the API returns and the plain-English messages the UI shows (pure, client-safe).
 * Import errors come from the adapters (LeagueImportError codes, src/adapters/types.ts); the rest are
 * the app's own. Anything forwarded from an adapter goes through redactSecrets() first.
 */
import type { ImportErrorCode } from "@/adapters/types";
import type { Platform } from "@/engine/model";
import { PLATFORM_LABEL } from "./labels";

export type AppErrorCode =
  | ImportErrorCode
  /** The request body failed validation. */
  | "INVALID_REQUEST"
  /** SESSION_SECRET is missing, so credentials can't be kept. */
  | "SESSION_UNAVAILABLE"
  /** A state-changing request came from another site. */
  | "BAD_ORIGIN"
  /** Too many requests from this address for now (src/server/rateLimit.ts; the reply carries Retry-After). */
  | "RATE_LIMITED"
  /**
   * Offer Sheet used today's budget of requests to the platform, or the client its share of it (src/server/budget.ts;
   * Retry-After: the next UTC midnight).
   */
  | "BUSY"
  /**
   * The request's deadline came first (src/server/deadline.ts), so we stopped waiting: a source answered too slowly (named
   * when known), or Offer Sheet's own queue or cache took the time ("Offer Sheet is busy right now").
   */
  | "SOURCE_SLOW"
  /** Anything unexpected. Never carries details. */
  | "INTERNAL";

export const IMPORT_ERROR_CODES: readonly ImportErrorCode[] = [
  "LEAGUE_NOT_FOUND",
  "PRIVATE_LEAGUE",
  "BAD_CREDENTIALS",
  "NOT_ACTIVATED",
  "UNSUPPORTED_LEAGUE",
  "USER_NOT_FOUND",
  "NO_LEAGUE",
  "SOURCE_DOWN",
  "BAD_RESPONSE",
];

export function isImportErrorCode(x: unknown): x is ImportErrorCode {
  return typeof x === "string" && (IMPORT_ERROR_CODES as readonly string[]).includes(x);
}

const STATUS: Record<AppErrorCode, number> = {
  LEAGUE_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  NO_LEAGUE: 404,
  PRIVATE_LEAGUE: 403,
  BAD_CREDENTIALS: 401,
  NOT_ACTIVATED: 409,
  UNSUPPORTED_LEAGUE: 422,
  SOURCE_DOWN: 502,
  BAD_RESPONSE: 502,
  INVALID_REQUEST: 400,
  SESSION_UNAVAILABLE: 503,
  BAD_ORIGIN: 403,
  RATE_LIMITED: 429,
  BUSY: 503,
  SOURCE_SLOW: 504,
  INTERNAL: 500,
};

export function errorStatus(code: AppErrorCode): number {
  return STATUS[code];
}

const SWID_BRACED = /\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}/g;
const GUID = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/g;
const COOKIE_PAIR = /\b(espn_s2|swid)\s*=\s*[^;\s,]+/gi;
/** Long opaque tokens (an espn_s2 value is hundreds of characters); JSON paths have dots and brackets. */
const LONG_TOKEN = /[A-Za-z0-9%+/=_-]{60,}/g;

/** Removes anything that looks like an ESPN cookie or a SWID from a message. */
export function redactSecrets(text: string): string {
  return text.replace(COOKIE_PAIR, "$1=[redacted]").replace(SWID_BRACED, "{SWID}").replace(GUID, "[id]").replace(LONG_TOKEN, "[redacted]");
}

export interface ErrorContext {
  platform?: Platform;
  /** The source's name when it isn't the platform's (SOURCE_SLOW, BUSY: "FantasyCalc"); it takes the platform's place. */
  source?: string;
  /** The adapter's own message (UNSUPPORTED_LEAGUE is written for users; BAD_RESPONSE names a JSON path). */
  adapterMessage?: string;
  season?: number;
  /** RATE_LIMITED, BUSY: the seconds the answer's Retry-After asks for, said in words ("in about 8 minutes"). */
  retryAfterS?: number;
  /** BUSY: the client's own share of the platform's day ran out (src/server/budget.ts), not Offer Sheet's whole day. */
  ownShare?: boolean;
  /**
   * SOURCE_SLOW: no source was slow; the time went to Offer Sheet's own waits (its queue to a source, its cache) or ran out
   * before the source was asked, so it says Offer Sheet is busy instead of naming a source.
   */
  busyHere?: boolean;
}

const MAX_DETAIL = 300;

/**
 * A wait in words, for the seconds a Retry-After asks: "in a minute or two" (up to 90 s), "in about 8 minutes" (rounded
 * up), "in about an hour", "in about 6 hours" (rounded up, five minutes' slack); undefined when there is none.
 */
export function waitWords(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  if (seconds <= 90) return "in a minute or two";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `in about ${minutes} minutes`;
  const hours = Math.max(1, Math.ceil((seconds - 300) / 3600));
  return hours === 1 ? "in about an hour" : `in about ${hours} hours`;
}

/** A Retry-After header's value in seconds (delta-seconds or an HTTP date, against `now`), or undefined. */
export function retryAfterSeconds(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds : undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) && at > now ? Math.ceil((at - now) / 1000) : undefined;
}

/** The plain message for an error code (CLAUDE.md §2.2 Errors: "League not found for that season."). */
export function errorMessage(code: AppErrorCode, ctx: ErrorContext = {}): string {
  const named = ctx.source ?? (ctx.platform ? PLATFORM_LABEL[ctx.platform] : undefined);
  const source = named ?? "The platform";
  const detail = ctx.adapterMessage ? redactSecrets(ctx.adapterMessage).trim().slice(0, MAX_DETAIL) : "";
  // ESPN answers the same way for a league that hasn't been renewed for the season (Phase 0).
  const notActivated = ctx.season ? ` (ESPN answers the same way if the league hasn't been renewed for ${ctx.season} yet.)` : "";
  switch (code) {
    case "LEAGUE_NOT_FOUND":
      return "League not found for that season.";
    case "PRIVATE_LEAGUE":
      return `This ESPN league is private, so ESPN only shares it with a login.${notActivated}`;
    case "BAD_CREDENTIALS":
      return `ESPN didn't accept your cookies. They may have expired or been copied incompletely, or this ESPN account isn't in the league: sign in to ESPN again, copy fresh espn_s2 and SWID values, and save them again.${notActivated}`;
    case "NOT_ACTIVATED":
      return "This league hasn't been activated for that season yet. The league manager renews it on ESPN each year.";
    case "UNSUPPORTED_LEAGUE":
      return detail || "Offer Sheet doesn't support this kind of league yet.";
    case "USER_NOT_FOUND":
      return "We couldn't find that Sleeper username. Check the spelling: it's your Sleeper username, not your display name or team name.";
    case "NO_LEAGUE":
      return ctx.season ? `We didn't find any ${source} leagues for that username in ${ctx.season}.` : `We didn't find any ${source} leagues for that username.`;
    case "SOURCE_DOWN":
      return `${source} isn't responding right now. Please try again in a few minutes.`;
    case "BAD_RESPONSE":
      return `${source} sent data in a shape we didn't expect, so we stopped instead of guessing.${detail ? ` (${detail})` : ""}`;
    case "INVALID_REQUEST":
      return detail || "Something in the form isn't right. Check it and try again.";
    case "SESSION_UNAVAILABLE":
      return "Saving ESPN cookies isn't available on this server right now.";
    case "BAD_ORIGIN":
      return "This request didn't come from Offer Sheet, so we ignored it.";
    case "RATE_LIMITED":
      return `You're going a bit fast. Try again ${waitWords(ctx.retryAfterS) ?? "in a minute or two"}.`;
    case "BUSY": {
      // Budgets start again at midnight UTC (the answer's Retry-After says how long that is).
      const when = waitWords(ctx.retryAfterS) ?? "after midnight UTC";
      const target = named ?? "this platform";
      return ctx.ownShare ? `Your connection has used today's share of requests to ${target}. Try again ${when}.` : `Offer Sheet has used today's share of requests to ${target}. Try again ${when}.`;
    }
    case "SOURCE_SLOW":
      if (ctx.busyHere) return "Offer Sheet is busy right now. Try again in a few minutes.";
      return `${named ?? "One of our data sources"} is answering slowly right now, so Offer Sheet stopped waiting. Try again in a few minutes.`;
    case "INTERNAL":
      return "Something went wrong on our side. Please try again.";
  }
}

/**
 * What to show for a reply that isn't one of ours (no JSON error body: a proxy's, the host's or the firewall's page), by
 * its HTTP status, so the user still reads what happened and what to do (client-side; src/lib/api.ts callApi). A Vercel
 * timeout (504) or a function that ran past its maxDuration, a firewall's 429 (with its Retry-After header, when it sends
 * one, said in words), a body over the host's size limit (413), the host unavailable (502, 503); anything else is the
 * generic INTERNAL.
 */
export function errorForStatus(status: number, retryAfter?: string | null): { code: AppErrorCode; message: string } {
  if (status === 429) {
    const retryAfterS = retryAfterSeconds(retryAfter);
    return { code: "RATE_LIMITED", message: errorMessage("RATE_LIMITED", retryAfterS !== undefined ? { retryAfterS } : {}) };
  }
  if (status === 504 || status === 408) return { code: "SOURCE_SLOW", message: "Offer Sheet took too long to answer. Try again in a few minutes." };
  if (status === 413) return { code: "INVALID_REQUEST", message: "That request is too large for Offer Sheet." };
  if (status === 502 || status === 503) return { code: "INTERNAL", message: "Offer Sheet isn't available right now. Try again in a few minutes." };
  return { code: "INTERNAL", message: errorMessage("INTERNAL") };
}
