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
 *    .vercel/, is an .env file or CLAUDE.md, or when the upload passes MAX_FILES or MAX_BYTES.
 * 3. Deployment Protection must be on (`vercel project protection offersheet`: ssoProtection set), so a preview's address
 *    asks a visitor to log in to Vercel.
 * 4. `vercel deploy --project offersheet --format json`: a preview (the CLI's default target) → the deployment's address.
 * 5. The address must refuse a visitor who isn't logged in (401, or a redirect to Vercel's login). If it answers anything
 *    else the deployment is removed at once (`vercel remove <address> --yes`) and the script fails.
 * The CLI runs through npx at VERCEL_CLI (the version checked at Checkpoint 7a). It never runs `vercel link` here (that
 * writes a token into .env.local; seen at Checkpoint 7a) or `vercel env pull`; --project names the project instead.
 * Nothing secret is printed: the CLI's own output is summarized (counts, sizes, the address), ids are cut out.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

/** What's wrong with a dry run's upload list (none: an empty list). */
export function uploadProblems(dry: DryRun): string[] {
  const out: string[] = [];
  const files = Array.isArray(dry.files) ? dry.files : [];
  const paths = files.map((f) => (typeof f === "string" ? f : (f.path ?? f.file ?? f.name ?? "")));
  const bad = paths.filter((p) => FORBIDDEN.test(p));
  if (bad.length) out.push(`${bad.length} file(s) that must never upload, e.g. under ${[...new Set(bad.map((p) => p.split(/[\\/]/)[0]))].slice(0, 4).join(", ")}`);
  const count = dry.fileCount ?? files.length;
  if (count > MAX_FILES) out.push(`${count} files (at most ${MAX_FILES})`);
  const bytes = dry.totalSize ?? files.reduce((s, f) => s + (typeof f === "string" ? 0 : (f.size ?? 0)), 0);
  if (bytes > MAX_BYTES) out.push(`${(bytes / 1e6).toFixed(1)} MB (at most ${MAX_BYTES / 1e6} MB)`);
  if (!files.length) out.push("the dry run listed no files");
  if (dry.framework?.slug !== "nextjs") out.push(`the framework read as ${dry.framework?.slug ?? "unknown"}, not nextjs (vercel.json sets it)`);
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

/** Runs the pinned Vercel CLI through npx (no shell): its exit status and output. */
function vercel(args: readonly string[]): { status: number; stdout: string; stderr: string } {
  const npxCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (!existsSync(npxCli)) throw new Error("npx wasn't found next to Node. Is Node.js installed with npm?");
  const r = spawnSync(process.execPath, [npxCli, "--yes", VERCEL_CLI, ...args, "--non-interactive"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, VERCEL_TELEMETRY_DISABLED: "1" },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** A CLI failure's last lines, with project and team ids cut out. */
function tail(text: string): string {
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

  console.log("1/4 Checking what would upload (a dry run)…");
  const dry = vercel(["deploy", "--dry", "--project", PROJECT]);
  if (dry.status !== 0) fail(`the dry run failed (exit ${dry.status}).\n  ${tail(dry.stderr || dry.stdout)}`);
  const plan = jsonOf(dry.stdout) as DryRun | null;
  if (!plan) fail("the dry run's output couldn't be read. Nothing was uploaded.");
  const problems = uploadProblems(plan);
  if (problems.length) fail(`the upload isn't safe: ${problems.join("; ")}. Nothing was uploaded.`);
  console.log(`    ${plan.fileCount ?? plan.files?.length} files, ${((plan.totalSize ?? 0) / 1e6).toFixed(1)} MB, framework ${plan.framework?.slug}.`);

  console.log("2/4 Checking that previews are protected (Vercel Authentication)…");
  const prot = vercel(["project", "protection", PROJECT]);
  if (prot.status !== 0) fail(`reading the protection settings failed (exit ${prot.status}).\n  ${tail(prot.stderr || prot.stdout)}`);
  if (!protectionOn(jsonOf(prot.stdout))) fail("Deployment Protection (Vercel Authentication) is off for this project, so a preview would be public. Turn it on (Settings → Deployment Protection → Vercel Authentication, Standard Protection), then run this again. Nothing was uploaded.");

  console.log("3/4 Deploying a preview (not production)…");
  const dep = vercel(["deploy", "--project", PROJECT, "--format", "json"]);
  const url = deploymentUrl(dep.stdout) ?? deploymentUrl(dep.stderr);
  if (dep.status !== 0 || !url) fail(`the deployment failed (exit ${dep.status}).\n  ${tail(dep.stderr || dep.stdout)}`);

  console.log("4/4 Checking that the preview asks visitors to log in…");
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
