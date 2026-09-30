import { describe, expect, it } from "vitest";
import { z } from "zod";
import { HttpError, OfflineCacheMiss, type HttpResult, type RequestOptions } from "../http";
import type { ProbeContext } from "../probe";
import { FfClient, OFFLINE_MISS_ERROR } from "./client";
import type { FleaIdentities } from "./identities";

const result = (over: Partial<HttpResult> = {}): HttpResult => ({ url: "u", finalUrl: "u", status: 200, ok: true, contentType: "application/json", isHtml: false, text: "{}", json: {}, headers: {}, elapsedMs: 0, fromCache: true, cachedAt: Date.UTC(2026, 8, 29), attempts: 0, ...over });

/** A ProbeContext stub: getJson answers from `answer`, raw captures are recorded. */
function stub(answer: (opts: RequestOptions) => { data: unknown; res: HttpResult }) {
  const calls: RequestOptions[] = [];
  const raw: string[] = [];
  const p = {
    getJson: async (_url: string, opts: RequestOptions) => {
      calls.push(opts);
      return answer(opts);
    },
    leagueCache: (key: string) => ({ key: `fleaflicker:public:${key}`, ttlMs: 600_000, namespace: "league-fleaflicker" }),
    saveRaw: async (key: string) => {
      raw.push(key);
      return key;
    },
  } as unknown as ProbeContext;
  const ids = { sweep: () => undefined } as unknown as FleaIdentities;
  return { p, ids, calls, raw };
}

describe("FfClient offline", () => {
  it("serves only cached copies, counts misses and saves no new raw capture", async () => {
    let n = 0;
    const s = stub((opts) => {
      if (n++ === 0) return { data: { rules: 1 }, res: result() };
      throw new OfflineCacheMiss(opts.label ?? "x");
    });
    const c = new FfClient(s.p, s.ids, "123", "oracle", { offline: true });
    const hit = await c.get("FetchLeagueRules", {}, z.unknown());
    const miss = await c.get("FetchLeagueStandings", { season: 2026 }, z.unknown());
    expect(s.calls.every((o) => o.offline === true)).toBe(true);
    expect(hit.data).toEqual({ rules: 1 });
    expect(miss).toMatchObject({ data: null, res: null, error: OFFLINE_MISS_ERROR, offlineMiss: true });
    expect(miss.url).toContain("league_id={leagueId}");
    expect(c.misses).toBe(1);
    expect(c.oldestCachedAt).toBe(Date.UTC(2026, 8, 29));
    expect(s.raw).toEqual([]);
  });

  it("stays live (and captures raw responses) when not offline", async () => {
    const s = stub(() => ({ data: { ok: true }, res: result({ fromCache: false, cachedAt: undefined }) }));
    const c = new FfClient(s.p, s.ids, "123", "primary");
    await c.get("FetchLeagueRules", {}, z.unknown());
    expect(s.calls[0]?.offline).toBe(false);
    expect(s.raw).toHaveLength(1);
    expect([c.misses, c.oldestCachedAt]).toEqual([0, undefined]);
  });

  it("still reports HTTP errors as data null with the response", async () => {
    const s = stub(() => {
      throw new HttpError(result({ status: 404, ok: false, fromCache: false }), "HTTP 404");
    });
    const f = await new FfClient(s.p, s.ids, "123", "coverage", { offline: true }).get("FetchLeagueRules", {}, z.unknown());
    expect(f.offlineMiss).toBeUndefined();
    expect(f.res?.status).toBe(404);
  });
});
