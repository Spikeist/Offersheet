/**
 * The browser's own HTTP client (track BF; ./browserHttp.ts): no credentials ever, polite pacing per host, retries with
 * backoff, Retry-After, timeouts, aborts, and answers read like the server client's. A scripted fetch, a fake clock. No
 * network.
 */
import { describe, expect, it } from "vitest";
import { browserFetchLimits } from "@/server/limits";
import { COOKIES_REFUSED, createBrowserHttpClient, type BrowserHttpLimits } from "./browserHttp";

const ESPN = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/4242?view=mSettings";
const SLEEPER = "https://api.sleeper.app/v1/state/nfl";

interface Call {
  url: string;
  init: RequestInit;
  at: number;
}

/** A fetch answering from a script (one answer per call, in order), recording each call and the fake time it began. */
function scripted(answers: Array<Response | Error | "hang">, clock: { now: number }) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init: RequestInit = {}) => {
    calls.push({ url, init, at: clock.now });
    const a = answers.shift() ?? new Response("{}", { status: 200 });
    if (a === "hang")
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function client(answers: Array<Response | Error | "hang">, opts: { signal?: AbortSignal; limits?: Partial<BrowserHttpLimits> } = {}) {
  const clock = { now: 1_000_000 };
  const sleeps: number[] = [];
  const { calls, fetchImpl } = scripted(answers, clock);
  const http = createBrowserHttpClient({
    fetchImpl,
    clock: () => clock.now,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.now += ms;
    },
    random: () => 0.5,
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.limits ? { limits: { ...browserFetchLimits, ...opts.limits } } : {}),
  });
  return { http, calls, sleeps, clock };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("createBrowserHttpClient", () => {
  it("sends no credentials, no Referer and keeps nothing; the league view goes without any header, a filter only when asked", async () => {
    const { http, calls } = client([json({ ok: 1 }), json({ ok: 2 })]);
    await http.get(ESPN);
    await http.get(ESPN, { headers: { "x-fantasy-filter": '{"players":{}}' } });
    for (const c of calls) expect(c.init).toMatchObject({ method: "GET", credentials: "omit", mode: "cors", cache: "no-store", referrerPolicy: "no-referrer" });
    expect(calls[0]?.init.headers).toBeUndefined();
    expect(calls[1]?.init.headers).toEqual({ "x-fantasy-filter": '{"players":{}}' });
    await expect(http.get(ESPN, { cookie: "espn_s2=x" })).rejects.toThrow(COOKIES_REFUSED);
    expect(calls).toHaveLength(2);
  });

  it("reads answers as the server's client does: transformText before parsing, 19-digit ids kept, HTML pages told apart, the time it came", async () => {
    const { http, clock } = client([new Response('{"id":1234567890123456789,"swid":"{A}"}', { status: 200 }), new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } })]);
    const res = await http.get(SLEEPER, { bigIntsAsStrings: true, transformText: (t) => t.replace("{A}", "{B}") });
    expect(res).toMatchObject({ status: 200, ok: true, isHtml: false, json: { id: "1234567890123456789", swid: "{B}" }, fromCache: false, fetchedAt: clock.now });
    expect(await http.get(SLEEPER)).toMatchObject({ status: 200, isHtml: true, json: undefined });
  });

  it("asks one host one request at a time, its gap apart (ESPN 250 ms, Sleeper 60 ms); two hosts don't wait for each other", async () => {
    const { http, calls, sleeps } = client([json(1), json(2), json(3)]);
    await Promise.all([http.get(ESPN), http.get(ESPN), http.get(SLEEPER)]);
    const espn = calls.filter((c) => c.url === ESPN);
    expect(espn).toHaveLength(2);
    expect((espn[1]?.at ?? 0) - (espn[0]?.at ?? 0)).toBe(browserFetchLimits.hostGapMs["lm-api-reads.fantasy.espn.com"]);
    expect(sleeps).toEqual([browserFetchLimits.hostGapMs["lm-api-reads.fantasy.espn.com"]]);
    expect(browserFetchLimits.hostGapMs["api.sleeper.app"]).toBe(60);
  });

  it("retries 429, 5xx and no answer with backoff and jitter, honours a short Retry-After, and gives up on a long one", async () => {
    const backoff = (n: number) => browserFetchLimits.backoffMs * 2 ** n + Math.floor(0.5 * browserFetchLimits.backoffJitterMs);
    const flaky = client([json({}, 503), new TypeError("Failed to fetch"), json({ ok: true })]);
    expect(await flaky.http.get(SLEEPER)).toMatchObject({ status: 200, json: { ok: true } });
    expect(flaky.calls).toHaveLength(3);
    expect(flaky.sleeps.filter((s) => s >= browserFetchLimits.backoffMs)).toEqual([backoff(0), backoff(1)]);
    const asked = client([json({}, 429, { "retry-after": "2" }), json({ ok: true })]);
    expect((await asked.http.get(SLEEPER)).status).toBe(200);
    expect(asked.sleeps).toContain(2_000);
    const tooLong = client([json({}, 429, { "retry-after": "60" })]);
    expect((await tooLong.http.get(SLEEPER)).status).toBe(429);
    expect(tooLong.calls).toHaveLength(1);
    // A CORS refusal looks like any network failure: no answer (status 0) once the retries are spent.
    const blocked = client([new TypeError("Failed to fetch"), new TypeError("Failed to fetch"), new TypeError("Failed to fetch")]);
    expect(await blocked.http.get(ESPN)).toMatchObject({ status: 0, ok: false, json: undefined });
    expect(blocked.calls).toHaveLength(1 + browserFetchLimits.retries);
    // 401, 403, 404 and HTML pages are answers: never retried.
    const priv = client([json({}, 401)]);
    expect((await priv.http.get(ESPN)).status).toBe(401);
    expect(priv.calls).toHaveLength(1);
  });

  it("times a request out as no answer; the page's signal stops the request under way and every later one", async () => {
    const slow = client(["hang"], { limits: { timeoutMs: 20, retries: 0 } });
    expect((await slow.http.get(SLEEPER)).status).toBe(0);
    const controller = new AbortController();
    const gone = client(["hang"], { signal: controller.signal });
    const pending = gone.http.get(SLEEPER);
    await new Promise((r) => setTimeout(r, 5));
    controller.abort(new DOMException("left", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(gone.http.get(SLEEPER)).rejects.toMatchObject({ name: "AbortError" });
    expect(gone.calls).toHaveLength(1);
  });

  it("never asks for a cache-only request", async () => {
    const { http, calls } = client([]);
    expect(await http.get(SLEEPER, { cacheOnly: true })).toMatchObject({ status: 0, ok: false });
    expect(calls).toHaveLength(0);
  });
});
