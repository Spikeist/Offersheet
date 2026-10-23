/**
 * npm run publish:public: rebuilds the public copy of this repository's history and, with --live, pushes it to the
 * public GitHub repository (CLAUDE.md section 0.4). Offline by default (section 0.9): without --live nothing leaves this
 * computer.
 *
 * Why a copy: this history holds FantasyCalc's value lists and values, which their terms and Parker's word to them keep
 * unpublished. The public repository gets every commit and checkpoint tag, rewritten in a temp folder by
 * scripts/publish/rewrite.py (the vendored git-filter-repo) with scripts/publish/rules.json and the frozen dictionary
 * scripts/publish/fc-dictionary.json (both private: the copy drops them), then checked by scripts/publish/verify.py:
 *
 *   1. a temp bare repository fetches main and the checkpoint-* tags from this folder (never the other way round);
 *   2. rewrite.py drops the FantasyCalc fixtures and the private files from every commit and masks FantasyCalc values
 *      tied to named players in every version;
 *   3. verify.py checks every published version (dropped paths, FantasyCalc-shaped data, values near names with every
 *      FantasyCalc list this computer holds, banned names, JSON, and the leak check over every version);
 *   4. --twice builds it again in another temp folder and fails unless main and every tag come out the same: the copy
 *      is deterministic, so a later publish fast-forwards the public repository;
 *   5. --live pushes main and the tags from the temp repository to the remote's URL (remote.origin.url; this folder's
 *      own pushes are blocked: its pushurl is a guard and .githooks/pre-push refuses). It refuses unless the remote's
 *      main is an ancestor of the new main and every remote tag already matches, unless --force (Parker's say-so: a rules
 *      change that rewrites published commits), which pushes with --force-with-lease.
 *
 * Options: --live, --force, --twice, --keep (keep the temp folders and print their paths), --skip-leak-check (only
 * without --live), --source <repo> (fetch from another clone; default this folder), --remote <name> (default origin).
 * Never prints the remote's URL.
 */
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flagValue, isMainModule, setNetworkMode, wantsLive } from "./lib/runMode";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISH = path.join(ROOT, "scripts", "publish");
export const RULES_FILE = path.join(PUBLISH, "rules.json");
export const DICTIONARY_FILE = path.join(PUBLISH, "fc-dictionary.json");
export const PUBLIC_COPY_TEXT = "This is the public copy: its history was filtered, and publishing runs from the private repository.";

export interface PublishOptions {
  source: string;
  rulesFile: string;
  dictionaryFile: string;
  /** The main folder whose .env.local, redaction maps and FantasyCalc lists the verifier reads (default ROOT). */
  main?: string;
  leakCheck: boolean;
  liveDictionary?: boolean;
  python?: PythonCommand;
  log?: (line: string) => void;
}

export interface Mirror {
  dir: string;
  main: string;
  tags: Record<string, string>;
  rewriteReport: { droppedPaths: string[]; changedBlobs: [string, string][] };
}

function run(cmd: string, args: readonly string[], opts: SpawnSyncOptions = {}): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    throw new Error(`${path.basename(cmd)} ${args[0] ?? ""} failed (exit ${r.status})${out ? `:\n${out.slice(-4000)}` : ""}`);
  }
  return String(r.stdout ?? "");
}

/** A command that runs Python: the program, then its own arguments (py -3). */
export type PythonCommand = readonly [string, ...string[]];

/** The first of python, python3 and py -3 that runs Python 3.8 or newer; null when none does. */
export function findPython(): PythonCommand | null {
  const candidates: PythonCommand[] = [["python"], ["python3"], ["py", "-3"]];
  for (const cand of candidates) {
    const r = spawnSync(cand[0], [...cand.slice(1), "-c", "import sys; print(sys.version_info >= (3, 8))"], { encoding: "utf8" });
    if (!r.error && r.status === 0 && r.stdout.trim() === "True") return cand;
  }
  return null;
}

function refsOf(dir: string): { main: string; tags: Record<string, string> } {
  const main = run("git", ["-C", dir, "rev-parse", "refs/heads/main"]).trim();
  const tags: Record<string, string> = {};
  for (const line of run("git", ["-C", dir, "for-each-ref", "--format=%(refname:short) %(objectname)", "refs/tags"]).split("\n")) {
    const [name, sha] = line.trim().split(" ");
    if (name && sha) tags[name] = sha;
  }
  return { main, tags };
}

