/**
 * The HTTP client's request deadline and daily budgets (planner reply to Checkpoint 4c, Part B, B1; track RL): what
 * src/server/http.ts does inside an API route's scope (src/server/deadline.ts) and with a budget (src/server/budget.ts).
 * The client's other behaviour is in http.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpResponse } from "@/adapters/types";
import { BudgetExhaustedError, createBudget, type BudgetVerdict, type OutboundBudget } from "./budget";
import { HOUR, MemoryCache, type Cache, type CacheLock } from "./cache";
import { newRequestScope, runInRequestScope, type RequestScope } from "./deadline";
import { createHttpClient, responseCut } from "./http";
import { deadlines } from "./limits";

type Answer = { status: number; body?: string } | "hang" | "network error";

/** A fetch answering from a list (the last one repeats); "hang" never answers but honours its abort signal. */
function fakeFetch(answers: Answer[]) {
  const calls: { url: string; at: number }[] = [];
  const releases: Array<() => void> = [];
  const impl = ((url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), at: Date.now() });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)] as Answer;
    if (a === "network error") return Promise.reject(new TypeError("fetch failed"));
    if (a === "hang")
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        releases.push(() => resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));
      });
    return Promise.resolve(new Response(a.body ?? "{}", { status: a.status, headers: { "content-type": "application/json" } }));
  }) as typeof fetch;
  return { impl, calls, release: () => releases.splice(0).forEach((r) => r()) };
}

/** Runs `fn` as a request whose deadline is `leftMs` from now (for `client`, when given). */
function asRequest<T>(leftMs: number, fn: (scope: RequestScope) => Promise<T>, client?: string): Promise<T> {
  const scope = newRequestScope("import", Date.now(), leftMs, client);
  return runInRequestScope(scope, () => fn(scope));
}

