import { describe, expect, it } from "vitest";
import { MemoryCache, credentialScope } from "./cache";
import { createHttpClient, quoteBigInts } from "./http";

function fakeFetch(responses: Array<{ status: number; body: string; type?: string }>) {
  const calls: { url: string; cookie?: string }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), cookie: headers.Cookie });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return new Response(r.body, { status: r.status, headers: { "content-type": r.type ?? "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

describe("server HttpClient", () => {
  it("retries 5xx, then returns the success", async () => {
    const f = fakeFetch([{ status: 503, body: "" }, { status: 200, body: '{"a":1}' }]);
    const http = createHttpClient({ fetchImpl: f.impl, maxRetries: 2 });
    const res = await http.get("https://example.invalid/x");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ a: 1 });
    expect(f.calls).toHaveLength(2);
  }, 15_000);

  it("never retries 403 or HTML login pages", async () => {
    const f = fakeFetch([{ status: 403, body: "<html>login</html>", type: "text/html" }]);
    const http = createHttpClient({ fetchImpl: f.impl });
    const res = await http.get("https://example.invalid/private", { cookie: "espn_s2=x; SWID={y}" });
    expect(res.status).toBe(403);
    expect(res.isHtml).toBe(true);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.cookie).toBe("espn_s2=x; SWID={y}");
  });

  it("caches 200 JSON bodies and serves them without the network", async () => {
    const f = fakeFetch([{ status: 200, body: '{"n":7}' }]);
    const http = createHttpClient({ fetchImpl: f.impl, cache: new MemoryCache() });
    const key = `espn:${credentialScope("s2", "{swid}")}:league`;
    await http.get("https://example.invalid/c", { cache: { key, ttlMs: 60_000 } });
    const again = await http.get("https://example.invalid/c", { cache: { key, ttlMs: 60_000 } });
    expect(again.fromCache).toBe(true);
    expect(again.json).toEqual({ n: 7 });
    expect(f.calls).toHaveLength(1);
  });

  it("does not retry MFL hosts at all", async () => {
    const f = fakeFetch([{ status: 500, body: "" }, { status: 200, body: "{}" }]);
    const http = createHttpClient({ fetchImpl: f.impl, maxRetries: 3 });
    const res = await http.get("https://www66.myfantasyleague.com/2026/export?TYPE=league&JSON=1");
    expect(res.status).toBe(500);
    expect(f.calls).toHaveLength(1);
  });

  it("keeps 19-digit IDs exact when asked", async () => {
    const f = fakeFetch([{ status: 200, body: '[{"draft_id":1234567890123456789,"rate":0.030303030303030304}]' }]);
    const http = createHttpClient({ fetchImpl: f.impl });
    const res = await http.get("https://example.invalid/d", { bigIntsAsStrings: true });
    expect(res.json).toEqual([{ draft_id: "1234567890123456789", rate: 0.030303030303030304 }]);
    expect(quoteBigInts("[1.5e+25]")).toBe("[1.5e+25]");
  });
});
