/**
 * The browser-safe SHA-256 (src/lib/sha256.ts) against node:crypto: the ESPN adapter's SWID pseudonyms and player-card
 * cache keys must come out the same whichever side computes them (track BF). No network.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/engine/rng";
import { sha256Hex } from "./sha256";

const node = (text: string) => createHash("sha256").update(text).digest("hex");

describe("sha256Hex", () => {
  it("matches the FIPS 180-4 test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("matches node:crypto on every length around the block boundaries, and on random UTF-8 text", () => {
    for (let n = 0; n <= 200; n++) {
      const text = "x".repeat(n);
      expect(sha256Hex(text), `length ${n}`).toBe(node(text));
    }
    const rng = mulberry32(20261004);
    const alphabet = ["a", "Z", "0", "{", "-", "é", "ü", "漢", "🏈", " ", "\n", "\u0000"];
    for (let i = 0; i < 300; i++) {
      let text = "";
      const len = Math.floor(rng() * 300);
      for (let j = 0; j < len; j++) text += alphabet[Math.floor(rng() * alphabet.length)];
      expect(sha256Hex(text)).toBe(node(text));
    }
  });

  it("hashes a SWID pseudonym's input exactly as the server always has (so cached pseudonyms stay the same)", () => {
    const input = "espn-swid:{00000000-0000-4000-8000-00000000000A}";
    expect(sha256Hex(input)).toBe(node(input));
  });
});
