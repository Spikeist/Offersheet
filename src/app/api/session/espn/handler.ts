/**
 * /api/session/espn: keeps a user's ESPN cookies for this browser session only (CLAUDE.md §3,
 * Phase 1). The values arrive in a POST body, are checked, and go straight into the sealed,
 * httpOnly, session-only cookie (src/server/session.ts). No response ever contains them.
 *
 *   GET     → { connected, available }   are cookies saved in this session? can the server keep them?
 *   POST    { espnS2, swid } → { connected: true, available: true } + Set-Cookie
 *   DELETE  → { connected: false, ... } + Set-Cookie that expires the cookie ("Forget my credentials")
 */
import type { EspnSessionStatus } from "@/lib/api";
import { checkEspnCredentials } from "@/lib/espnCredentials";
import { forgetEspnCredentials, readEspnCredentials, saveEspnCredentials, SessionTooLargeError, sessionAvailable, type EnvLike } from "@/server/session";
import { errorResponse, isSameOrigin, jsonResponse, logUnexpected, readJsonBody } from "../../_lib/respond";
import { ESPN_S2_TOO_LONG, espnSessionBodySchema } from "../../_lib/schemas";

export interface EspnSessionHandlers {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
  DELETE: (request: Request) => Promise<Response>;
}

export function createEspnSessionHandlers(opts: { env?: () => EnvLike } = {}): EspnSessionHandlers {
  const env = () => opts.env?.() ?? process.env;

  return {
    async GET(request) {
      const available = sessionAvailable(env());
      const connected = available ? Boolean(await readEspnCredentials(request, env())) : false;
      const status: EspnSessionStatus = { connected, available };
      return jsonResponse(status);
    },

    async POST(request) {
      if (!isSameOrigin(request)) return errorResponse("BAD_ORIGIN");
      if (!sessionAvailable(env())) return errorResponse("SESSION_UNAVAILABLE");
      const body = await readJsonBody(request, espnSessionBodySchema);
      if (!body.ok) return errorResponse("INVALID_REQUEST", body.message);
      const check = checkEspnCredentials(body.data);
      if (!check.ok) return errorResponse("INVALID_REQUEST", check.message);
      const headers = new Headers();
      try {
        await saveEspnCredentials(request, headers, check.value, env());
      } catch (err) {
        // Too long to keep (B4 security review): the user's input, answered like the checks above, and not logged.
        if (err instanceof SessionTooLargeError) return errorResponse("INVALID_REQUEST", ESPN_S2_TOO_LONG);
        logUnexpected("session_save", err, "espn");
        return errorResponse("INTERNAL");
      }
      const status: EspnSessionStatus = { connected: true, available: true };
      return jsonResponse(status, { headers });
    },

    async DELETE(request) {
      if (!isSameOrigin(request)) return errorResponse("BAD_ORIGIN");
      const headers = new Headers();
      try {
        await forgetEspnCredentials(request, headers, env());
      } catch (err) {
        logUnexpected("session_forget", err, "espn");
        return errorResponse("INTERNAL");
      }
      const status: EspnSessionStatus = { connected: false, available: sessionAvailable(env()) };
      return jsonResponse(status, { headers });
    },
  };
}
