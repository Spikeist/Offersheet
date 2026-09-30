import { describe, expect, it } from "vitest";
import { fmix32, hash32, mix32, mulberry32, streamFor, streamSeed } from "./rng";

/** FNV-1a over TextEncoder's UTF-8 bytes: the reference hash32 must match. */
function fnv1aReference(s: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) h = Math.imul(h ^ b, 0x01000193);
  return h >>> 0;
}

function popcount(x: number): number {
  let n = 0;
  for (let v = x >>> 0; v; v &= v - 1) n++;
  return n;
}

function draws(next: () => number, n: number): number[] {
  return Array.from({ length: n }, () => next());
}

describe("hash32: FNV-1a 32-bit (CLAUDE.md §0.10 seeded randomness)", () => {
  it("matches the published FNV-1a test vectors", () => {
    expect(hash32("")).toBe(0x811c9dc5);
    expect(hash32("a")).toBe(0xe40c292c);
    expect(hash32("foobar")).toBe(0xbf9cf968);
  });

  it("hashes UTF-8 bytes, like FNV-1a over TextEncoder's output (2-, 3- and 4-byte characters, lone surrogates)", () => {
    for (const s of ["4046", "espn:4239996", "Amon-Ra St. Brown", "é", "Ω≈ç√", "日本", "🏈 football", "a\ud800b", "\udc00", "x\ud83c"]) {
      expect(hash32(s), s).toBe(fnv1aReference(s));
    }
  });

  it("is unsigned 32-bit and spreads similar ids apart", () => {
    const hashes = Array.from({ length: 5000 }, (_, i) => hash32(String(i)));
    expect(hashes.every((h) => Number.isInteger(h) && h >= 0 && h < 2 ** 32)).toBe(true);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe("mix32 and fmix32", () => {
  it("fmix32 is MurmurHash3's finalizer (0 stays 0; pinned value for 1)", () => {
    expect(fmix32(0)).toBe(0);
    expect(fmix32(1)).toBe(1364076727);
  });

  it("avalanches: flipping one input bit flips about half of the 32 output bits", () => {
    const rand = mulberry32(7);
    let flippedA = 0;
    let flippedB = 0;
    let trials = 0;
    for (let i = 0; i < 2000; i++) {
      const a = (rand() * 2 ** 32) >>> 0;
      const b = (rand() * 2 ** 32) >>> 0;
      const bit = 1 << (i % 32);
      flippedA += popcount(mix32(a, b) ^ mix32(a ^ bit, b));
      flippedB += popcount(mix32(a, b) ^ mix32(a, b ^ bit));
      trials++;
    }
    expect(flippedA / trials).toBeGreaterThan(15);
    expect(flippedA / trials).toBeLessThan(17);
    expect(flippedB / trials).toBeGreaterThan(15);
    expect(flippedB / trials).toBeLessThan(17);
  });

  it("is a bijection of the second word for a fixed first word: one key's scenario streams never share a seed", () => {
    const base = mix32(20_260_929, hash32("4046"));
    const seeds = new Set<number>();
    for (let s = 0; s < 100_000; s++) seeds.add(mix32(base, s));
    expect(seeds.size).toBe(100_000);
  });

  it("depends on the order of its words", () => {
    expect(mix32(1, 2)).not.toBe(mix32(2, 1));
    expect(mix32(0, 1)).not.toBe(mix32(1, 0));
  });
});

describe("mulberry32", () => {
  it("is deterministic, and pinned so scenarios stay reproducible across versions", () => {
    expect(draws(mulberry32(0), 3)).toEqual([0.26642920868471265, 0.0003297457005828619, 0.2232720274478197]);
    expect(draws(mulberry32(20_260_929), 3)).toEqual([0.33081650477834046, 0.7369657973758876, 0.29230662784539163]);
    expect(draws(mulberry32(42), 50)).toEqual(draws(mulberry32(42), 50));
  });

  it("draws uniforms in [0, 1): mean ≈ 1/2 and variance ≈ 1/12 over 1e5 draws, flat over 10 bins", () => {
    const xs = draws(mulberry32(123_456), 100_000);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.005); // SD of the mean ≈ 0.0009
    expect(Math.abs(variance - 1 / 12)).toBeLessThan(0.002);
    const bins = new Array<number>(10).fill(0);
    for (const x of xs) bins[Math.floor(x * 10)]!++;
    const chi2 = bins.reduce((s, c) => s + (c - 10_000) ** 2 / 10_000, 0);
    expect(chi2).toBeLessThan(30); // 9 degrees of freedom: P(χ² > 30) < 0.001
  });
});

describe("streamFor: common random numbers per (seed, key, index) (§8; planner reply to Checkpoint 1, addition C)", () => {
  it("is mulberry32 seeded by mix32(mix32(seed, hash32(key)), index)", () => {
    const seed = mix32(mix32(20_260_929, hash32("4046")), 3);
    expect(streamSeed(20_260_929, "4046", 3)).toBe(seed);
    expect(draws(streamFor(20_260_929, "4046", 3), 20)).toEqual(draws(mulberry32(seed), 20));
  });

  it("depends only on (seed, key, index): not on call order or on other streams drawn in between", () => {
    const first = draws(streamFor(1, "espn:4239996", 5), 10);
    const noise = streamFor(1, "other", 0);
    draws(noise, 1000);
    expect(draws(streamFor(1, "espn:4239996", 5), 10)).toEqual(first);
  });

  it("different keys, indices and seeds give different streams", () => {
    const a = draws(streamFor(1, "4046", 0), 5);
    expect(draws(streamFor(1, "4047", 0), 5)).not.toEqual(a);
    expect(draws(streamFor(1, "4046", 1), 5)).not.toEqual(a);
    expect(draws(streamFor(2, "4046", 0), 5)).not.toEqual(a);
  });

  it("neighboring streams are uncorrelated (index s vs s + 1, key vs a similar key)", () => {
    const n = 20_000;
    const corr = (x: number[], y: number[]) => {
      const mx = x.reduce((s, v) => s + v, 0) / n;
      const my = y.reduce((s, v) => s + v, 0) / n;
      let sxy = 0;
      let sxx = 0;
      let syy = 0;
      for (let i = 0; i < n; i++) {
        sxy += ((x[i] as number) - mx) * ((y[i] as number) - my);
        sxx += ((x[i] as number) - mx) ** 2;
        syy += ((y[i] as number) - my) ** 2;
      }
      return sxy / Math.sqrt(sxx * syy);
    };
    // The first draw of many streams (how scenarios use them): stream s vs stream s + 1, key "p" vs "q".
    const firstOf = (key: string, offset: number) => Array.from({ length: n }, (_, s) => streamFor(9, key, s + offset)());
    expect(Math.abs(corr(firstOf("p", 0), firstOf("p", 1)))).toBeLessThan(0.03); // SD ≈ 0.007
    expect(Math.abs(corr(firstOf("p", 0), firstOf("q", 0)))).toBeLessThan(0.03);
  });
});
