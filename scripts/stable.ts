/**
 * npm run stable — Parker's stable copy of Offer Sheet (planner reply to Checkpoint 4c, A1: "a copy that in-progress work
 * can't break"). He uses the app every week while development goes on in this folder, so the copy he uses runs the latest
 * checkpoint, from its own folder, on the port his saved leagues live under.
 *
 *   npm run stable                     update the copy to the latest checkpoint, then serve it at http://127.0.0.1:3000
 *   npm run stable -- --no-serve       update only
 *   npm run stable -- --stay           serve the copy as it is (no update)
 *   npm run stable -- --ref <tag>      another checkpoint than the latest (any tag or commit)
 *   npm run stable -- --port <n>       another port (testing: Parker's saved leagues, settings and feedback are the
 *                                      browser's for http://127.0.0.1:3000 only)
 *   npm run stable -- --dir <folder>   another folder (testing)
 *
 * When the "--" is left out (`npm run stable --stay`), or a shell drops it, npm keeps the options as its own settings
 * (npm_config_stay …): they're read from there too (parseStableArgs), so both forms work. ⚠️ At a PowerShell prompt npm
 * 10's npm.ps1 keeps the "--" (seen with npm 10.9.3 on Windows PowerShell 5.1); it drops it when npm runs from piped
 * input or `powershell -File` (it then passes PowerShell's own arguments), as npm.ps1 files before npm 10 always did.
 *
 * What it does, in order (main):
 * 1. The main folder is the one this script lives in (MAIN_ROOT: its scripts/ folder's parent). Run from the stable copy
 *    itself it stops: its npm ci would have to replace the node_modules it runs from.
 * 2. The lock: one run at a time per copy (takeLock: a named pipe on Windows, a socket file elsewhere, held while this run
 *    lives; the system removes a pipe when its process ends, however it ends, so a run that was killed never leaves it
 *    behind). A second `npm run stable` while one installs, builds or serves stops before touching anything: two runs
 *    would run npm ci or next build in the same folder at once, and a build spoiled by the other could be recorded as
 *    good. --help takes no lock.
 * 3. The port: something already listening there (the stable copy, or a development server from before this change)
 *    stops it before anything is touched, so an update never pulls files from under a running server. --no-serve with
 *    --stay doesn't move the copy and skips the check (while a run serves the copy, the lock has stopped it already).
 * 4. The checkpoint: the newest commit tagged checkpoint-* (git for-each-ref refs/tags/checkpoint-*; the lead tags each
 *    checkpoint commit), by commit time, ties to the later tag name (latestCheckpoint); or --ref.
 * 5. The worktree: the sibling folder <main>-stable (stableDirOf: D:\Source Code\VS Code\fantasy-trade-finder-stable),
 *    created with `git -c core.longpaths=true worktree add --detach` (MAX_PATH: long fixture names); then every run
 *    (but --stay) checks it out again with a forced detached checkout of the checkpoint (worktreePlan): moving it to a
 *    newer checkpoint, and restoring any tracked file that's missing or changed (cheap when nothing is). Untracked files
 *    (node_modules, .next, .env.local) stay. A copy an earlier run left unfinished (stopped while git created it: git's
 *    record is locked "initializing", its files partly there, git's index.lock left behind) is unlocked and finished the
 *    same way, the lock files a stopped git left removed first (clearStaleGitLocks); when its folder is gone, or empty,
 *    git's record of it is unlocked and cleared and the copy created again. A folder there that isn't this repo's
 *    worktree is never touched. --stay leaves the copy on its commit (an unfinished one: stop, run without --stay).
 * 6. .env.local: copied from the main folder every run, as a file (never read or printed here). Missing: a warning, and
 *    the copy keeps the one from the last run, if any.
 * 7. `npm ci` only when package-lock.json changed since the last install (installPlan: a marker in node_modules/ holds
 *    the lock file's sha256), `npm run build` only when the commit changed since the last build (buildPlan: a marker in
 *    .next/ holds the commit), or when either is missing. npm runs through Node (npm-cli.js: no shell) with the copy as
 *    its folder and none of the parent npm's per-run variables (childEnv; a precaution: npm 10 works out its folder from
 *    the working directory even when npm_config_local_prefix names the main folder, checked with `npm prefix`);
 *    `npm ci --include=dev --prefer-offline`, telemetry off.
 * 8. Serves `next start -H 127.0.0.1 -p 3000` from the copy (serveEnv): OFFERSHEET_DATA_LOCAL = the main folder's
 *    data-local/, so the projection snapshots and FantasyCalc lists land with the development copy's
 *    (src/server/projectionArchive.ts turns the archives on for it); OFFERSHEET_CACHE_DIR = the main folder's .cache/app,
 *    one shared file cache (src/app/api/_lib/deps.ts: raw responses only, written atomically; FantasyCalc stays at one
 *    fetch a day per format; an entry of another shape or format, written by another version of the code, is a miss
 *    there, never an error: src/server/http.ts CACHE_FORMAT); never the scripts' offline guard (NETWORK_ENV). Ctrl+C
 *    stops it.
 * Development moves to port 3001 (`npm run dev`), so 127.0.0.1:3000 belongs to the stable copy.
 *
 * Friendly errors (no checkpoint tag, another run going on, the port in use, a folder that isn't the copy, git or npm
 * failing): exit 1. The pure parts (parseStableArgs, parseTagRefs, latestCheckpoint, parseWorktreeList, findWorktree,
 * worktreePlan, stableDirOf, lockAddress, installPlan, buildPlan, childEnv, serveEnv, npmCliPath) are tested in
 * stable.test.ts without git or the network, and so are the lock (takeLock, across processes) and clearStaleGitLocks.
 *
 * `npm run stable` runs this folder's own copy of this script (the development folder's), so it imports only Node's
 * built-ins and two dependency-free modules of this folder (scripts/lib/runMode.ts, scripts/check-browser/chrome.ts):
 * nothing of the app (src/) or its packages, which work in progress could break. stable.test.ts checks the import graph.
 * ⚠️ This script itself, those two modules and tsx (which runs it, from this folder's node_modules) still come from the
 * development folder, so work on them can still break the start command. The copy it serves is the checkpoint's own code.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exited, killTree } from "./check-browser/chrome";
import { canonicalPath, isMainModule, npmFlag, samePath, type Env } from "./lib/runMode";

/** The main folder: the one this script lives in (its scripts/ folder's parent), wherever it's started from. */
export const MAIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where Parker's browser keeps his saved leagues, settings and feedback (per origin): the stable copy's address. */
export const STABLE_HOST = "127.0.0.1";
export const STABLE_PORT = 3000;
/** The checkpoint tags (the lead tags each checkpoint commit). */
export const TAG_REFS = "refs/tags/checkpoint-*";
/**
 * The variables the copy's server reads, named here rather than imported (stable.test.ts checks each against its module):
 * this script runs from the development folder, so it imports nothing of the app that work in progress could break. The
 * file cache's folder (src/app/api/_lib/deps.ts CACHE_DIR_ENV), the archives' folder (src/server/projectionArchive.ts
 * DATA_LOCAL_ENV), the scripts' offline guard (src/server/http.ts NETWORK_ENV).
 */