const ESPN = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/4242";
const SLEEPER = "https://api.sleeper.app/v1/state/nfl";
const PROJ = "https://api.sleeper.app/projections/nfl/2026/5?season_type=regular&position=QB";
const PUBLIC = { cache: { key: "proj-w5", ttlMs: HOUR, public: true } };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the request's deadline (inside an API route)", () => {
  it("starts no attempt without deadlines.minAttemptMs left: no request, 'no response' marked as the deadline's, and the request noted as skipped", async () => {
    const f = fakeFetch([{ status: 200 }]);
    const http = createHttpClient({ fetchImpl: f.impl, budget: null });
    const { res, scope } = await asRequest(deadlines.minAttemptMs - 1, async (scope) => ({ res: await http.get(ESPN), scope }));
    expect(res).toMatchObject({ status: 0, ok: false });
    expect(responseCut(res)).toBe("deadline");
    expect(f.calls).toHaveLength(0);
    expect([...scope.cut.skipped]).toEqual(["espn"]);
    expect([...scope.cut.slow]).toEqual([]);
    // Outside a route nothing changes.
    const outside = await http.get(ESPN);
    expect(outside.status).toBe(200);
    expect(responseCut(outside)).toBeUndefined();
  });

  it("caps a fetch's timeout at the time left: cut short, the source was slow", async () => {
    const f = fakeFetch(["hang"]);
    const http = createHttpClient({ fetchImpl: f.impl, budget: null });
    const started = Date.now();
    const { res, scope } = await asRequest(deadlines.minAttemptMs + 150, async (scope) => ({ res: await http.get("https://example.invalid/slow", { timeoutMs: 30_000, maxRetries: 3 }), scope }));
    const took = Date.now() - started;
    expect(res.status).toBe(0);
    expect(responseCut(res)).toBe("deadline");
    expect(f.calls).toHaveLength(1); // no retry: there's no time for one
    expect(took).toBeLessThan(deadlines.minAttemptMs + 1_000);
    expect([...scope.cut.slow]).toEqual(["other"]);
  });

  it("never waits out a backoff past the deadline: the answer so far (the source's own, unmarked) is the answer", async () => {
    const f = fakeFetch([{ status: 503 }, { status: 200 }]);
    const http = createHttpClient({ fetchImpl: f.impl, budget: null });
    const { res, scope } = await asRequest(deadlines.minAttemptMs + 500, async (scope) => ({ res: await http.get(SLEEPER, { maxRetries: 3 }), scope }));
    expect(res.status).toBe(503);
    expect(responseCut(res)).toBeUndefined(); // Sleeper did answer 503: an outage memory should hear that
    expect(f.calls).toHaveLength(1);
    expect(Object.values(scope.cut).every((s) => s.size === 0)).toBe(true);
    // A network error with time to spare isn't the deadline's either.
    const down = createHttpClient({ fetchImpl: fakeFetch(["network error"]).impl, budget: null });
    const failed = await asRequest(60_000, () => down.get(SLEEPER, { maxRetries: 0 }));
    expect(failed.status).toBe(0);
    expect(responseCut(failed)).toBeUndefined();
  });

  it("never waits in the host's queue past the deadline, and passes the turn on unused; a short turn ahead means Offer Sheet was busy", async () => {
    const f = fakeFetch(["hang", { status: 200 }]);
    const http = createHttpClient({ fetchImpl: f.impl, budget: null });
    const first = http.get("https://example.invalid/held"); // outside a route: holds the host's turn
    await vi.waitFor(() => expect(f.calls).toHaveLength(1));
    const started = Date.now();
    const { res, scope } = await asRequest(deadlines.minAttemptMs + 100, async (scope) => ({ res: await http.get("https://example.invalid/queued"), scope }));
    expect(res.status).toBe(0);
    expect(responseCut(res)).toBe("deadline");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(f.calls).toHaveLength(1);
    expect([...scope.cut.busy]).toEqual(["other"]);
    f.release();
    expect((await first).status).toBe(200);
    // The queue goes on: the next request gets its turn.
    expect((await http.get("https://example.invalid/after")).status).toBe(200);
    expect(f.calls).toHaveLength(2);
  });

  it("a queue wait that runs out behind one answer held deadlines.slowAnswerMs or more: the source was slow (review RL-8)", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 4, 18, 0, 0) });
    const f = fakeFetch(["hang", { status: 200 }]);
    const http = createHttpClient({ fetchImpl: f.impl, budget: null });
    const held = http.get(ESPN, { timeoutMs: 60_000 }); // outside a route: ESPN holds the turn
    await vi.advanceTimersByTimeAsync(10);
    const scope = newRequestScope("import", Date.now(), deadlines.slowAnswerMs + 2_000);
    const waiting = runInRequestScope(scope, () => http.get(`${ESPN}?view=mTeam`));
    await vi.advanceTimersByTimeAsync(deadlines.slowAnswerMs + 1_100);
    const res = await waiting;
    expect(res.status).toBe(0);
    expect([...scope.cut.slow]).toEqual(["espn"]);
    expect([...scope.cut.busy]).toEqual([]);
    f.release();
    await vi.advanceTimersByTimeAsync(1);
    expect((await held).status).toBe(200);
  });

  it("serves each host's queue in the order requests reached Offer Sheet: an import that started first finishes first", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 4, 18, 0, 0) });
    const order: string[] = [];
    const impl = ((url: string | URL) => {
      order.push(new URL(String(url)).searchParams.get("r") ?? "");
      return new Promise<Response>((r) => setTimeout(() => r(new Response("{}", { status: 200 })), 50));
    }) as typeof fetch;
    const http = createHttpClient({ fetchImpl: impl, budget: null });
    // Three imports of three sequential requests each, arriving 10 ms apart.
    const imp = (name: string) => asRequest(45_000, async () => {
      for (let k = 1; k <= 3; k++) await http.get(`${ESPN}?r=${name}${k}`);
    });
    const runs = [imp("a")];
    await vi.advanceTimersByTimeAsync(10);
    runs.push(imp("b"));
    await vi.advanceTimersByTimeAsync(10);
    runs.push(imp("c"));
    for (let i = 0; i < 200; i++) await vi.advanceTimersByTimeAsync(100);
    await Promise.all(runs);
    // First come, first served by request: a's later requests go before b's first (a FIFO queue would interleave them).
    expect(order).toEqual(["a1", "a2", "a3", "b1", "b2", "b3", "c1", "c2", "c3"]);
    // Outside a route it's first come, first served by request too: the order they asked in.
    const plain: Promise<unknown>[] = [];
    order.length = 0;
    for (const r of ["x", "y", "z"]) plain.push(http.get(`${SLEEPER}?r=${r}`));
    for (let i = 0; i < 50; i++) await vi.advanceTimersByTimeAsync(100);
    await Promise.all(plain);
    expect(order).toEqual(["x", "y", "z"]);
  });

  it("a retained copy stands in when the deadline stops a staleIfError request, and says it stands in for a cut", async () => {
    const cache = new MemoryCache();
    await cache.set("public", { status: 200, contentType: "application/json", text: '{"saved":true}', fetchedAt: Date.now() - 2 * HOUR }, 7 * 24 * HOUR, Date.now() - 2 * HOUR);
    const f = fakeFetch([{ status: 200, body: '{"saved":false}' }]);
    const http = createHttpClient({ fetchImpl: f.impl, cache, budget: null });
    const res = await asRequest(10, () => http.get("https://api.fantasycalc.com/players", { cache: { key: "public", ttlMs: HOUR, retainMs: 7 * 24 * HOUR, staleIfError: true } }));
    expect(res).toMatchObject({ stale: true, json: { saved: true }, liveFailure: { status: 0 } });
    expect(responseCut(res)).toBe("deadline"); // an outage memory sees it wasn't FantasyCalc that failed
    expect(f.calls).toHaveLength(0);
  });
});

