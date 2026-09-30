/**
 * Remove sanitized fixtures a run no longer writes (a label that changed or was dropped): the file
 * AND its index.json entry, so a fixture folder has no orphans. Only labels under the given prefix are
 * touched; filenames are sha256(label) by construction (fixtures.ts). The probe calls this once per
 * folder (fixtures/sanitized/sleeper and the git-ignored data-local/fixtures-sanitized/sleeper) with the
 * labels it saved to that folder. Subfolders are never deleted (see shared/fixture-folders.ts).
 */
import { pruneFolder } from "../shared/fixture-folders";

export async function pruneStaleFixtures(dir: string, prefix: string, keep: ReadonlySet<string>): Promise<string[]> {
  return (await pruneFolder(dir, (label) => label.startsWith(prefix) && !keep.has(label))).removed;
}
