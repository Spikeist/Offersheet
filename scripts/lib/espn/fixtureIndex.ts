/**
 * Keeps the ESPN fixture folders tidy: after a COMPLETE probe run, fixtures this run no longer
 * produces (a label changed or a capture was dropped) are deleted together with their index.json
 * entry, and every remaining file is checked to be named sha256(label) + extension. The probe calls
 * this for fixtures/sanitized/espn (Parker's league, public data) and for the git-ignored
 * data-local/fixtures-sanitized/espn (the public test league: a stranger's), each with the labels it
 * saved to that folder. Labels are placeholder-only (fixtures.ts refuses anything else), so they are
 * safe to print. Subfolders and files not named like a fixture are never deleted.
 */
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { sha256, writeFileAtomic } from "../cache";
import { FIXTURE_FILE, assertPrunable, isPlainName } from "../shared/fixture-folders";

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

/**
 * Apply planPrune() to a fixture folder. Returns the removed labels and any inconsistencies;
 * `unindexed` lists the orphan files removed (named like a fixture). A folder without an index
 * (never written, e.g. no stranger's league probed yet) is left alone.
 */
export async function pruneFixtures(dir: string, keepLabels: ReadonlySet<string>): Promise<PruneResult> {
  assertPrunable(dir);
  const none: PruneResult = { removed: [], misnamed: [], unindexed: [], missingFiles: [] };
  const indexPath = path.join(dir, "index.json");
  let index: Record<string, IndexEntry>;
  let files: string[];
  try {
    index = JSON.parse(await readFile(indexPath, "utf8")) as Record<string, IndexEntry>;
    files = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return none;
  }
  const plan = planPrune(index, keepLabels, files);
  const removedLabels: string[] = [];
  for (const file of plan.removed) {
    removedLabels.push(index[file]?.label ?? file);
    if (isPlainName(file) && file !== "index.json") await rm(path.join(dir, file), { force: true });
  }
  // Files without an index entry are orphans from earlier runs: nothing can find them by label.
  const orphans = plan.unindexed.filter((f) => FIXTURE_FILE.test(f));
  for (const file of orphans) await rm(path.join(dir, file), { force: true });
  if (plan.removed.length) {
    const sorted = Object.fromEntries(Object.entries(plan.keep).sort(([, a], [, b]) => a.label.localeCompare(b.label)));
    await writeFileAtomic(indexPath, JSON.stringify(sorted, null, 2) + "\n");
  }
  return { removed: removedLabels, misnamed: plan.misnamed, unindexed: orphans, missingFiles: plan.missingFiles };
}
