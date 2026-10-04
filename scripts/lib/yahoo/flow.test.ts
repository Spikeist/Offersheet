import { beforeEach, describe, expect, it, vi } from "vitest";
import { Checklist } from "../checklist";
import type { HttpResult, RequestOptions } from "../http";
import { Redactor } from "../sanitize";
import { YAHOO_AUTH_GUIDE_URL, htmlToText, parseAuthGuide } from "./docs";
import { GAME_NFL_URL, errorText, findCheck, runYahoo, type YahooIo, type YahooProbe } from "./flow";
import { YAHOO_TOKEN_URL } from "./oauth";

// A trimmed copy of the guide's HTML (developer.yahoo.com/oauth2/guide/flows_authcode/, 2026-09-29).
const GUIDE_HTML = `<html><body>
<h2>Step 1: Sign in and get credentials</h2><p>To create an app project, Yahoo needs:</p>
<ul><li>name</li><li>scopes (permissions for specific services)</li></ul>
<h2>Step 2: Get an authorization URL and authorize access</h2>
<p>Table 1 Request Authorization URL (/request_auth) Call Request</p>
<table><tr><th>Request Parameters</th><th>Description</th></tr>
<tr><td>client_id</td><td>Consumer Key provided to you when you signed up.</td></tr>
<tr><td>redirect_uri</td><td>Yahoo redirects Users to this URL.</td></tr>
<tr><td>response_type</td><td>Must constraint the string code.</td></tr>
<tr><td>state</td><td>Optional. State information.</td></tr>
<tr><td>language</td><td>Optional. Language identifier.</td></tr></table>
<p>Sample URL</p>
<p>The authorization server will revoke the old
refresh token after issuing a new refresh token to the client.</p>
</body></html>`;

/** Same rule as scripts/lib/matrix.ts: an n/a summary with one of these words renders "⏸ untested". */
const UNTESTED = /awaiting|skipped|not tested|untested|no public league/i;

function http(status: number, json?: unknown, contentType = "application/json", text?: string): HttpResult {
  const body = text ?? (json === undefined ? "" : JSON.stringify(json));
  return { url: "u", finalUrl: "u", status, ok: status >= 200 && status < 300, contentType, isHtml: /html/.test(contentType), text: body, json, headers: {}, elapsedMs: 1, fromCache: false, attempts: 1 };
}

type Responder = (url: string, opts: RequestOptions) => HttpResult;

function harness(env: Record<string, string>, respond: Responder, ioOverrides: Partial<YahooIo> = {}) {
  const cl = new Checklist("yahoo-test");
  const calls: Array<{ url: string; opts: RequestOptions }> = [];
  const printed: string[] = [];
  const written: string[] = [];
  const p: YahooProbe = {
    cl,
    redactor: new Redactor("yahoo-test"),
    env: ((name: string) => env[name]) as YahooProbe["env"],
    request: (async (url: string, opts: RequestOptions = {}) => {
      calls.push({ url, opts });
      return respond(url, opts);
    }) as YahooProbe["request"],
    safeUrl: (u) => u,
    saveRaw: async () => "",
    saveSanitized: async () => "",
    timed: async (_label, fn) => fn(),
  };
  const io: YahooIo = {
    saveRefreshToken: async () => undefined,
    writeAuthorizeUrl: async (u) => {
      written.push(u);
    },
    print: (t) => printed.push(t),
    randomState: () => "state123",
    readSharedOutput: async () => ({ generatedAt: "2026-09-29T16:58:00Z", checks: [{ key: "XWALK.yahoo", status: "warn", summary: "either 177/250 (70.8%)" }] }),
    readEnvExample: async () => "YAHOO_CLIENT_ID=\nYAHOO_AUTH_CODE=\nYAHOO_REFRESH_TOKEN=\n",
    ...ioOverrides,
  };
  return { p, io, cl, calls, printed, written };
}

/** Default Yahoo endpoints: 401 without credentials, the guide page, and whatever the test adds. */
function yahoo(extra: Responder = () => http(599)): Responder {
  return (url, opts) => {
    if (url === YAHOO_AUTH_GUIDE_URL) return http(200, undefined, "text/html", GUIDE_HTML);
    if (url === GAME_NFL_URL && !opts.headers?.Authorization) return http(401, { error: { description: "Please provide valid credentials." } });
    return extra(url, opts);
  };
}