export const CACHE_DIR_ENV = "OFFERSHEET_CACHE_DIR";
export const DATA_LOCAL_ENV = "OFFERSHEET_DATA_LOCAL";
export const NETWORK_ENV = "OFFERSHEET_NETWORK";
/** The markers (step 7), inside folders npm ci and next build replace, so a missing folder also means "do it again". */
export const INSTALL_MARKER = path.join("node_modules", ".offersheet-stable-install.json");
export const BUILD_MARKER = path.join(".next", "offersheet-stable-build.json");

export const USAGE = [
  "The stable copy of Offer Sheet: the latest checkpoint, in its own folder, at http://127.0.0.1:3000.",
  "",
  "In PowerShell:",
  '  cd "D:\\Source Code\\VS Code\\fantasy-trade-finder"',
  "  npm run stable",
  "",
  "That updates the copy to the latest checkpoint (installing and building only when needed), then serves it. Keep the",
  "window open while you use the app; Ctrl+C stops it. To update later: stop it, then run npm run stable again.",
  "",
  "Options (testing):",
  "  --no-serve       update only",
  "  --stay           serve the copy as it is (no update)",
  "  --ref <tag>      another checkpoint than the latest (any tag or commit)",
  "  --port <n>       another port (your saved leagues live under port 3000)",
  "  --dir <folder>   another folder (default: the main folder's name + -stable, next to it)",
  "  --help           this text",
].join("\n");

/** A failure the script explains in words (exit 1). */
export class StableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StableError";
  }
}

// ---------------------------------------------------------------------------------------------
// The command line (pure)

export interface StableArgs {
  port: number;
  serve: boolean;
  stay: boolean;
  ref: string | null;
  dir: string | null;
  help: boolean;
}

/** A tag or commit we pass to git: no leading "-" (never an option), nothing a shell would care about. */
const REF = /^[A-Za-z0-9][A-Za-z0-9._/^~-]{0,199}$/;
const VALUE_FLAGS = ["port", "ref", "dir"] as const;
type ValueFlag = (typeof VALUE_FLAGS)[number];

function setValue(args: StableArgs, flag: ValueFlag, raw: string | null | undefined): string | null {
  const v = raw?.trim();
  if (flag === "port") {
    const n = Number(v);
    if (!v || !Number.isInteger(n) || n < 1 || n > 65535) return "--port needs a port number, for example --port 3005.";
    args.port = n;
  } else if (flag === "ref") {
    if (!v || !REF.test(v)) return "--ref needs a tag or commit, for example --ref checkpoint-4c.";
    args.ref = v;
  } else {
    if (!v) return "--dir needs a folder.";
    args.dir = v;
  }
  return null;
}

/**
 * The options (pure): the command line's, then what npm kept for itself when the "--" was left out or dropped (npm_config_stay
 * "true", npm_config_serve "" or "false" for --no-serve, npm_config_port "3005" for --port=3005; for --port 3005,
 * npm_config_port "true" and a stray "3005", which goes back to the one option that lost its value). The command line wins.
 */
