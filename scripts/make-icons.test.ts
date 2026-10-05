/**
 * scripts/make-icons.ts and the icons it wrote (planner reply to Checkpoint 4c, B3: "Installable: a PWA manifest and
 * icons"): read from the files themselves (no sharp here), so a stale or broken icon is caught. The PNGs' sizes and
 * opacity (iOS and Android's maskable icon get no see-through pixels), the .ico's directory, and the SVG equal to the
 * mark's own drawing (src/components/logoGeometry.ts), so a change of the mark without `npx tsx scripts/make-icons.ts`
 * fails here.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { logoSvg } from "@/components/logoGeometry";
import { ICONS, icoFromPngs } from "./make-icons";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (file: string) => readFileSync(path.join(ROOT, file));

/** A PNG's width, height and color type (IHDR: 2 = RGB, no alpha; 6 = RGBA). */
function pngInfo(b: Buffer): { width: number; height: number; colorType: number } {
  expect(b.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(b.subarray(12, 16).toString("latin1")).toBe("IHDR");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b.readUInt8(25) };
}

/** An .ico's images: each directory entry's size and the PNG it points at. */
function icoImages(b: Buffer): Array<{ width: number; height: number; png: Buffer }> {
  expect([b.readUInt16LE(0), b.readUInt16LE(2)]).toEqual([0, 1]);
  const count = b.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const e = 6 + 16 * i;
    const width = b.readUInt8(e) || 256;
    const height = b.readUInt8(e + 1) || 256;
    expect([b.readUInt16LE(e + 4), b.readUInt16LE(e + 6)]).toEqual([1, 32]);
    const length = b.readUInt32LE(e + 8);
    const offset = b.readUInt32LE(e + 12);
    return { width, height, png: b.subarray(offset, offset + length) };
  });
}

describe("the icons make-icons.ts wrote", () => {
  it("lists every icon the app serves: the tab icons, the iPhone icon and the manifest's three", () => {
    expect(ICONS.map((i) => i.file)).toEqual([
      "src/app/icon.svg",
      "src/app/favicon.ico",
      "src/app/apple-icon.png",
      "public/icons/icon-192.png",
      "public/icons/icon-512.png",
      "public/icons/maskable-512.png",
    ]);
  });

  it("icon.svg is the mark as logoGeometry.ts draws it today, its colors written in", () => {
    const svg = read("src/app/icon.svg").toString("utf8");
    expect(svg).toBe(`${logoSvg({ tile: "rounded" })}\n`);
    expect(svg).not.toContain("var(");
  });

  it("each PNG has its size, and the iPhone and maskable icons have no see-through pixels (no alpha channel)", () => {
    for (const icon of ICONS.filter((i) => i.kind === "png")) {
      const { width, height, colorType } = pngInfo(read(icon.file));
      expect([icon.file, width, height]).toEqual([icon.file, icon.sizes[0], icon.sizes[0]]);
      expect([icon.file, colorType]).toEqual([icon.file, icon.opaque ? 2 : 6]);
    }
    expect(ICONS.filter((i) => i.opaque).map((i) => i.file)).toEqual(["src/app/apple-icon.png", "public/icons/maskable-512.png"]);
  });

  it("favicon.ico holds 16, 32 and 48 px PNGs (it replaced Next's default icon)", () => {
    const ico = read("src/app/favicon.ico");
    const images = icoImages(ico);
    expect(images.map((i) => [i.width, i.height])).toEqual([
      [16, 16],
      [32, 32],
      [48, 48],
    ]);
    for (const img of images) {
      const info = pngInfo(img.png);
      expect([info.width, info.height]).toEqual([img.width, img.height]);
    }
    // Not the scaffold's 25,931-byte default any more.
    expect(ico.length).toBeLessThan(10_000);
  });

  it("make-icons.ts's header names the tests that check what it wrote, and they exist (review PG-9)", () => {
    const header = read("scripts/make-icons.ts").toString("utf8").split("*/")[0] ?? "";
    const named = [...header.matchAll(/[\w/.-]+\.test\.ts/g)].map((m) => m[0]);
    expect(named).toEqual(["scripts/make-icons.test.ts", "src/app/metadata.test.ts"]);
    for (const file of named) expect(existsSync(path.join(ROOT, file)), file).toBe(true);
  });
});

describe("icoFromPngs", () => {
  const fakePng = (n: number) => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(n, 7)]);

  it("writes the header, one directory entry per image (256 as 0) and the images in order, at the offsets it says", () => {
    const a = fakePng(10);
    const b = fakePng(20);
    const ico = icoFromPngs([
      { size: 16, png: a },
      { size: 256, png: b },
    ]);
    expect(ico.length).toBe(6 + 32 + a.length + b.length);
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 2]);
    expect([ico.readUInt8(6), ico.readUInt8(7), ico.readUInt32LE(6 + 8), ico.readUInt32LE(6 + 12)]).toEqual([16, 16, a.length, 38]);
    expect([ico.readUInt8(22), ico.readUInt8(23), ico.readUInt32LE(22 + 8), ico.readUInt32LE(22 + 12)]).toEqual([0, 0, b.length, 38 + a.length]);
    expect(ico.subarray(38, 38 + a.length).equals(a)).toBe(true);
    expect(ico.subarray(38 + a.length).equals(b)).toBe(true);
  });

  it("refuses a size an .ico can't hold", () => {
    expect(() => icoFromPngs([{ size: 300, png: fakePng(1) }])).toThrow("An .ico image must be 1 to 256 px, not 300.");
    expect(() => icoFromPngs([{ size: 0, png: fakePng(1) }])).toThrow();
  });
});
