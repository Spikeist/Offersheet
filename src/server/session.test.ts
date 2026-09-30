import { getIronSession, webCookies } from "iron-session";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  SESSION_COOKIE_NAME,
  SESSION_SEAL_TTL_SECONDS,
  SessionUnavailableError,
  devFallbackEspnCredentials,
  espnCredentialsFor,
  forgetEspnCredentials,
  readEspnCredentials,
  saveEspnCredentials,
  sessionOptions,
} from "./session";

// Fake values only.
const SECRET = "unit-test-secret-that-is-at-least-32-chars!!";
const ENV = { SESSION_SECRET: SECRET, NODE_ENV: "test" };
const CREDS = { espnS2: `AEBfakeTOKEN${"z".repeat(70)}%3D`, swid: "{00000000-0000-4000-8000-000000000000}" };
const URL_BASE = "http://localhost:3000/api/session/espn";

function request(cookie?: string): Request {
  return new Request(URL_BASE, { headers: cookie ? { cookie } : {} });
}

/** The name=value part of a Set-Cookie header, ready to send back as a Cookie header. */
function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0] ?? "";
}

async function savedCookie(env: Record<string, string> = ENV): Promise<string> {
  const headers = new Headers();
  await saveEspnCredentials(request(), headers, CREDS, env);
  const [setCookie] = headers.getSetCookie();
  if (!setCookie) throw new Error("no Set-Cookie");
  return setCookie;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("iron-session 9 behaviour (why src/server/session.ts strips Max-Age itself)", () => {
  it("sets Max-Age = ttl - 60 by default, which is not a session cookie", async () => {
    const headers = new Headers();
    const s = await getIronSession<{ x?: number }>(webCookies(request(), headers), { cookieName: "probe", password: SECRET, ttl: 3600 });
    s.x = 1;
    await s.save();
    expect(headers.getSetCookie()[0]).toMatch(/Max-Age=3540/);
  });

  it("its documented session-cookie switch (maxAge: undefined) makes a seal that never expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
    const headers = new Headers();
    const opts = { cookieName: "probe", password: SECRET, ttl: 3600, cookieOptions: { maxAge: undefined } };
    const s = await getIronSession<{ x?: number }>(webCookies(request(), headers), opts);
    s.x = 1;
    await s.save();
    const setCookie = headers.getSetCookie()[0] ?? "";
    expect(setCookie).not.toMatch(/Max-Age|Expires/i);
    vi.setSystemTime(new Date("2027-09-29T12:00:00Z")); // a year later
    const again = await getIronSession<{ x?: number }>(webCookies(request(cookiePair(setCookie)), new Headers()), opts);
    expect(again.x).toBe(1); // ttl was forced to 0: still accepted
  });
});