describe("a request that joins another's fetch (single-flight) and its own deadline (review RL-1)", () => {
  it("waits no longer than its own deadline: then 'no response', cut, the source noted as slow; the starter goes on", async () => {
    const f = fakeFetch(["hang"]);
    const http = createHttpClient({ fetchImpl: f.impl, cache: new MemoryCache(), budget: null });
    const starter = runInRequestScope(newRequestScope("model", Date.now(), 60_000), () => http.get(PROJ, PUBLIC));
    await vi.waitFor(() => expect(f.calls).toHaveLength(1));
    const started = Date.now();
    const scope = newRequestScope("import", Date.now(), 300);
    const joined = await runInRequestScope(scope, () => http.get(PROJ, PUBLIC));
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(joined).toMatchObject({ status: 0, ok: false });
    expect(responseCut(joined)).toBe("deadline");
    expect([...scope.cut.slow]).toEqual(["sleeper"]);
    f.release();
    expect((await starter).status).toBe(200);
    expect(f.calls).toHaveLength(1);
  });

  it("asks once more itself when the starter's own deadline cut the fetch short and it still has the time", async () => {
    const f = fakeFetch(["hang", { status: 200, body: '{"week":5}' }]);
    const http = createHttpClient({ fetchImpl: f.impl, cache: new MemoryCache(), budget: null });
    const starterScope = newRequestScope("import", Date.now(), deadlines.minAttemptMs + 200);
    const starter = runInRequestScope(starterScope, () => http.get(PROJ, PUBLIC));
    await vi.waitFor(() => expect(f.calls).toHaveLength(1));
    const joinerScope = newRequestScope("model", Date.now(), 60_000);
    const joiner = await runInRequestScope(joinerScope, () => http.get(PROJ, PUBLIC));
    expect(responseCut(await starter)).toBe("deadline");
    expect([...starterScope.cut.slow]).toEqual(["sleeper"]);
    expect(joiner).toMatchObject({ status: 200, json: { week: 5 } });
    expect(responseCut(joiner)).toBeUndefined();
    expect(Object.values(joinerScope.cut).every((s) => s.size === 0)).toBe(true);
    expect(f.calls).toHaveLength(2);
  });

  it("a day's budget refusal is everyone's: the joiner's own scope notes it too (so its import answers BUSY)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let answer!: (v: BudgetVerdict) => void;
    const take = vi.fn((): Promise<BudgetVerdict> => new Promise((r) => (answer = r)));
    const http = createHttpClient({ fetchImpl: fakeFetch([{ status: 200 }]).impl, cache: new MemoryCache(), budget: { take } });
    const league = { cache: { key: "espn:league", ttlMs: HOUR } };
    const a = newRequestScope("import", Date.now(), 45_000, "client-a");
    const b = newRequestScope("import", Date.now(), 45_000, "client-b");
    const starter = runInRequestScope(a, () => http.get(ESPN, league));
    await vi.waitFor(() => expect(take).toHaveBeenCalledTimes(1));
    const joiner = runInRequestScope(b, () => http.get(ESPN, league));
    await new Promise((r) => setTimeout(r, 20));
    answer("day");
    await expect(starter).rejects.toMatchObject({ name: "BudgetExhaustedError", by: "day" });
    await expect(joiner).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(take).toHaveBeenCalledTimes(1);
    expect([...a.cut.budget]).toEqual(["espn"]);
    expect([...b.cut.budget]).toEqual(["espn"]);
  });

  it("a client's share is its own: a joiner of a fetch the starter's share refused asks for itself", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let answerA!: (v: BudgetVerdict) => void;
    const take = vi.fn((_p: string, _now?: number, client?: string): BudgetVerdict | Promise<BudgetVerdict> => (client === "client-a" ? new Promise<BudgetVerdict>((r) => (answerA = r)) : "ok"));
    const budget: OutboundBudget = { take };
    const f = fakeFetch([{ status: 200, body: '{"league":1}' }]);
    const http = createHttpClient({ fetchImpl: f.impl, cache: new MemoryCache(), budget });
    const league = { cache: { key: "espn:league", ttlMs: HOUR } };
    const a = newRequestScope("import", Date.now(), 45_000, "client-a");
    const b = newRequestScope("import", Date.now(), 45_000, "client-b");
    const starter = runInRequestScope(a, () => http.get(ESPN, league));
    await vi.waitFor(() => expect(take).toHaveBeenCalledTimes(1));
    const joiner = runInRequestScope(b, () => http.get(ESPN, league));
    await new Promise((r) => setTimeout(r, 20));
    answerA("share");
    await expect(starter).rejects.toMatchObject({ name: "BudgetExhaustedError", by: "share" });
    expect(await joiner).toMatchObject({ status: 200, json: { league: 1 } });
    expect([...a.cut.share]).toEqual(["espn"]);
    expect([...b.cut.share]).toEqual([]);
    expect(f.calls).toHaveLength(1);
  });
});

