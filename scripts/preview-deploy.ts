/**
 * npm run preview:deploy -- --live — a protected PREVIEW deployment of this folder to Parker's Vercel project "offersheet"
 * (planner reply to Checkpoint 4c, Part B: "Before that, use protected preview deployments (Vercel Authentication) only";
 * production deploys only through `npm run prod:deploy`, a clean copy of the approved tag, after Parker's "go": planner
 * reply to Checkpoint 7b, §2; scripts/prod-deploy.ts).
 *
 * It never deploys to production: no --prod, no --target production, no promote, no --public, and it refuses to run with
 * an option it doesn't know. The CLI and the upload checks live in scripts/lib/vercelCli.ts (shared with prod:deploy since
 * Checkpoint 7c). In order:
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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isMainModule, requireLive } from "./lib/runMode";
import { deploymentUrl, envNames, gitState, isAllowlist, jsonOf, leakCheckPasses, looksProtected, PROJECT, protectionOn, ROOT, tail, uploadPaths, uploadProblems, vercel, type DryRun, type GitState } from "./lib/vercelCli";

// The CLI and the upload checks live in scripts/lib/vercelCli.ts since Checkpoint 7c (npm run prod:deploy shares them);
// they're re-exported here so their readers (vercel-secret.ts) and this script's tests keep their imports.
export {
  deploymentUrl,
  envNames,
  gitState,
  isAllowlist,
  jsonOf,
  looksProtected,
  MAX_BYTES,
  MAX_FILES,
  PROJECT,
  protectionOn,
  ROOT,
  tail,
  uploadPaths,
  uploadProblems,
  VERCEL_CLI,
  vercel,
  type DryRun,
  type GitState,
} from "./lib/vercelCli";

/** The options this script takes; anything else (above all --prod) stops it. */
export function parseDeployArgs(argv: readonly string[]): { ok: true } | { ok: false; error: string } {
  for (const a of argv) {
    if (a === "--live") continue;
    if (/prod|promote|public|target/i.test(a)) return { ok: false, error: `Refused: "${a}". This script only makes protected preview deployments; production deploys only through npm run prod:deploy, after Parker's go.` };
    return { ok: false, error: `Unknown option "${a}". Usage: npm run preview:deploy -- --live` };
  }
  return { ok: true };
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
  if (!leakCheckPasses({ files: uploadPaths(plan) })) fail("the leak check found something in the files that would upload (above). Nothing was uploaded.");

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
