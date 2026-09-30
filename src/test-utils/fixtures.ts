/**
 * Test-only readers for committed fixtures (no network). Filenames are sha256 of the label
 * (CLAUDE.md §0.7); each folder's index.json maps them back.
 *   - fixtures/sanitized/<platform>/        Parker's leagues and public data (full sanitized copies)
 *   - fixtures/sanitized/min/<platform>/<group>/  minimized strangers' test leagues
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function sanitizedFixturePath(platform: string, label: string, ext = ".json"): string {
  return path.join(ROOT, "fixtures", "sanitized", platform, `${sha256(label)}${ext}`);
}

export function readSanitizedFixture<T = unknown>(platform: string, label: string): T {
  return JSON.parse(readFileSync(sanitizedFixturePath(platform, label), "utf8")) as T;
}

export function minFixturePath(platform: string, group: string, label: string): string {
  return path.join(ROOT, "fixtures", "sanitized", "min", platform, group, `${sha256(`${group}/${label}`)}.json`);
}

export function readMinFixture<T = unknown>(platform: string, group: string, label: string): T {
  return JSON.parse(readFileSync(minFixturePath(platform, group, label), "utf8")) as T;
}

/** Labels in a committed fixture folder (from its index.json). */
export function fixtureLabels(dir: string): string[] {
  const index = path.join(ROOT, dir, "index.json");
  if (!existsSync(index)) return [];
  return Object.values(JSON.parse(readFileSync(index, "utf8")) as Record<string, { label: string }>).map((e) => e.label);
}
