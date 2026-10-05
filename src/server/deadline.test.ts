import { afterEach, describe, expect, it, vi } from "vitest";
import { CUT_REASONS, LATE, ROUTE_KINDS, deadlineMsOf, newRequestScope, noteCut, requestScope, runInRequestScope, timeLeftMs, withinDeadline } from "./deadline";
import { deadlines } from "./limits";

afterEach(() => {
  vi.useRealTimers();
});

describe("the request scope (track RL: each API request's deadline)", () => {
  it("has a deadline per route kind from limits.deadlines", () => {
    expect(ROUTE_KINDS.map((k) => deadlineMsOf(k))).toEqual([deadlines.importMs, deadlines.modelMs, deadlines.sessionMs, deadlines.feedbackMs, deadlines.healthMs, deadlines.cronMs]);
    expect(deadlines).toMatchObject({ importMs: 45_000, modelMs: 90_000, sessionMs: 10_000, feedbackMs: 10_000, healthMs: 10_000, cronMs: 110_000 });
    const scope = newRequestScope("model", 1_000);
    expect(scope).toMatchObject({ route: "model", startedAt: 1_000, deadlineAt: 91_000, pendingLogs: [], flushed: false });
    expect(scope.client).toBeUndefined();
    expect(Object.keys(scope.cut)).toEqual([...CUT_REASONS]);
    expect(newRequestScope("import", 0, 5).deadlineAt).toBe(5);
    // withRoute passes the client's rate-limit id (an HMAC), for its share of the daily budgets.
    expect(newRequestScope("import", 0, undefined, "client-hmac").client).toBe("client-hmac");
  });

  it("outside a request there is no deadline and nothing is noted", () => {
    expect(requestScope()).toBeUndefined();
    expect(timeLeftMs()).toBe(Number.POSITIVE_INFINITY);
    expect(() => noteCut("slow", "espn")).not.toThrow();
  });

  it("everything a request awaits, and every task it starts, sees its scope; two requests never share one", async () => {
    const a = newRequestScope("import", 10_000);
    const b = newRequestScope("session", 10_000);
    const seen: string[] = [];
    let background: Promise<void> | undefined;
    await Promise.all([
      runInRequestScope(a, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(`a:${requestScope()?.route}`);
        noteCut("budget", "sleeper");
        // A task started without awaiting it (a background rebuild) runs in the same scope.
        background = (async () => {
          await new Promise((r) => setTimeout(r, 5));
          noteCut("skipped", "github");
        })();
      }),
      runInRequestScope(b, async () => {
        await Promise.resolve();
        seen.push(`b:${requestScope()?.route}`);
        noteCut("slow", "espn");
        noteCut("busy", "cache");
        noteCut("share", "espn");
      }),
    ]);
    await background;
    expect(seen.sort()).toEqual(["a:import", "b:session"]);
    expect([...a.cut.budget]).toEqual(["sleeper"]);
    expect([...a.cut.skipped]).toEqual(["github"]);
    expect([...a.cut.slow]).toEqual([]);
    expect([...b.cut.slow]).toEqual(["espn"]);
    expect([...b.cut.busy]).toEqual(["cache"]);
    expect([...b.cut.share]).toEqual(["espn"]);
    expect(requestScope()).toBeUndefined();
  });

  it("time left counts down from the request's start", async () => {
    const scope = newRequestScope("session", 50_000);
    await runInRequestScope(scope, async () => {
      expect(timeLeftMs(50_000)).toBe(deadlines.sessionMs);
      expect(timeLeftMs(50_000 + deadlines.sessionMs + 1)).toBe(-1);
    });
  });
});

describe("withinDeadline (track RL review RL-1, RL-3: nothing a request waits for outlasts its deadline)", () => {
  it("outside a request it's the promise itself: no deadline, no timer", async () => {
    const p = Promise.resolve(7);
    expect(withinDeadline(p)).toBe(p);
    await expect(withinDeadline(Promise.reject(new Error("x")))).rejects.toThrow("x");
  });

  it("inside one: the value when it comes first, LATE when the deadline (plus the grace) does; the work goes on", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 4, 18, 0, 0) });
    const scope = newRequestScope("import", Date.now(), 1_000);
    let finish!: (v: string) => void;
    const slow = new Promise<string>((r) => (finish = r));
    const quick = runInRequestScope(scope, () => withinDeadline(Promise.resolve("ok")));
    await expect(quick).resolves.toBe("ok");
    const waiting = runInRequestScope(scope, () => withinDeadline(slow, 500));
    let got: unknown = "pending";
    void waiting.then((v) => (got = v));
    await vi.advanceTimersByTimeAsync(1_499);
    expect(got).toBe("pending"); // the grace counts past the deadline
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toBe(LATE);
    finish("late answer");
    await expect(slow).resolves.toBe("late answer");
    expect(vi.getTimerCount()).toBe(0); // no timer left behind
  });

  it("a rejection before the deadline rejects; one after it is ignored (never unhandled)", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 4, 18, 0, 0) });
    const scope = newRequestScope("import", Date.now(), 100);
    await expect(runInRequestScope(scope, () => withinDeadline(Promise.reject(new RangeError("early"))))).rejects.toBeInstanceOf(RangeError);
    let fail!: (e: Error) => void;
    const later = new Promise<never>((_, reject) => (fail = reject));
    const p = runInRequestScope(scope, () => withinDeadline(later));
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toBe(LATE);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      fail(new Error("after the deadline"));
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("past its bound a wait still gets a moment (a healthy cache answers in it); once something came back LATE, no more", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 4, 18, 0, 0) });
    const scope = newRequestScope("import", Date.now() - 10_000, 1_000);
    await runInRequestScope(scope, async () => {
      // An answer that's already there counts, and one that comes within the floor too.
      expect(await withinDeadline(Promise.resolve("there"))).toBe("there");
      const soon = withinDeadline(new Promise((r) => setTimeout(() => r("soon"), deadlines.lateFloorMs - 1)));
      await vi.advanceTimersByTimeAsync(deadlines.lateFloorMs - 1);
      expect(await soon).toBe("soon");
      expect(scope.lateSeen).toBe(false);
      // A hanging one is LATE after the floor…
      const hanging = withinDeadline(new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(deadlines.lateFloorMs);
      expect(await hanging).toBe(LATE);
      expect(scope.lateSeen).toBe(true);
      // …and from then on a pending one is LATE at once (the request is done waiting); a settled one still counts.
      let got: unknown;
      void withinDeadline(new Promise(() => {})).then((v) => (got = v));
      await vi.advanceTimersByTimeAsync(0);
      expect(got).toBe(LATE);
      expect(await withinDeadline(Promise.resolve("there"))).toBe("there");
    });
  });
});