/** Fetches main and the checkpoint tags from `source` into a new temp bare repository and rewrites it. */
export function buildMirror(opts: PublishOptions): Mirror {
  const python = opts.python ?? findPython();
  if (!python) throw new Error("Python 3.8 or newer is needed (python, python3 or py -3).");
  const dir = mkdtempSync(path.join(os.tmpdir(), "offersheet-public-"));
  run("git", ["init", "--bare", "-q", dir]);
  run("git", ["-C", dir, "symbolic-ref", "HEAD", "refs/heads/main"]);
  run("git", ["-C", dir, "fetch", "-q", "--no-tags", opts.source, "+refs/heads/main:refs/heads/main", "+refs/tags/checkpoint-*:refs/tags/checkpoint-*"]);
  const report = `${dir}.rewrite.json`;
  const out = run(python[0], [...python.slice(1), path.join(PUBLISH, "rewrite.py"), "--repo", dir, "--rules", opts.rulesFile, "--dictionary", opts.dictionaryFile, "--report", report], { env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" } });
  opts.log?.(out.trim().split("\n").filter((l) => l.startsWith("rewrite:")).join("\n"));
  const rewriteReport = JSON.parse(readFileSync(report, "utf8")) as Mirror["rewriteReport"];
  rmSync(report, { force: true });
  return { dir, ...refsOf(dir), rewriteReport };
}

/** Runs verify.py on a mirror; returns its output, throws (with its list) when a check fails. */
export function verifyMirror(mirror: Mirror, opts: PublishOptions): string {
  const python = opts.python ?? findPython();
  if (!python) throw new Error("Python 3.8 or newer is needed (python, python3 or py -3).");
  const args = [path.join(PUBLISH, "verify.py"), "--repo", mirror.dir, "--rules", opts.rulesFile, "--dictionary", opts.dictionaryFile, "--main", opts.main ?? ROOT];
  if (opts.leakCheck) args.push("--leak-check");
  if (opts.liveDictionary === false) args.push("--no-live-dictionary");
  return run(python[0], [...python.slice(1), ...args], { env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" } }).trim();
}

export function removeMirror(mirror: Mirror): void {
  rmSync(mirror.dir, { recursive: true, force: true });
}

function lsRemote(url: string): Map<string, string> {
  const refs = new Map<string, string>();
  for (const line of run("git", ["ls-remote", url]).split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (sha && ref) refs.set(ref, sha);
  }
  return refs;
}

/** Pushes main and the tags from the mirror to `url`, after checking the remote can take them without a force. */
export function pushMirror(mirror: Mirror, url: string, force: boolean, log: (line: string) => void): void {
  const remote = lsRemote(url);
  const remoteMain = remote.get("refs/heads/main");
  let lease: string | null = null;
  if (remoteMain && remoteMain !== mirror.main) {
    run("git", ["-C", mirror.dir, "fetch", "-q", "--no-tags", url, "+refs/heads/main:refs/remotes/public/main"]);
    const ff = spawnSync("git", ["-C", mirror.dir, "merge-base", "--is-ancestor", "refs/remotes/public/main", "refs/heads/main"]).status === 0;
    if (!ff) {
      if (!force) throw new Error("The public main isn't an ancestor of the new main: the rules or the history changed what was published. Ask Parker, then run again with --force.");
      lease = remoteMain;
    }
  }
  const tagRefs = Object.keys(mirror.tags).sort();
  for (const t of tagRefs) {
    const there = remote.get(`refs/tags/${t}`);
    if (there && there !== mirror.tags[t] && !force) throw new Error(`The public tag ${t} points elsewhere. Ask Parker, then run again with --force.`);
  }
  const args = ["-C", mirror.dir, "push", "--quiet"];
  if (force) args.push(lease ? `--force-with-lease=refs/heads/main:${lease}` : "--force");
  args.push(url, "refs/heads/main:refs/heads/main", ...tagRefs.map((t) => `refs/tags/${t}:refs/tags/${t}`));
  run("git", args);
  const after = lsRemote(url);
  const expected: Array<[string, string | undefined]> = [["refs/heads/main", mirror.main], ...tagRefs.map((t): [string, string | undefined] => [`refs/tags/${t}`, mirror.tags[t]])];
  const wrong = expected.filter(([ref, sha]) => after.get(ref) !== sha);
  if (wrong.length) throw new Error(`After the push the remote still differs: ${wrong.map(([r]) => r).join(", ")}`);
  log(`pushed main (${mirror.main.slice(0, 10)}) and ${tagRefs.length} tags; the remote matches`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const live = wantsLive(argv);
  setNetworkMode(live);
  const force = argv.includes("--force");
  const keep = argv.includes("--keep");
  const twice = argv.includes("--twice");
  const skipLeaks = argv.includes("--skip-leak-check");
  if (live && skipLeaks) throw new Error("--skip-leak-check is for dry runs only: a live publish always runs the leak check.");
  if (!existsSync(RULES_FILE) || !existsSync(DICTIONARY_FILE)) {
    console.log(PUBLIC_COPY_TEXT);
    return;
  }
  const source = path.resolve(flagValue(argv, "--source") ?? ROOT);
  const remoteName = flagValue(argv, "--remote") ?? "origin";
  const log = (line: string) => console.log(line);
  const opts: PublishOptions = { source, rulesFile: RULES_FILE, dictionaryFile: DICTIONARY_FILE, leakCheck: !skipLeaks, log };
  const started = Date.now();
  const mirrors: Mirror[] = [];
  try {
    const mirror = buildMirror(opts);
    mirrors.push(mirror);
    const commits = run("git", ["-C", mirror.dir, "rev-list", "--count", "refs/heads/main"]).trim();
    log(`built: ${commits} commits on main (${mirror.main.slice(0, 10)}), tags ${Object.keys(mirror.tags).sort().join(", ")}; ${mirror.rewriteReport.droppedPaths.length} paths dropped, ${mirror.rewriteReport.changedBlobs.length} text versions masked`);
    log(verifyMirror(mirror, opts));
    if (twice) {
      const again = buildMirror(opts);
      mirrors.push(again);
      const same = again.main === mirror.main && JSON.stringify(again.tags) === JSON.stringify(mirror.tags);
      if (!same) throw new Error("Two builds differ: the rewrite isn't deterministic, so a later publish couldn't fast-forward.");
      log("a second build matches the first exactly (main and every tag)");
    }
    if (live) {
      const url = run("git", ["-C", ROOT, "config", "--get", `remote.${remoteName}.url`]).trim();
      if (!url) throw new Error(`No remote "${remoteName}" in this repository's config.`);
      pushMirror(mirror, url, force, log);
    } else {
      log("dry run: nothing was pushed (add --live to publish)");
    }
    log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  } finally {
    for (const m of mirrors) {
      if (keep) log(`kept: ${m.dir}`);
      else removeMirror(m);
    }
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
