/**
 * Makes Offer Sheet's icons from its mark (planner reply to Checkpoint 4c, B3: "Installable: a PWA manifest and
 * icons"). Offline: it draws src/components/logoGeometry.ts's mark with sharp (installed with Next) and writes the files
 * the app serves. Run it again after the mark changes, then commit what it wrote:
 *
 *   npx tsx scripts/make-icons.ts
 *
 * What it writes (ICONS):
 * - src/app/icon.svg: the browser-tab icon of current browsers (Next links it, sizes="any").
 * - src/app/favicon.ico: 16, 32 and 48 px PNGs in one .ico (PNG-in-ICO), for older browsers and tools that ask for
 *   /favicon.ico; it replaces Next's default icon from the Phase 0 scaffold.
 * - src/app/apple-icon.png: 180 × 180, square and opaque (iOS rounds the corners itself and fills see-through pixels with
 *   black).
 * - public/icons/icon-192.png, icon-512.png: the manifest's "any" icons (Chrome's install needs 192 and 512 px).
 * - public/icons/maskable-512.png: the manifest's "maskable" icon, square and opaque: Android cuts its own shape from it,
 *   and the football stays inside the safe zone (logoGeometry.ts logoSvg).
 *
 * scripts/make-icons.test.ts checks the files it wrote without sharp (each PNG's size and opacity, the .ico's directory,
 * icon.svg equal to the mark's drawing), and src/app/metadata.test.ts the manifest's icons (each a real file of its size)
 * and their colors.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LOGO_GOLD, logoSvg } from "@/components/logoGeometry";
import { ROOT } from "./lib/env";
import { isMainModule, relativePath } from "./lib/runMode";

export interface IconSpec {
  /** Where it goes, relative to the project root. */
  file: string;
  kind: "svg" | "png" | "ico";
  /** Pixel sizes: one for a PNG, several for the .ico; none for the SVG. */
  sizes: number[];
  tile: "rounded" | "square";
  /** Flattened onto the gold, with no alpha channel. */
  opaque: boolean;
}

export const ICONS: readonly IconSpec[] = [
  { file: "src/app/icon.svg", kind: "svg", sizes: [], tile: "rounded", opaque: false },
  { file: "src/app/favicon.ico", kind: "ico", sizes: [16, 32, 48], tile: "rounded", opaque: false },
  { file: "src/app/apple-icon.png", kind: "png", sizes: [180], tile: "square", opaque: true },
  { file: "public/icons/icon-192.png", kind: "png", sizes: [192], tile: "rounded", opaque: false },
  { file: "public/icons/icon-512.png", kind: "png", sizes: [512], tile: "rounded", opaque: false },
  { file: "public/icons/maskable-512.png", kind: "png", sizes: [512], tile: "square", opaque: true },
];

/**
 * One PNG of the mark (the SVG drawn at exactly `size` px, so no resampling). sharp comes with Next (an optional
 * dependency, not one of ours), so it's loaded only here: the tests read the files and never need it.
 */
async function pngOf(size: number, tile: IconSpec["tile"], opaque: boolean): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const image = sharp(Buffer.from(logoSvg({ size, tile })));
  return (opaque ? image.flatten({ background: LOGO_GOLD }).removeAlpha() : image).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * An .ico holding PNG images (pure): the 6-byte header (reserved 0, type 1 = icon, the count), one 16-byte directory
 * entry per image (width and height, 0 meaning 256; no palette; 1 plane; 32 bits; the PNG's length and offset), then
 * the PNGs in order. Every current browser and Windows since Vista read PNG entries.
 */
export function icoFromPngs(images: ReadonlyArray<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error(`An .ico image must be 1 to 256 px, not ${size}.`);
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0);
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

/** Every icon's bytes (nothing written). */
export async function renderIcons(): Promise<Array<{ file: string; bytes: Buffer }>> {
  const out: Array<{ file: string; bytes: Buffer }> = [];
  for (const icon of ICONS) {
    if (icon.kind === "svg") {
      out.push({ file: icon.file, bytes: Buffer.from(`${logoSvg({ tile: icon.tile })}\n`, "utf8") });
    } else if (icon.kind === "ico") {
      const images = [];
      for (const size of icon.sizes) images.push({ size, png: await pngOf(size, icon.tile, icon.opaque) });
      out.push({ file: icon.file, bytes: icoFromPngs(images) });
    } else {
      out.push({ file: icon.file, bytes: await pngOf(icon.sizes[0] as number, icon.tile, icon.opaque) });
    }
  }
  return out;
}

async function main(): Promise<void> {
  for (const { file, bytes } of await renderIcons()) {
    const target = path.join(ROOT, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    console.log(`${relativePath(ROOT, target)}: ${bytes.length.toLocaleString("en-US")} bytes`);
  }
}

// Run only as a script (an exact path: scripts/lib/runMode.ts isMainModule).
if (isMainModule(import.meta.url)) void main();