export function parseStableArgs(argv: readonly string[], env: Env = {}): StableArgs | { error: string } {
  const args: StableArgs = { port: STABLE_PORT, serve: true, stay: false, ref: null, dir: null, help: false };
  const given = new Set<string>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (!a.startsWith("-")) {
      positionals.push(a);
      continue;
    }
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    const inline = eq > 0 ? a.slice(eq + 1) : undefined;
    const value = (): string | null => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return null;
      i++;
      return next;
    };
    switch (flag) {
      case "--port":
      case "--ref":
      case "--dir": {
        const name = flag.slice(2) as ValueFlag;
        const error = setValue(args, name, value());
        if (error) return { error };
        given.add(name);
        break;
      }
      case "--no-serve":
        args.serve = false;
        break;
      case "--stay":
        args.stay = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        return { error: `Unknown option: ${a}. Run npm run stable -- --help for the options.` };
    }
  }
  if (npmFlag(env, "stay") === "true") args.stay = true;
  const serve = npmFlag(env, "serve");
  if (serve === "" || serve === "false" || npmFlag(env, "no-serve") === "true") args.serve = false;
  const lost = VALUE_FLAGS.filter((f) => npmFlag(env, f) === "true" && !given.has(f));
  if (lost.length === 1 && positionals.length === 1) {
    const error = setValue(args, lost[0] as ValueFlag, positionals.shift());
    if (error) return { error };
    given.add(lost[0] as ValueFlag);
  }
  if (positionals.length) {
    const why = lost.length ? ` npm kept ${lost.map((f) => `--${f}`).join(" and ")} for itself: write it as --${lost[0]}=<value>.` : "";
    return { error: `Unexpected argument: ${positionals[0]}.${why} Run npm run stable -- --help for the options.` };
  }
  for (const f of VALUE_FLAGS) {
    const v = npmFlag(env, f);
    if (given.has(f) || v === undefined || v === "true") continue;
    const error = setValue(args, f, v);
    if (error) return { error };
  }
  return args;
}

// ---------------------------------------------------------------------------------------------
// Checkpoints and the worktree (pure)

export interface TagInfo {
  name: string;
  /** The tagged commit (an annotated tag peeled). */
  commit: string;
  /** Its commit time (Unix seconds). */
  time: number;
  /**
   * An annotated tag (`git tag -a`: a tag object), not a lightweight one; parseTagRefs always sets it. npm run prod:deploy
   * deploys only an annotated checkpoint tag (Checkpoint 7c); the stable copy takes either.
   */
  annotated?: boolean;
}

/** The for-each-ref format parseTagRefs reads: name, type, object, commit time, then the same peeled (annotated tags). */
export const TAG_FORMAT = "%(refname:strip=2)%09%(objecttype)%09%(objectname)%09%(committerdate:unix)%09%(*objecttype)%09%(*objectname)%09%(*committerdate:unix)";

/** The tags of `git for-each-ref --format=TAG_FORMAT` that point at commits (lightweight, or annotated and peeled). */
export function parseTagRefs(text: string): TagInfo[] {
  const out: TagInfo[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name, type, object, date, peeledType, peeled, peeledDate] = line.split("\t");
    const commit = type === "commit" ? object : peeledType === "commit" ? peeled : undefined;
    const time = Number(type === "commit" ? date : peeledDate);
    if (!name || !commit || !/^[0-9a-f]{40,64}$/.test(commit) || !Number.isFinite(time)) continue;
    out.push({ name, commit, time, annotated: type === "tag" });
  }
  return out;
}

const byName = new Intl.Collator("en", { numeric: true });

/** The newest tagged commit by commit time; ties (two tags, or two commits of one second) go to the later tag name, numbers compared as numbers. */
export function latestCheckpoint(tags: readonly TagInfo[]): TagInfo | null {
  let best: TagInfo | null = null;
  for (const t of tags) if (!best || t.time > best.time || (t.time === best.time && byName.compare(t.name, best.name) > 0)) best = t;
  return best;
}

export interface WorktreeInfo {
  path: string;
  head: string | null;
  prunable: boolean;
  /**
   * Why git keeps it locked ("" without a reason), or null when it isn't: UNFINISHED_LOCK while `git worktree add` fills
   * it, and still so when that run was stopped; a reason of one's own after `git worktree lock`.
   */
  locked: string | null;
}

/**
 * The reason `git worktree add` locks a worktree with while it fills it (git's worktree.c; ⚠️ git translates it, so
 * under another language a copy left unfinished reads as locked by hand: it's still checked out again, just not
 * unlocked or called unfinished).
 */
export const UNFINISHED_LOCK = "initializing";

/** `git worktree list --porcelain`: each worktree's folder, HEAD, whether git calls it prunable (its folder is gone) and its lock. */
export function parseWorktreeList(text: string): WorktreeInfo[] {
  const out: WorktreeInfo[] = [];
  let cur: WorktreeInfo | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice("worktree ".length), head: null, prunable: false, locked: null };
      out.push(cur);
    } else if (cur && line.startsWith("HEAD ")) cur.head = line.slice("HEAD ".length).trim();
    else if (cur && (line === "prunable" || line.startsWith("prunable "))) cur.prunable = true;
    else if (cur && (line === "locked" || line.startsWith("locked "))) cur.locked = line.slice("locked".length).trim();
  }
  return out;
}

