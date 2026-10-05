/**
 * npm run preview:deploy -- --live — a protected PREVIEW deployment of this folder to Parker's Vercel project "offersheet"
 * (planner reply to Checkpoint 4c, Part B: "Before that, use protected preview deployments (Vercel Authentication) only";
 * production waits for Parker's "go" at Checkpoint 7b).
 *
 * It never deploys to production: no --prod, no --target production, no promote, no --public, and it refuses to run with
 * an option it doesn't know. In order:
 * 1. .vercelignore must be the allowlist (its first rule "/*"): the CLI uploads this folder and ignores .gitignore, so
 *    without it raw captures, strangers' leagues and reports would upload.
 * 2. A dry run of the Vercel CLI (`vercel deploy --dry --project offersheet`, the CLI's own ignore rules) lists what would
 *    upload; it stops when any file is under fixtures/, data-local/, reports/, .cache/, scripts/, node_modules/, .next/,
 *    .vercel/, is an .env file or CLAUDE.md, when the upload passes MAX_FILES or MAX_BYTES, or (final review SEC-8: the CLI
 *    uploads the working tree, not git's) when any file isn't committed as it is: untracked, or changed since the last
 *    commit (`git ls-files`, `git diff --name-only HEAD`). So only committed content deploys: a debug capture or a pasted
 *    league body under src/ or public/ can't leave this computer by accident.
 * 3. The leak check (`npm run check:leaks`'s scan, scripts/check-leaks.ts --files) over exactly the files the dry run
 *    listed: .env.local's secrets and ids, and the identities the sanitizers recorded, must appear in none of them.
 * 4. Deployment Protection must be on (`vercel project protection offersheet`: ssoProtection set), so a preview's address
 *    asks a visitor to log in to Vercel; and the preview environment must have SESSION_SECRET (final review SEC-9: without
 *    it a preview runs with no shared store, no ESPN cookie sessions and no signed imports; `vercel env ls preview --format
 *    json`, read for the variables' names only: `npm run vercel:secret -- --live` adds it).
 * 5. `vercel deploy --project offersheet --format json`: a preview (the CLI's default target) → the deployment's address.
 * 6. The address must refuse a visitor who isn't logged in (401, or a redirect to Vercel's login). If it answers anything
 *    else the deployment is removed at once (`vercel remove <address> --yes`) and the script fails.
 * The CLI runs through npx at VERCEL_CLI (the version checked at Checkpoint 7a). It never runs `vercel link` here (that
 * writes a token into .env.local; seen at Checkpoint 7a) or `vercel env pull`; --project names the project instead.
 * Nothing secret is printed: the CLI's own output is summarized (counts, sizes, the address, variables' names), ids are
 * cut out, and `env ls`'s output (it can hold values) is never printed.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule, requireLive } from "./lib/runMode";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The Vercel CLI version this script was checked with (Checkpoint 7a). */
export const VERCEL_CLI = "vercel@62.2.0";
export const PROJECT = "offersheet";
/** The most a deployment may upload (Hobby's CLI limit is 15,000 files and 100 MB; ours is about 380 files and 7 MB). */
export const MAX_FILES = 2_000;
export const MAX_BYTES = 50_000_000;
/** Paths that must never upload (the allowlist keeps them out; this is the check). */
const FORBIDDEN = /^(fixtures|data-local|reports|\.cache|scripts|node_modules|\.next|\.vercel)(\/|\\|$)|(^|\/|\\)\.env|^CLAUDE\.md$/i;

/** The options this script takes; anything else (above all --prod) stops it. */
export function parseDeployArgs(argv: readonly string[]): { ok: true } | { ok: false; error: string } {
  for (const a of argv) {
    if (a === "--live") continue;
    if (/prod|promote|public|target/i.test(a)) return { ok: false, error: `Refused: "${a}". This script only makes protected preview deployments; production waits for Parker's go (Checkpoint 7b).` };
    return { ok: false, error: `Unknown option "${a}". Usage: npm run preview:deploy -- --live` };
  }
  return { ok: true };
}

/** Whether .vercelignore is the allowlist this project relies on: its first rule ignores everything ("/*"). */
export function isAllowlist(ignoreText: string): boolean {
  const rules = ignoreText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  return rules[0] === "/*" && rules.slice(1).every((r) => r.startsWith("!"));
}

interface DryRun {
  fileCount?: number;
  totalSize?: number;
  files?: Array<string | { path?: string; file?: string; name?: string; size?: number }>;
  framework?: { slug?: string } | null;
}

/** A dry run's upload list as project-relative paths with forward slashes. */
export function uploadPaths(dry: DryRun): string[] {
  const files = Array.isArray(dry.files) ? dry.files : [];
  return files.map((f) => (typeof f === "string" ? f : (f.path ?? f.file ?? f.name ?? "")).replace(/\\/g, "/"));
}

/** What git says of this folder (gitState): the tracked files, and those changed since the last commit (staged or not). */
export interface GitState {
  tracked: ReadonlySet<string>;
  changed: ReadonlySet<string>;
}

