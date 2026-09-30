/**
 * Keeps fixtures/sanitized/espn tidy: after a COMPLETE probe run, fixtures this run no longer
 * produces (a label changed or a capture was dropped) are deleted together with their index.json
 * entry, and every remaining file is checked to be named sha256(label) + extension.
 * Labels are placeholder-only (fixtures.ts refuses anything else), so they are safe to print.
 */
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { sha256, writeFileAtomic } from "../cache";

interface IndexEntry {
  label: string;
  [key: string]: unknown;
}

export interface PruneResult {
  removed: string[];
  /** Index entries whose file name isn't sha256(label) + ext. */
  misnamed: string[];
  /** Files in the folder without an index entry (other than index.json). */
  unindexed: string[];
  /** Index entries whose file is missing. */
  missingFiles: string[];
}

/** Pure part: which index entries to drop and which look wrong. */
export function planPrune(index: Record<string, IndexEntry>, keepLabels: ReadonlySet<string>, files: readonly string[]): PruneResult & { keep: Record<string, IndexEntry> } {
  const keep: Record<string, IndexEntry> = {};
  const removed: string[] = [];
  const misnamed: string[] = [];
  const missingFiles: string[] = [];
  for (const [file, entry] of Object.entries(index)) {
    if (!keepLabels.has(entry.label)) {
      removed.push(file);
      continue;
    }
    keep[file] = entry;
    if (file !== sha256(entry.label) + path.extname(file)) misnamed.push(entry.label);
    if (!files.includes(file)) missingFiles.push(entry.label);
  }
  const indexed = new Set(Object.keys(index));
  const unindexed = files.filter((f) => f !== "index.json" && !indexed.has(f));
  return { keep, removed, misnamed, unindexed, missingFiles };
}

/** Apply planPrune() to a fixture folder. Returns the removed labels and any inconsistencies. */
export async function pruneFixtures(dir: string, keepLabels: ReadonlySet<string>): Promise<PruneResult> {
  const indexPath = path.join(dir, "index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8")) as Record<string, IndexEntry>;
  const files = await readdir(dir);
  const plan = planPrune(index, keepLabels, files);
  const removedLabels: string[] = [];
  for (const file of plan.removed) {
    removedLabels.push(index[file]?.label ?? file);
    await rm(path.join(dir, file), { force: true });
  }
  // Files without an index entry are orphans from earlier runs: nothing can find them by label.
  for (const file of plan.unindexed) await rm(path.join(dir, file), { force: true });
  if (plan.removed.length) {
    const sorted = Object.fromEntries(Object.entries(plan.keep).sort(([, a], [, b]) => a.label.localeCompare(b.label)));
    await writeFileAtomic(indexPath, JSON.stringify(sorted, null, 2) + "\n");
  }
  return { removed: removedLabels, misnamed: plan.misnamed, unindexed: plan.unindexed, missingFiles: plan.missingFiles };
}
