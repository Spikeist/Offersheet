import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpClient } from "@/adapters/types";
import type { FantasyCalcFormat } from "@/engine/inputs";
import type { PlayerInfo } from "@/engine/model";
import { config } from "@/engine/config";
import { DAY, FANTASYCALC_RETAIN_MS, HOUR, MemoryCache, STALE_PUBLIC_RETAIN_MS, TTL } from "@/server/cache";
import { createHttpClient } from "@/server/http";
import { fixtureLabels, readSanitizedFixture } from "@/test-utils/fixtures";
import {
  FANTASYCALC_DYNASTY_MIN_PLAYERS,
  FANTASYCALC_REDRAFT_MIN_PLAYERS,
  FANTASYCALC_OUTAGE_HOLD_MS,
  FANTASYCALC_OUTAGE_MAX_HOLD_MS,
  FANTASYCALC_VALUES_TIMEOUT_MS,
  fantasyCalcGate,
  fantasyCalcKnownIds,
  fantasyCalcListUse,
  fantasyCalcMatcher,
  fantasyCalcOutageHoldMs,
  fantasyCalcOutcome,
  fantasyCalcValuesFor,
  fantasyCalcValuesSchema,
  fantasyCalcValuesUrl,
  loadFantasyCalcValues,
  marketInputsFrom,
  reduceFantasyCalcValues,
  type FantasyCalcValueRow,
  type FantasyCalcValuesLoad,
} from "./fantasyCalcValues";
import { SLEEPER_OUTAGE_HOLD_MS, SLEEPER_OUTAGE_MAX_HOLD_MS } from "./sleeperProjections";
import { fakeHttp } from "./testSupport";

const fmt = (over: Partial<FantasyCalcFormat> = {}): FantasyCalcFormat => ({ isDynasty: false, numQbs: 1, numTeams: 12, ppr: 1, substitutions: [], ...over });
/** Parker's format: redraft, 1 QB, 10 teams, half PPR (no committed capture; the 10-team PPR one stands in below). */
const REDRAFT_10 = fmt({ numTeams: 10 });
const DYNASTY_12 = fmt({ isDynasty: true });

type ValueRow = { player: { id: number | string; name: string; position: string; sleeperId?: unknown; espnId?: unknown }; value: number; redraftValue?: number };
const capture = (url: string) => {
  const label = `fantasycalc/values?${url.split("?")[1] ?? ""}`;
  return readSanitizedFixture<ValueRow[]>("shared", label);
};

/** A /values/current body: the given rows plus fictional filler players (no ids, value 1) up to `players` player rows. */
function valuesWith(rows: ValueRow[], players: number): ValueRow[] {
  const have = rows.filter((r) => r.player.position !== "PICK").length;
  const filler = Array.from({ length: Math.max(0, players - have) }, (_, i) => ({ player: { id: 900_000 + i, name: `Filler ${i}`, position: "WR", sleeperId: null, espnId: null }, value: 1, redraftValue: 1 }));
  return [...rows, ...filler];
}

describe("fantasyCalcValuesUrl (CLAUDE.md §2.9)", () => {
  it("encodes every committed capture's format exactly as it was requested, TE premium as tep=te%2B / te%2B%2B", () => {
    const labels = fixtureLabels("fixtures/sanitized/shared").filter((l) => l.startsWith("fantasycalc/values?"));
    expect(labels.length).toBeGreaterThanOrEqual(11);
    for (const label of labels) {
      const q = new URLSearchParams(label.split("?")[1]);
      const f = fmt({ isDynasty: q.get("isDynasty") === "true", numQbs: Number(q.get("numQbs")) as 1 | 2, numTeams: Number(q.get("numTeams")), ppr: Number(q.get("ppr")) as 0 | 0.5 | 1, ...(q.get("tep") ? { tep: q.get("tep") as "te+" | "te++" } : {}) });
      expect(fantasyCalcValuesUrl(f)).toBe(`https://api.fantasycalc.com/values/current?${label.split("?")[1]}`);
    }
    expect(fantasyCalcValuesUrl(fmt({ tep: "te+" }))).toBe("https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1&tep=te%2B");
    expect(fantasyCalcValuesUrl(fmt({ tep: "te++", isDynasty: true, numQbs: 2 }))).toBe("https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1&tep=te%2B%2B");
    expect(fantasyCalcValuesUrl(fmt({ numTeams: 10, ppr: 0.5 }))).toBe("https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=10&ppr=0.5");
    // One cache key per format: the explanation of a substitution isn't part of the request.
    expect(fantasyCalcValuesUrl(fmt({ numTeams: 14, substitutions: ["16 teams → 14-team values"] }))).toBe(fantasyCalcValuesUrl(fmt({ numTeams: 14 })));
  });
});

describe("reduceFantasyCalcValues", () => {
  it("keeps draft picks apart from player values (dynasty only), by name", () => {
    const dynasty = reduceFantasyCalcValues(fantasyCalcValuesSchema.parse(capture(fantasyCalcValuesUrl(DYNASTY_12))));
    expect(dynasty.players).toHaveLength(49);
    expect(dynasty.picks).toHaveLength(24);
    for (const p of dynasty.picks) expect(p.name).toMatch(/^\d{4} \d+(st|nd|rd|th)( \((Early|Mid|Late)\))?$/);
    expect(dynasty.picks).toContainEqual({ name: "2027 1st (Early)", value: 0 /* [value] */ });
    expect(dynasty.players.every((p) => p.position !== "PICK" && p.sleeperId !== null && !/^FP_/.test(p.sleeperId))).toBe(true);
    const redraft = reduceFantasyCalcValues(fantasyCalcValuesSchema.parse(capture(fantasyCalcValuesUrl(REDRAFT_10))));
    expect(redraft.picks).toEqual([]);
    expect(redraft.players[0]).toEqual({
      fantasyCalcId: "9821",
      name: "Jahmyr Gibbs",
      position: "RB",
      sleeperId: "9221",
      espnId: "4429795",
      mflId: "16162",
      fleaflickerId: "17612",
      team: "DET",
      value: 10717,
      redraftValue: 10605, // the 12-team PPR baseline: not this format's value
      overallRank: 1, // kept for the local archive only
      positionRank: 1,
    });
  });
});

