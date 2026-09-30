/**
 * Turn an ESPN league-API response into a clear, specific outcome (CLAUDE.md §2.2 "Errors"): an
 * HTML page, 401 or 403 means bad/expired cookies, a wrong season, or a league not activated for
 * the season. We never retry these in a loop; the caller shows the message.
 */

export type EspnOutcomeCode =
  | "ok"
  | "html-login-page"
  | "not-authorized-no-cookies"
  | "not-authorized-with-cookies"
  | "forbidden"
  | "not-found"
  | "rate-limited"
  | "server-error"
  | "not-json"
  | "unexpected-status";

export interface EspnOutcome {
  ok: boolean;
  code: EspnOutcomeCode;
  /** Plain-English message for the user (no secrets). */
  message: string;
  /** ESPN's machine-readable error types from the JSON body (details[].type), if any. */
  detailTypes: string[];
  /** ESPN's short messages from the JSON body, if any. */
  detailMessages: string[];
}

export interface ResponseLike {
  status: number;
  isHtml: boolean;
  json: unknown;
}

function errorDetails(json: unknown): { types: string[]; messages: string[] } {
  const types: string[] = [];
  const messages: string[] = [];
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const o = json as { details?: unknown; messages?: unknown };
    if (Array.isArray(o.details))
      for (const d of o.details) {
        if (d && typeof d === "object") {
          const x = d as { type?: unknown; shortMessage?: unknown; message?: unknown };
          if (typeof x.type === "string") types.push(x.type);
          const m = typeof x.shortMessage === "string" ? x.shortMessage : typeof x.message === "string" ? x.message : undefined;
          if (m) messages.push(m);
        }
      }
    if (!messages.length && Array.isArray(o.messages)) for (const m of o.messages) if (typeof m === "string") messages.push(m);
  }
  return { types, messages };
}

export function classifyEspnResponse(res: ResponseLike, ctx: { withCookies: boolean; season: number }): EspnOutcome {
  const { types, messages } = errorDetails(res.json);
  const out = (ok: boolean, code: EspnOutcomeCode, message: string): EspnOutcome => ({ ok, code, message, detailTypes: types, detailMessages: messages });

  if (res.isHtml)
    return out(
      false,
      "html-login-page",
      ctx.withCookies
        ? `ESPN sent a web page instead of data. Your espn_s2/SWID cookies are probably expired or copied wrong; copy them again from a logged-in browser. Also check that the league exists in ${ctx.season}.`
        : `ESPN sent a web page instead of data. This league is probably private: add your espn_s2 and SWID cookies.`,
    );
  if (res.status === 401)
    return ctx.withCookies
      ? out(false, "not-authorized-with-cookies", `ESPN refused access (HTTP 401) even with cookies. The cookies may be expired or belong to an account that isn't in this league, or the league hasn't been activated for ${ctx.season}.`)
      : out(false, "not-authorized-no-cookies", `ESPN refused access (HTTP 401). This league is private: add your espn_s2 and SWID cookies.`);
  if (res.status === 403) return out(false, "forbidden", `ESPN refused access (HTTP 403). Check the cookies, the season (${ctx.season}) and that the league has been activated for this season.`);
  if (res.status === 404) return out(false, "not-found", `ESPN has no league with this ID for ${ctx.season} (HTTP 404). Check the league ID and season; a league that hasn't been renewed for ${ctx.season} also returns this.`);
  if (res.status === 429) return out(false, "rate-limited", "ESPN is rate-limiting requests (HTTP 429). Wait a few minutes and try again.");
  if (res.status >= 500) return out(false, "server-error", `ESPN had a server error (HTTP ${res.status}). Try again later.`);
  if (res.status !== 200) return out(false, "unexpected-status", `ESPN returned HTTP ${res.status}.`);
  if (res.json === undefined) return out(false, "not-json", "ESPN returned something that isn't JSON.");
  return out(true, "ok", "OK");
}
