/**
 * The two sanitized-fixture folders a probe writes, after the planner's reply to Checkpoint 0
 * (answer 2). scripts/lib/fixtures.ts decides where each label goes (sanitizedDirFor):
 *
 *   fixtures/sanitized/<platform>/              committed: Parker's own leagues and public data
 *   data-local/fixtures-sanitized/<platform>/   git-ignored: FULL sanitized copies of strangers' leagues
 *   fixtures/sanitized/min/<platform>/<group>/  committed minimized copies (scripts/lib/minimize.ts)
 *
 * These helpers keep each probe's report wording and stale-fixture pruning right for both folders.
 * Nothing here ever deletes a subfolder, so the minimized fixtures are out of reach, and a prune of
 * the minimized tree itself is refused outright.
 */
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { sha256, writeFileAtomic } from "../cache";
import { ROOT } from "../env";
import { LOCAL_SANITIZED_DIR, SANITIZED_DIR, sanitizedDirFor } from "../fixtures";

/** Committed minimized fixtures (MIN_DIR in scripts/lib/minimize.ts): no prune may run inside it. */
export const MIN_FIXTURES_DIR = path.join(SANITIZED_DIR, "min");

/** A probe fixture file name: sha256(label) + extension. Unindexed files are only deleted when named like this. */
export const FIXTURE_FILE = /^[0-9a-f]{64}\.[a-z0-9]+$/;

export interface FixtureFolder {
  dir: string;
  /** Repo-relative with forward slashes (safe to print). */
  rel: string;
  committed: boolean;
}

const relOf = (dir: string) => path.relative(ROOT, dir).replace(/\\/g, "/");

/** Both folders for a platform: [committed, git-ignored]. */
export function fixtureFolders(platform: string): [FixtureFolder, FixtureFolder] {
  const committed = path.join(SANITIZED_DIR, platform);
  const local = path.join(LOCAL_SANITIZED_DIR, platform);
  return [
    { dir: committed, rel: relOf(committed), committed: true },
    { dir: local, rel: relOf(local), committed: false },
  ];
}

/** The folder a label is saved to (same rule as saveSanitizedFixture). */
export function folderOfLabel(platform: string, label: string): FixtureFolder {
  const dir = sanitizedDirFor(platform, label);
  const [committed, local] = fixtureFolders(platform);
  return path.resolve(dir) === path.resolve(committed.dir) ? committed : local;
}

/** The folder of a repo-relative path returned by saveSanitized, or undefined if it's in neither. */
export function folderOfPath(platform: string, savedPath: string): FixtureFolder | undefined {
  const dir = path.posix.dirname(savedPath.replace(/\\/g, "/"));
  return fixtureFolders(platform).find((f) => f.rel === dir);
}

/** Repo-relative paths split by folder (paths in neither folder are ignored). */
export function partitionPaths(platform: string, saved: Iterable<string>): { committed: string[]; local: string[] } {
  const out = { committed: [] as string[], local: [] as string[] };
  for (const s of saved) {
    const f = folderOfPath(platform, s);
    if (f) (f.committed ? out.committed : out.local).push(s.replace(/\\/g, "/"));
  }
  return out;
}

/** Labels split by the folder they're saved to. */
export function partitionLabels(platform: string, labels: Iterable<string>): { committed: string[]; local: string[] } {
  const out = { committed: [] as string[], local: [] as string[] };
  for (const l of labels) (folderOfLabel(platform, l).committed ? out.committed : out.local).push(l);
  return out;
}

/**
 * Report wording for where a run's sanitized fixtures went, e.g. "31 in fixtures/sanitized/espn
 * (committed) and 2 in data-local/fixtures-sanitized/espn (git-ignored: …)".
 */
export function whereSaved(platform: string, committed: number, local: number): string {
  const parts: string[] = [];
  if (committed || !local) parts.push(`${committed} in fixtures/sanitized/${platform} (committed)`);
  if (local) parts.push(`${local} in data-local/fixtures-sanitized/${platform} (git-ignored: strangers' public leagues; tests use minimized copies in fixtures/sanitized/min/${platform}/)`);
  return parts.join(" and ");
}

/** Throws when `dir` is the minimized-fixture tree or inside it (those files are never pruned). */
export function assertPrunable(dir: string): void {
  const r = path.relative(path.resolve(MIN_FIXTURES_DIR), path.resolve(dir));
  if (r === "" || (!r.startsWith("..") && !path.isAbsolute(r))) throw new Error(`refusing to prune ${relOf(dir)}: minimized fixtures are never pruned`);
}

/** True for a plain file name (no folder part), so an index key can never point outside its folder. */
export function isPlainName(name: string): boolean {
  return name.length > 0 && name !== "." && name !== ".." && path.basename(name) === name && !/[\\/]/.test(name);
}

interface IndexEntry {
  label?: unknown;
  [key: string]: unknown;
}

