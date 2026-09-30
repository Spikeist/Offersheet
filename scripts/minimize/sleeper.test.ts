import { describe, expect, it } from "vitest";
import { synthesizeCreated } from "./sleeper";

const HOUR = 3_600_000;
const WEEK1 = Date.UTC(2026, 8, 9, 12); // the synthetic start of league week 1

describe("synthesizeCreated (review PRIV-3: no real transaction time survives minimizing)", () => {
  it("keeps the real order but puts every time on its league week's start plus whole hours", () => {
    // Made-up real times: two in leg 2 (the second one late at night), two in leg 3, one proposed early.
    const rows = [
      { id: "a", leg: 2, created: 1_788_000_000_123 },
      { id: "b", leg: 2, created: 1_788_050_000_456 },
      { id: "c", leg: 3, created: 1_788_600_000_789 },
      { id: "d", leg: 3, created: 1_788_000_500_000 }, // created before "b", completed in leg 3
      { id: "e", leg: 3, created: 1_788_700_000_000 },
    ];
    const out = synthesizeCreated(rows);
    const byRealTime = [...rows].sort((x, y) => x.created - y.created);
    const times = byRealTime.map((r) => out.get(r) as number);
    expect([...times].sort((x, y) => x - y)).toEqual(times); // order kept
    for (const r of rows) {
      const t = out.get(r) as number;
      expect(rows.some((x) => x.created === t)).toBe(false); // no real value survives
      expect((t - WEEK1) % HOUR).toBe(0); // whole hours after the synthetic anchor
      expect(t).toBeGreaterThanOrEqual(WEEK1 + (r.leg - 1) * 7 * 24 * HOUR + HOUR); // not before its league week
    }
    expect(out.get(rows[0] as (typeof rows)[number])).toBe(WEEK1 + 7 * 24 * HOUR + HOUR); // leg 2's first: week start + 1 h
  });
});
