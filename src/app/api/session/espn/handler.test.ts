import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** A test hook (B4 security review): the save fails as iron-session does for a seal too big for one cookie. */
const saveHook = vi.hoisted(() => ({ tooLarge: false }));
vi.mock("@/server/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/session")>();
  return {
    ...actual,
    saveEspnCredentials: async (...args: Parameters<typeof actual.saveEspnCredentials>) => {
      if (saveHook.tooLarge) throw new actual.SessionTooLargeError();
      return actual.saveEspnCredentials(...args);
    },
  };
});

import { SESSION_COOKIE_NAME } from "@/server/session";
import { createEspnSessionHandlers } from "./handler";

afterEach(() => {
  saveHook.tooLarge = false;
});

// Fake values only.
const SECRET = "unit-test-secret-that-is-at-least-32-chars!!";
const S2 = `AEBfakeTOKEN${"k".repeat(70)}%2F`;
const SWID = "{00000000-0000-4000-8000-000000000000}";
const URL_BASE = "http://localhost:3000/api/session/espn";

const handlers = createEspnSessionHandlers({ env: () => ({ SESSION_SECRET: SECRET, NODE_ENV: "test" }) });
const noSecret = createEspnSessionHandlers({ env: () => ({ NODE_ENV: "test" }) });

function req(method: string, opts: { body?: unknown; cookie?: string; origin?: string; raw?: string } = {}): Request {
  const headers: Record<string, string> = { host: "localhost:3000" };
  if (opts.body !== undefined || opts.raw !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin) headers.origin = opts.origin;
  return new Request(URL_BASE, { method, headers, body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) });
}

describe("/api/session/espn", () => {
  it("saves the cookies in a session-only cookie and never echoes them", async () => {
    const res = await handlers.POST(req("POST", { body: { espnS2: ` ${S2} `, swid: SWID.slice(1, -1) }, origin: "http://localhost:3000" }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ connected: true, available: true });
    expect(text).not.toContain(S2);
    expect(text).not.toContain(SWID.slice(1, -1));

    const [setCookie, ...more] = res.headers.getSetCookie();
    expect(more).toHaveLength(0);
    expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=[^;]+;`));
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).not.toMatch(/Max-Age|Expires/i);
    expect(setCookie).not.toContain(S2);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reports the status, then forgets the cookies", async () => {
    const saved = await handlers.POST(req("POST", { body: { espnS2: S2, swid: SWID } }));
    const pair = (saved.headers.getSetCookie()[0] ?? "").split(";")[0] ?? "";

    const status = await handlers.GET(req("GET", { cookie: pair }));
    expect(await status.json()).toEqual({ connected: true, available: true });
    expect((await handlers.GET(req("GET"))).status).toBe(200);
    expect(await (await handlers.GET(req("GET"))).json()).toEqual({ connected: false, available: true });

    const forgot = await handlers.DELETE(req("DELETE", { cookie: pair }));
    expect(forgot.status).toBe(200);
    expect(await forgot.json()).toEqual({ connected: false, available: true });
    expect(forgot.headers.getSetCookie()[0]).toMatch(/Max-Age=0/);
  });

  it("rejects malformed cookies with a message that doesn't repeat them", async () => {
    const res = await handlers.POST(req("POST", { body: { espnS2: S2, swid: "{nope}" } }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.error.message).toMatch(/SWID/);
    expect(body.error.message).not.toContain(S2);
    expect(res.headers.getSetCookie()).toHaveLength(0);

    const missing = await handlers.POST(req("POST", { body: { swid: SWID } }));
    expect(missing.status).toBe(400);
    const notJson = await handlers.POST(req("POST", { raw: "espn_s2=abc" }));
    expect(notJson.status).toBe(400);
  });

  it("an espn_s2 too long for the session cookie is the user's mistake: 400 in words, nothing set, nothing logged (B4 security review)", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // Past the checks' cap (src/lib/espnCredentials.ts ESPN_S2_MAX_LENGTH): it used to pass them and fail the save (500, two log lines).
    for (const espnS2 of ["A".repeat(3_000), "A".repeat(2_050)]) {
      const res = await handlers.POST(req("POST", { body: { espnS2, swid: SWID } }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
      expect(res.headers.getSetCookie()).toHaveLength(0);
    }
    // And should a save still find it too big (the backstop), the same kind of answer, not INTERNAL.
    saveHook.tooLarge = true;
    const res = await handlers.POST(req("POST", { body: { espnS2: S2, swid: SWID } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "INVALID_REQUEST", message: "That espn_s2 value is too long." } });
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect(logged).not.toHaveBeenCalled();
  });

  it("refuses requests from another site", async () => {
    const res = await handlers.POST(req("POST", { body: { espnS2: S2, swid: SWID }, origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("BAD_ORIGIN");
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect((await handlers.DELETE(req("DELETE", { origin: "https://evil.example" }))).status).toBe(403);
  });

  it("refuses a cross-site post without an Origin header, and bodies not sent as JSON", async () => {
    // A browser marks a request another site sent, even when it leaves Origin out.
    const crossSite = new Request(URL_BASE, { method: "POST", headers: { host: "localhost:3000", "content-type": "text/plain", "sec-fetch-site": "cross-site" }, body: JSON.stringify({ espnS2: S2, swid: SWID }) });
    const refused = await handlers.POST(crossSite);
    expect(refused.status).toBe(403);
    expect(refused.headers.getSetCookie()).toHaveLength(0);
    // Same site, but a text/plain body (what a cross-site form or simple request can send): refused unread.
    const plain = new Request(URL_BASE, { method: "POST", headers: { host: "localhost:3000", "content-type": "text/plain" }, body: JSON.stringify({ espnS2: S2, swid: SWID }) });
    const notJson = await handlers.POST(plain);
    expect(notJson.status).toBe(400);
    expect(notJson.headers.getSetCookie()).toHaveLength(0);
    expect(await handlers.DELETE(new Request(URL_BASE, { method: "DELETE", headers: { host: "localhost:3000", "sec-fetch-site": "cross-site" } })).then((r) => r.status)).toBe(403);
  });

  it("says so when the server can't keep credentials", async () => {
    const res = await noSecret.POST(req("POST", { body: { espnS2: S2, swid: SWID } }));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SESSION_UNAVAILABLE");
    expect(await (await noSecret.GET(req("GET"))).json()).toEqual({ connected: false, available: false });
    const forgot = await noSecret.DELETE(req("DELETE"));
    expect(forgot.status).toBe(200);
    expect(forgot.headers.getSetCookie()[0]).toMatch(/Max-Age=0/);
  });
});
