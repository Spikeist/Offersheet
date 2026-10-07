/**
 * A clean copy of a commit's deployable files (planner reply to Checkpoint 7b, §2: production deploys "only the approved
 * launch tag … from a clean copy of that tag"; `npm run prod:deploy`, scripts/prod-deploy.ts). Not a worktree and not
 * the working tree: the blobs themselves, straight out of git.
 *
 * 1. The commit's own .vercelignore (`git cat-file blob <commit>:.vercelignore`) must be the allowlist, and its rules name the
 *    roots to copy (allowlistRoots: "/*", then only "!/<one name>" lines, no wildcards; anything else is refused rather
 *    than guessed at).
 * 2. `git --literal-pathspecs ls-tree -r -z -l <commit> -- <roots> .vercelignore` lists the files (parseLsTree), and
 *    exportProblems refuses anything that isn't a plain file (a symlink, a submodule), a path that could leave the copy
 *    (absolute, "..", "."), a name Windows can't hold (nul, con, aux, com1 …, `<>:"|?*`, control characters, a trailing dot
 *    or space, a backslash), and two paths that differ only in letter case (they'd collide on NTFS).
 * 3. One `git cat-file --batch` reads every blob (parseCatFileBatch), and each is written under the copy's folder: the
 *    commit's bytes exactly (no core.autocrlf conversion, no filters, no .git, no worktree record in the main repository).
 * 4. verifyCopy reads every file back and hashes it as git does (gitBlobId: sha1 of "blob <size>\0" + the bytes, or
 *    sha256 for a sha256 repository): each must be the commit's blob id, and the folder must hold nothing else. So the
 *    copy is byte for byte the commit, the "committed files only" rule made exact.
 *
 * Checked on checkpoint-7b (map of 2026-10-07): 440 files, 8.71 MB, every blob id equal, about 0.3 s; all mode 100644,
 * longest path 51 characters, so a copy under the system's temp folder stays far below Windows' 260-character limit.
 * Pure but for exportCommit (git and the file system, both passed in) and nodeCopyFs; tested in cleanCopy.test.ts.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** A file of a commit's tree, as `git ls-tree -r -z -l` lists it. */
export interface TreeEntry {
  mode: string;
  type: string;
  /** The blob id (40 hex characters, or 64 in a sha256 repository). */
  id: string;
  size: number;
  /** The path in the tree, with forward slashes. */
  path: string;
}

/** A git run: its exit status and output (stdout as bytes: the blobs are binary-safe). */
export interface GitResult {
  status: number;
  stdout: Buffer;
  stderr: string;
}

/** Runs git in the main folder with `args`; `input` goes to its stdin. */
export type GitRun = (args: readonly string[], input?: string) => GitResult;

/** The file system a copy is written to (nodeCopyFs; tests pass their own). */
export interface CopyFs {
  /** A new empty folder in the system's temp folder, its name starting with `prefix`. */
  makeTempDir(prefix: string): string;
  /** Writes a file, creating its folders. */
  writeFile(file: string, bytes: Uint8Array, mode: number): void;
  readFile(file: string): Buffer;
  /** Every file under `dir`, as paths relative to it with forward slashes. */
  listFiles(dir: string): string[];
  /** Removes a folder and everything in it (no error when it's gone). */
  removeDir(dir: string): void;
}

export const nodeCopyFs: CopyFs = {
  makeTempDir: (prefix) => mkdtempSync(path.join(tmpdir(), prefix)),
  writeFile: (file, bytes, mode) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes, { mode });
  },
  readFile: (file) => readFileSync(file),
  listFiles: (dir) => {
    const out: string[] = [];
    const walk = (d: string, rel: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), r);
        else out.push(r);
      }
    };
    walk(dir, "");
    return out;
  },
  // Defender can hold a just-written file for a moment: retry, as stable.ts does for its folders.
  removeDir: (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
};

/** One allowlist rule a copy can follow: "!/<name>", one path segment, no wildcards or escapes. */
const ROOT_RULE = /^!\/([A-Za-z0-9._-]+)$/;

/**
 * The roots an allowlist .vercelignore lets through ("/*", then "!/src", "!/package.json" …), or why it can't be followed:
 * not the allowlist, or a rule other than "!/<one name>" (a nested path, a wildcard, a negated folder pattern), which the
 * copy would have to interpret the way the CLI does. Comments and blank lines are skipped.
 */