describe("the ESPN credentials cookie", () => {
  it("is encrypted, httpOnly, SameSite=Lax, Path=/, and session-only (no Max-Age, no Expires)", async () => {
    const setCookie = await savedCookie();
    expect(setCookie.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);
    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(setCookie).toMatch(/;\s*SameSite=Lax/i);
    expect(setCookie).toMatch(/;\s*Path=\//i);
    expect(setCookie).not.toMatch(/Max-Age/i);
    expect(setCookie).not.toMatch(/Expires/i);
    expect(setCookie).not.toMatch(/;\s*Secure/i); // plain http outside production
    // Sealed: neither value appears in the cookie in any form.
    for (const secret of [CREDS.espnS2, CREDS.swid, CREDS.swid.slice(1, -1), encodeURIComponent(CREDS.swid)]) expect(setCookie).not.toContain(secret);
  });

  it("is Secure in production", async () => {
    const setCookie = await savedCookie({ SESSION_SECRET: SECRET, NODE_ENV: "production" });
    expect(setCookie).toMatch(/;\s*Secure/i);
    expect(setCookie).not.toMatch(/Max-Age|Expires/i);
  });

  it("reads back only with the right secret and an untampered cookie", async () => {
    const pair = cookiePair(await savedCookie());
    expect(await readEspnCredentials(request(pair), ENV)).toEqual(CREDS);
    expect(await readEspnCredentials(request(), ENV)).toBeUndefined();
    expect(await readEspnCredentials(request(`${pair.slice(0, -4)}AAAA`), ENV)).toBeUndefined();
    expect(await readEspnCredentials(request(pair), { SESSION_SECRET: "another-secret-that-is-also-32-chars-long" })).toBeUndefined();
    expect(await readEspnCredentials(request(pair), {})).toBeUndefined();
  });

  it("stops being accepted after the seal TTL, even if the browser keeps the cookie", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
    const pair = cookiePair(await savedCookie());
    vi.setSystemTime(new Date(Date.parse("2026-09-29T12:00:00Z") + (SESSION_SEAL_TTL_SECONDS - 120) * 1000));
    expect(await readEspnCredentials(request(pair), ENV)).toEqual(CREDS);
    vi.setSystemTime(new Date(Date.parse("2026-09-29T12:00:00Z") + (SESSION_SEAL_TTL_SECONDS + 120) * 1000));
    expect(await readEspnCredentials(request(pair), ENV)).toBeUndefined();
  });

  it("is removed by 'Forget my credentials' with Max-Age=0", async () => {
    const pair = cookiePair(await savedCookie());
    const headers = new Headers();
    await forgetEspnCredentials(request(pair), headers, ENV);
    const [setCookie] = headers.getSetCookie();
    expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=;`));
    expect(setCookie).toMatch(/Max-Age=0/);
  });

  it("can still be expired when the server has no secret", async () => {
    const headers = new Headers();
    await forgetEspnCredentials(request(`${SESSION_COOKIE_NAME}=stale`), headers, { NODE_ENV: "production" });
    expect(headers.getSetCookie()[0]).toBe(`${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
  });

  it("needs a SESSION_SECRET of at least 32 characters", () => {
    expect(() => sessionOptions({})).toThrow(SessionUnavailableError);
    expect(() => sessionOptions({ SESSION_SECRET: "short" })).toThrow(SessionUnavailableError);
    expect(sessionOptions(ENV)).toMatchObject({ cookieName: SESSION_COOKIE_NAME, ttl: SESSION_SEAL_TTL_SECONDS, cookieOptions: { httpOnly: true, sameSite: "lax", secure: false, path: "/" } });
  });
});

describe("development fallback to .env.local", () => {
  const dev = { NODE_ENV: "development", ESPN_LEAGUE_ID: "4242", ESPN_S2: CREDS.espnS2, ESPN_SWID: CREDS.swid };

  it("applies only in development, only to the configured league, only with both values", () => {
    expect(devFallbackEspnCredentials("4242", dev)).toEqual(CREDS);
    expect(devFallbackEspnCredentials(" 4242 ", dev)).toEqual(CREDS);
    expect(devFallbackEspnCredentials("4243", dev)).toBeUndefined();
    expect(devFallbackEspnCredentials("4242", { ...dev, NODE_ENV: "production" })).toBeUndefined();
    expect(devFallbackEspnCredentials("4242", { ...dev, NODE_ENV: "test" })).toBeUndefined();
    expect(devFallbackEspnCredentials("4242", { ...dev, ESPN_SWID: "" })).toBeUndefined();
  });

  it("prefers the browser session's cookies over .env.local", async () => {
    const pair = cookiePair(await savedCookie());
    const env = { ...dev, SESSION_SECRET: SECRET };
    expect(await espnCredentialsFor(request(pair), "4242", env)).toEqual({ credentials: CREDS, source: "session" });
    expect(await espnCredentialsFor(request(), "4242", env)).toEqual({ credentials: CREDS, source: "dev-env" });
    expect(await espnCredentialsFor(request(), "9999", env)).toEqual({ source: "none" });
  });
});
