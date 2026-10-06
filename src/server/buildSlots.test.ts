import { afterEach, describe, expect, it, vi } from "vitest";
import { createBuildSlots, modelBuildSlots } from "./buildSlots";
import { newRequestScope, runInRequestScope } from "./deadline";
import { deadlines, modelBuildLimits } from "./limits";

const T0 = Date.UTC(2026, 9, 5, 18, 0, 0);

afterEach(() => {
  vi.useRealTimers();
});

/** Asks for a slot as a model request that started at `startedAt` (its deadline deadlines.modelMs after). */
function asModelRequest(slots: ReturnType<typeof createBuildSlots>, startedAt: number) {
  return runInRequestScope(newRequestScope("model", startedAt), () => slots.acquire());
}

describe("League page builds at once per instance (Checkpoint 7b load test, risk 3)", () => {
  it("the cap: 8 builds at once, a waiting build starting with at least 30 s of its 90 s deadline left", () => {
    expect(modelBuildLimits).toEqual({ concurrent: 8, minTimeLeftMs: 30_000, retryAfterS: 60 });
    expect(deadlines.modelMs).toBe(90_000);
    expect(modelBuildSlots()).toBe(modelBuildSlots()); // one per process, both model routes
  });

  it("at most `capacity` hold a slot; the others wait and get one as each is released, in the order their requests started", async () => {
    vi.useFakeTimers({ now: T0 });
    const slots = createBuildSlots(2, 30_000);
    const a = await asModelRequest(slots, T0);
    const b = await asModelRequest(slots, T0 + 1);
    expect([slots.running(), slots.waiting()]).toEqual([2, 0]);
    // Three more: the one whose request started last asks first, the earliest asks last.
    const got: string[] = [];
    const late = asModelRequest(slots, T0 + 30).then((r) => (got.push("started +30"), r));
    const mid = asModelRequest(slots, T0 + 20).then((r) => (got.push("started +20"), r));
    const early = asModelRequest(slots, T0 + 10).then((r) => (got.push("started +10"), r));
    await vi.advanceTimersByTimeAsync(0);
    expect([slots.running(), slots.waiting()]).toEqual([2, 3]);
    a?.();
    a?.(); // a second call of the same release does nothing
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toEqual(["started +10"]);
    expect([slots.running(), slots.waiting()]).toEqual([2, 2]);
    b?.();
    (await early)?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toEqual(["started +10", "started +20", "started +30"]);
    (await mid)?.();
    (await late)?.();
    expect([slots.running(), slots.waiting()]).toEqual([0, 0]);
  });

  it("a build waits while more than minTimeLeftMs of its deadline is left, then gets none (its route answers BUSY); a free slot is given at once however late", async () => {
    vi.useFakeTimers({ now: T0 });
    const slots = createBuildSlots(1, 30_000);
    const holder = await asModelRequest(slots, T0);
    // Started now: 90 s of deadline, so it waits 60 s.
    let waited: (() => void) | null | undefined;
    void asModelRequest(slots, T0).then((r) => (waited = r));
    await vi.advanceTimersByTimeAsync(60_000 - 1);
    expect(waited).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(waited).toBeNull();
    expect(slots.waiting()).toBe(0);
    // Started 70 s ago (20 s left, under the 30 s): none at once, without waiting.
    expect(await asModelRequest(slots, T0 + 60_000 - 70_000)).toBeNull();
    // A free slot is given whatever time is left (the build would have run before the cap too).
    holder?.();
    const late = await asModelRequest(slots, T0 + 60_000 - 85_000);
    expect(late).toBeTypeOf("function");
    late?.();
  });

  it("outside a request (scripts, tests) a waiter waits without a bound", async () => {
    vi.useFakeTimers({ now: T0 });
    const slots = createBuildSlots(1);
    const first = await slots.acquire();
    let second: (() => void) | null | undefined;
    void slots.acquire().then((r) => (second = r));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(second).toBeUndefined();
    first?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(second).toBeTypeOf("function");
  });
});