/** The worktree registered at `dir`, if any (paths compared as the file system has them: runMode.samePath). */
export function findWorktree(list: readonly WorktreeInfo[], dir: string, same: (a: string, b: string) => boolean = samePath): WorktreeInfo | null {
  return list.find((w) => same(w.path, dir)) ?? null;
}

/** The copy's folder as step 5 sees it (folderState). */
export interface FolderState {
  exists: boolean;
  /** An existing folder with nothing in it (a file there isn't empty). */
  empty: boolean;
  /** It holds .git, the file git writes into a worktree first: a working copy, finished or not. */
  workingCopy: boolean;
}

export type WorktreeStep =
  /** git worktree add; first, when git still has a record of a copy there (`clearRecord`), git worktree unlock and prune. */
  | { do: "create"; clearRecord: boolean }
  /** The checkpoint checked out again, forced and detached; first git worktree unlock when an earlier run left it unfinished. */
  | { do: "checkout"; unfinished: boolean }
  /** --stay: the copy as it is. */
  | { do: "stay" }
  | { do: "refuse"; message: string };

/**
 * Step 5's decision (pure): from the folder, git's record of a worktree there (`found`) and --stay.
 * - No folder, or an empty one: created (git worktree add takes an empty folder); a record git still holds (a copy
 *   deleted, or one stopped while git created it, whose lock makes git worktree prune skip it) is unlocked and cleared
 *   first.
 * - A folder git doesn't know as this repository's worktree: never touched.
 * - A registered folder without .git (stopped before git wrote it) but with something in it: refused, saying to delete it
 *   (the next run then creates the copy again).
 * - Otherwise the checkpoint is checked out again every run, forced and detached: it moves the copy to a newer checkpoint,
 *   puts back any tracked file that's missing or changed, and finishes a copy an earlier run left unfinished (locked
 *   UNFINISHED_LOCK: unlocked first). --stay leaves the copy as it is, unless it's unfinished (refused: run without
 *   --stay).
 */
export function worktreePlan(o: { dir: string; folder: FolderState; found: WorktreeInfo | null; stay: boolean }): WorktreeStep {
  const { dir, folder, found, stay } = o;
  if (!folder.exists || (folder.empty && !folder.workingCopy)) {
    if (stay) return { do: "refuse", message: `There's no stable copy in ${dir} yet: run npm run stable (without --stay) first.` };
    return { do: "create", clearRecord: found !== null };
  }
  if (!found) return { do: "refuse", message: `${dir} exists but isn't this repository's stable copy (git worktree list doesn't know it). Move or rename that folder, then run npm run stable again.` };
  if (!folder.workingCopy) return { do: "refuse", message: `${dir} is an unfinished stable copy (git has a record of it, but the folder isn't a working copy). Delete that folder, then run npm run stable again.` };
  const unfinished = found.locked === UNFINISHED_LOCK;
  if (stay) return unfinished ? { do: "refuse", message: `The stable copy in ${dir} is unfinished (an earlier run stopped while creating it): run npm run stable without --stay to finish it.` } : { do: "stay" };
  return { do: "checkout", unfinished };
}

/**
 * Git's own lock files in a worktree's folder of .git (`git rev-parse --git-dir` there: <main>/.git/worktrees/<name>). A git
 * stopped mid-way leaves them behind: a killed `git worktree add` leaves index.lock (seen in a sandbox: killed 5–400 ms in,
 * every time), a killed checkout index.lock or HEAD.lock, and git then refuses every checkout there.
 */
export const GIT_LOCK_FILES = ["index.lock", "HEAD.lock"] as const;
/** A git lock file this old is left over from a git that was stopped: in the copy git holds one well under a second. */
export const STALE_GIT_LOCK_MS = 10_000;

/**
 * Step 5: removes GIT_LOCK_FILES a stopped git left in `gitDir`; returns the ones removed. One at least STALE_GIT_LOCK_MS
 * old goes at once; a younger one may belong to a git running right now (an editor's git status), so it's waited for, and
 * removed only if it's still there once that time has passed (`onWait` hears of each wait). Safe while this run holds the
 * stable copy's lock (step 2): no other run of this script works in the copy. `now` and `sleep` are for tests.
 */
export async function clearStaleGitLocks(
  gitDir: string,
  opts: { now?: () => number; sleep?: (ms: number) => Promise<void>; onWait?: (name: string) => void } = {},
): Promise<string[]> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const removed: string[] = [];
  for (const name of GIT_LOCK_FILES) {
    const file = path.join(gitDir, name);
    const deadline = now() + STALE_GIT_LOCK_MS;
    let waiting = false;
    for (;;) {
      let mtime: number;
      try {
        mtime = statSync(file).mtimeMs;
      } catch {
        break; // not there, or gone meanwhile
      }
      if (now() - mtime >= STALE_GIT_LOCK_MS || now() >= deadline) {
        rmSync(file, { force: true });
        removed.push(name);
        break;
      }
      if (!waiting) opts.onWait?.(name);
      waiting = true;
      await sleep(250);
    }
  }
  return removed;
}

/**
 * The lock's address (step 2), one per copy folder (pure): a named pipe on Windows (\\.\pipe\offersheet-stable-<id>), a
 * socket file in the temporary folder elsewhere; <id> = the first 16 hex digits of the sha256 of the folder as the file
 * system has it (runMode.canonicalPath), so two spellings of one folder share it.
 */
