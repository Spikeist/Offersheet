/**
 * probe:shared's FantasyCalc section (section-fc.ts; review of Checkpoint 7b's server work): FantasyCalc's conditions of
 * 2026-10-05 allow only /values/current, so the section asks for nothing else, and it asks through the app's own client and
 * cache entry (scripts/lib/fantasycalc.ts). Every request is stubbed: nothing goes out, nothing is written.
 */
import { describe, expect, it, vi } from "vitest";
import type { HttpRequestOptions, HttpResponse } from "@/adapters/types";

const asked: Array<{ url: string; opts?: HttpRequestOptions }> = [];

function rows(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({ player: { id: 70_000 + i, name: `Player ${i}`, position: i % 2 ? "WR" : "TE", sleeperId: String(80_000 + i), espnId: null, mflId: null, fleaflickerId: null, maybeTeam: "KC" }, value: 9_000 - i, redraftValue: 9_000 - i }));
}

// The app's client: every FantasyCalc list answered here (320 rows meet both floors), every call recorded.
vi.mock("@/server/http", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/http")>();
  return {
    ...real,
    createHttpClient: () => ({
      async get(url: string, opts?: HttpRequestOptions): Promise<HttpResponse> {
        asked.push({ url, ...(opts ? { opts } : {}) });
        const json = rows(320);
        return { status: 200, ok: true, isHtml: false, json, text: JSON.stringify(json), fromCache: false, fetchedAt: Date.now() };
      },
    }),
  };
});
// The app's file cache is never opened (the stub above doesn't use one).
vi.mock("@/server/cache", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/cache")>();
  return { ...real, FileCache: real.MemoryCache };
});
// The probes' own client (the site's docs pages): answered 404 here, recorded too.
vi.mock("../http", async (importOriginal) => {
  const real = await importOriginal<typeof import("../http")>();
  const notFound = (url: string) => ({ url, finalUrl: url, status: 404, ok: false, contentType: "", isHtml: false, text: "", json: undefined, headers: {}, elapsedMs: 0, fromCache: false, attempts: 1 });
  return {
    ...real,
    request: vi.fn(async (url: string) => {
      asked.push({ url });
      return notFound(url);
    }),
    getJson: vi.fn(async (url: string) => {
      asked.push({ url });
      throw new Error(`unexpected getJson ${url}`);
    }),
  };
});
// No lock files in the real .cache/ folder.
vi.mock("../cache", async (importOriginal) => {
  const real = await importOriginal<typeof import("../cache")>();
  return { ...real, withLock: async <T>(_ns: string, _key: string, fn: () => Promise<T>) => fn() };
});

describe("probe:shared's FantasyCalc section (part of probe:all)", () => {
  it("asks FantasyCalc's API for /values/current only, each list under the app's cache key and 3-hour TTL; never /players", async () => {
    const { FC_FORMATS, runFantasyCalc } = await import("./section-fc");
    const { fantasyCalcUrl } = await import("../fantasycalc");
    const { newState } = await import("./context");
    const { TTL } = await import("@/server/cache");
    const noop = () => undefined;
    const cl = new Proxy({}, { get: () => noop });
    const p = { cl, timed: (_label: string, fn: () => unknown) => fn(), safeUrl: (u: string) => u, saveRaw: async () => "", saveSanitized: async () => "" };
    const state = newState();
    await runFantasyCalc(p as never, state);
    expect(state.fc.every((r) => r.data !== null)).toBe(true);
    const api = asked.filter((a) => a.url.startsWith("https://api.fantasycalc.com/"));
    expect(api.map((a) => a.url)).toEqual(FC_FORMATS.map((f) => fantasyCalcUrl(f.format)));
    for (const a of api) expect(a.opts?.cache).toMatchObject({ key: `fantasycalc:${a.url}`, ttlMs: TTL.fantasyCalc });
    expect(asked.some((a) => a.url.includes("/players"))).toBe(false);
  });
});
