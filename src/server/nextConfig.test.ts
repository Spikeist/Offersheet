/**
 * What next.config.ts leaves open to anyone besides the pages and the API routes (B4 security review). The security headers
 * are checked with the policy pages (src/app/pages.test.ts); this is the image optimizer: /_next/image runs outside
 * withRoute (no rate limit, no work budget), so it stays off while no page uses next/image. No build, no network.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

const SRC = fileURLToPath(new URL("../", import.meta.url));

function sources(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("next.config.ts: the image optimizer is off (B4 security review)", () => {
  it("images is { unoptimized: true }: Next's own optimizer is off (`next start` answers /_next/image with a 404; Vercel's own is denied at launch by a firewall rule)", () => {
    expect(nextConfig.images).toEqual({ unoptimized: true });
  });

  it("no page needs it: nothing imports next/image (the icons and the sharing image are files and metadata routes of their own)", () => {
    const users = sources().filter((f) => /from\s+["']next\/image["']|require\(\s*["']next\/image["']\s*\)/.test(readFileSync(f, "utf8")));
    expect(users.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
