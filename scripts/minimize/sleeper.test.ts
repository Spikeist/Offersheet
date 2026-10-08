import { describe, expect, it } from "vitest";
import { BracketMatchSchema } from "@/adapters/sleeper/schemas";
import { minimizeBracket, standingsFrom, synthesizeCreated, syntheticScore } from "./sleeper";

describe("minimizeBracket (Checkpoint 7c: the 3rd-place game; CLAUDE.md §0.6, only what the tests read)", () => {
  it("keeps each match's round, number and place, never its rosters, results or feeds, in a shape the adapter reads", () => {
    // A made-up 4-team bracket as Sleeper sends it.
    const raw = [
      { r: 1, m: 1, t1: 1, t2: 4, w: 4, l: 1 },
      { r: 1, m: 2, t1: 2, t2: 3, w: 2, l: 3 },
      { r: 2, m: 3, t1: 4, t2: 2, w: null, l: null, t1_from: { w: 1 }, t2_from: { w: 2 }, p: 1 },
      { r: 2, m: 4, t1: 1, t2: 3, w: null, l: null, t1_from: { l: 1 }, t2_from: { l: 2 }, p: 3 },
    ];
    const min = minimizeBracket(raw);
    expect(min).toEqual([{ r: 1, m: 1 }, { r: 1, m: 2 }, { r: 2, m: 3, p: 1 }, { r: 2, m: 4, p: 3 }]);
    expect(JSON.stringify(min)).not.toMatch(/"t[12]"|"w"|"l"|_from/);
    for (const row of min) expect(BracketMatchSchema.parse(row)).toEqual(row);
  });
});

describe("synthetic scores and the standings rebuilt from them (review PRIV-3; Phase 3 matchup results)", () => {
  it("gives each roster and week a fixed score of 70.00–159.99 in whole cents, not tied to the real one", () => {
    const scores = [1, 2, 3, 12].flatMap((r) => [1, 2, 3].map((w) => syntheticScore(r, w)));
    for (const s of scores) {
      expect(s).toBeGreaterThanOrEqual(70);
      expect(s).toBeLessThan(160);
      expect(String(s)).toMatch(/^\d+(\.\d{1,2})?$/); // whole cents: prints without float noise
    }
    expect(syntheticScore(3, 2)).toBe(syntheticScore(3, 2));
    expect(new Set(scores).size).toBeGreaterThan(scores.length - 2);
  });

  it("rebuilds W-L-T and points for/against from the scored weeks' pairs, ties included, and skips byes and unscored rows", () => {
    const week1 = [
      { roster_id: 1, matchup_id: 1, points: 100.5 },
      { roster_id: 2, matchup_id: 1, points: 90.25 },
      { roster_id: 3, matchup_id: 2, points: 80 },
      { roster_id: 4, matchup_id: 2, points: 80 },
      { roster_id: 5, matchup_id: null, points: 120 }, // a bye: no game
    ];
    const week2 = [
      { roster_id: 1, matchup_id: 7, points: 70.1 },
      { roster_id: 3, matchup_id: 7, points: 99.9 },
      { roster_id: 2, matchup_id: 8, points: 88 },
      { roster_id: 4, matchup_id: 8 }, // not scored: the game doesn't count
    ];
    const s = standingsFrom([week1, week2]);
    expect(s.get(1)).toEqual({ wins: 1, losses: 1, ties: 0, forCents: 17060, againstCents: 19015 });
    expect(s.get(2)).toEqual({ wins: 0, losses: 1, ties: 0, forCents: 9025, againstCents: 10050 });
    expect(s.get(3)).toEqual({ wins: 1, losses: 0, ties: 1, forCents: 17990, againstCents: 15010 });
    expect(s.get(4)).toEqual({ wins: 0, losses: 0, ties: 1, forCents: 8000, againstCents: 8000 });
    expect(s.has(5)).toBe(false);
  });
});

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
