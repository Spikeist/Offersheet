/**
 * The League page's shared model request: React StrictMode's mount → unmount → mount sends one
 * request, the request is aborted once nobody waits for it, and a settled one is never reused (a Try
 * again asks again). `later` is driven by hand, so "a tick later" is explicit.
 */
import { describe, expect, it } from "vitest";
import { createRequestSharer } from "./sharedRequest";

function harness<T>() {
  const pending: (() => void)[] = [];
  const sharer = createRequestSharer<T>((check) => void pending.push(check));
  const tick = () => {
    for (const check of pending.splice(0)) check();
  };
  const starts: { signal: AbortSignal; resolve: (v: T) => void; reject: (e: unknown) => void }[] = [];
  const start = (signal: AbortSignal) =>
    new Promise<T>((resolve, reject) => {
      starts.push({ signal, resolve, reject });
    });
  return { sharer, tick, starts, start };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createRequestSharer", () => {
  it("sends one request through StrictMode's mount → unmount → mount, and the remount gets its answer", async () => {
    const h = harness<string>();
    const first = h.sharer.join("POST /api/model/espn {}", h.start);
    first.leave(); // StrictMode's simulated unmount…
    const second = h.sharer.join("POST /api/model/espn {}", h.start); // …and remount, in the same tick
    h.tick();
    expect(h.starts).toHaveLength(1);
    expect(h.starts[0]?.signal.aborted).toBe(false);
    h.starts[0]?.resolve("inputs");
    await expect(second.promise).resolves.toBe("inputs");
    await flush();
    expect(h.sharer.size).toBe(0);
  });

  it("aborts the request a tick after the last one waiting leaves (the page unmounted)", () => {
    const h = harness<string>();
    const a = h.sharer.join("k", h.start);
    const b = h.sharer.join("k", h.start);
    a.leave();
    h.tick();
    expect(h.starts[0]?.signal.aborted).toBe(false); // b still waits
    b.leave();
    b.leave(); // leaving twice counts once
    expect(h.starts[0]?.signal.aborted).toBe(false); // not before the tick
    h.tick();
    expect(h.starts[0]?.signal.aborted).toBe(true);
    expect(h.sharer.size).toBe(0);
    // A later join starts afresh.
    h.sharer.join("k", h.start);
    expect(h.starts).toHaveLength(2);
    expect(h.starts[1]?.signal.aborted).toBe(false);
  });

  it("forgets a settled request, so a Try again asks again, and never aborts it afterwards", async () => {
    const h = harness<string>();
    const a = h.sharer.join("k", h.start);
    h.starts[0]?.reject(new Error("offline"));
    await expect(a.promise).rejects.toThrow("offline");
    await flush();
    expect(h.sharer.size).toBe(0);
    a.leave();
    h.tick();
    expect(h.starts[0]?.signal.aborted).toBe(false);
    const retry = h.sharer.join("k", h.start);
    expect(h.starts).toHaveLength(2);
    h.starts[1]?.resolve("inputs");
    await expect(retry.promise).resolves.toBe("inputs");
  });

  it("keeps different requests apart, and turns a start that throws into a rejected request", async () => {
    const h = harness<string>();
    h.sharer.join("league A", h.start);
    h.sharer.join("league B", h.start);
    expect(h.starts).toHaveLength(2);
    expect(h.sharer.size).toBe(2);
    const broken = h.sharer.join("league C", () => {
      throw new Error("no fetch");
    });
    await expect(broken.promise).rejects.toThrow("no fetch");
  });
});
