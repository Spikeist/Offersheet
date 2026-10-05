/**
 * The probes' FantasyCalc lists (scripts/lib/fantasycalc.ts; review of Checkpoint 7b's server work): read through the app's
 * own client and cache entry, so the 3-hour rule (FantasyCalc's conditions of 2026-10-05) holds across the probes and the
 * app. No network: a fake fetch and the app's MemoryCache.
 */
import { describe, expect, it } from "vitest";
import { fantasyCalcGate, fantasyCalcValuesUrl, loadFantasyCalcValues } from "@/data/fantasyCalcValues";
import { FANTASYCALC_RETAIN_MS, HOUR, MemoryCache, TTL } from "@/server/cache";
import { createHttpClient } from "@/server/http";
import { fantasyCalcUrl, getFantasyCalc, type FcFormat } from "./fantasycalc";
import { HttpError } from "./http";

const FORMAT: FcFormat = { isDynasty: false, numQbs: 1, numTeams: 10, ppr: 0.5 };
const APP_FORMAT = { isDynasty: false, numQbs: 1 as const, numTeams: 10, ppr: 0.5 as const, substitutions: [] };
const URL_ = fantasyCalcUrl(FORMAT);
const KEY = `fantasycalc:${URL_}`;

/** A /values/current body of `n` fictional players (made-up ids). */
function body(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({ player: { id: 70_000 + i, name: `Player ${i}`, position: "WR", sleeperId: String(80_000 + i), espnId: null }, value: 9_000 - i, redraftValue: 9_000 - i }));
}

function fantasyCalc(answer: () => Response) {
  const asked: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    asked.push(String(input));
    return answer();
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

describe("getFantasyCalc: the probes read FantasyCalc through the app's own cache entry", () => {
  it("asks for the same URL, under the same key, as the app's loader", () => {
    expect(URL_).toBe(fantasyCalcValuesUrl(APP_FORMAT));
    expect(fantasyCalcUrl({ ...FORMAT, extra: { tep: "te+" } })).toBe(fantasyCalcValuesUrl({ ...APP_FORMAT, tep: "te+" }));
  });

  it("a copy the app (or the stable copy) fetched within 3 hours: no request", async () => {
    const cache = new MemoryCache();
    const fetchedAt = Date.now() - 2 * HOUR;
    await cache.set(KEY, { status: 200, contentType: "application/json", text: JSON.stringify(body(160)), fetchedAt }, FANTASYCALC_RETAIN_MS, fetchedAt);
    const fc = fantasyCalc(() => json(body(160)));
    const { data, res } = await getFantasyCalc(FORMAT, { http: createHttpClient({ fetchImpl: fc.fetchImpl, cache, budget: null }) });
    expect(fc.asked).toEqual([]);
    expect(data).toHaveLength(160);
    expect(res).toMatchObject({ url: URL_, status: 200, fromCache: true, cachedAt: fetchedAt, attempts: 0 });
  });

  it("an older copy: one request to /values/current, kept where the app reads it (its TTL and retention), so the app's next build asks nothing", async () => {
    const cache = new MemoryCache();
    const old = Date.now() - 4 * HOUR;
    await cache.set(KEY, { status: 200, contentType: "application/json", text: JSON.stringify(body(155)), fetchedAt: old }, FANTASYCALC_RETAIN_MS, old);
    const fc = fantasyCalc(() => json(body(160)));
    const http = createHttpClient({ fetchImpl: fc.fetchImpl, cache, budget: null });
    const { data, res } = await getFantasyCalc(FORMAT, { http });
    expect(fc.asked).toEqual([URL_]);
    expect(data).toHaveLength(160);
    expect(res).toMatchObject({ fromCache: false, attempts: 1 });
    const stored = await cache.get<{ text: string }>(KEY, TTL.fantasyCalc);
    expect(JSON.parse(stored?.value.text ?? "[]")).toHaveLength(160);
    expect((stored?.expiresAt ?? 0) - (stored?.storedAt ?? 0)).toBe(FANTASYCALC_RETAIN_MS);
    const load = await loadFantasyCalcValues(http, APP_FORMAT, { gate: fantasyCalcGate(http, new Date()) });
    expect(load).toMatchObject({ fromCache: true, stale: false });
    expect(fc.asked).toEqual([URL_]);
  });

  it("a list the app's checks would turn down is the probe's to report, never cached; an error status throws as before", async () => {
    const cache = new MemoryCache();
    const short = fantasyCalc(() => json(body(40)));
    const { data } = await getFantasyCalc(FORMAT, { http: createHttpClient({ fetchImpl: short.fetchImpl, cache, budget: null }) });
    expect(data).toHaveLength(40);
    expect(await cache.get(KEY, TTL.fantasyCalc)).toBeUndefined();
    const missing = fantasyCalc(() => json({ error: "not found" }, 404));
    await expect(getFantasyCalc(FORMAT, { http: createHttpClient({ fetchImpl: missing.fetchImpl, cache: new MemoryCache(), budget: null }) })).rejects.toBeInstanceOf(HttpError);
  });
});