/** This folder's git state (see GitState), from `git ls-files -z` and `git diff --name-only -z HEAD`. */
export function gitState(root: string = ROOT): GitState {
  const list = (args: string[]) => new Set(execFileSync("git", args, { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean));
  return { tracked: list(["ls-files", "-z"]), changed: list(["diff", "--name-only", "-z", "HEAD"]) };
}

/** What's wrong with a dry run's upload list (none: an empty list); with `git`, also any file not committed as it is. */
export function uploadProblems(dry: DryRun, git?: GitState): string[] {
  const out: string[] = [];
  const files = Array.isArray(dry.files) ? dry.files : [];
  const paths = uploadPaths(dry);
  const bad = paths.filter((p) => FORBIDDEN.test(p));
  if (bad.length) out.push(`${bad.length} file(s) that must never upload, e.g. under ${[...new Set(bad.map((p) => p.split(/[\\/]/)[0]))].slice(0, 4).join(", ")}`);
  if (git) {
    // Only committed content deploys (the header, step 2): the names are this project's own files, never data.
    const uncommitted = paths.filter((p) => p && (!git.tracked.has(p) || git.changed.has(p)));
    if (uncommitted.length) out.push(`${uncommitted.length} file(s) that aren't committed as they are (untracked, or changed since the last commit), e.g. ${uncommitted.slice(0, 3).join(", ")}: commit them first, or take them out of the folder`);
  }
  const count = dry.fileCount ?? files.length;
  if (count > MAX_FILES) out.push(`${count} files (at most ${MAX_FILES})`);
  const bytes = dry.totalSize ?? files.reduce((s, f) => s + (typeof f === "string" ? 0 : (f.size ?? 0)), 0);
  if (bytes > MAX_BYTES) out.push(`${(bytes / 1e6).toFixed(1)} MB (at most ${MAX_BYTES / 1e6} MB)`);
  if (!files.length) out.push("the dry run listed no files");
  if (dry.framework?.slug !== "nextjs") out.push(`the framework read as ${dry.framework?.slug ?? "unknown"}, not nextjs (vercel.json sets it)`);
  return out;
}

/**
 * The names of the variables `vercel env ls <target> --format json` lists for `target` ({ envs: [{ key, target }] }; its
 * values are never read). An entry without a target list counts for every target.
 */
export function envNames(json: unknown, target: "preview" | "production"): Set<string> {
  const envs = (json as { envs?: unknown } | null)?.envs;
  const out = new Set<string>();
  if (!Array.isArray(envs)) return out;
  for (const e of envs) {
    const key = (e as { key?: unknown } | null)?.key;
    const targets = (e as { target?: unknown } | null)?.target;
    if (typeof key !== "string") continue;
    const list = Array.isArray(targets) ? targets : typeof targets === "string" ? [targets] : null;
    if (!list || list.includes(target)) out.add(key);
  }
  return out;
}

/** Whether `vercel project protection` says Vercel Authentication protects deployments (ssoProtection set). */
export function protectionOn(json: unknown): boolean {
  const sso = (json as { ssoProtection?: { deploymentType?: unknown } | null } | null)?.ssoProtection;
  return typeof sso?.deploymentType === "string" && sso.deploymentType.length > 0;
}

/** The deployment's address in the CLI's JSON (or text) output: the first https://…vercel.app it names. */
export function deploymentUrl(stdout: string): string | null {
  const found = /https:\/\/[a-z0-9][a-z0-9-]*\.vercel\.app\b/i.exec(stdout);
  return found ? found[0] : null;
}

/** Whether an anonymous request's answer shows Vercel Authentication in front of the deployment. */
export function looksProtected(status: number, location: string | null): boolean {
  if (status === 401 || status === 403) return true;
  return status >= 300 && status < 400 && /vercel\.com/i.test(location ?? "");
}

/** The JSON object in a CLI's stdout (the CLI prints its banner and progress on stderr). */
export function jsonOf(stdout: string): unknown {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Runs the pinned Vercel CLI through npx (no shell): its exit status and output. `input` goes to its stdin (a secret for
 * `env add`: never on the command line, where the process list would show it).
 */
export function vercel(args: readonly string[], input?: string): { status: number; stdout: string; stderr: string } {
  const npxCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (!existsSync(npxCli)) throw new Error("npx wasn't found next to Node. Is Node.js installed with npm?");
  const r = spawnSync(process.execPath, [npxCli, "--yes", VERCEL_CLI, ...args, "--non-interactive"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, VERCEL_TELEMETRY_DISABLED: "1" },
    ...(input !== undefined ? { input } : {}),
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * Runs the leak check over exactly `files` (scripts/check-leaks.ts --files, through tsx like npm run check:leaks), its own
 * output shown (file paths, categories and counts, never values); true when it found no hard hit.
 */
function leakCheckPasses(files: readonly string[]): boolean {
  const dir = mkdtempSync(path.join(tmpdir(), "offersheet-upload-"));
  try {
    const list = path.join(dir, "upload.txt");
    writeFileSync(list, `${files.join("\n")}\n`);
    const r = spawnSync(process.execPath, ["--import", "tsx", path.join(ROOT, "scripts", "check-leaks.ts"), "--files", list], { cwd: ROOT, stdio: "inherit", windowsHide: true });
    return r.status === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A CLI failure's last lines, with project and team ids cut out. */
export function tail(text: string): string {
  return text.replace(/(prj_|team_)[A-Za-z0-9]+/g, "$1…").trim().split(/\r?\n/).slice(-6).join("\n  ");
}

function fail(message: string): never {
  console.error(`preview:deploy: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  requireLive({ script: "preview:deploy", what: "uploads this folder to Vercel and makes a protected preview deployment" });
  const args = parseDeployArgs(process.argv.slice(2));
  if (!args.ok) fail(args.error);

  const ignorePath = path.join(ROOT, ".vercelignore");
  if (!existsSync(ignorePath) || !isAllowlist(readFileSync(ignorePath, "utf8"))) fail(".vercelignore is missing or isn't the allowlist (first rule \"/*\", then only \"!…\" lines). Nothing was uploaded.");

  console.log("1/6 Checking what would upload (a dry run), and that all of it is committed…");
  const dry = vercel(["deploy", "--dry", "--project", PROJECT]);
  if (dry.status !== 0) fail(`the dry run failed (exit ${dry.status}).\n  ${tail(dry.stderr || dry.stdout)}`);
  const plan = jsonOf(dry.stdout) as DryRun | null;
  if (!plan) fail("the dry run's output couldn't be read. Nothing was uploaded.");
  let git: GitState;
  try {
    git = gitState();
  } catch {
    fail("git couldn't list this folder's files (is git installed?). Nothing was uploaded.");
  }
  const problems = uploadProblems(plan, git);
  if (problems.length) fail(`the upload isn't safe: ${problems.join("; ")}. Nothing was uploaded.`);
  console.log(`    ${plan.fileCount ?? plan.files?.length} files, ${((plan.totalSize ?? 0) / 1e6).toFixed(1)} MB, framework ${plan.framework?.slug}, all committed.`);

  console.log("2/6 Scanning exactly those files for secrets and leaguemates' data (the leak check)…");
  if (!leakCheckPasses(uploadPaths(plan))) fail("the leak check found something in the files that would upload (above). Nothing was uploaded.");

  console.log("3/6 Checking that previews are protected (Vercel Authentication)…");
  const prot = vercel(["project", "protection", PROJECT]);
  if (prot.status !== 0) fail(`reading the protection settings failed (exit ${prot.status}).\n  ${tail(prot.stderr || prot.stdout)}`);
  if (!protectionOn(jsonOf(prot.stdout))) fail("Deployment Protection (Vercel Authentication) is off for this project, so a preview would be public. Turn it on (Settings → Deployment Protection → Vercel Authentication, Standard Protection), then run this again. Nothing was uploaded.");

  console.log("4/6 Checking that previews have SESSION_SECRET (names only)…");
  const envs = vercel(["env", "ls", "preview", "--project", PROJECT, "--format", "json"]);
  // Never printed: `env ls` can list a plain variable's value.
  if (envs.status !== 0) fail(`listing the preview's environment variables failed (exit ${envs.status}). Nothing was uploaded.`);
  const names = envNames(jsonOf(envs.stdout), "preview");
  if (!names.has("SESSION_SECRET")) fail("the preview environment has no SESSION_SECRET, so a preview would run without its shared store, ESPN cookie sessions and signed imports. Add one with: npm run vercel:secret -- --live. Nothing was uploaded.");
  if (!names.has("KV_REST_API_URL") && !names.has("UPSTASH_REDIS_REST_URL")) console.log("    Note: no Upstash variables for previews yet, so the preview caches per instance only (Checkpoint 7a's steps connect it).");

  console.log("5/6 Deploying a preview (not production)…");
  const dep = vercel(["deploy", "--project", PROJECT, "--format", "json"]);
  const url = deploymentUrl(dep.stdout) ?? deploymentUrl(dep.stderr);
  if (dep.status !== 0 || !url) fail(`the deployment failed (exit ${dep.status}).\n  ${tail(dep.stderr || dep.stdout)}`);

  console.log("6/6 Checking that the preview asks visitors to log in…");
  let status = 0;
  let location: string | null = null;
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    status = res.status;
    location = res.headers.get("location");
  } catch {
    status = 0;
  }
  if (!looksProtected(status, location)) {
    const removed = vercel(["remove", url, "--yes"]);
    fail(`the preview answered ${status || "nothing"} to a visitor who isn't logged in, so it may be public: it was ${removed.status === 0 ? "removed" : "NOT removed (remove it in the Vercel dashboard now)"}. Check Deployment Protection, then run this again.`);
  }
  console.log(`\nPreview ready (protected: ${status}): ${url}\nOpen it on your phone and log in with your Vercel account when asked.`);
}

if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
}
