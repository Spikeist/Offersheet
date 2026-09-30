import { describe, expect, it } from "vitest";
import {
  YAHOO_AUTHORIZE_URL,
  YAHOO_REDIRECT_URI,
  authorizeUrl,
  basicAuthHeader,
  codeGrantBody,
  extractAuthCode,
  extractGame,
  parseTokenResponse,
  refreshGrantBody,
  upsertEnvLine,
} from "./oauth";

describe("Yahoo OAuth helpers", () => {
  it("builds the authorize URL with the documented parameters only", () => {
    const u = new URL(authorizeUrl("client-abc", "state123"));
    expect(`${u.origin}${u.pathname}`).toBe(YAHOO_AUTHORIZE_URL);
    expect(u.searchParams.get("client_id")).toBe("client-abc");
    expect(u.searchParams.get("redirect_uri")).toBe(YAHOO_REDIRECT_URI);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("state")).toBe("state123");
    expect(u.searchParams.has("scope")).toBe(false);
    expect(YAHOO_REDIRECT_URI.startsWith("https://")).toBe(true);
  });

  it("encodes client credentials as HTTP Basic and grant bodies as form data", () => {
    expect(basicAuthHeader("id", "secret")).toBe(`Basic ${Buffer.from("id:secret").toString("base64")}`);
    const code = new URLSearchParams(codeGrantBody("c0de"));
    expect(Object.fromEntries(code)).toEqual({ grant_type: "authorization_code", code: "c0de", redirect_uri: YAHOO_REDIRECT_URI });
    const refresh = new URLSearchParams(refreshGrantBody("r3fresh"));
    expect(Object.fromEntries(refresh)).toEqual({ grant_type: "refresh_token", refresh_token: "r3fresh", redirect_uri: YAHOO_REDIRECT_URI });
  });

  it("accepts a bare code or a pasted callback URL", () => {
    expect(extractAuthCode("  abc123 ")).toBe("abc123");
    expect(extractAuthCode(`${YAHOO_REDIRECT_URI}?code=xyz789&state=s`)).toBe("xyz789");
    expect(extractAuthCode("code=q1&state=s")).toBe("q1");
    expect(extractAuthCode("")).toBeUndefined();
    expect(extractAuthCode(`${YAHOO_REDIRECT_URI}?error=access_denied`)).toBeUndefined();
  });

  it("parses token responses without exposing anything but Yahoo's error text", () => {
    expect(parseTokenResponse(200, { access_token: "A", refresh_token: "R", expires_in: "3600", token_type: "bearer", xoauth_yahoo_guid: "G" })).toEqual({
      ok: true,
      accessToken: "A",
      refreshToken: "R",
      expiresIn: 3600,
      userGuid: "G",
    });
    const missing = parseTokenResponse(200, { token_type: "bearer" });
    expect(missing.ok).toBe(false);
    expect(parseTokenResponse(400, { error: "invalid_grant", error_description: "expired" })).toEqual({ ok: false, error: "invalid_grant", description: "expired" });
    expect(parseTokenResponse(401, { error: { description: "Please provide valid credentials." } })).toEqual({ ok: false, error: "HTTP 401", description: "Please provide valid credentials." });
    expect(parseTokenResponse(500, undefined)).toEqual({ ok: false, error: "HTTP 500" });
  });

  it("reads the game key from game/nfl in both JSON layouts", () => {
    const arrayForm = { fantasy_content: { game: [{ game_key: "461", season: "2026", code: "nfl", name: "Football" }] } };
    expect(extractGame(arrayForm)).toEqual({ gameKey: "461", season: "2026", code: "nfl", name: "Football" });
    expect(extractGame({ fantasy_content: { game: { game_key: 461 } } })).toEqual({ gameKey: "461", season: undefined, code: undefined, name: undefined });
    expect(extractGame({ error: { description: "Please provide valid credentials." } })).toBeNull();
  });

  it("upserts .env lines, keeping line endings and other lines", () => {
    expect(upsertEnvLine("A=1\nB=2\n", "B", "x")).toBe("A=1\nB=x\n");
    expect(upsertEnvLine("A=1\r\nexport  YAHOO_REFRESH_TOKEN = old\r\n", "YAHOO_REFRESH_TOKEN", "n.e~w-1")).toBe("A=1\r\nYAHOO_REFRESH_TOKEN=n.e~w-1\r\n");
    expect(upsertEnvLine("A=1\n", "C", "3")).toBe("A=1\nC=3\n");
    expect(upsertEnvLine("A=1", "C", "3")).toBe("A=1\nC=3\n");
    expect(upsertEnvLine("", "C", "3")).toBe("C=3\n");
    expect(upsertEnvLine("CC=1\n", "C", "3")).toBe("CC=1\nC=3\n");
  });

  it("refuses values that .env parsing would change, without echoing them", () => {
    for (const bad of ["has space", "dollar$sign", 'quo"te', "hash#x", "new\nline"]) {
      let message = "";
      try {
        upsertEnvLine("", "TOKEN", bad);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).toMatch(/not written/);
      expect(message).not.toContain(bad);
    }
  });
});