export function allowlistRoots(ignoreText: string): { roots: string[] } | { error: string } {
  const rules = ignoreText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (rules[0] !== "/*") return { error: `its first rule is ${rules[0] === undefined ? "missing" : `"${rules[0]}"`}, not "/*" (ignore everything)` };
  const roots: string[] = [];
  for (const rule of rules.slice(1)) {
    const m = ROOT_RULE.exec(rule);
    const name = m?.[1];
    if (!name || name === "." || name === "..") return { error: `the rule "${rule}" isn't "!/<one name>" (a nested path, a wildcard or a pattern), so the copy can't follow it exactly` };
    if (!roots.includes(name)) roots.push(name);
  }
  if (!roots.length) return { error: "it lets nothing through" };
  return { roots };
}

/** `git ls-tree -r -z -l` output (entries "<mode> <type> <id> <size>\t<path>", each ended by NUL) as entries. */
export function parseLsTree(out: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const record of out.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) throw new Error("git ls-tree's output couldn't be read (an entry without a tab)");
    const [mode, type, id, size] = record.slice(0, tab).trim().split(/\s+/);
    if (!mode || !type || !id || size === undefined) throw new Error("git ls-tree's output couldn't be read (an entry without its four fields)");
    entries.push({ mode, type, id, size: size === "-" ? -1 : Number(size), path: record.slice(tab + 1) });
  }
  return entries;
}

/** Windows device names, as a whole name or before an extension (check-leaks.ts's RESERVED_NAMES). */
const RESERVED_NAME = /^(nul|con|prn|aux|com[1-9]|lpt[1-9])(\..*)?$/i;
/** Characters Windows doesn't allow in a name (and the backslash, a separator there); control characters are checked apart. */
const BAD_CHARS = /[<>:"|?*\\]/;

/** A path segment Windows can't hold as a file or folder name. */
function badSegment(s: string): boolean {
  return RESERVED_NAME.test(s) || BAD_CHARS.test(s) || /[. ]$/.test(s) || [...s].some((ch) => ch.charCodeAt(0) < 0x20);
}

/**
 * What keeps a commit's entries from being copied exactly (none: an empty list): see the header, step 2. At most a few
 * paths are named per problem; they're the project's own file names, never data.
 */
export function exportProblems(entries: readonly TreeEntry[]): string[] {
  const out: string[] = [];
  const say = (what: string, paths: string[]) => {
    if (paths.length) out.push(`${paths.length} ${what}, e.g. ${paths.slice(0, 3).join(", ")}`);
  };
  say("entries that aren't plain files (a symlink, a submodule)", entries.filter((e) => e.type !== "blob" || (e.mode !== "100644" && e.mode !== "100755")).map((e) => `${e.path} (${e.mode})`));
  say("ids that aren't git object ids", entries.filter((e) => !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(e.id)).map((e) => e.path));
  say(
    "paths that could leave the copy",
    entries.filter((e) => e.path.startsWith("/") || /^[A-Za-z]:/.test(e.path) || e.path.split("/").some((s) => s === "" || s === "." || s === "..")).map((e) => e.path),
  );
  say(
    "paths Windows can't hold",
    entries.filter((e) => e.path.split("/").some(badSegment)).map((e) => e.path),
  );
  const byLower = new Map<string, string[]>();
  for (const e of entries) byLower.set(e.path.toLowerCase(), [...(byLower.get(e.path.toLowerCase()) ?? []), e.path]);
  say("paths that differ only in letter case", [...byLower.values()].filter((p) => p.length > 1).map((p) => p.join(" and ")));
  return out;
}

/** A blob's git id: the hash of "blob <size>\0" and its bytes (sha1, or sha256 for a sha256 repository's 64-character ids). */
export function gitBlobId(bytes: Uint8Array, format: "sha1" | "sha256" = "sha1"): string {
  return createHash(format).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/**
 * `git cat-file --batch` output for `ids` (each "<id> blob <size>\n", its bytes, "\n"), as each id's bytes. Throws on
 * anything else (a missing object, another type, a short stream): a copy that isn't the commit must not go on.
 */
export function parseCatFileBatch(out: Buffer, ids: readonly string[]): Map<string, Buffer> {
  const blobs = new Map<string, Buffer>();
  let at = 0;
  for (const id of ids) {
    const nl = out.indexOf(0x0a, at);
    if (nl < 0) throw new Error("git cat-file's output ended early");
    const header = out.subarray(at, nl).toString("utf8");
    const [oid, type, size] = header.split(" ");
    if (oid !== id) throw new Error(`git cat-file answered for another object than ${id.slice(0, 12)}`);
    if (type !== "blob" || size === undefined || !/^\d+$/.test(size)) throw new Error(`git cat-file didn't give ${id.slice(0, 12)} as a blob (${type ?? "no type"})`);
    const start = nl + 1;
    const end = start + Number(size);
    if (end >= out.length || out[end] !== 0x0a) throw new Error(`git cat-file's output for ${id.slice(0, 12)} is cut short`);
    blobs.set(id, out.subarray(start, end));
    at = end + 1;
  }
  if (at !== out.length) throw new Error("git cat-file gave more than was asked for");
  return blobs;
}

/** A finished copy: the allowlist's roots and the files written. */
export interface ExportedCopy {
  roots: string[];
  entries: TreeEntry[];
  /** The files' total size in bytes. */
  bytes: number;
}

/** Why a copy couldn't be made (git, the allowlist, the entries, the blobs), in words. */
export class CleanCopyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CleanCopyError";
  }
}

