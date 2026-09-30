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
  /** The adapter's own message (UNSUPPORTED_LEAGUE is written for users; BAD_RESPONSE names a JSON path). */
  adapterMessage?: string;
  season?: number;
}

const MAX_DETAIL = 300;

/** The plain message for an error code (CLAUDE.md §2.2 Errors: "League not found for that season."). */
export function errorMessage(code: AppErrorCode, ctx: ErrorContext = {}): string {
  const source = ctx.platform ? PLATFORM_LABEL[ctx.platform] : "The platform";
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
    case "INTERNAL":
      return "Something went wrong on our side. Please try again.";
  }
}