describe("loadFantasyCalcValues (FantasyCalc's conditions of 2026-10-05: at most every 3 hours per format)", () => {
  const url = fantasyCalcValuesUrl(REDRAFT_10);

  it("fetches with a 3-hour cache (FantasyCalc's conditions; 24 hours before), a saved copy kept 90 days (Phase 4c; other public sources 7) and one retry, and reports the top value", async () => {
    const { http, calls } = fakeHttp({ [url]: { json: valuesWith(capture(url), FANTASYCALC_REDRAFT_MIN_PLAYERS), fetchedAt: 42 } });
    const load = await loadFantasyCalcValues(http, REDRAFT_10);
    expect(calls).toHaveLength(1);
    // League-independent (public: the shared cache's lock); not reduced, so its key stays shared with the stable copy (one fetch every 3 hours per format).
    expect(calls[0]?.opts?.cache).toEqual({ key: `fantasycalc:${url}`, ttlMs: TTL.fantasyCalc, retainMs: FANTASYCALC_RETAIN_MS, staleIfError: true, public: true });
    expect(TTL.fantasyCalc).toBe(3 * HOUR);
    expect(calls[0]?.opts?.transformText).toBeUndefined();
    expect(FANTASYCALC_RETAIN_MS).toBe(config.market.fantasyCalcCurveDays * DAY);
    expect(FANTASYCALC_RETAIN_MS).toBeGreaterThan(STALE_PUBLIC_RETAIN_MS);
    expect(calls[0]?.opts).toMatchObject({ maxRetries: 1, timeoutMs: FANTASYCALC_VALUES_TIMEOUT_MS });
    expect(load).toMatchObject({ format: REDRAFT_10, topValue: 10717, fromCache: false, stale: false, fetchedAt: 42 });
    expect(load.players).toHaveLength(FANTASYCALC_REDRAFT_MIN_PLAYERS);
    expect(load.players.filter((p) => p.sleeperId)).toHaveLength(50); // the capture's rows; the filler has no ids
  });

  it("can skip the retry (a keeper league's second list right after FantasyCalc didn't answer), and a saved copy still stands in then", async () => {
    const { http, calls } = fakeHttp({ [url]: { json: valuesWith(capture(url), FANTASYCALC_REDRAFT_MIN_PLAYERS), stale: true, fetchedAt: 7 } });
    await expect(loadFantasyCalcValues(http, REDRAFT_10, { maxRetries: 0 })).resolves.toMatchObject({ stale: true, fetchedAt: 7 });
    expect(calls.map((c) => c.opts?.maxRetries)).toEqual([0]);
    expect(calls[0]?.opts?.cache).toMatchObject({ staleIfError: true });
    // Through the real client: FantasyCalc down (503), no saved copy: exactly one attempt, then the failure.
    let requests = 0;
    const fetchImpl = (async () => {
      requests++;
      return new Response("", { status: 503 });
    }) as unknown as typeof fetch;
    await expect(loadFantasyCalcValues(createHttpClient({ fetchImpl, cache: new MemoryCache() }), REDRAFT_10, { maxRetries: 0 })).rejects.toMatchObject({ code: "SOURCE_DOWN", message: "FantasyCalc redraft values: HTTP 503", detail: { status: 503 } });
    expect(requests).toBe(1);
  });

  it("rejects (and never caches) a list below its row floor: 150 redraft, 300 dynasty players (picks don't count)", async () => {
    const short = capture(url);
    const { http, calls } = fakeHttp({ [url]: { json: short } });
    await expect(loadFantasyCalcValues(http, REDRAFT_10)).rejects.toMatchObject({ code: "BAD_RESPONSE", message: "FantasyCalc redraft values: 50 rows, expected at least 150 player rows", detail: { path: "(root)" } });
    const cacheIf = calls[0]?.opts?.cacheIf;
    const res = (json: unknown) => ({ status: 200, ok: true, isHtml: false, json, text: JSON.stringify(json), fromCache: false });
    expect(cacheIf?.(res(short))).toBe(false);
    expect(cacheIf?.(res(valuesWith(short, 150)))).toBe(true);
    const dUrl = fantasyCalcValuesUrl(DYNASTY_12);
    const dynasty = capture(dUrl); // 49 players + 24 picks
    await expect(loadFantasyCalcValues(fakeHttp({ [dUrl]: { json: valuesWith(dynasty, 299) } }).http, DYNASTY_12)).rejects.toMatchObject({ code: "BAD_RESPONSE", message: "FantasyCalc dynasty values: 299 rows, expected at least 300 player rows" });
    const ok = await loadFantasyCalcValues(fakeHttp({ [dUrl]: { json: valuesWith(dynasty, 300) } }).http, DYNASTY_12);
    expect({ players: ok.players.length, picks: ok.picks.length }).toEqual({ players: 300, picks: 24 });
    expect([FANTASYCALC_REDRAFT_MIN_PLAYERS, FANTASYCALC_DYNASTY_MIN_PLAYERS]).toEqual([150, 300]);
  });

  it("throws on a missing field (naming its JSON path), an error status or a non-JSON body", async () => {
    const rows = valuesWith(capture(url), 150);
    const broken = structuredClone(rows) as Array<Partial<ValueRow>>;
    delete broken[1]?.value;
    await expect(loadFantasyCalcValues(fakeHttp({ [url]: { json: broken } }).http, REDRAFT_10)).rejects.toMatchObject({ code: "BAD_RESPONSE", detail: { path: "[1].value" } });
    await expect(loadFantasyCalcValues(fakeHttp({ [url]: { status: 503, json: {} } }).http, REDRAFT_10)).rejects.toMatchObject({ code: "SOURCE_DOWN", message: "FantasyCalc redraft values: HTTP 503" });
    await expect(loadFantasyCalcValues(fakeHttp({ [url]: { text: "<html>", isHtml: true } }).http, REDRAFT_10)).rejects.toMatchObject({ code: "SOURCE_DOWN" });
    await expect(loadFantasyCalcValues(fakeHttp({ [url]: { json: { players: [] } } }).http, REDRAFT_10)).rejects.toMatchObject({ code: "BAD_RESPONSE", detail: { path: "(root)" } });
    const thrower: HttpClient = { get: async () => Promise.reject(new Error(`timeout at ${url}`)) };
    const err = await loadFantasyCalcValues(thrower, REDRAFT_10).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "SOURCE_DOWN", message: "FantasyCalc redraft values: couldn't be reached" });
  });

  it("serves a saved copy (up to 7 days old) when FantasyCalc fails, and says so", async () => {
    const { http } = fakeHttp({ [url]: { json: valuesWith(capture(url), 150), stale: true, fetchedAt: 5 } });
    await expect(loadFantasyCalcValues(http, REDRAFT_10)).resolves.toMatchObject({ fromCache: true, stale: true, fetchedAt: 5 });
    // Through the real client: a copy stored 2 days ago (past the 3-hour TTL) stands in for a broken answer.
    const cache = new MemoryCache();
    const savedAt = Date.now() - 2 * DAY;
    await cache.set(`fantasycalc:${url}`, { status: 200, contentType: "application/json", text: JSON.stringify(valuesWith(capture(url), 150)), fetchedAt: savedAt }, STALE_PUBLIC_RETAIN_MS, savedAt);
    let requests = 0;
    const fetchImpl = (async () => {
      requests++;
      return new Response(JSON.stringify(capture(url)), { status: 200, headers: { "content-type": "application/json" } }); // 50 rows: below the floor
    }) as unknown as typeof fetch;
    const load = await loadFantasyCalcValues(createHttpClient({ fetchImpl, cache }), REDRAFT_10);
    expect(requests).toBe(1);
    expect(load).toMatchObject({ fromCache: true, stale: true, fetchedAt: savedAt });
    expect(load.players).toHaveLength(150);
  });

  describe("Phase 4c (planner reply to Checkpoint 4b, change 12): a saved copy through the Cache, by its age", () => {
    /** A list as the real client stores it, FantasyCalc having served it `daysAgo` days ago (kept FANTASYCALC_RETAIN_MS). */
    async function savedCopy(cache: MemoryCache, daysAgo: number): Promise<number> {
      const savedAt = Date.now() - daysAgo * DAY;
      await cache.set(`fantasycalc:${url}`, { status: 200, contentType: "application/json", text: JSON.stringify(valuesWith(capture(url), 150)), fetchedAt: savedAt }, FANTASYCALC_RETAIN_MS, savedAt);
      return savedAt;
    }
    /** FantasyCalc answering unusably (50 rows): no retry, no backoff; the client falls back to what the cache holds. */
    function brokenFantasyCalc(): { fetchImpl: typeof fetch; requests: () => number } {
      let n = 0;
      const fetchImpl = (async () => {
        n++;
        return new Response(JSON.stringify(capture(url)), { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch;
      return { fetchImpl, requests: () => n };
    }

    it("a fresh answer is kept 90 days, but served fresh only for 3 hours: at most one request every 3 hours per format, and only when a build asks", async () => {
      const cache = new MemoryCache();
      let requests = 0;
      const fetchImpl = (async () => {
        requests++;
        return new Response(JSON.stringify(valuesWith(capture(url), 150)), { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch;
      const http = createHttpClient({ fetchImpl, cache });
      const first = await loadFantasyCalcValues(http, REDRAFT_10);
      const again = await loadFantasyCalcValues(http, REDRAFT_10);
      expect(requests).toBe(1);
      expect([first.stale, again.stale, again.fromCache]).toEqual([false, false, true]);
      expect(fantasyCalcListUse(again, new Date())).toBe("fresh");
      // Fresh (no new request) for 3 hours, then a build's next read asks FantasyCalc again.
      const key = `fantasycalc:${url}`;
      expect(await cache.get(key, TTL.fantasyCalc, Date.now() + 3 * HOUR - 60_000)).toBeDefined();
      expect(await cache.get(key, TTL.fantasyCalc, Date.now() + 3 * HOUR + 60_000)).toBeUndefined();
      // Stored with the long retention: still there 89 days on (as a saved copy), gone after 90.
      expect(await cache.get(key, Number.POSITIVE_INFINITY, Date.now() + 89 * DAY)).toBeDefined();
      expect(await cache.get(key, Number.POSITIVE_INFINITY, Date.now() + 90 * DAY + 60_000)).toBeUndefined();
    });

    it("FantasyCalc down with a 3-day-old copy: it stands in, stale, as a saved list", async () => {
      const cache = new MemoryCache();
      const savedAt = await savedCopy(cache, 3);
      const broken = brokenFantasyCalc();
      const load = await loadFantasyCalcValues(createHttpClient({ fetchImpl: broken.fetchImpl, cache }), REDRAFT_10);
      expect(broken.requests()).toBe(1);
      expect(load).toMatchObject({ fromCache: true, stale: true, fetchedAt: savedAt });
      expect(fantasyCalcListUse(load, new Date())).toBe("saved");
    });

    it("a 20-day-old copy is still served (the 7-day retention dropped it), and only for the curve", async () => {
      const cache = new MemoryCache();
      const savedAt = await savedCopy(cache, 20);
      const broken = brokenFantasyCalc();
      const load = await loadFantasyCalcValues(createHttpClient({ fetchImpl: broken.fetchImpl, cache }), REDRAFT_10);
      expect(load).toMatchObject({ stale: true, fetchedAt: savedAt });
      expect(load.players).toHaveLength(150);
      expect(fantasyCalcListUse(load, new Date())).toBe("curve");
    });

    it("no copy (or one past 90 days, deleted): FantasyCalc's failure, as before", async () => {
      const cache = new MemoryCache();
      const old = Date.now() - 100 * DAY;
      await cache.set(`fantasycalc:${url}`, { status: 200, contentType: "application/json", text: JSON.stringify(valuesWith(capture(url), 150)), fetchedAt: old }, FANTASYCALC_RETAIN_MS, old);
      const broken = brokenFantasyCalc();
      await expect(loadFantasyCalcValues(createHttpClient({ fetchImpl: broken.fetchImpl, cache }), REDRAFT_10)).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    });
  });

  it("fantasyCalcListUse: fresh when FantasyCalc answered; a saved copy by its age: 7 days saved, 90 days curve, then expired", () => {
    const now = new Date("2026-10-04T12:00:00.000Z");
    const at = (days: number) => ({ stale: true, fetchedAt: now.getTime() - days * DAY });
    expect(fantasyCalcListUse({ stale: false, fetchedAt: now.getTime() - 400 * DAY }, now)).toBe("fresh");
    expect(fantasyCalcListUse(at(0.5), now)).toBe("saved");
    expect(fantasyCalcListUse(at(7), now)).toBe("saved");
    expect(fantasyCalcListUse(at(7.01), now)).toBe("curve");
    expect(fantasyCalcListUse(at(90), now)).toBe("curve");
    expect(fantasyCalcListUse(at(90.01), now)).toBe("expired");
    // A saved copy of unknown age reads as saved, as before Phase 4c.
    expect(fantasyCalcListUse({ stale: true }, now)).toBe("saved");
    expect(fantasyCalcListUse({ stale: true, fetchedAt: Number.NaN }, now)).toBe("saved");
    // The days come from config.market (calibration and tests can pass others).
    expect([config.market.fantasyCalcStaleDays, config.market.fantasyCalcCurveDays]).toEqual([7, 90]);
    expect(fantasyCalcListUse(at(5), now, { fantasyCalcStaleDays: 3, fantasyCalcCurveDays: 4 })).toBe("expired");
  });

  it("asks again, once, when a fresh cached copy fails the check, and replaces it", async () => {
    const cache = new MemoryCache();
    await cache.set(`fantasycalc:${url}`, { status: 200, contentType: "application/json", text: "[]" }, TTL.fantasyCalc);
    let requests = 0;
    const fetchImpl = (async () => {
      requests++;
      return new Response(JSON.stringify(valuesWith(capture(url), 150)), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const load = await loadFantasyCalcValues(createHttpClient({ fetchImpl, cache }), REDRAFT_10);
    expect(requests).toBe(1);
    expect(load).toMatchObject({ fromCache: false, stale: false });
    const stored = await cache.get<{ text: string }>(`fantasycalc:${url}`, TTL.fantasyCalc);
    expect(JSON.parse(stored?.value.text ?? "[]")).toHaveLength(150);
  });
});

describe("the outage memory (Phase 4c's polish; CLAUDE.md §0.9: the Sleeper gate's rule for FantasyCalc's value lists)", () => {
  const url = fantasyCalcValuesUrl(REDRAFT_10);
  const key = `fantasycalc:${url}`;
  const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
  const MIN = 60_000;

  /** Runs the fake clock until the promise settles (the client's backoff and pacing sleeps). */
  async function settle<T>(p: Promise<T>): Promise<T> {
    let done = false;
    void p.then(
      () => (done = true),
      () => (done = true),
    );
    for (let i = 0; i < 1_000 && !done; i++) await vi.advanceTimersByTimeAsync(100);
    return p;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds 5 minutes, then 10, then at most 15 while the outage lasts: the Sleeper gate's numbers", () => {
    expect([0, 1, 2, 3, 4, 9].map(fantasyCalcOutageHoldMs)).toEqual([0, 5 * MIN, 10 * MIN, 15 * MIN, 15 * MIN, 15 * MIN]);
    expect([FANTASYCALC_OUTAGE_HOLD_MS, FANTASYCALC_OUTAGE_MAX_HOLD_MS]).toEqual([SLEEPER_OUTAGE_HOLD_MS, SLEEPER_OUTAGE_MAX_HOLD_MS]);
  });

  it("reads what a response says about FantasyCalc: no response, 429, 5xx or a web page is no answer (a saved copy standing in for one too); a 404 or a body that fails the checks is an answer; a cache hit says nothing", () => {
    const live = (status: number, isHtml = false) => ({ status, isHtml, fromCache: false });
    expect(fantasyCalcOutcome(live(200))).toEqual({ answered: true });
    expect(fantasyCalcOutcome(live(404))).toEqual({ answered: true });
    expect(fantasyCalcOutcome(live(503))).toEqual({ answered: false, reason: "HTTP 503" });
    expect(fantasyCalcOutcome(live(429))).toEqual({ answered: false, reason: "HTTP 429" });
    expect(fantasyCalcOutcome(live(0))).toEqual({ answered: false, reason: "no response" });
    expect(fantasyCalcOutcome(live(200, true))).toEqual({ answered: false, reason: "a web page instead of data" });
    const saved = (liveFailure?: { status: number; isHtml: boolean }) => ({ status: 200, isHtml: false, fromCache: true, stale: true, ...(liveFailure ? { liveFailure } : {}) });
    expect(fantasyCalcOutcome(saved({ status: 503, isHtml: false }))).toEqual({ answered: false, reason: "HTTP 503" });
    expect(fantasyCalcOutcome(saved({ status: 0, isHtml: false }))).toEqual({ answered: false, reason: "no response" });
    expect(fantasyCalcOutcome(saved({ status: 200, isHtml: true }))).toEqual({ answered: false, reason: "a web page instead of data" });
    // Checkpoint 7a (review RL-2): a request its own deadline cut says nothing about FantasyCalc, a saved copy standing in
    // for one neither; nor does one the day's FantasyCalc budget held back (review of Checkpoint 7b's server work: read as
    // an outage, a budget anyone could spend held every format off).
    expect(fantasyCalcOutcome({ ...live(0), cut: "deadline" })).toBeNull();
    expect(fantasyCalcOutcome({ ...saved({ status: 0, isHtml: false }), cut: "deadline" })).toBeNull();
    expect(fantasyCalcOutcome({ ...live(0), cut: "budget" })).toBeNull();
    expect(fantasyCalcOutcome({ ...saved({ status: 0, isHtml: false }), cut: "budget" })).toBeNull();
    // A 200 body the checks turned down (too few rows): FantasyCalc answered, so no hold.
    expect(fantasyCalcOutcome(saved({ status: 200, isHtml: false }))).toEqual({ answered: true });
    // A client that doesn't say why its copy stood in: counted as no answer.
    expect(fantasyCalcOutcome(saved())).toEqual({ answered: false, reason: "no usable answer" });
    // A copy within the TTL: no request went out.
    expect(fantasyCalcOutcome({ status: 200, isHtml: false, fromCache: true })).toBeNull();
  });

  it("remembers an outage per client from each build's own time: one outage, one doubling (a build alongside doesn't double it), and an answer ends it", () => {
    const http: HttpClient = { get: async () => Promise.reject(new Error("unused")) };
    const at = (ms: number) => fantasyCalcGate(http, new Date(T0 + ms));
    at(0).saw({ answered: false, reason: "HTTP 503" });
    expect(at(1).down()).toBe("HTTP 503");
    // A build running alongside (an older moment) finds it down too and starts no second hold.
    at(-MIN).saw({ answered: false, reason: "no response" });
    expect(at(5 * MIN - 1).down()).toBe("HTTP 503");
    expect(at(5 * MIN).down()).toBeUndefined();
    // Still down when asked again: 10 minutes, then 15, then 15.
    at(5 * MIN).saw({ answered: false, reason: "HTTP 502" });
    expect([at(15 * MIN - 1).down(), at(15 * MIN).down()]).toEqual(["HTTP 502", undefined]);
    at(15 * MIN).saw({ answered: false, reason: "HTTP 502" });
    expect([at(30 * MIN - 1).down(), at(30 * MIN).down()]).toEqual(["HTTP 502", undefined]);
    at(30 * MIN).saw({ answered: false, reason: "HTTP 502" });
    expect([at(45 * MIN - 1).down(), at(45 * MIN).down()]).toEqual(["HTTP 502", undefined]);
    // FantasyCalc answers: the outage is over, and the next one starts at 5 minutes again.
    at(45 * MIN).saw({ answered: true });
    expect(at(45 * MIN + 1).down()).toBeUndefined();
    at(50 * MIN).saw({ answered: false, reason: "HTTP 503" });
    expect([at(55 * MIN - 1).down(), at(55 * MIN).down()]).toEqual(["HTTP 503", undefined]);
    // Another client remembers nothing.
    expect(fantasyCalcGate({ get: http.get }, new Date(T0 + 50 * MIN + 1)).down()).toBeUndefined();
  });

  it("through the real client and cache: the build that finds FantasyCalc down asks twice (its retry), the builds in the hold ask nothing and read the saved copy, a later one probes again (a longer hold), and an answer ends it", async () => {
    vi.useFakeTimers({ now: T0 });
    const cache = new MemoryCache();
    const savedAt = T0 - 3 * DAY;
    await cache.set(key, { status: 200, contentType: "application/json", text: JSON.stringify(valuesWith(capture(url), 150)), fetchedAt: savedAt }, FANTASYCALC_RETAIN_MS, savedAt);
    let down = true;
    const requests: number[] = [];
    const fetchImpl = (async () => {
      requests.push(Date.now());
      return down ? new Response("", { status: 503 }) : new Response(JSON.stringify(valuesWith(capture(url), 150)), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const http = createHttpClient({ fetchImpl, cache });
    const build = async (minutes: number) => {
      vi.setSystemTime(T0 + minutes * MIN);
      const before = requests.length;
      const load = await settle(loadFantasyCalcValues(http, REDRAFT_10, { gate: fantasyCalcGate(http, new Date(Date.now())) }));
      return { load, asked: requests.length - before };
    };
    // T0: down (503, then its retry): the 3-day-old copy stands in, as before; the outage starts (5 minutes).
    const first = await build(0);
    expect(first.asked).toBe(2);
    expect(first.load).toMatchObject({ stale: true, fetchedAt: savedAt });
    expect(fantasyCalcListUse(first.load, new Date(T0))).toBe("saved");
    // A minute later: nothing asked, the same copy (still a saved one standing in), the same use.
    const held = await build(1);
    expect(held.asked).toBe(0);
    expect(held.load).toMatchObject({ fromCache: true, stale: true, fetchedAt: savedAt });
    expect(held.load.players).toEqual(first.load.players);
    expect(fantasyCalcListUse(held.load, new Date(T0 + MIN))).toBe("saved");
    // Past the hold: asked again (twice), still down, so the next hold is 10 minutes.
    expect((await build(6)).asked).toBe(2);
    expect((await build(15)).asked).toBe(0);
    // Back after the 10 minutes: one request, FantasyCalc's own answer, and the outage is over.
    down = false;
    const back = await build(17);
    expect(back.asked).toBe(1);
    expect(back.load).toMatchObject({ fromCache: false, stale: false });
    // Then the 3-hour TTL as always: a cache hit, nothing asked.
    expect((await build(18)).asked).toBe(0);
    expect(fantasyCalcGate(http, new Date(T0 + 18 * MIN)).down()).toBeUndefined();
  });

  it("while held, a format with no copy in the cache isn't asked: the load fails as not asked (status 0, so later lists count it as no answer); a 200 body that fails the checks starts no hold", async () => {
    vi.useFakeTimers({ now: T0 });
    let requests = 0;
    let answer: "down" | "short" = "down";
    const fetchImpl = (async () => {
      requests++;
      return answer === "down" ? new Response("", { status: 503 }) : new Response(JSON.stringify(capture(url)), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const http = createHttpClient({ fetchImpl, cache: new MemoryCache() });
    const gate = fantasyCalcGate(http, new Date(T0));
    // No copy: FantasyCalc's failure, as before, and the outage starts.
    await expect(settle(loadFantasyCalcValues(http, REDRAFT_10, { gate }))).rejects.toMatchObject({ code: "SOURCE_DOWN", message: "FantasyCalc redraft values: HTTP 503" });
    expect(requests).toBe(2);
    // Another format in the same build (a keeper league's second list): not asked.
    await expect(settle(loadFantasyCalcValues(http, DYNASTY_12, { gate }))).rejects.toMatchObject({
      code: "SOURCE_DOWN",
      message: "FantasyCalc dynasty values: not asked while FantasyCalc isn't answering (HTTP 503)",
      detail: { status: 0 },
    });
    expect(requests).toBe(2);
    // A FantasyCalc that answers with a list too short to use (another client, no hold yet): an answer, so no hold.
    answer = "short";
    const other = createHttpClient({ fetchImpl, cache: new MemoryCache() });
    await expect(settle(loadFantasyCalcValues(other, REDRAFT_10, { gate: fantasyCalcGate(other, new Date(T0)) }))).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    expect(fantasyCalcGate(other, new Date(T0 + MIN)).down()).toBeUndefined();
  });
});

describe("answers the checks turn down, and requests Offer Sheet held back (review of Checkpoint 7b's server work: the 3-hour rule held only for good answers)", () => {
  const url = fantasyCalcValuesUrl(REDRAFT_10);
  const key = `fantasycalc:${url}`;
  const T0 = Date.UTC(2026, 9, 5, 12, 0, 0);
  const MIN = 60_000;
  const json = { "content-type": "application/json" };

  async function settle<T>(p: Promise<T>): Promise<T> {
    let done = false;
    void p.then(
      () => (done = true),
      () => (done = true),
    );
    for (let i = 0; i < 1_000 && !done; i++) await vi.advanceTimersByTimeAsync(100);
    return p;
  }

  /** A FantasyCalc that answers every request with `answer()` (a body below the row floor, a 404, a good list …), counting requests by URL. */
  function fantasyCalc(answer: (url: string) => Response) {
    const requests: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      requests.push(String(input));
      return answer(String(input));
    }) as unknown as typeof fetch;
    return { fetchImpl, requests };
  }
  const short = () => new Response(JSON.stringify(capture(url).slice(0, 40)), { status: 200, headers: json });
  const good = () => new Response(JSON.stringify(valuesWith(capture(url), 150)), { status: 200, headers: json });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a short list with no saved copy: asked once in 3 hours, not once a build; the later builds fail as not asked again yet, and FantasyCalc isn't taken for down", async () => {
    vi.useFakeTimers({ now: T0 });
    const fc = fantasyCalc(short);
    const http = createHttpClient({ fetchImpl: fc.fetchImpl, cache: new MemoryCache(), budget: null });
    const build = (minutes: number) => {
      vi.setSystemTime(T0 + minutes * MIN);
      const gate = fantasyCalcGate(http, new Date(Date.now()));
      return { gate, load: settle(loadFantasyCalcValues(http, REDRAFT_10, { gate })) };
    };
    const first = build(0);
    await expect(first.load).rejects.toMatchObject({ code: "BAD_RESPONSE", message: "FantasyCalc redraft values: 40 rows, expected at least 150 player rows" });
    expect(first.gate.down()).toBeUndefined();
    for (const minutes of [1, 30, 179]) {
      const later = build(minutes);
      await expect(later.load).rejects.toMatchObject({
        code: "BAD_RESPONSE",
        message: "FantasyCalc redraft values: not asked again yet, since its last answer was a list that failed our checks and a format is asked at most once every 3 hours",
      });
      expect(later.gate.down()).toBeUndefined();
    }
    expect(fc.requests).toHaveLength(1);
    // Another format is still asked: the memory is per format.
    await expect(settle(loadFantasyCalcValues(http, DYNASTY_12, { gate: fantasyCalcGate(http, new Date(Date.now())) }))).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    expect(fc.requests).toEqual([url, fantasyCalcValuesUrl(DYNASTY_12)]);
    // 3 hours after that answer: asked again (still short, so held again).
    await expect(build(180).load).rejects.toMatchObject({ code: "BAD_RESPONSE", message: "FantasyCalc redraft values: 40 rows, expected at least 150 player rows" });
    expect(fc.requests.filter((u) => u === url)).toHaveLength(2);
    expect(TTL.fantasyCalc).toBe(3 * HOUR);
  });

  it("with yesterday's copy saved: that copy stands in for every build, from the cache only after the first; the snapshot cron asks nothing more on the same client", async () => {
    vi.useFakeTimers({ now: T0 });
    const cache = new MemoryCache();
    const savedAt = T0 - DAY;
    await cache.set(key, { status: 200, contentType: "application/json", text: JSON.stringify(valuesWith(capture(url), 150)), fetchedAt: savedAt }, FANTASYCALC_RETAIN_MS, savedAt);
    const fc = fantasyCalc(short);
    const http = createHttpClient({ fetchImpl: fc.fetchImpl, cache, budget: null });
    for (const minutes of [0, 5, 60, 120]) {
      vi.setSystemTime(T0 + minutes * MIN);
      const load = await settle(loadFantasyCalcValues(http, REDRAFT_10, { gate: fantasyCalcGate(http, new Date(Date.now())) }));
      expect(load).toMatchObject({ stale: true, fetchedAt: savedAt });
      expect(load.players).toHaveLength(150);
    }
    expect(fc.requests).toHaveLength(1);
    // The cron's own read (src/server/snapshots.ts todaysList): yesterday's copy isn't today's list, and nothing is asked.
    const { todaysList } = await import("@/server/snapshots");
    expect(await settle(todaysList(http, REDRAFT_10, new Date(Date.now())))).toEqual({ skip: "not today's list" });
    expect(fc.requests).toHaveLength(1);
  });

  it("an error status (a 404) is remembered by its status; a good answer ends the hold, and so does a good copy another request cached meanwhile", async () => {
    vi.useFakeTimers({ now: T0 });
    let answer: () => Response = () => new Response("", { status: 404 });
    const fc = fantasyCalc(() => answer());
    const cache = new MemoryCache();
    const http = createHttpClient({ fetchImpl: fc.fetchImpl, cache, budget: null });
    await expect(settle(loadFantasyCalcValues(http, REDRAFT_10, { gate: fantasyCalcGate(http, new Date(T0)) }))).rejects.toMatchObject({ code: "SOURCE_DOWN", message: "FantasyCalc redraft values: HTTP 404" });
    const gate = fantasyCalcGate(http, new Date(T0 + MIN));
    expect(gate.rejected(url)).toBe("HTTP 404");
    expect(gate.down()).toBeUndefined();
    await expect(settle(loadFantasyCalcValues(http, REDRAFT_10, { gate }))).rejects.toMatchObject({ message: expect.stringContaining("its last answer was HTTP 404") });
    expect(fc.requests).toHaveLength(1);
    // Another instance (here: a write straight into the shared cache) stores a good list: read as FantasyCalc's, and the hold is over.
    vi.setSystemTime(T0 + 10 * MIN);
    await cache.set(key, { status: 200, contentType: "application/json", text: JSON.stringify(valuesWith(capture(url), 150)), fetchedAt: Date.now() }, FANTASYCALC_RETAIN_MS);
    const held = fantasyCalcGate(http, new Date(Date.now()));
    expect(await settle(loadFantasyCalcValues(http, REDRAFT_10, { gate: held }))).toMatchObject({ fromCache: true, stale: false });
    expect(fantasyCalcGate(http, new Date(Date.now())).rejected(url)).toBeUndefined();
    expect(fc.requests).toHaveLength(1);
    // Past that copy's TTL FantasyCalc is asked as usual, and a good answer keeps the format free.
    answer = good;
    vi.setSystemTime(T0 + 10 * MIN + TTL.fantasyCalc + 1);
    expect(await settle(loadFantasyCalcValues(http, REDRAFT_10, { gate: fantasyCalcGate(http, new Date(Date.now())) }))).toMatchObject({ fromCache: false, stale: false });
    expect(fantasyCalcGate(http, new Date(Date.now())).rejected(url)).toBeUndefined();
    expect(fc.requests).toHaveLength(2);
  });

  it("a request the day's FantasyCalc budget held back starts no outage: a saved copy stands in, and with none the load says Offer Sheet held off", async () => {
    vi.useFakeTimers({ now: T0 });
    const { createBudget } = await import("@/server/budget");
    const spent = () => createBudget({ perDay: { espn: 1, sleeper: 1, fantasycalc: 0, github: 1 } });
    const fc = fantasyCalc(good);
    // No copy: not asked, in words that don't blame FantasyCalc; no outage, so another build would ask (the budget allowing).
    const bare = createHttpClient({ fetchImpl: fc.fetchImpl, cache: new MemoryCache(), budget: spent() });
    const gate = fantasyCalcGate(bare, new Date(T0));
    await expect(settle(loadFantasyCalcValues(bare, REDRAFT_10, { gate }))).rejects.toMatchObject({
      code: "SOURCE_DOWN",
      message: "FantasyCalc redraft values: not asked: Offer Sheet has used today's share of requests to FantasyCalc",
      detail: { status: 0 },
    });
    expect(gate.down()).toBeUndefined();
    expect(gate.rejected(url)).toBeUndefined();
    // With a saved copy: it stands in, and FantasyCalc isn't taken for down.
    const cache = new MemoryCache();
    const savedAt = T0 - DAY;
    await cache.set(key, { status: 200, contentType: "application/json", text: JSON.stringify(valuesWith(capture(url), 150)), fetchedAt: savedAt }, FANTASYCALC_RETAIN_MS, savedAt);
    const withCopy = createHttpClient({ fetchImpl: fc.fetchImpl, cache, budget: spent() });
    const g2 = fantasyCalcGate(withCopy, new Date(T0));
    expect(await settle(loadFantasyCalcValues(withCopy, REDRAFT_10, { gate: g2 }))).toMatchObject({ stale: true, fetchedAt: savedAt });
    expect(g2.down()).toBeUndefined();
    expect(fc.requests).toEqual([]);
  });
});

// Fictional players (made-up ids and names) for the join rules.
const row = (over: Partial<FantasyCalcValueRow>): FantasyCalcValueRow => ({ fantasyCalcId: "1", name: "Zorblax Quintavious", position: "WR", sleeperId: null, espnId: null, mflId: null, fleaflickerId: null, team: null, value: 1000, redraftValue: null, ...over });
const info = (id: string, name: string, pos: PlayerInfo["pos"], eligible: PlayerInfo["pos"][] = [pos]): PlayerInfo => ({ id, name, pos, eligible, nflTeam: "DAL", injury: "ACTIVE", ids: {} });

describe("joining FantasyCalc to canonical ids (§4 canonical ids; §9 v_i)", () => {
  const rows = [
    row({ fantasyCalcId: "1", sleeperId: "90001", espnId: "4400001", value: 5000 }),
    row({ fantasyCalcId: "2", name: "Quillon Thrasp Jr.", position: "TE", sleeperId: "90002", espnId: "4400002", mflId: "16002", fleaflickerId: "17002", value: 3000 }),
    row({ fantasyCalcId: "3", name: "Brontis Vell", position: "RB", sleeperId: "90003", espnId: "4400003", value: 800 }),
    row({ fantasyCalcId: "4", name: "Duplicate Row", sleeperId: "90001", value: 1 }),
  ];
  const players: Record<string, PlayerInfo> = {
    "90001": info("90001", "Somebody Else Entirely", "WR"), // a Sleeper id joins on sleeperId alone
    "espn:4400002": info("espn:4400002", "Quillon Thrasp", "TE"), // suffix and punctuation don't matter
    "espn:4400003": info("espn:4400003", "Brontis Vell", "WR"), // FantasyCalc says RB: a namesake, no match
    "espn:4400001": info("espn:4400001", "Different Person", "WR"), // FantasyCalc's espnId is stale here
    "mfl:16002": info("mfl:16002", "Quillon Thrasp", "WR", ["WR", "TE"]),
    "fleaflicker:17002": info("fleaflicker:17002", "Quillon Thrasp", "TE"),
    DAL: info("DAL", "Dallas D/ST", "DEF"),
    "yahoo:4400002": info("yahoo:4400002", "Quillon Thrasp", "TE"),
  };

  it("joins a Sleeper id on sleeperId, and a platform id only when name and position agree too", () => {
    const match = fantasyCalcMatcher(rows);
    expect(match("90001", players["90001"])?.fantasyCalcId).toBe("1"); // first row wins over the duplicate
    expect(match("90001", undefined)?.fantasyCalcId).toBe("1");
    expect(match("espn:4400002", players["espn:4400002"])?.fantasyCalcId).toBe("2");
    expect(match("espn:4400003", players["espn:4400003"])).toBeUndefined();
    expect(match("espn:4400001", players["espn:4400001"])).toBeUndefined();
    expect(match("espn:4400002", undefined)).toBeUndefined(); // nothing to check the name against
    expect(match("mfl:16002", players["mfl:16002"])?.fantasyCalcId).toBe("2"); // eligible at TE
    expect(match("fleaflicker:17002", players["fleaflicker:17002"])?.fantasyCalcId).toBe("2");
    expect(match("DAL", players.DAL)).toBeUndefined();
    expect(match("yahoo:4400002", players["yahoo:4400002"])).toBeUndefined(); // FantasyCalc has no Yahoo id
    expect(match("toString:4400002", players["espn:4400002"])).toBeUndefined();
    expect(match("constructor:4400002", players["espn:4400002"])).toBeUndefined();
    expect(fantasyCalcValuesFor(rows, players, ["90001", "espn:4400002", "espn:4400003", "DAL", "90009"])).toEqual({ "90001": 5000, "espn:4400002": 3000 });
  });

  it("knownIds: players matched in any of the lists given (a build passes its value lists' rows), in order, without repeats", () => {
    const fcPlayers = [{ fantasyCalcId: "7", name: "Vellum Oats", position: "QB", sleeperId: "90007", espnId: "4400007", mflId: null, fleaflickerId: null, team: null }];
    const known = fantasyCalcKnownIds(["90007", "90001", "espn:4400003", "90001", "90008", "espn:4400007"], { ...players, "espn:4400007": info("espn:4400007", "Vellum Oats", "QB") }, [rows, fcPlayers]);
    expect(known).toEqual(["90007", "90001", "espn:4400007"]);
  });

  it("works on the committed captures: every value row's Sleeper id finds its row", () => {
    const load = reduceFantasyCalcValues(fantasyCalcValuesSchema.parse(capture(fantasyCalcValuesUrl(REDRAFT_10))));
    const ids = load.players.map((p) => p.sleeperId as string);
    const values = fantasyCalcValuesFor(load.players, {}, ids);
    expect(Object.keys(values)).toHaveLength(50);
    expect(values["9221"]).toBe(10717);
  });
});

function loaded(format: FantasyCalcFormat, players: FantasyCalcValueRow[], fetchedAt?: number): FantasyCalcValuesLoad {
  return { format, players, picks: [], topValue: Math.max(...players.map((p) => p.value)), fromCache: false, stale: false, ...(fetchedAt !== undefined ? { fetchedAt } : {}) };
}

describe("market inputs (§9: which number a league uses)", () => {
  const players: Record<string, PlayerInfo> = { "90001": info("90001", "Zorblax Quintavious", "WR"), "90002": info("90002", "Quillon Thrasp", "TE"), "90003": info("90003", "Brontis Vell", "RB") };
  const NOW = new Date("2026-09-30T12:00:00Z");

  it("redraft: the league-format value for relevant players only; knownIds is the players the lists name (FantasyCalc's /players no longer widens it: its conditions of 2026-10-05)", () => {
    const values = loaded(REDRAFT_10, [row({ sleeperId: "90001", value: 7000 }), row({ sleeperId: "90009", value: 9000 })], 1_000);
    const m = marketInputsFrom({ values, players, relevantIds: ["90001", "90002", "90003"], now: NOW });
    expect(m).toEqual({ format: REDRAFT_10, fetchedAt: new Date(1_000).toISOString(), values: { "90001": 7000 }, knownIds: ["90001"], topValue: 9000 });
  });

  it("keeper: dynasty values for the future term, redraft values for perception; the oldest fetch time", () => {
    const dynasty = loaded(DYNASTY_12, [row({ sleeperId: "90001", value: 8000 }), row({ sleeperId: "90002", value: 4000 })], 2_000);
    const redraft = loaded(fmt(), [row({ sleeperId: "90001", value: 6000 })], 1_500);
    const m = marketInputsFrom({ values: dynasty, redraft, players, relevantIds: new Set(["90001", "90002", "90003"]), now: NOW });
    expect(m).toEqual({ format: DYNASTY_12, fetchedAt: new Date(1_500).toISOString(), values: { "90001": 8000, "90002": 4000 }, redraftValues: { "90001": 6000 }, knownIds: ["90001", "90002"], topValue: 8000 });
    expect(marketInputsFrom({ values: loaded(DYNASTY_12, [row({ sleeperId: "90001" })]), players, relevantIds: [], now: NOW }).fetchedAt).toBe(NOW.toISOString());
  });

  it("dynasty: this season's list (the market blend's, §6 step 8) becomes seasonValues, never redraftValues; it counts for knownIds and the oldest fetch time", () => {
    const dynasty = loaded(DYNASTY_12, [row({ sleeperId: "90001", value: 8000 })], 2_000);
    const season = loaded(fmt(), [row({ sleeperId: "90001", value: 6000 }), row({ sleeperId: "90003", value: 3000 })], 1_200);
    const m = marketInputsFrom({ values: dynasty, season, players, relevantIds: ["90001", "90002", "90003"], now: NOW });
    expect(m).toEqual({ format: DYNASTY_12, fetchedAt: new Date(1_200).toISOString(), values: { "90001": 8000 }, seasonValues: { "90001": 6000, "90003": 3000 }, knownIds: ["90001", "90003"], topValue: 8000 });
  });
});