export function lockAddress(dir: string, platform: NodeJS.Platform = process.platform, tmp: string = tmpdir()): string {
  const id = createHash("sha256").update(canonicalPath(dir)).digest("hex").slice(0, 16);
  return platform === "win32" ? `\\\\.\\pipe\\offersheet-stable-${id}` : path.posix.join(tmp, `offersheet-stable-${id}.sock`);
}

/** The stable copy's folder: next to the main folder, with "-stable" after its name. */
export function stableDirOf(mainRoot: string): string {
  const root = path.resolve(mainRoot);
  return path.join(path.dirname(root), `${path.basename(root)}-stable`);
}

/** Whether `inner` is `outer` or inside it (canonical paths). */
export function isInside(inner: string, outer: string): boolean {
  const rel = path.relative(canonicalPath(outer), canonicalPath(inner));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// ---------------------------------------------------------------------------------------------
// Install and build (pure)

export interface InstallMarker {
  lockSha256: string;
  installedAt: string;
}

export interface BuildMarker {
  commit: string;
  builtAt: string;
}

export interface Plan {
  run: boolean;
  why: string;
}

/** npm ci only when package-lock.json changed since the last install, or node_modules or the marker is missing. */
export function installPlan(o: { lockSha256: string; marker: InstallMarker | null; nextInstalled: boolean }): Plan {
  if (!o.nextInstalled) return { run: true, why: "the packages aren't installed yet" };
  if (!o.marker) return { run: true, why: "there's no record of the last install" };
  if (o.marker.lockSha256 !== o.lockSha256) return { run: true, why: "package-lock.json changed since the last install" };
  return { run: false, why: "package-lock.json is unchanged since the last install" };
}

/** npm run build only when the commit changed since the last build, or the build or the marker is missing. */
export function buildPlan(o: { commit: string; marker: BuildMarker | null; buildIdExists: boolean }): Plan {
  if (!o.buildIdExists) return { run: true, why: "there's no production build yet" };
  if (!o.marker) return { run: true, why: "there's no record of the last build" };
  if (o.marker.commit !== o.commit) return { run: true, why: `the checkpoint changed since the last build (${o.marker.commit.slice(0, 7)} → ${o.commit.slice(0, 7)})` };
  return { run: false, why: `already built for ${o.commit.slice(0, 7)}` };
}

/** The sha256 of a file's bytes (the lock file). */
export function fileSha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** A marker read back, or null when it's missing or not ours. */
export function readInstallMarker(file: string): InstallMarker | null {
  const m = readJson<Partial<InstallMarker>>(file);
  return m && typeof m.lockSha256 === "string" && typeof m.installedAt === "string" ? { lockSha256: m.lockSha256, installedAt: m.installedAt } : null;
}

export function readBuildMarker(file: string): BuildMarker | null {
  const m = readJson<Partial<BuildMarker>>(file);
  return m && typeof m.commit === "string" && typeof m.builtAt === "string" ? { commit: m.commit, builtAt: m.builtAt } : null;
}

// ---------------------------------------------------------------------------------------------
// The child processes' environment (pure)

/**
 * The environment for npm in the copy: this one without the scripts' offline guard, without the parent npm's per-run
 * variables (npm_config_local_prefix, npm_package_*, npm_lifecycle_*, npm_command, INIT_CWD: they name the main folder;
 * a precaution, since npm 10 takes its folder from the working directory anyway), without our own options npm kept
 * (npm_config_port …), without NODE_ENV (production would make npm ci skip the dev packages the build needs; next build
 * sets its own), telemetry off.
 */
export function childEnv(base: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    const key = k.toLowerCase();
    if (k === NETWORK_ENV || key === "node_env" || key === "init_cwd" || key === "npm_command") continue;
    if (/^npm_(package_|lifecycle_)/.test(key) || key === "npm_config_local_prefix") continue;
    if (/^npm_config_(port|ref|dir|stay|serve|no_serve|help|live)$/.test(key)) continue;
    out[k] = v;
  }
  out.NEXT_TELEMETRY_DISABLED = "1";
  return out;
}

/** The server's environment: childEnv, production, and the main folder's data-local/ and file cache (step 8). */
export function serveEnv(base: Env, mainRoot: string): Record<string, string> {
  return {
    ...childEnv(base),
    NODE_ENV: "production",
    [DATA_LOCAL_ENV]: path.join(mainRoot, "data-local"),
    [CACHE_DIR_ENV]: path.join(mainRoot, ".cache", "app"),
  };
}

/** npm's own CLI script, so npm runs through Node without a shell: npm_execpath when it is npm-cli.js (npx's isn't), else the one next to Node. */
export function npmCliPath(env: Env, nodePath: string, exists: (p: string) => boolean = existsSync): string | null {
  const fromNpm = env.npm_execpath;
  if (fromNpm && path.basename(fromNpm).toLowerCase() === "npm-cli.js" && exists(fromNpm)) return fromNpm;
  const nextToNode = path.join(path.dirname(nodePath), "node_modules", "npm", "bin", "npm-cli.js");
  return exists(nextToNode) ? nextToNode : null;
}

