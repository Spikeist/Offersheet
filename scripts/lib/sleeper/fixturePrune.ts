/**
 * Remove sanitized fixtures a run no longer writes (a label that changed or was dropped): the file
 * AND its index.json entry, so fixtures/sanitized/sleeper has no orphans. Only labels under the given
 * prefix are touched; filenames are sha256(label) by construction (fixtures.ts).
 */
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../cache";

export async function pruneStaleFixtures(dir: string, prefix: string, keep: ReadonlySet<string>): Promise<string[]> {
  const indexPath = path.join(dir, "index.json");
  let index: Record<string, { label: string }>;
  try {
    index = JSON.parse(await readFile(indexPath, "utf8")) as Record<string, { label: string }>;
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const [file, e] of Object.entries(index)) {
    if (!e.label.startsWith(prefix) || keep.has(e.label)) continue;
    await rm(path.join(dir, file), { force: true });
    delete index[file];
    removed.push(e.label);
  }
  if (removed.length) {
    const sorted = Object.fromEntries(Object.entries(index).sort(([, a], [, b]) => a.label.localeCompare(b.label)));
    await writeFileAtomic(indexPath, JSON.stringify(sorted, null, 2) + "\n");
  }
  return removed;
}