describe("a hanging server cache can't hold a request past its deadline (review RL-3)", () => {
  /** A cache whose reads (or writes) never answer, as Upstash hanging would. */
  const hangingCache = (what: "get" | "set"): Cache => {
    const base = new MemoryCache();
    return what === "get"
      ? Object.assign(Object.create(base) as Cache, { get: () => new Promise(() => {}) })
      : Object.assign(Object.create(base) as Cache, { get: async () => undefined, set: () => new Promise(() => {}) });
  };

  it("a cache read gets deadlines.cacheGraceMs past the deadline, then counts as a miss (Offer Sheet's own store was busy)", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 4, 18, 0, 0) });
    const f = fakeFetch([{ status: 200 }]);
    const http = createHttpClient({ fetchImpl: f.impl, cache: hangingCache("get"), budget: null });
    const scope = newRequestScope("import", Date.now(), 300);
    let res: HttpResponse | undefined;
    void runInRequestScope(scope, () => http.get(SLEEPER, { cache: { key: "sleeper:state", ttlMs: 60_000 } })).then((r) => (res = r));
    await vi.advanceTimersByTimeAsync(300 + deadlines.cacheGraceMs - 1);
    expect(res).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(res).toMatchObject({ status: 0 });
    expect(responseCut(res as HttpResponse)).toBe("deadline");
    expect([...scope.cut.busy]).toEqual(["cache"]);
    expect([...scope.cut.skipped]).toEqual(["sleeper"]); // no time was left to ask Sleeper
    expect(f.calls).toHaveLength(0);
  });

  it("a cache write that hangs: the answer is served by the deadline and the grace, the write goes on behind", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 4, 18, 0, 0) });
    const http = createHttpClient({ fetchImpl: fakeFetch([{ status: 200, body: '{"week":5}' }]).impl, cache: hangingCache("set"), budget: null });
    const scope = newRequestScope("import", Date.now(), 5_000);
    let res: HttpResponse | undefined;
    void runInRequestScope(scope, () => http.get(SLEEPER, { cache: { key: "sleeper:state", ttlMs: 60_000 } })).then((r) => (res = r));
    await vi.advanceTimersByTimeAsync(5_000 + deadlines.cacheGraceMs);
    expect(res).toMatchObject({ status: 200, json: { week: 5 } });
    expect([...scope.cut.busy]).toEqual(["cache"]);
  });

  it("a request already past its deadline and the grace (a background rebuild running late) still reads a healthy cache", async () => {
    const cache = new MemoryCache();
    await cache.set("fresh", { status: 200, contentType: "application/json", text: '{"fresh":true}', fetchedAt: Date.now() }, HOUR);
    await cache.set("saved", { status: 200, contentType: "application/json", text: '{"saved":true}', fetchedAt: Date.now() - 2 * HOUR }, 7 * 24 * HOUR, Date.now() - 2 * HOUR);
    const f = fakeFetch([{ status: 200 }]);
    const http = createHttpClient({ fetchImpl: f.impl, cache, budget: null });
    const scope = newRequestScope("model", Date.now() - 100_000, 90_000); // 10 s past its deadline, 8 s past the grace
    await runInRequestScope(scope, async () => {
      expect(await http.get(SLEEPER, { cache: { key: "fresh", ttlMs: HOUR } })).toMatchObject({ fromCache: true, json: { fresh: true } });
      const stale = await http.get("https://api.fantasycalc.com/players", { cache: { key: "saved", ttlMs: HOUR, retainMs: 7 * 24 * HOUR, staleIfError: true } });
      expect(stale).toMatchObject({ stale: true, json: { saved: true } });
    });
    expect(f.calls).toHaveLength(0);
    expect([...scope.cut.busy]).toEqual([]); // the cache answered: nothing was cut there
    expect(scope.lateSeen).toBe(false);
  });

  it("a fetch stuck in the cross-instance lock leaves the single-flight map: a later request starts its own", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 4, 18, 0, 0) });
    let runs = 0;
    const lock: CacheLock = { run: (_key, _copy, fetch) => (++runs === 1 ? new Promise(() => {}) : fetch()) };
    const f = fakeFetch([{ status: 200, body: '{"w":5}' }]);
    const http = createHttpClient({ fetchImpl: f.impl, cache: new MemoryCache(), budget: null, lock });
    const first = newRequestScope("model", Date.now(), 1_000);
    let res: HttpResponse | undefined;
    void runInRequestScope(first, () => http.get(PROJ, PUBLIC)).then((r) => (res = r));
    // Its own fetch is waited for twice the grace past the deadline (its cache write may take one grace, the lock another).
    await vi.advanceTimersByTimeAsync(1_000 + 2 * deadlines.cacheGraceMs - 1);
    expect(res).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(res).toMatchObject({ status: 0 });
    expect([...first.cut.busy]).toEqual(["cache"]);
    // A request with plenty of time doesn't join the stuck fetch: it asks itself.
    const later = runInRequestScope(newRequestScope("model", Date.now(), 90_000), () => http.get(PROJ, PUBLIC));
    await vi.advanceTimersByTimeAsync(200);
    expect(await later).toMatchObject({ status: 200, json: { w: 5 } });
    expect(runs).toBe(2);
  });
});