// ---------------------------------------------------------------------------------------------
// The work (git, npm, the server)

function say(line: string): void {
  console.log(line);
}

/** Runs git; its output, or a StableError with git's own last lines (paths only: nothing secret goes through git here). */
function git(args: readonly string[], cwd: string, what: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new StableError(`git couldn't run (${r.error.message}). Is Git for Windows installed?`);
  if (r.status !== 0) {
    const tail = `${r.stderr ?? ""}${r.stdout ?? ""}`.trim().split(/\r?\n/).slice(-6).join("\n  ");
    throw new StableError(`${what} failed (git exited ${r.status}).${tail ? `\n  ${tail}` : ""}`);
  }
  return r.stdout ?? "";
}

function gitTry(args: readonly string[], cwd: string): string | null {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return !r.error && r.status === 0 ? (r.stdout ?? "").trim() : null;
}

function npm(cli: string, args: readonly string[], cwd: string, what: string): void {
  // A plain record: NODE_ENV is left out on purpose (childEnv), which Next's ProcessEnv type doesn't allow for.
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, env: childEnv(process.env) as NodeJS.ProcessEnv, stdio: "inherit", windowsHide: false });
  if (r.error) throw new StableError(`${what} couldn't start (${r.error.message}).`);
  if (r.signal) throw new StableError(`${what} was stopped.`);
  if (r.status !== 0) throw new StableError(`${what} failed (npm exited ${r.status}): see its output above. Fix it, then run npm run stable again.`);
}

/** A local server listening at `address` (a pipe or socket path), or the error that stopped it. */
function listenAt(address: string): Promise<net.Server | NodeJS.ErrnoException> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.destroy());
    server.once("error", (err: NodeJS.ErrnoException) => resolve(err));
    server.listen(address, () => resolve(server));
  });
}

