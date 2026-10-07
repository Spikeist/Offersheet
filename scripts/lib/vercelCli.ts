/**
 * The Vercel CLI and the upload checks that `npm run preview:deploy` and `npm run prod:deploy` share (moved out of
 * scripts/preview-deploy.ts at Checkpoint 7c, planner reply to Checkpoint 7b, §2: "with the preview script's checks";
 * preview-deploy.ts re-exports all of it, so its readers and tests keep their imports).
 *
 * - vercel: the pinned CLI (VERCEL_CLI, the version checked at Checkpoint 7a) through npx, no shell, telemetry off,
 *   `--non-interactive` appended; `input` goes to its stdin (a secret for `env add`, never on the command line), `cwd`
 *   is the folder it runs in (prod:deploy runs its dry run and its deploy in the clean copy of the tag), `timeoutMs`
 *   stops it. Never `vercel link` or `vercel env pull` (both write into .env.local: seen at Checkpoint 7a); every call
 *   names `--project` instead.
 * - The upload checks: .vercelignore is the allowlist (isAllowlist), what a dry run lists (uploadPaths), and what's wrong
 *   with it (uploadProblems: private folders, .env files, CLAUDE.md, too many files or bytes, another framework, and with
 *   git's state any file that isn't committed as it is).
 * - Reading the CLI's answers: the JSON in its stdout (jsonOf), the variables' names `env ls` lists (envNames: values
 *   are never read), whether protection is on (protectionOn), a deployment's address (deploymentUrl), whether an
 *   anonymous answer shows Vercel Authentication (looksProtected), a failure's last lines without ids (tail).
 * - leakCheckPasses: the leak check (scripts/check-leaks.ts --files, its --base for files read from another folder),
 *   always started from the main folder, so its needles come from the main folder's .env.local.
 *
 * Nothing secret is printed here: `env ls`'s output (it can hold a plain variable's value) is read for names only.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The main folder: this file's scripts/lib/ folder's grandparent, wherever the script is started from. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The Vercel CLI version these scripts were checked with (Checkpoint 7a). */
export const VERCEL_CLI = "vercel@62.2.0";
export const PROJECT = "offersheet";
/** The most a deployment may upload (Hobby's CLI limit is 15,000 files and 100 MB; ours is about 440 files and 9 MB). */
export const MAX_FILES = 2_000;
export const MAX_BYTES = 50_000_000;
/** Paths that must never upload (the allowlist keeps them out; this is the check). */
const FORBIDDEN = /^(fixtures|data-local|reports|\.cache|scripts|node_modules|\.next|\.vercel)(\/|\\|$)|(^|\/|\\)\.env|^CLAUDE\.md$/i;

/** Whether .vercelignore is the allowlist this project relies on: its first rule ignores everything ("/*"). */
export function isAllowlist(ignoreText: string): boolean {
  const rules = ignoreText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  return rules[0] === "/*" && rules.slice(1).every((r) => r.startsWith("!"));
}

/** What `vercel deploy --dry` prints (its JSON plan). */
export interface DryRun {
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

/** What git says of a folder (gitState): the tracked files, and those changed since the last commit (staged or not). */
export interface GitState {
  tracked: ReadonlySet<string>;
  changed: ReadonlySet<string>;
}

/** A folder's git state (see GitState), from `git ls-files -z` and `git diff --name-only -z HEAD`. */
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
    // Only committed content deploys (preview-deploy.ts's header, step 2): the names are this project's own files, never data.
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
  return protectionMode(json) !== null;
}

/** Which deployments Vercel Authentication protects (`ssoProtection.deploymentType`, e.g. "all_except_custom_domains"), or null when it's off. */
export function protectionMode(json: unknown): string | null {
  const sso = (json as { ssoProtection?: { deploymentType?: unknown } | null } | null)?.ssoProtection;
  return typeof sso?.deploymentType === "string" && sso.deploymentType.length > 0 ? sso.deploymentType : null;
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

/** A CLI run's exit status (1 when it had none) and output; `timedOut` when `timeoutMs` stopped it. */
export interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface VercelRunOptions {
  /** Its stdin (a secret for `env add`: never on the command line, where the process list would show it). */
  input?: string;
  /** The folder it runs in (default: the main folder). */
  cwd?: string;
  /** Stops it after this long (default: no limit). */
  timeoutMs?: number;
}

/** Runs the pinned Vercel CLI through npx (no shell) with `--non-interactive`; `opts` as a string is its stdin (the old form). */
export function vercel(args: readonly string[], opts: string | VercelRunOptions = {}): CliResult {
  const o: VercelRunOptions = typeof opts === "string" ? { input: opts } : opts;
  const npxCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (!existsSync(npxCli)) throw new Error("npx wasn't found next to Node. Is Node.js installed with npm?");
  const r = spawnSync(process.execPath, [npxCli, "--yes", VERCEL_CLI, ...args, "--non-interactive"], {
    cwd: o.cwd ?? ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, VERCEL_TELEMETRY_DISABLED: "1" },
    ...(o.input !== undefined ? { input: o.input } : {}),
    ...(o.timeoutMs !== undefined ? { timeout: o.timeoutMs } : {}),
  });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut };
}

/**
 * Runs the leak check over exactly `files` (scripts/check-leaks.ts --files, through tsx like npm run check:leaks), its own
 * output shown (file paths, categories and counts, never values); true when it found no hard hit. With `base`, each file
 * is read from that folder (`--base`: prod:deploy's clean copy) while the check itself still starts in the main folder, so
 * its needles (.env.local's values, the redaction maps, the watch lists) are the main folder's; check-leaks refuses a
 * `--files` scan that has no .env.local values to look for.
 */
export function leakCheckPasses(opts: { files: readonly string[]; base?: string }): boolean {
  const dir = mkdtempSync(path.join(tmpdir(), "offersheet-upload-"));
  try {
    const list = path.join(dir, "upload.txt");
    writeFileSync(list, `${opts.files.join("\n")}\n`);
    const args = ["--import", "tsx", path.join(ROOT, "scripts", "check-leaks.ts"), "--files", list, ...(opts.base ? ["--base", opts.base] : [])];
    const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit", windowsHide: true });
    return r.status === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A CLI failure's last lines, with project and team ids cut out. */
export function tail(text: string): string {
  return text.replace(/(prj_|team_)[A-Za-z0-9]+/g, "$1…").trim().split(/\r?\n/).slice(-6).join("\n  ");
}