function gitText(git: GitRun, args: readonly string[], what: string): string {
  const r = git(args);
  if (r.status !== 0) throw new CleanCopyError(`${what}: git answered with exit ${r.status}`);
  return r.stdout.toString("utf8");
}

/**
 * Writes `commit`'s deployable files into `dest` (an empty folder): the header's steps 1–3. Throws CleanCopyError when
 * the copy can't be made exactly; verifyCopy (step 4) is the caller's next step.
 */
export function exportCommit(opts: { git: GitRun; commit: string; dest: string; fs: CopyFs }): ExportedCopy {
  const { git, commit, dest, fs } = opts;
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) throw new CleanCopyError("the commit to copy isn't a full commit id");
  const ignore = gitText(git, ["cat-file", "blob", `${commit}:.vercelignore`], "reading the commit's .vercelignore");
  const allow = allowlistRoots(ignore);
  if ("error" in allow) throw new CleanCopyError(`the commit's .vercelignore isn't an allowlist the copy can follow: ${allow.error}`);
  const entries = parseLsTree(gitText(git, ["--literal-pathspecs", "ls-tree", "-r", "-z", "-l", commit, "--", ...allow.roots, ".vercelignore"], "listing the commit's files"));
  if (!entries.some((e) => e.path === ".vercelignore")) throw new CleanCopyError("the commit's file list doesn't hold .vercelignore");
  const problems = exportProblems(entries);
  if (problems.length) throw new CleanCopyError(`the commit's files can't be copied exactly: ${problems.join("; ")}`);
  const ids = [...new Set(entries.map((e) => e.id))];
  const batch = git(["cat-file", "--batch"], `${ids.join("\n")}\n`);
  if (batch.status !== 0) throw new CleanCopyError(`reading the commit's files: git cat-file answered with exit ${batch.status}`);
  let blobs: Map<string, Buffer>;
  try {
    blobs = parseCatFileBatch(batch.stdout, ids);
  } catch (err) {
    throw new CleanCopyError(`reading the commit's files: ${err instanceof Error ? err.message : String(err)}`);
  }
  let bytes = 0;
  for (const e of entries) {
    const blob = blobs.get(e.id);
    if (!blob) throw new CleanCopyError(`reading the commit's files: no bytes for ${e.path}`);
    fs.writeFile(path.join(dest, ...e.path.split("/")), blob, e.mode === "100755" ? 0o755 : 0o644);
    bytes += blob.length;
  }
  return { roots: allow.roots, entries, bytes };
}

/**
 * What differs between the copy in `dest` and the commit's entries (none: an empty list): a file whose bytes don't hash
 * to its blob id, a file missing, or a file the commit doesn't have (the header, step 4).
 */
export function verifyCopy(dest: string, entries: readonly TreeEntry[], fs: CopyFs): string[] {
  const out: string[] = [];
  const expected = new Map(entries.map((e) => [e.path, e]));
  let found: string[];
  try {
    found = fs.listFiles(dest);
  } catch {
    return ["the copy's folder couldn't be read"];
  }
  const extra = found.filter((p) => !expected.has(p));
  if (extra.length) out.push(`${extra.length} file(s) the commit doesn't have, e.g. ${extra.slice(0, 3).join(", ")}`);
  const present = new Set(found);
  const missing = entries.filter((e) => !present.has(e.path)).map((e) => e.path);
  if (missing.length) out.push(`${missing.length} file(s) missing, e.g. ${missing.slice(0, 3).join(", ")}`);
  const differ: string[] = [];
  for (const e of entries) {
    if (!present.has(e.path)) continue;
    try {
      const bytes = fs.readFile(path.join(dest, ...e.path.split("/")));
      if (gitBlobId(bytes, e.id.length === 64 ? "sha256" : "sha1") !== e.id) differ.push(e.path);
    } catch {
      differ.push(e.path);
    }
  }
  if (differ.length) out.push(`${differ.length} file(s) whose bytes aren't the commit's, e.g. ${differ.slice(0, 3).join(", ")}`);
  return out;
}
