/**
 * Keep fixtures/sanitized/shared/ in step with what the probe produces: drop fixtures whose label
 * is no longer expected (and their index entries), fixture-named files (sha256 + ext) without an
 * index entry, and index entries without a file. Only this probe writes fixtures there; any other
 * file, and any subfolder, is left alone (see fixture-folders.ts).
 */
import { existsSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { sha256, writeFileAtomic } from "../cache";
import { SANITIZED_DIR } from "../fixtures";
import { FIXTURE_FILE, assertPrunable, isPlainName } from "./fixture-folders";

export interface IndexEntry {
  label: string;
  [k: string]: unknown;
}

export interface PrunePlan {
  /** Index keys (file names) whose label isn't expected, or whose name isn't sha256(label)+ext. */
  dropEntries: string[];
  /** Files in the folder with no index entry. */
  orphanFiles: string[];
  /** Index entries whose file is missing. */
  missingFiles: string[];
}

/** Pure: decide what to remove. */
export function planPrune(index: Record<string, IndexEntry>, files: string[], expected: Set<string>): PrunePlan {
  const present = new Set(files);
  const dropEntries: string[] = [];
  const missingFiles: string[] = [];
  for (const [file, e] of Object.entries(index)) {
    if (!present.has(file)) {
      missingFiles.push(file);
      continue;
    }
    const ext = path.extname(file);
    if (!expected.has(e.label) || file !== sha256(e.label) + ext) dropEntries.push(file);
  }
  const orphanFiles = files.filter((f) => f !== "index.json" && !(f in index));
  return { dropEntries: dropEntries.sort(), orphanFiles: orphanFiles.sort(), missingFiles: missingFiles.sort() };
}

export async function pruneSanitized(platform: string, expected: Set<string>): Promise<PrunePlan & { removedLabels: string[] }> {
  const dir = path.join(SANITIZED_DIR, platform);
  assertPrunable(dir);
  const indexPath = path.join(dir, "index.json");
  if (!existsSync(indexPath)) return { dropEntries: [], orphanFiles: [], missingFiles: [], removedLabels: [] };
  const index = JSON.parse(await readFile(indexPath, "utf8")) as Record<string, IndexEntry>;
  const files = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && /\.(json|csv|txt)$/.test(e.name)).map((e) => e.name);
  const plan = planPrune(index, files, expected);
  // Orphans are deleted only when named like a probe fixture (sha256 + ext): a file another tool
  // put here (a hand-made test fixture, say) is left alone. Subfolders are never touched.
  plan.orphanFiles = plan.orphanFiles.filter((f) => FIXTURE_FILE.test(f));
  const removedLabels = plan.dropEntries.map((f) => index[f]?.label ?? f);
  for (const f of [...plan.dropEntries, ...plan.orphanFiles]) if (isPlainName(f)) await rm(path.join(dir, f), { force: true });
  for (const f of [...plan.dropEntries, ...plan.missingFiles]) delete index[f];
  if (plan.dropEntries.length || plan.missingFiles.length) {
    const sorted = Object.fromEntries(Object.entries(index).sort(([, a], [, b]) => a.label.localeCompare(b.label)));
    await writeFileAtomic(indexPath, JSON.stringify(sorted, null, 2) + "\n");
  }
  return { ...plan, removedLabels };
}