const items = (cl: Checklist) => cl.checks.filter((c) => /^[A-M]$/.test(c.item));

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("Yahoo docs parser", () => {
  it("reads the request_auth parameters, where scopes are chosen, and refresh rotation", () => {
    expect(parseAuthGuide(htmlToText(GUIDE_HTML))).toEqual({
      requestAuthParams: ["client_id", "redirect_uri", "response_type", "state", "language"],
      scopesChosenAtAppCreation: true,
      rotationRevokesOld: true,
    });
    expect(parseAuthGuide("a page without the table")).toBeNull();
  });

  it("finds another probe's check and shortens local paths but not URLs in errors", () => {
    expect(findCheck({ checks: [{ key: "XWALK.yahoo", status: "warn", summary: "s" }] }, "XWALK.yahoo")).toEqual({ status: "warn", summary: "s", generatedAt: undefined });
    expect(findCheck(undefined, "XWALK.yahoo")).toBeNull();
    expect(errorText(new Error("EPERM: operation not permitted, rename 'D:\\Some Dir\\x.tmp'"))).toBe("EPERM: operation not permitted, rename '<path>'");
    expect(errorText(new Error("failed: https://api.login.yahoo.com/oauth2/get_token"))).toBe("failed: https://api.login.yahoo.com/oauth2/get_token");
  });
});