/** Whether a run answers at `address` (a socket file left by a run that died answers nobody). */
function answersAt(address: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(address);
    const done = (v: boolean) => {
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(1_000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export type LockResult =
  /** This run holds the lock (closed when the run ends). */
  | { server: net.Server }
  /** Another run holds it. */
  | { busy: true }
  /** It couldn't be taken for another reason (the error's code): the run goes on without it, with a warning. */
  | { unavailable: string };

/**
 * Step 2: takes the lock at `address` (lockAddress): a local server listening there for as long as this process lives
 * (unref'd: it never keeps the process alive). The system closes a named pipe when its process ends, however it ends
 * (Ctrl+C, a crash, Task Manager, a restart), so a run that was killed never leaves the lock behind; elsewhere than
 * Windows a socket file can stay behind, and one that nobody answers is removed first (⚠️ that branch isn't exercised on
 * Windows, Parker's system). Any other failure doesn't stop the start command: the run goes on unlocked (⚠️ our call).
 */
export async function takeLock(address: string): Promise<LockResult> {
  let got = await listenAt(address);
  if (!(got instanceof net.Server) && got.code === "EADDRINUSE" && !address.startsWith("\\\\") && !(await answersAt(address))) {
    rmSync(address, { force: true });
    got = await listenAt(address);
  }
  if (got instanceof net.Server) {
    got.unref();
    return { server: got };
  }
  return got.code === "EADDRINUSE" ? { busy: true } : { unavailable: got.code ?? got.name };
}

/** Something listens on the port: a connection is accepted, or the port can't be taken. */
export async function portBusy(port: number, host: string = STABLE_HOST): Promise<boolean> {
  const answers = await new Promise<boolean>((resolve) => {
    const socket = net.connect({ port, host });
    const done = (v: boolean) => {
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(1_000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
  if (answers) return true;
  return new Promise<boolean>((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", () => resolve(true));
    srv.listen(port, host, () => srv.close(() => resolve(false)));
  });
}

interface Target {
  label: string;
  commit: string;
  time: number | null;
}

function checkpointTarget(mainRoot: string, ref: string | null): Target {
  if (ref) {
    const commit = gitTry(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], mainRoot);
    if (!commit) throw new StableError(`${ref} isn't a tag or commit of this repository (git tag --list "checkpoint-*" lists the checkpoints).`);
    return { label: ref, commit, time: null };
  }
  const latest = latestCheckpoint(parseTagRefs(git(["for-each-ref", `--format=${TAG_FORMAT}`, TAG_REFS], mainRoot, "Listing the checkpoint tags")));
  if (!latest) throw new StableError('There\'s no checkpoint tag yet (git tag --list "checkpoint-*" lists none). The lead tags each checkpoint commit; until then, --ref <commit> picks one.');
  return { label: latest.name, commit: latest.commit, time: latest.time };
}

/** Step 5: the copy's folder as worktreePlan reads it. */
function folderState(dir: string): FolderState {
  if (!existsSync(dir)) return { exists: false, empty: true, workingCopy: false };
  let empty = false;
  try {
    empty = readdirSync(dir).length === 0;
  } catch {
    // a file, or a folder we can't read: not empty
  }
  return { exists: true, empty, workingCopy: existsSync(path.join(dir, ".git")) };
}

/** Step 5: creates the copy, or checks the checkpoint out in it again (worktreePlan); returns what happened, in words. */
async function updateWorktree(mainRoot: string, dir: string, target: Target, stay: boolean): Promise<string> {
  const found = findWorktree(parseWorktreeList(git(["worktree", "list", "--porcelain"], mainRoot, "Listing the worktrees")), dir);
  const step = worktreePlan({ dir, folder: folderState(dir), found, stay });
  switch (step.do) {
    case "refuse":
      throw new StableError(step.message);
    case "stay":
      return `left as it is at ${(gitTry(["rev-parse", "HEAD"], dir) ?? "an unknown commit").slice(0, 7)}: --stay`;
    case "create":
      if (step.clearRecord && found) {
        // A copy deleted or emptied since, or one an earlier run stopped while git created it (locked, so prune skips it).
        gitTry(["worktree", "unlock", found.path], mainRoot);
        git(["worktree", "prune"], mainRoot, "Clearing git's record of the earlier stable copy (git worktree prune)");
      }
      git(["-c", "core.longpaths=true", "worktree", "add", "--detach", dir, target.commit], mainRoot, "Creating the stable copy (git worktree add)");
      return step.clearRecord ? "created again" : "created";
    case "checkout": {
      if (step.unfinished && found) gitTry(["worktree", "unlock", found.path], mainRoot);
      // Lock files a git stopped mid-way left behind (a killed worktree add leaves index.lock): git would refuse to check out.
      const gitDir = gitTry(["rev-parse", "--path-format=absolute", "--git-dir"], dir);
      const onWait = (name: string) => say(`- Waiting up to ${STALE_GIT_LOCK_MS / 1000} s for git's ${name} in the copy (a git may be working there)…`);
      const cleared = gitDir ? await clearStaleGitLocks(gitDir, { onWait }) : [];
      const head = gitTry(["rev-parse", "--verify", "--quiet", "HEAD"], dir);
      // Tracked files that differ from the commit (missing or changed): the forced checkout below puts them back.
      const changed = head === target.commit ? gitTry(["-c", "core.longpaths=true", "status", "--porcelain", "--untracked-files=no"], dir) : null;
      git(["-c", "core.longpaths=true", "checkout", "--force", "--detach", target.commit], dir, "Checking the checkpoint out in the stable copy (git checkout)");
      const locks = cleared.length ? `; removed git's ${cleared.join(" and ")}, left by a git that was stopped` : "";
      if (step.unfinished) return `finished: an earlier run had stopped while creating it${locks}`;
      if (head !== target.commit) return `moved from ${(head ?? "an unknown commit").slice(0, 7)}${locks}`;
      const n = changed ? changed.split(/\r?\n/).filter((l) => l.trim()).length : 0;
      return `already on it${n ? `; put back ${n} tracked file${n === 1 ? "" : "s"} that ${n === 1 ? "was" : "were"} missing or changed` : ""}${locks}`;
    }
  }
}

/** Step 6: .env.local, as a file copy (values never read here). */
function copyEnvLocal(mainRoot: string, dir: string): string {
  const from = path.join(mainRoot, ".env.local");
  const to = path.join(dir, ".env.local");
  if (!existsSync(from)) return existsSync(to) ? "⚠️ missing in the main folder: the copy keeps the one from the last run" : "⚠️ missing in the main folder (and in the copy): the app runs without it";
  copyFileSync(from, to);
  return "copied from the main folder (values not shown)";
}

/** Step 8: next start from the copy until it stops; its exit code (0 when Ctrl+C stopped it). */
async function serve(dir: string, mainRoot: string, port: number): Promise<number> {
  const bin = path.join(dir, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(bin)) throw new StableError(`Next.js isn't installed in the copy (${path.join("node_modules", "next")} is missing): run npm run stable again without --stay.`);
  const started = Date.now();
  const child = spawn(process.execPath, [bin, "start", "-H", STABLE_HOST, "-p", String(port)], { cwd: dir, env: serveEnv(process.env, mainRoot) as NodeJS.ProcessEnv, stdio: "inherit", windowsHide: false });
  let stopping = false;
  // Ctrl+C reaches every process in the window (the server too); if it lingers, its tree is ended.
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void exited(child, 5_000).then((done) => {
      if (!done) killTree(child);
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const code = await new Promise<number>((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", (c) => resolve(c ?? 0));
  });
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  if (stopping) return 0;
  // Right after the start, the likely cause is a port taken since the check; later, the server's own output above says why.
  const early = Date.now() - started < 15_000;
  if (code !== 0) console.error(`The server stopped (exit code ${code}).${early ? " If another server took the port meanwhile, close it and run npm run stable -- --stay." : ""}`);
  return code;
}

async function main(): Promise<number> {
  const parsed = parseStableArgs(process.argv.slice(2), process.env);
  if ("error" in parsed) throw new StableError(parsed.error);
  if (parsed.help) {
    say(USAGE);
    return 0;
  }
  const mainRoot = MAIN_ROOT;
  // 1. Never from the stable copy (or any linked worktree): name the main folder instead.
  const gitDir = gitTry(["rev-parse", "--path-format=absolute", "--git-dir"], mainRoot);
  const commonDir = gitTry(["rev-parse", "--path-format=absolute", "--git-common-dir"], mainRoot);
  if (!gitDir || !commonDir) throw new StableError(`${mainRoot} isn't a git repository: run npm run stable from the main project folder.`);
  if (!samePath(gitDir, commonDir)) throw new StableError(`This is a copy, not the main folder: run npm run stable from ${path.resolve(path.dirname(commonDir))}.`);
  const dir = parsed.dir ? path.resolve(mainRoot, parsed.dir) : stableDirOf(mainRoot);
  if (isInside(dir, mainRoot) || isInside(mainRoot, dir)) throw new StableError(`The stable copy's folder (${dir}) can't be the main folder, inside it, or around it.`);

  // 2. One run at a time, for as long as this one lives (the system releases the lock when it ends).
  const lock = await takeLock(lockAddress(dir));
  if ("busy" in lock) {
    throw new StableError(
      "npm run stable is already running in another window (installing, building or serving the copy). Use that one, or stop it (Ctrl+C in its window), then run npm run stable again.",
    );
  }
  if ("unavailable" in lock) say(`⚠️ The lock that keeps two runs apart couldn't be taken (${lock.unavailable}): don't start npm run stable in another window while this one runs.`);
  try {
    return await update(parsed, mainRoot, dir);
  } finally {
    if ("server" in lock) lock.server.close();
  }
}

/** Steps 3–8, under the lock. */
async function update(parsed: StableArgs, mainRoot: string, dir: string): Promise<number> {
  // 3. Nothing running on the port, before anything changes.
  if (!(parsed.stay && !parsed.serve) && (await portBusy(parsed.port))) {
    throw new StableError(
      `Port ${parsed.port} is in use: the stable copy (or another server, such as npm run dev from before it moved to port 3001) is probably running. Stop it (Ctrl+C in its window), then run npm run stable again.`,
    );
  }

  say("Offer Sheet: the stable copy");
  // 4–5. The checkpoint and the worktree.
  const target: Target = parsed.stay ? { label: "(as it is)", commit: "", time: null } : checkpointTarget(mainRoot, parsed.ref);
  const what = await updateWorktree(mainRoot, dir, target, parsed.stay);
  const commit = gitTry(["rev-parse", "HEAD"], dir);
  if (!commit) throw new StableError(`Couldn't read the stable copy's commit in ${dir}.`);
  const label = parsed.stay ? (gitTry(["describe", "--tags", "--exact-match", "--match", "checkpoint-*", "HEAD"], dir) ?? commit.slice(0, 7)) : target.label;
  const when = target.time !== null ? `, committed ${new Date(target.time * 1000).toISOString().slice(0, 10)}` : "";
  say(`- Checkpoint: ${label} (${commit.slice(0, 7)}${when})`);
  say(`- Folder: ${dir} (${what})`);

  // 6. .env.local.
  say(`- .env.local: ${copyEnvLocal(mainRoot, dir)}`);

  // 7. Install and build when needed.
  const cli = npmCliPath(process.env, process.execPath);
  const lockFile = path.join(dir, "package-lock.json");
  if (!existsSync(lockFile)) throw new StableError(`The copy has no package-lock.json (${dir}): is it really a checkpoint of Offer Sheet?`);
  const lockSha256 = fileSha256(lockFile);
  const install = installPlan({ lockSha256, marker: readInstallMarker(path.join(dir, INSTALL_MARKER)), nextInstalled: existsSync(path.join(dir, "node_modules", "next", "package.json")) });
  const build = buildPlan({ commit, marker: readBuildMarker(path.join(dir, BUILD_MARKER)), buildIdExists: existsSync(path.join(dir, ".next", "BUILD_ID")) });
  if ((install.run || build.run) && !cli) throw new StableError("npm wasn't found next to Node: run npm run stable from a PowerShell window where npm works.");
  if (install.run) {
    say(`- Packages: installing (npm ci), because ${install.why}…`);
    npm(cli as string, ["ci", "--include=dev", "--prefer-offline", "--no-audit", "--no-fund"], dir, "Installing the packages (npm ci)");
    writeFileSync(path.join(dir, INSTALL_MARKER), JSON.stringify({ lockSha256, installedAt: new Date().toISOString() } satisfies InstallMarker));
  } else say(`- Packages: up to date (${install.why})`);
  if (build.run) {
    say(`- Build: building (npm run build), because ${build.why}…`);
    rmSync(path.join(dir, BUILD_MARKER), { force: true });
    npm(cli as string, ["run", "build"], dir, "Building the app (npm run build)");
    writeFileSync(path.join(dir, BUILD_MARKER), JSON.stringify({ commit, builtAt: new Date().toISOString() } satisfies BuildMarker));
  } else say(`- Build: up to date (${build.why})`);

  if (!parsed.serve) {
    say(`Ready. Start it with: npm run stable -- --stay`);
    return 0;
  }
  // 8. Serve.
  say(`Serving http://${STABLE_HOST}:${parsed.port} (stable copy, ${label}). Keep this window open while you use it; Ctrl+C stops it.`);
  return serve(dir, mainRoot, parsed.port);
}

// Run only as a script (an exact path: scripts/lib/runMode.ts isMainModule).
if (isMainModule(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof StableError ? `Stable copy: ${err.message}` : `Stable copy: something went wrong (${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}).`);
      process.exit(1);
    },
  );
}