export interface FolderPrune {
  /** Repo-relative folder. */
  folder: string;
  /** Labels of stale index entries: entry dropped, file deleted when present. */
  removed: string[];
  /** Fixture-named files (sha256 + ext) with no index entry, deleted (only with removeOrphans). */
  orphans: string[];
  /** Kept entries whose file name isn't sha256(label) + ext. */
  misnamed: string[];
  /** Kept entries whose file is missing. */
  missingFiles: string[];
}

/**
 * Prune one fixture folder: drop the index entries `isStale(label, file)` marks, with their files,
 * and — with removeOrphans, and only when the folder has an index — files named like a fixture
 * that no entry lists. Never deletes index.json, subfolders or files named otherwise; refuses the
 * minimized-fixture tree. A missing folder or index.json means nothing indexed to prune.
 */
export async function pruneFolder(dir: string, isStale: (label: string, file: string) => boolean, opts: { removeOrphans?: boolean } = {}): Promise<FolderPrune> {
  assertPrunable(dir);
  const out: FolderPrune = { folder: relOf(dir), removed: [], orphans: [], misnamed: [], missingFiles: [] };
  let files: Set<string>;
  try {
    files = new Set((await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name));
  } catch {
    return out; // no folder yet
  }
  const indexPath = path.join(dir, "index.json");
  let index: Record<string, IndexEntry>;
  try {
    index = JSON.parse(await readFile(indexPath, "utf8")) as Record<string, IndexEntry>;
  } catch {
    return out; // no index: nothing can be matched to a label, so nothing is removed
  }
  const indexed = new Set(Object.keys(index));
  let changed = false;
  for (const [file, e] of Object.entries(index)) {
    const label = typeof e?.label === "string" ? e.label : file;
    if (isStale(label, file)) {
      if (isPlainName(file) && file !== "index.json" && files.has(file)) await rm(path.join(dir, file), { force: true });
      delete index[file];
      changed = true;
      out.removed.push(label);
      continue;
    }
    if (file !== `${sha256(label)}${path.extname(file)}`) out.misnamed.push(label);
    if (!files.has(file)) out.missingFiles.push(label);
  }
  if (opts.removeOrphans) {
    for (const f of files) {
      if (f === "index.json" || indexed.has(f) || !FIXTURE_FILE.test(f)) continue;
      await rm(path.join(dir, f), { force: true });
      out.orphans.push(f);
    }
  }
  if (changed) {
    const label = (e: IndexEntry | undefined) => (typeof e?.label === "string" ? e.label : "");
    const sorted = Object.fromEntries(Object.entries(index).sort(([, a], [, b]) => label(a).localeCompare(label(b))));
    await writeFileAtomic(indexPath, JSON.stringify(sorted, null, 2) + "\n");
  }
  return out;
}

export interface PruneOptions {
  /** Labels this run is responsible for (default: all); entries of other labels are never touched. */
  owns?: (label: string) => boolean;
  removeOrphans?: boolean;
}

/**
 * Prune each folder so it keeps exactly what this run wrote there: an entry is stale when
 * `owns(label)` and its file in THAT folder isn't among `saved` (repo-relative paths from
 * saveSanitized, compared as `${folder.rel}/${file}`).
 */
export async function pruneFolders(folders: readonly FixtureFolder[], saved: Iterable<string>, opts: PruneOptions = {}): Promise<FolderPrune[]> {
  const kept = new Set([...saved].map((s) => s.replace(/\\/g, "/")));
  const owns = opts.owns ?? (() => true);
  const out: FolderPrune[] = [];
  for (const f of folders) out.push(await pruneFolder(f.dir, (label, file) => owns(label) && !kept.has(`${f.rel}/${file}`), { removeOrphans: opts.removeOrphans }));
  return out;
}

/**
 * Prune a probe's fixtures in BOTH of its folders (pruneFolders). A stranger's stale copy in the
 * committed folder is therefore always removed, even when the same label was saved to the
 * git-ignored folder this run.
 */
export function pruneBothFolders(platform: string, saved: Iterable<string>, opts: PruneOptions = {}): Promise<FolderPrune[]> {
  return pruneFolders(fixtureFolders(platform), saved, opts);
}

export interface FolderStats extends FixtureFolder {
  /** Files listed in the folder's index.json that exist. */
  files: number;
  bytes: number;
  largest: number;
}

/** Size of the indexed fixtures in both folders (a folder without index.json counts as empty). */
export async function folderStats(platform: string, folders: readonly FixtureFolder[] = fixtureFolders(platform)): Promise<FolderStats[]> {
  const out: FolderStats[] = [];
  for (const f of folders) {
    const s: FolderStats = { ...f, files: 0, bytes: 0, largest: 0 };
    let index: Record<string, unknown> = {};
    try {
      index = JSON.parse(await readFile(path.join(f.dir, "index.json"), "utf8")) as Record<string, unknown>;
    } catch {
      // no folder or no index yet
    }
    for (const name of Object.keys(index)) {
      if (!isPlainName(name)) continue;
      try {
        const st = await stat(path.join(f.dir, name));
        if (!st.isFile()) continue;
        s.files++;
        s.bytes += st.size;
        s.largest = Math.max(s.largest, st.size);
      } catch {
        // listed but missing
      }
    }
    out.push(s);
  }
  return out;
}
