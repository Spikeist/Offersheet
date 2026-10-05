/**
 * The model routes' memory of answers built from a signed import (final review SEC-1; ./memo.ts): kept until the token
 * stops being good, never served after, bounded by bytes (the least recently used go first).
 */
import { describe, expect, it } from "vitest";
import { modelMemoLimits, rateLimits } from "@/server/limits";
import { createModelMemo, modelMemo, modelMemoKey } from "./memo";

describe("the model routes' memory", () => {
  it("serves an answer until its expiry, never after (and forgets it then)", () => {
    const memo = createModelMemo(1_000);
    memo.set("k", "answer", 100, 0);
    expect(memo.get("k", 99)).toBe("answer");
    expect(memo.get("k", 100)).toBeUndefined();
    expect(memo.size()).toBe(0);
    // An answer already past its expiry isn't kept at all.
    memo.set("late", "x", 50, 60);
    expect(memo.size()).toBe(0);
  });

  it("forgets every expired answer within a sweep's interval while reads come, not only the key read (the privacy page's promise)", () => {
    const memo = createModelMemo(1_000);
    memo.set("a", "x".repeat(10), 1_000, 0);
    memo.set("b", "y".repeat(10), 5_000_000, 0);
    expect(memo.size()).toBe(2);
    // A read of another key well after "a" expired sweeps it away.
    expect(memo.get("b", 2 * rateLimits.sweepEveryMs)).toBe("y".repeat(10));
    expect(memo.size()).toBe(1);
    expect(memo.bytes()).toBe(10);
  });

  it("keeps at most its bytes, the least recently used going first; an answer bigger than the memory isn't kept", () => {
    const memo = createModelMemo(10);
    memo.set("a", "aaaa", 1_000, 0);
    memo.set("b", "bbbb", 1_000, 0);
    expect(memo.get("a", 1)).toBe("aaaa"); // a is now the most recently used
    memo.set("c", "cccc", 1_000, 2);
    expect(memo.get("b", 3)).toBeUndefined();
    expect(memo.get("a", 3)).toBe("aaaa");
    expect(memo.get("c", 3)).toBe("cccc");
    expect(memo.bytes()).toBe(8);
    memo.set("huge", "x".repeat(11), 1_000, 4);
    expect(memo.get("huge", 5)).toBeUndefined();
    // A write replaces the key's old answer, and sweeps answers past their time.
    memo.set("a", "AA", 1_000, 6);
    expect(memo.bytes()).toBe(6);
    memo.set("d", "d", 2_000, 1_500);
    expect([memo.get("a", 1_500), memo.get("c", 1_500), memo.get("d", 1_500)]).toEqual([undefined, undefined, "d"]);
    expect(memo.size()).toBe(1);
  });

  it("files answers by platform and the signed content's digest; one memory per process, bounded by modelMemoLimits", () => {
    expect(modelMemoKey("espn", "abc")).not.toBe(modelMemoKey("sleeper", "abc"));
    expect(modelMemo()).toBe(modelMemo());
    expect(modelMemoLimits.maxBytes).toBe(24_000_000);
  });
});
