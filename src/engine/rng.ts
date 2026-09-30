/**
 * Seeded random numbers (CLAUDE.md §0.10: all randomness uses a seeded PRNG; §8 and planner reply to
 * Checkpoint 1, addition C: common random numbers). Pure and deterministic: no Math.random(), no clock.
 *
 * streamFor(seed, key, index) is an independent stream for each (seed, key, index). A player's
 * availability scenario s uses streamFor(seed, playerId, s) (src/engine/availability.ts), so his draws
 * depend only on the seed, his id and the scenario: never on call order, on the other players or on
 * the team he's on. The "before" and "after" evaluations of a trade therefore see the same numbers.
 *
 * - hash32: FNV-1a (32-bit) over the string's UTF-8 bytes.
 * - mix32: combines two 32-bit words with one MurmurHash3 block round and its fmix32 finalizer (full
 *   avalanche). For a fixed first word it's a bijection of the second, so the streams of one key never
 *   share a seed.
 * - mulberry32: a small, fast 32-bit generator; uniforms in [0, 1) with 2^-32 resolution. Plenty for
 *   Monte Carlo averages over tens of thousands of draws; not for cryptography.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** One FNV-1a step: xor the byte in, multiply by the prime (mod 2^32). */
function fnvStep(h: number, byte: number): number {
  return Math.imul(h ^ byte, FNV_PRIME);
}

/** FNV-1a 32-bit hash of a string's UTF-8 bytes (a lone surrogate encodes as U+FFFD, as TextEncoder does). Unsigned. */
export function hash32(s: string): number {
  let h = FNV_OFFSET | 0;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      h = fnvStep(h, c);
      continue;
    }
    if (c < 0x800) {
      h = fnvStep(h, 0xc0 | (c >> 6));
      h = fnvStep(h, 0x80 | (c & 0x3f));
      continue;
    }
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        const cp = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
        i++;
        h = fnvStep(h, 0xf0 | (cp >> 18));
        h = fnvStep(h, 0x80 | ((cp >> 12) & 0x3f));
        h = fnvStep(h, 0x80 | ((cp >> 6) & 0x3f));
        h = fnvStep(h, 0x80 | (cp & 0x3f));
        continue;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    h = fnvStep(h, 0xe0 | (c >> 12));
    h = fnvStep(h, 0x80 | ((c >> 6) & 0x3f));
    h = fnvStep(h, 0x80 | (c & 0x3f));
  }
  return h >>> 0;
}

function rotl32(x: number, r: number): number {
  return (x << r) | (x >>> (32 - r));
}

/** MurmurHash3's 32-bit finalizer: every input bit affects every output bit. A bijection. Unsigned. */
export function fmix32(x: number): number {
  let h = x | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Mixes two 32-bit words into one (a MurmurHash3 block round of b into a, then fmix32). Numbers are
 * read as 32-bit integers (ToInt32), so seeds and indices beyond 2^32 wrap. Unsigned.
 */
export function mix32(a: number, b: number): number {
  let k = Math.imul(b | 0, 0xcc9e2d51);
  k = rotl32(k, 15);
  k = Math.imul(k, 0x1b873593);
  let h = (a | 0) ^ k;
  h = rotl32(h, 13);
  h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  return fmix32(h);
}

/** mulberry32: uniforms in [0, 1) from a 32-bit seed. Each call to the returned function advances the stream. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The mulberry32 seed of streamFor(seed, key, index); callers in hot loops hash the key once and mix per index. */
export function streamSeed(seed: number, key: string, index: number): number {
  return mix32(mix32(seed, hash32(key)), index);
}

/** An independent stream of uniforms in [0, 1) for (seed, key, index), e.g. one per (player, scenario). */
export function streamFor(seed: number, key: string, index: number): () => number {
  return mulberry32(streamSeed(seed, key, index));
}