describe("the daily budgets", () => {
  const tiny = (perDay: Partial<Record<"espn" | "sleeper" | "fantasycalc" | "github", number>>, perClient?: { espn?: number; sleeper?: number }) =>
    createBudget({ perDay: { espn: 100, sleeper: 100, fantasycalc: 100, github: 100, ...perDay }, ...(perClient ? { perClient } : {}) });

  it("over budget, a league request throws BudgetExhaustedError before any request, and the request's scope notes it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakeFetch([{ status: 200 }]);
    const http = createHttpClient({ fetchImpl: f.impl, budget: tiny({ espn: 1 }) });
    expect((await http.get(ESPN)).status).toBe(200);
    const scope = newRequestScope("import", Date.now());
    await expect(runInRequestScope(scope, () => http.get(`${ESPN}?view=mTeam`))).rejects.toMatchObject({ name: "BudgetExhaustedError", by: "day" });
    expect(f.calls).toHaveLength(1);
    expect([...scope.cut.budget]).toEqual(["espn"]);
  });

  it("over budget, league-independent data takes the usual outage path: its saved copy, else 'no response', both marked as the budget's", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cache = new MemoryCache();
    await cache.set("saved", { status: 200, contentType: "application/json", text: '{"v":1}', fetchedAt: Date.now() - 2 * HOUR }, 7 * 24 * HOUR, Date.now() - 2 * HOUR);
    const f = fakeFetch([{ status: 200, body: '{"v":2}' }]);
    const http = createHttpClient({ fetchImpl: f.impl, cache, budget: tiny({ fantasycalc: 0, sleeper: 0 }) });
    const stale = await http.get("https://api.fantasycalc.com/values/current?isDynasty=false", { cache: { key: "saved", ttlMs: HOUR, retainMs: 7 * 24 * HOUR, staleIfError: true } });
    expect(stale).toMatchObject({ stale: true, json: { v: 1 }, liveFailure: { status: 0 } });
    expect(responseCut(stale)).toBe("budget");
    const none = await http.get("https://api.fantasycalc.com/players", { cache: { key: "none", ttlMs: HOUR, staleIfError: true } });
    expect(none).toMatchObject({ status: 0, ok: false });
    expect(responseCut(none)).toBe("budget");
    // cache.public (track CA's flag for league-independent requests) counts too.
    const flagged = await http.get("https://api.sleeper.app/projections/nfl/2026/5", { cache: { key: "proj", ttlMs: HOUR, public: true } });
    expect(flagged.status).toBe(0);
    expect(f.calls).toHaveLength(0);
  });

  it("every attempt counts, retries included; a retry over budget returns the last answer", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakeFetch([{ status: 503 }, { status: 503 }, { status: 200 }]);
    const http = createHttpClient({ fetchImpl: f.impl, budget: tiny({ sleeper: 2 }) });
    const p = http.get(SLEEPER, { maxRetries: 3 });
    await vi.advanceTimersByTimeAsync(10_000);
    const res = await p;
    expect(res.status).toBe(503);
    expect(responseCut(res)).toBeUndefined(); // Sleeper's own answer
    expect(f.calls).toHaveLength(2);
  });

  it("cache hits, joined fetches and unbudgeted hosts cost nothing", async () => {
    const budget = tiny({ sleeper: 1 });
    const take = vi.spyOn(budget, "take");
    const f = fakeFetch([{ status: 200, body: '{"week":5}' }]);
    const http = createHttpClient({ fetchImpl: f.impl, cache: new MemoryCache(), budget });
    const opts = { cache: { key: "state", ttlMs: HOUR } };
    const [a, b] = await Promise.all([http.get(SLEEPER, opts), http.get(SLEEPER, opts)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await http.get(SLEEPER, opts)).fromCache).toBe(true);
    await http.get("https://example.invalid/x");
    expect(take).toHaveBeenCalledTimes(1);
    expect(take.mock.calls[0]?.[0]).toBe("sleeper");
  });

  it("a league request made for an API request counts against its client's share (review RL-4); league-independent data doesn't", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakeFetch([{ status: 200, body: "{}" }]);
    const http = createHttpClient({ fetchImpl: f.impl, budget: tiny({}, { espn: 1 }) });
    const scope = newRequestScope("import", Date.now(), 45_000, "client-a");
    await runInRequestScope(scope, async () => {
      expect((await http.get(`${ESPN}?view=mTeam`)).status).toBe(200);
      // Public data (cache.public) is everyone's: no share.
      expect((await http.get(`${ESPN}?view=kona_player_info`, { cache: { key: "x", ttlMs: HOUR, public: true } })).status).toBe(200);
      await expect(http.get(`${ESPN}?view=mRoster`)).rejects.toMatchObject({ name: "BudgetExhaustedError", platform: "espn", by: "share" });
    });
    expect([...scope.cut.share]).toEqual(["espn"]);
    // Another client still has its share; and outside a request (no client) there's none.
    expect((await asRequest(45_000, () => http.get(`${ESPN}?view=mSettings`), "client-b")).status).toBe(200);
    expect((await http.get(`${ESPN}?view=mStatus`)).status).toBe(200);
  });
});