describe("Yahoo probe flow", () => {
  it("without credentials: A–M untested (L not applicable), Phase 5 scope recorded, setup steps printed", async () => {
    const h = harness({}, yahoo());
    await runYahoo(h.p, h.io);
    const am = items(h.cl);
    expect(am.map((c) => c.item)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"]);
    for (const c of am) {
      expect(c.status).toBe("na");
      if (c.item === "L") expect(c.summary).not.toMatch(UNTESTED);
      else expect(c.summary).toMatch(UNTESTED);
    }
    expect(am.find((c) => c.item === "M")?.evidence[0]?.note).toMatch(/XWALK\.yahoo \(warn, run 2026-09-29\): either 177\/250.*name \+ position \+ NFL team/);
    expect(h.cl.checks.find((c) => c.key === "API.hostUnauthenticated")?.status).toBe("ok");
    expect(h.cl.checks.find((c) => c.key === "DOCS.oauthGuide")?.status).toBe("ok");
    expect(h.cl.decisions.some((d) => /Scope of this probe after approval.*does not check items A–M.*Phase 5 work/.test(d))).toBe(true);
    expect(h.cl.decisions.some((d) => /not in CLAUDE\.md §0\.5.*env\.ts.*: both; in \.env\.example: both/.test(d))).toBe(true);
    expect(h.cl.issues.some((i) => /^§2\.4 lists "Scope: fspt-r".*client_id, redirect_uri, response_type, state, language/.test(i))).toBe(true);
    expect(h.cl.issues.some((i) => /^Yahoo items A–M are unverified.*HTTP 401.*Phase 5/.test(i))).toBe(true);
    expect(h.printed.join("\n")).toMatch(/redirect URI https:\/\/localhost:3001\/api\/auth\/yahoo\/callback[\s\S]*Fantasy Sports → Read/);
    expect(h.cl.questions).toHaveLength(1);
    // Exactly the host check and the guide: no token calls without credentials.
    expect(h.calls.map((c) => c.url)).toEqual([GAME_NFL_URL, YAHOO_AUTH_GUIDE_URL]);
  });

  it("with credentials but no code: writes the authorize URL to the file only, never prints it", async () => {
    const h = harness({ YAHOO_CLIENT_ID: "zq-client-id-123", YAHOO_CLIENT_SECRET: "zq-client-secret-456" }, yahoo());
    await runYahoo(h.p, h.io);
    expect(h.written).toHaveLength(1);
    expect(h.written[0]).toMatch(/client_id=zq-client-id-123/);
    expect(h.printed.join("\n")).not.toContain("zq-client-id-123");
    expect(h.printed.join("\n")).toMatch(/0\. The app must have redirect URI .* Fantasy Sports: Read permission/);
    expect(h.cl.checks.find((c) => c.key === "AUTH.consent")?.status).toBe("warn");
    for (const c of items(h.cl).filter((x) => x.item !== "L")) expect(c.summary).toMatch(/^untested: awaiting Yahoo OAuth consent/);
  });

  it("a token that can't be saved is reported, and the run still uses the access token (F8)", async () => {
    const h = harness(
      { YAHOO_CLIENT_ID: "zq-client-id-123", YAHOO_CLIENT_SECRET: "zq-client-secret-456", YAHOO_AUTH_CODE: "zq-one-time-code" },
      yahoo((url, opts) => {
        if (url === YAHOO_TOKEN_URL) return http(200, { access_token: "zq-access-token-789", refresh_token: "zq-refresh#token$", expires_in: 3600 });
        if (url === GAME_NFL_URL && opts.headers?.Authorization === "Bearer zq-access-token-789") return http(200, { fantasy_content: { game: [{ game_key: "499", season: "2026", code: "nfl" }] } });
        return http(599);
      }),
      {
        saveRefreshToken: async () => {
          throw new Error("value for YAHOO_REFRESH_TOKEN has characters that .env parsing would change; not written");
        },
      },
    );
    await runYahoo(h.p, h.io);
    const exchange = h.cl.checks.find((c) => c.key === "AUTH.codeExchange");
    expect(exchange?.status).toBe("fail");
    expect(exchange?.summary).toMatch(/tokens received, but YAHOO_REFRESH_TOKEN was not saved \(value for YAHOO_REFRESH_TOKEN has characters/);
    expect(h.cl.checks.find((c) => c.key === "API.gameKey")).toMatchObject({ status: "ok" });
    expect(h.cl.checks.find((c) => c.key === "run.crash")).toBeUndefined();
    for (const c of items(h.cl).filter((x) => x.item !== "L")) expect(c.summary).toMatch(/^untested: Yahoo access is live, but the A–M league checks aren't written yet \(Phase 5 work/);
    // One token POST, never retried (the code is single-use).
    const posts = h.calls.filter((c) => c.url === YAHOO_TOKEN_URL);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.opts.retries).toBe(0);
    expect(JSON.stringify(h.cl.toJSON())).not.toMatch(/zq-refresh#token|zq-access-token-789|zq-one-time-code|zq-client-secret-456/);
  });

  it("refresh with a rotated token that can't be saved, then 403: both reported with next steps", async () => {
    const h = harness(
      { YAHOO_CLIENT_ID: "zq-client-id-123", YAHOO_CLIENT_SECRET: "zq-client-secret-456", YAHOO_REFRESH_TOKEN: "zq-old-refresh-token" },
      yahoo((url, opts) => {
        if (url === YAHOO_TOKEN_URL) return http(200, { access_token: "zq-access-token-000", refresh_token: "zq-new-refresh-token", expires_in: 3600 });
        if (url === GAME_NFL_URL && opts.headers?.Authorization) return http(403, undefined, "application/xml", "<error/>");
        return http(599);
      }),
      {
        saveRefreshToken: async () => {
          throw new Error("EBUSY: resource busy or locked, open 'D:\\Some Dir\\.env.local'");
        },
      },
    );
    await runYahoo(h.p, h.io);
    const rotation = h.cl.checks.find((c) => c.key === "AUTH.rotation");
    expect(rotation?.status).toBe("fail");
    expect(rotation?.summary).toMatch(/not saved \(EBUSY: resource busy or locked, open '<path>'\); Yahoo's guide says the old one is revoked/);
    const approval = h.cl.checks.find((c) => c.key === "API.approval");
    expect(approval?.status).toBe("warn");
    expect(approval?.summary).toMatch(/lacks the Fantasy Sports: Read permission or was created before access was enabled/);
    for (const c of items(h.cl).filter((x) => x.item !== "L")) expect(c.summary).toMatch(/^untested: awaiting Yahoo approval \(OAuth works/);
  });
});
