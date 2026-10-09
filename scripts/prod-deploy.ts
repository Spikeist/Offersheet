/**
 * npm run prod:deploy — Offer Sheet's production deploy (planner reply to Checkpoint 7b, §2: "yes to `npm run prod:deploy
 * -- --live`"). Production deploys only through this script, and only after Parker writes "go" (CLAUDE.md §19): the
 * approved launch tag (checkpoint-7d once Parker approves Checkpoint 7d, else checkpoint-7c), from a clean copy of that
 * tag, with the preview script's checks.
 *
 *   npm run prod:deploy                                             a dry run on the newest checkpoint tag: every check, nothing uploaded
 *   npm run prod:deploy -- --checkpoint <the approved tag>          a dry run on that tag (launch day, before the go)
 *   npm run prod:deploy -- --ref HEAD                               a rehearsal on a commit that isn't tagged yet (it never deploys)
 *   npm run prod:deploy -- --offline [--checkpoint …|--ref …]       the local checks only: no Vercel CLI, no web request
 *   npm run prod:deploy -- --live --checkpoint <the approved tag>   THE deploy, only after Parker's "go"
 *   npm run prod:deploy -- --verify --checkpoint <the tag it serves> the checks of the production domain again, no deploy
 *
 * Without --live it is its own dry run, the one exception to CLAUDE.md §0.9's rule for scripts that talk to Vercel: it
 * asks Vercel read-only questions and the production domain for a few public addresses, and never uploads, so forgetting
 * a flag never deploys. Like the other scripts it sets OFFERSHEET_NETWORK=off without --live (its own requests don't go
 * through the app's HTTP client, so nothing it does reads it). --live needs --checkpoint, so the tag that goes live is
 * always named on the command line. When the "--" is left out, npm keeps --live, --checkpoint, --ref and --verify as its
 * own settings (npm_config_live …): the script refuses then, rather than guess (the command is spelled out in the error,
 * LIVE_COMMAND, with <the approved tag> for the tag).
 *
 * In order, each a numbered line (✅, ⚠️ or ❌). A dry run goes through every check and lists every problem; a live run
 * uploads only when none failed.
 * 1. What: --checkpoint names an annotated checkpoint-* tag (`git for-each-ref`, stable.ts's TAG_FORMAT) that is the newest
 *    checkpoint by commit time (stable.ts latestCheckpoint; another tag on the same commit is the same code); without it,
 *    the newest checkpoint tag; --ref any commit (a rehearsal, "not a tag").
 * 2. The clean copy (scripts/lib/cleanCopy.ts): the commit's own .vercelignore is the allowlist; its files, exported with
 *    `git cat-file --batch` into a new folder in the system's temp folder (COPY_PREFIX), every blob id checked, nothing
 *    else there. The folder is removed at the end, whatever happens.
 * 3. The copy has what the build needs (REQUIRED_IN_COPY, src/app/) and its vercel.json the framework, the region and the
 *    daily snapshot cron (vercelJsonProblems).
 * 4. What the checks after the deploy expect, from the tag itself, since the script runs from the development folder,
 *    which may have moved past the tag (review of the deploy track, deploy-3): the tag's own Content-Security-Policy (the
 *    copy's next.config.ts, loaded and asked for contentSecurityPolicy({ vercelPreview: false }): its one import is a
 *    type) and the app pages (APP_PAGES) the tag has (pagesPlan); an app page the tag lacks, or a page of the tag's that
 *    APP_PAGES doesn't list, is a warning (it isn't asked after the deploy).
 * 5. Vercel's own dry run in the copy (`vercel deploy --dry`, with the deploy's --meta): what would upload is exactly the
 *    copy's files (uploadMatchesCopy), nothing private, under 2,000 files and 50 MB, framework nextjs.
 * 6. The leak check (scripts/check-leaks.ts --files --base): the copy's files, read from the copy, against the main
 *    folder's .env.local values, redaction maps and watch lists (it starts in the main folder, and refuses a scan with no
 *    .env.local values to look for).
 * 7. Deployment Protection is Standard (`vercel project protection`; protectionVerdict): deployment addresses ask visitors
 *    to log in, the production domain doesn't. Checkpoint 7c's dry run read Standard as all_except_custom_domains for this
 *    project; STANDARD_PROTECTIONS still takes both of its names (the line shows the one read), and step 9 asks the domain
 *    itself.
 * 8. Production's variables, by name only (`vercel env ls production --format json`, never printed: a plain variable's
 *    value can be in it; productionEnv): SESSION_SECRET, CRON_SECRET and the store's address and token are there, and none
 *    of the names that must never be (FORBIDDEN_PRODUCTION_ENV). CONTACT_EMAIL is a constant in the code
 *    (src/lib/site.ts), not a variable.
 * 9. The production domain (PRODUCTION_ORIGIN) answers an anonymous visitor (the page it serves now).
 * 10. The image optimizer: /_next/image and /_vercel/image (IMAGE_PATHS) answer 403 on the production domain already. The
 *     firewall rule is the project's, so it holds before the deploy too; a rule not yet published shows here, before
 *     anything uploads, not only after (deploy-4).
 * 11. Cross-site API requests (planner reply to Checkpoint 7c, answer 4: "a request with that header gets 403, and the app
 *     still works"): CROSS_SITE_PATH asked twice on the production domain, as a page on another site would ask it
 *     (Sec-Fetch-Site: cross-site) and as the app's own pages do (same-origin), then CROSS_SITE_PAGE as a link on another
 *     site opens it (CROSS_SITE_NAVIGATION). The first must get the firewall's 403 from its "Deny cross-site API requests"
 *     rule (CROSS_SITE_RULE), the second must not be denied (crossSiteRuleProblems), and nor must the page
 *     (crossSitePageProblems): a rule that lost its /api/ path condition denies every page reached from another site (a
 *     search result, a link in a post), and the /api/ asks alone can't tell it from the right rule (review of the
 *     policy-deploy track, PD-1). The app answers a cross-site request with a 403 of its own (BAD_ORIGIN), but only after
 *     the firewall's rate limit counted it: told apart by the app's JSON (isAppCrossSiteRefusal), it fails the line. The
 *     rule is the project's, so, as with step 10, a rule not yet published shows before anything uploads. ⚠️ Not the
 *     rules' order: that a deny above the rate limit keeps those requests out of its count is Vercel's documented order
 *     (CLAUDE.md §19), which only past 80 requests could show.
 * 12. The rollback target: the deployment production serves now (`vercel api /v9/projects/offersheet`, read for
 *     targets.production.url only, the host only: the JSON can hold variables' values and is never printed; never the
 *     production domain itself, which after the deploy serves the new one: projectFacts). Warn only: the dashboard's Instant
 *     Rollback needs no address. The same JSON says whether Vercel's own variables reach the app.
 * 13. Next: a newer 16.3.x patch on npm than the tag's lock file has (warn only: a patch needs a new approved tag).
 * Then, live only and only when nothing above failed:
 * 14. `vercel deploy --prod --project offersheet --format json --meta offersheetCheckpoint=<tag> --meta
 *     offersheetCommit=<sha>`, run in the copy: only the copy uploads, Vercel builds it, and a build that fails never takes
 *     the domain. The only call that can reach production; allowedVercelCall refuses every other shape.
 * 15–21. On the production domain (anonymous requests, well inside the app's rate limits and the firewall's): /api/health
 *     (asked up to HEALTH_TRIES times until the domain serves the new deployment) shows production, the shared store and
 *     its check (region iad1, warn only); every app page step 4 kept answers 200 with the tag's Content-Security-Policy and
 *     no report-only copy, its footer's FantasyCalc link (rel "noopener", referrerpolicy "origin") and nothing loaded from
 *     another site (foreignResourcesInHtml); robots.txt names the production sitemap; the cron route answers a bare 401
 *     without the secret; /_next/image and /_vercel/image answer 403 (the firewall rule); step 11's three asks again, the
 *     same-origin one now the health check's 200 and the page the app's 200; the deployment's own address asks visitors to
 *     log in (warn only: a production deployment is never removed here).
 * Last: .env.local is unchanged (its sha256 before the first CLI call and after the last, never printed: `vercel link`
 * once wrote a token into it, Checkpoint 7a). Every live run ends with the rollback steps (rollbackSteps), and so does a
 * dry run's summary.
 *
 * --verify --checkpoint <the tag production serves>: steps 1, 2 and 4, then 15–20 once (no CLI call, no deploy, no wait),
 * for when a check after the deploy failed or the domain was slow to switch. Never a second --live to check again: a
 * second production deploy leaves Hobby's Instant Rollback no way back to the landing page.
 *
 * Never: `vercel link`, `env pull`, `promote`, `alias`, `redeploy`, `rollback` or `remove` (allowedVercelCall: the exact
 * calls above, nothing else), an upload from anywhere but the copy, or any variable's value printed. Every CLI call runs in
 * the copy when there is one, so whatever the CLI might write lands in a folder that's deleted, never next to .env.local.
 * The pure parts are exported and tested in prod-deploy.test.ts; runProdDeploy takes git, the CLI, fetch, the leak check,
 * the module loader, the file system and the log as arguments, so a whole run is tested offline with fakes. ⚠️ Like
 * stable.ts, the script itself runs from the development folder, not from the tag (only the policy and the pages it checks
 * come from the tag, step 4): it's reviewed with Checkpoint 7d, and shouldn't change between the dry run and the go. A
 * launch on checkpoint-7c (7d not approved in time) runs this same script, whose changes since Checkpoint 7c are the
 * cross-site check, step 11 (planner reply to Checkpoint 7c, answer 4), and LIVE_COMMAND, which names <the approved tag>
 * instead of checkpoint-7c; its FantasyCalc link reader, shared with check:browser, was reworked for 7d's DynastyProcess
 * check and reads the same.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_PAGES, fantasyCalcLinkIssues, fantasyCalcLinksInHtml, foreignResourcesInHtml } from "./check-browser/contracts";
import { CleanCopyError, exportCommit, nodeCopyFs, verifyCopy, type CopyFs, type ExportedCopy, type GitRun } from "./lib/cleanCopy";
import { isMainModule, npmFlag, setNetworkMode, type Env } from "./lib/runMode";
import { envNames, jsonOf, leakCheckPasses, looksProtected, PROJECT, protectionMode, ROOT, tail, uploadPaths, uploadProblems, VERCEL_CLI, vercel, type CliResult, type DryRun } from "./lib/vercelCli";
import { fileSha256, latestCheckpoint, npmCliPath, parseTagRefs, TAG_FORMAT, TAG_REFS, type TagInfo } from "./stable";

/** The production domain (Vercel's project domain; a custom domain later changes it, and robots.txt's sitemap with it). */
export const PRODUCTION_ORIGIN = "https://offersheet.vercel.app";
/** The clean copy's folder name in the system's temp folder (a copy a killed run left holds only the tag's public code). */
export const COPY_PREFIX = "offersheet-prod-";
/**
 * Deployment Protection as the launch takes it: Vercel's Standard Protection, previews and deployment addresses behind
 * Vercel's login and the production domain public. Vercel's API has two names for that kind of setting (review of the
 * deploy track, deploy-6, when neither had been seen for this project); Checkpoint 7c's dry run read
 * all_except_custom_domains. Both are still taken, the line shows the one read, and step 9 asks the production domain
 * itself.
 */
export const STANDARD_PROTECTIONS: readonly string[] = ["all_except_custom_domains", "prod_deployment_urls_and_all_previews"];
/** How many times, and how far apart, /api/health is asked until the domain serves the new deployment (its limit: 12 per 10 minutes). */
export const HEALTH_TRIES = 6;
export const HEALTH_WAIT_MS = 10_000;
/** A read-only CLI call (npx may first fetch the pinned CLI), the deploy (Vercel's build included), a web request. */
export const READ_TIMEOUT_MS = 3 * 60_000;
export const DEPLOY_TIMEOUT_MS = 30 * 60_000;
export const FETCH_TIMEOUT_MS = 30_000;
/** Files the build needs, which the copy must hold (and something under src/app/). */
export const REQUIRED_IN_COPY = ["package.json", "package-lock.json", "next.config.ts", "vercel.json"] as const;
/** The daily snapshot cron (vercel.json; planner reply to Checkpoint 7a, §6.3) and its region. */
export const SNAPSHOT_CRON_PATH = "/api/cron/snapshot";
export const REGION = "iad1";
/** Vercel's image optimizer, which the launch's firewall rule denies (CLAUDE.md §19). */
export const IMAGE_PATHS = ["/_next/image?url=%2Fapple-icon.png&w=32&q=75", "/_vercel/image?url=%2Fapple-icon.png&w=32&q=75"] as const;
/**
 * The firewall rule that denies another site's /api/ requests before the rate limit counts them (planner reply to
 * Checkpoint 7c, answer 4; CLAUDE.md §19), and the address it's asked on: any /api/ path would do, and the health route
 * answers fast, holds nothing and is what a live run asks anyway.
 */
export const CROSS_SITE_RULE = "Deny cross-site API requests";
export const CROSS_SITE_PATH = "/api/health";
/** How a page on another site's request says so (current browsers send the header; scripts send none), and how the app's own pages' does. */
export const CROSS_SITE = { "sec-fetch-site": "cross-site" } as const;
export const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;
/**
 * A page opened from a link on another site (a search result, a post), which the cross-site rule must leave alone: a rule
 * that lost its /api/ path condition denies it (review of the policy-deploy track, PD-1). Asked as a followed link asks
 * it, as far as Node's fetch allows: it sends Sec-Fetch-Mode: cors whatever it's given (Node 22.18, checked), and the rule
 * reads only the path and Sec-Fetch-Site.
 */
export const CROSS_SITE_PAGE = "/";
export const CROSS_SITE_NAVIGATION = { "sec-fetch-site": "cross-site", "sec-fetch-dest": "document", "sec-fetch-user": "?1" } as const;
/**
 * The command that deploys (in every message that names it), its tag left for Parker to name: the launch tag is
 * checkpoint-7d once he approves Checkpoint 7d, else checkpoint-7c, so a fixed one could name the wrong tag (which step 1
 * would refuse, as not the newest checkpoint).
 */
export const LIVE_COMMAND = "npm run prod:deploy -- --live --checkpoint <the approved tag>";

/** The command that checks the production domain again without deploying, for `tag` (the one production serves). */
export function verifyCommand(tag: string): string {
  return `npm run prod:deploy -- --verify --checkpoint ${tag}`;
}

export const USAGE = [
  "Usage (PowerShell, in the project folder):",
  "  npm run prod:deploy                                             a dry run on the newest checkpoint tag: every check, nothing uploaded",
  "  npm run prod:deploy -- --checkpoint checkpoint-7c               a dry run on that tag",
  "  npm run prod:deploy -- --ref HEAD                               a rehearsal on a commit that isn't tagged (never deploys)",
  "  npm run prod:deploy -- --offline                                the local checks only (no Vercel CLI, no web request)",
  `  ${LIVE_COMMAND}   the production deploy, only after Parker's "go"`,
  `  ${verifyCommand("checkpoint-7c")}      the checks of the production domain again (no deploy)`,
].join("\n");

// ---------------------------------------------------------------------------------------------
// The command line

export interface ProdArgs {
  live: boolean;
  offline: boolean;
  /** --verify: the checks of the production domain again (steps 15–20), against --checkpoint's tag; no deploy, no CLI. */
  verify: boolean;
  help: boolean;
  /** --checkpoint <tag>: the tag to deploy (and to check in a dry run, or to check production against with --verify). */
  checkpoint: string | null;
  /** --ref <commit>: a dry run's rehearsal on a commit that isn't tagged. */
  ref: string | null;
}

/** A checkpoint tag's name (no "/", no leading "-"). */
const CHECKPOINT_NAME = /^checkpoint-[A-Za-z0-9._-]+$/;
/** A ref for --ref (stable.ts's rule: no leading "-", so it can't be read as an option). */
const REF = /^[A-Za-z0-9][A-Za-z0-9._/^~-]{0,199}$/;

/**
 * The command line (see the header), or what's wrong with it in words. Refused: a dropped "--" (npm's npm_config_live,
 * _checkpoint, _ref, _verify, or a stray word), --tag and --dry-run (npm's own options when the "--" is dropped), anything
 * that reads like production (the script adds --prod itself), --live without --checkpoint, --ref with --live or
 * --checkpoint, --offline with --live, --verify with anything but --checkpoint (which it needs), and any option it
 * doesn't know.
 */
export function parseProdArgs(argv: readonly string[], env: Env = {}): ProdArgs | { error: string } {
  for (const name of ["live", "checkpoint", "ref", "verify"]) {
    if (npmFlag(env, name) !== undefined) return { error: `npm took --${name} as its own option, so the "--" before the options was left out or dropped. Nothing ran. Write it as: ${LIVE_COMMAND} (or without --live, the dry run).` };
  }
  const out: ProdArgs = { live: false, offline: false, verify: false, help: false, checkpoint: null, ref: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    const inline = eq > 0 ? a.slice(eq + 1) : undefined;
    if (flag === "--live" || flag === "--offline" || flag === "--verify" || flag === "--help" || flag === "-h") {
      if (inline !== undefined) return { error: `${flag} takes no value.` };
      if (flag === "--live") out.live = true;
      else if (flag === "--offline") out.offline = true;
      else if (flag === "--verify") out.verify = true;
      else out.help = true;
      continue;
    }
    if (flag === "--checkpoint" || flag === "--ref") {
      const value = inline ?? argv[i + 1];
      if (inline === undefined) i++;
      const example = flag === "--checkpoint" ? "--checkpoint checkpoint-7c" : "--ref HEAD";
      if (!value || value.startsWith("-")) return { error: `${flag} needs a value, for example ${example}.` };
      const key = flag === "--checkpoint" ? "checkpoint" : "ref";
      if (out[key] !== null) return { error: `${flag} is given twice.` };
      if (key === "checkpoint" && !CHECKPOINT_NAME.test(value)) return { error: `--checkpoint takes a checkpoint tag's name, for example ${example} (git tag --list "checkpoint-*" lists them).` };
      if (key === "ref" && !REF.test(value)) return { error: `--ref takes a commit or a tag, for example ${example}.` };
      out[key] = value;
      continue;
    }
    if (flag === "--tag") return { error: "Use --checkpoint <tag>, for example --checkpoint checkpoint-7c (npm takes --tag as its own option when the \"--\" is dropped)." };
    if (flag === "--dry-run" || flag === "--dry") return { error: "Leave it out: without --live, npm run prod:deploy is its own dry run (nothing is uploaded)." };
    if (/prod|promote|public|target/i.test(a)) return { error: `Refused: "${a}". The script adds --prod itself, and only with --live --checkpoint <the approved tag>.` };
    if (a.startsWith("-")) return { error: `Unknown option "${a}".\n${USAGE}` };
    return { error: `Unexpected "${a}": was the "--" before the options left out? Write it as: ${LIVE_COMMAND}` };
  }
  if (out.help) return out;
  if (out.verify && (out.live || out.offline || out.ref)) return { error: `--verify only asks the production domain again (no deploy, no Vercel CLI): it goes with --checkpoint <the tag production serves> alone, for example ${verifyCommand("checkpoint-7c")}` };
  if (out.verify && !out.checkpoint) return { error: `--verify needs --checkpoint <the tag production serves>, so the checks compare with that tag: ${verifyCommand("checkpoint-7c")}` };
  if (out.live && out.ref) return { error: "--ref is for dry runs only (a rehearsal on a commit that isn't tagged): a deploy needs --checkpoint <the approved tag>." };
  if (out.live && !out.checkpoint) return { error: `--live needs --checkpoint <the approved tag>, so the tag that goes live is named: ${LIVE_COMMAND}` };
  if (out.live && out.offline) return { error: "--offline makes no Vercel call, so it can't go with --live." };
  if (out.checkpoint && out.ref) return { error: "Pick one: --checkpoint <tag> or --ref <commit>." };
  return out;
}

/**
 * Whether a run sets the offline guard to "live" (scripts/lib/runMode.ts setNetworkMode): only with --live, as every
 * script does (CLAUDE.md §0.9); the dry run, --offline and --verify set it "off" (review of the deploy track, deploy-7).
 * Nothing of this script reads it: its own requests use the global fetch, and the Vercel CLI, npm and the leak check
 * don't look at it.
 */
export function networkLive(args: ProdArgs): boolean {
  return args.live;
}

// ---------------------------------------------------------------------------------------------
// What to deploy (pure)

/**
 * The checkpoint a run is about: `requested` (else the newest), which must exist, be annotated and be the newest
 * checkpoint's commit; the problems in words.
 */
export function checkpointVerdict(requested: string | null, tags: readonly TagInfo[]): { tag: TagInfo | null; newest: TagInfo | null; problems: string[] } {
  const newest = latestCheckpoint(tags);
  if (!newest) return { tag: null, newest: null, problems: ['there\'s no checkpoint tag yet (git tag --list "checkpoint-*" lists none): the lead tags the approved checkpoint; until then --ref <commit> rehearses'] };
  const name = requested ?? newest.name;
  const tag = tags.find((t) => t.name === name) ?? null;
  if (!tag) return { tag: null, newest, problems: [`there's no checkpoint tag ${name} on a commit (git tag --list "checkpoint-*" lists them; the newest is ${newest.name})`] };
  const problems: string[] = [];
  if (tag.annotated !== true) problems.push(`${name} is a lightweight tag: production deploys only an annotated checkpoint tag (git tag -a), the kind made on Parker's approval`);
  if (tag.commit !== newest.commit) problems.push(`${name} isn't the newest checkpoint: ${newest.name} (commit ${newest.commit.slice(0, 7)}) is newer, and production deploys only the newest approved checkpoint`);
  return { tag, newest, problems };
}

/** A commit time (Unix seconds) as "2026-10-11 18:02 UTC". */
export function utcTime(unixSeconds: number): string {
  return `${new Date(unixSeconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// ---------------------------------------------------------------------------------------------
// The copy and the upload (pure)

/** What's wrong with the copy's vercel.json (none: an empty list): the framework, the region and the daily snapshot cron. */
export function vercelJsonProblems(text: string): string[] {
  let json: { framework?: unknown; regions?: unknown; crons?: unknown };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    return ["it isn't valid JSON"];
  }
  const out: string[] = [];
  if (json.framework !== "nextjs") out.push(`its framework is ${JSON.stringify(json.framework ?? null)}, not "nextjs"`);
  if (!Array.isArray(json.regions) || !json.regions.includes(REGION)) out.push(`its regions don't include ${REGION} (the store is in US East)`);
  const crons = Array.isArray(json.crons) ? json.crons : [];
  if (!crons.some((c) => (c as { path?: unknown } | null)?.path === SNAPSHOT_CRON_PATH)) out.push(`it doesn't schedule the daily snapshot cron (${SNAPSHOT_CRON_PATH})`);
  return out;
}

/**
 * What differs between the CLI's upload list and the copy's files (none: an empty list): a file it would upload that the
 * copy doesn't have, or one of the copy's it would leave out. .vercelignore may be either way (the allowlist's "/*" covers it).
 */
export function uploadMatchesCopy(upload: readonly string[], copy: readonly string[]): string[] {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
  const up = new Set(upload.map(norm).filter((p) => p && p !== ".vercelignore"));
  const have = new Set(copy.map(norm).filter((p) => p && p !== ".vercelignore"));
  const out: string[] = [];
  const extra = [...up].filter((p) => !have.has(p));
  const missing = [...have].filter((p) => !up.has(p));
  if (extra.length) out.push(`it would upload ${extra.length} file(s) the copy doesn't have, e.g. ${extra.slice(0, 3).join(", ")}`);
  if (missing.length) out.push(`it would leave out ${missing.length} of the copy's file(s), e.g. ${missing.slice(0, 3).join(", ")}`);
  return out;
}

/** The `next` version in a package-lock.json (packages["node_modules/next"].version), or null. */
export function lockedNextVersion(lockText: string): string | null {
  try {
    const v = (JSON.parse(lockText) as { packages?: Record<string, { version?: unknown }> }).packages?.["node_modules/next"]?.version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** The newest release in `published` with `locked`'s major and minor and a higher patch (no pre-releases), or null. */
export function newerPatch(locked: string, published: readonly string[]): string | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(locked);
  if (!m) return null;
  let best: string | null = null;
  let bestPatch = Number(m[3]);
  for (const v of published) {
    const p = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
    if (p && p[1] === m[1] && p[2] === m[2] && Number(p[3]) > bestPatch) {
      bestPatch = Number(p[3]);
      best = v;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// What the checks after the deploy expect, from the tag itself (pure; step 4)

/**
 * The pages a commit's files hold (src/app/**\/page.tsx and the like) as the addresses they answer: "/" and "/connect" …,
 * a route group's "(name)" left out of the address; a dynamic ("[id]"), private ("_x") or parallel ("@x") folder's pages
 * are left out (no one address to ask).
 */
export function pageRoutes(files: readonly string[]): string[] {
  const out = new Set<string>();
  for (const f of files) {
    const m = /^src\/app\/(?:(.+)\/)?page\.(?:tsx|ts|jsx|js|mdx)$/.exec(f);
    if (!m) continue;
    const segments = (m[1] ?? "").split("/");
    if (segments.some((s) => s.startsWith("[") || s.startsWith("_") || s.startsWith("@"))) continue;
    out.add(`/${segments.filter((s) => s && !/^\(.*\)$/.test(s)).join("/")}`);
  }
  return [...out].sort();
}

/**
 * Which of `appPages` (APP_PAGES, the development folder's list) the tag has, to be asked after the deploy; the ones it
 * doesn't have (the folder moved past the tag), and the tag's pages the list doesn't name (neither is asked: a warning).
 */
export function pagesPlan(files: readonly string[], appPages: readonly string[]): { pages: string[]; missing: string[]; unlisted: string[] } {
  const tag = new Set(pageRoutes(files));
  return {
    pages: appPages.filter((p) => tag.has(p)),
    missing: appPages.filter((p) => !tag.has(p)),
    unlisted: [...tag].filter((p) => !appPages.includes(p)),
  };
}

/**
 * The production Content-Security-Policy a loaded next.config.ts gives (its contentSecurityPolicy({ vercelPreview: false }),
 * a named export, or one on the default export when the loader wraps the module), or null when it gives none.
 */
export function tagPolicy(mod: unknown): string | null {
  const m = mod as { contentSecurityPolicy?: unknown; default?: { contentSecurityPolicy?: unknown } | null } | null;
  const fn = typeof m?.contentSecurityPolicy === "function" ? m.contentSecurityPolicy : typeof m?.default?.contentSecurityPolicy === "function" ? m.default.contentSecurityPolicy : null;
  if (!fn) return null;
  try {
    const csp = (fn as (o: { vercelPreview: boolean }) => unknown)({ vercelPreview: false });
    return typeof csp === "string" && csp.trim() ? csp : null;
  } catch {
    return null;
  }
}

/** What the checks after the deploy compare with (step 4): the tag's own policy, and the app pages it has. */
export interface Expectations {
  csp: string;
  pages: string[];
}

// ---------------------------------------------------------------------------------------------
// Production's variables, by name only (pure)

/** A variable production must have: any one of `anyOf` (in the order the app reads them), and how to add it. */
export interface RequiredEnv {
  label: string;
  anyOf: readonly string[];
  how: string;
}

/** What the app reads in production (src/server/session.ts, redis.ts, the cron handler; the store's names in redis.ts's order). */
export const REQUIRED_PRODUCTION_ENV: readonly RequiredEnv[] = [
  { label: "SESSION_SECRET", anyOf: ["SESSION_SECRET"], how: "npm run vercel:secret -- --live --env production" },
  { label: "CRON_SECRET", anyOf: ["CRON_SECRET"], how: "npm run vercel:secret -- --live --name CRON_SECRET" },
  { label: "the store's address", anyOf: ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL"], how: "connect the Upstash store to Production: Vercel → offersheet → Storage" },
  { label: "the store's token", anyOf: ["UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN"], how: "connect the Upstash store to Production: Vercel → offersheet → Storage" },
];

/** Names that must never be Production variables, and why (a listed one stops the deploy until it's deleted in Vercel). */
export const FORBIDDEN_PRODUCTION_ENV: Readonly<Record<string, string>> = {
  ESPN_S2: "Parker's ESPN cookie: it must never sit on Vercel",
  ESPN_SWID: "Parker's ESPN cookie: it must never sit on Vercel",
  ESPN_LEAGUE_ID: "development only",
  USE_ENV_COOKIES: "development only",
  NODE_ENV: "Next and Vercel set it",
  OFFERSHEET_CSP_REPORT_ONLY: "it would ship the Content-Security-Policy as report-only",
  OFFERSHEET_NETWORK: "\"off\" refuses every fetch",
  OFFERSHEET_CACHE_DIR: "the stable copy's",
  OFFERSHEET_DATA_LOCAL: "the stable copy's",
  VITEST: "tests only",
  READONLY_STORE_URL: "this computer's store-reading scripts only",
  READONLY_STORE_TOKEN: "this computer's store-reading scripts only",
  VERCEL: "Vercel sets it itself",
  VERCEL_ENV: "Vercel sets it itself",
  VERCEL_REGION: "Vercel sets it itself",
  VERCEL_PROJECT_PRODUCTION_URL: "Vercel sets it itself",
};

/** Production's variables sorted by what they are to the app (names only). */
export interface ProductionEnv {
  /** The required names found (for each requirement, the one the app reads). */
  present: string[];
  missing: RequiredEnv[];
  forbidden: Array<{ name: string; why: string }>;
  /** Names the app doesn't read (the Marketplace's extras, the other of a pair, anything else). */
  notRead: string[];
}

/** Sorts production's variable names (see ProductionEnv). */
export function productionEnv(names: ReadonlySet<string>): ProductionEnv {
  const present: string[] = [];
  const missing: RequiredEnv[] = [];
  for (const r of REQUIRED_PRODUCTION_ENV) {
    const found = r.anyOf.find((n) => names.has(n));
    if (found) present.push(found);
    else missing.push(r);
  }
  const forbidden = [...names].filter((n) => n in FORBIDDEN_PRODUCTION_ENV).sort().map((name) => ({ name, why: FORBIDDEN_PRODUCTION_ENV[name] as string }));
  const notRead = [...names].filter((n) => !present.includes(n) && !(n in FORBIDDEN_PRODUCTION_ENV)).sort();
  return { present, missing, forbidden, notRead };
}

/** The variables' step in words: the line and its detail lines (names only, never a value). */
export function productionEnvText(e: ProductionEnv): { ok: boolean; text: string; detail: string[] } {
  const detail: string[] = [];
  if (e.missing.length) detail.push(`Missing: ${e.missing.map((m) => `${m.label} (${m.how})`).join("; ")}.`);
  if (e.forbidden.length) detail.push(`Must not be there (delete in Vercel → offersheet → Settings → Environment Variables): ${e.forbidden.map((f) => `${f.name} (${f.why})`).join("; ")}.`);
  if (e.notRead.length) detail.push(`Present, not read by the app: ${e.notRead.join(", ")}.`);
  detail.push("CONTACT_EMAIL is a constant in the code (src/lib/site.ts), not a variable.");
  const ok = !e.missing.length && !e.forbidden.length;
  const set = e.present.length ? `${e.present.join(", ")} set` : "none of the required ones set";
  return { ok, text: ok ? `${set}; none of the names that must not be there` : `${set}; ${[e.missing.length ? `${e.missing.length} missing` : "", e.forbidden.length ? `${e.forbidden.length} that must not be there` : ""].filter(Boolean).join(", ")}`, detail };
}

// ---------------------------------------------------------------------------------------------
// Vercel's answers (pure)

/** A *.vercel.app host in a CLI answer (with or without https://), or null. */
function vercelHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  return /^[a-z0-9][a-z0-9-]*\.vercel\.app$/.test(host) ? host : null;
}

/** An origin's host, lower case ("offersheet.vercel.app"). */
function hostOf(origin: string): string {
  return new URL(origin).host.toLowerCase();
}

/**
 * Whether `host` is a domain production is served at, never one deployment: the production origin's, or the project's own
 * <project>.vercel.app (an alias of production even once a custom domain is the origin). A deployment's own address
 * always carries its hash (offersheet-<hash>-<team>.vercel.app).
 */
function isDomainHost(host: string, origin: string): boolean {
  return host === hostOf(origin) || host === `${PROJECT}.vercel.app`;
}

/**
 * What the project's JSON (`vercel api /v9/projects/<project>`) says: the deployment production serves (host only), and
 * whether Vercel's own variables reach the app. Never a production domain (`namedDomain` says Vercel gave one): after the
 * deploy the domain serves the new deployment, so a rollback "to" it would go nowhere (review of the deploy track,
 * deploy-2; ⚠️ the field's shape isn't seen yet).
 */
export function projectFacts(json: unknown, origin: string = PRODUCTION_ORIGIN): { productionHost: string | null; namedDomain: boolean; systemEnvs: boolean | null } {
  const o = json as { targets?: { production?: { url?: unknown } | null } | null; autoExposeSystemEnvs?: unknown } | null;
  const host = vercelHost(o?.targets?.production?.url);
  const namedDomain = host !== null && isDomainHost(host, origin);
  return { productionHost: namedDomain ? null : host, namedDomain, systemEnvs: typeof o?.autoExposeSystemEnvs === "boolean" ? o.autoExposeSystemEnvs : null };
}

/**
 * Step 7's verdict on `vercel project protection`'s ssoProtection.deploymentType (null: off). Standard Protection under
 * either of its names (STANDARD_PROTECTIONS) passes and the line shows the name read; "all" fails (the production domain
 * would ask every visitor to log in) and so does no protection (previews would be public); "preview" (production
 * deployments' own addresses public) and a name this script doesn't know only warn: step 9 asks the domain itself.
 */
export function protectionVerdict(mode: string | null): { mark: "ok" | "warn" | "fail"; text: string } {
  if (mode === null) return { mark: "fail", text: "off: previews and deployment addresses would be public. Turn on Vercel Authentication, Standard Protection (Settings → Deployment Protection)" };
  const name = mode.slice(0, 80);
  if (STANDARD_PROTECTIONS.includes(mode)) return { mark: "ok", text: `Standard ("${name}"): deployment addresses ask visitors to log in, the production domain doesn't (it's asked below)` };
  if (mode === "all") return { mark: "fail", text: '"all": every visitor of the production domain would have to log in to Vercel. Choose Standard Protection (Settings → Deployment Protection)' };
  if (mode === "preview") return { mark: "warn", text: '"preview": previews ask visitors to log in, but a production deployment\'s own address doesn\'t (the same pages as the domain). The launch expects Standard Protection (Settings → Deployment Protection)' };
  return { mark: "warn", text: `"${name}", a setting this script doesn't know: the production domain must stay public (it's asked below) and previews must ask for a login (Settings → Deployment Protection)` };
}

/**
 * The new deployment's own address in the deploy's output: the JSON's deployment.url (or url), else the first
 * https://…vercel.app in its text that isn't a production domain (isDomainHost), which the output can also name. Null:
 * none.
 */
export function prodDeploymentUrl(stdout: string, stderr: string, origin: string = PRODUCTION_ORIGIN): string | null {
  const json = jsonOf(stdout) as { deployment?: { url?: unknown } | null; url?: unknown } | null;
  for (const v of [json?.deployment?.url, json?.url]) {
    const host = vercelHost(v);
    if (host && !isDomainHost(host, origin)) return `https://${host}`;
  }
  for (const m of `${stdout}\n${stderr}`.matchAll(/https:\/\/([a-z0-9][a-z0-9-]*\.vercel\.app)\b/gi)) {
    const host = (m[1] as string).toLowerCase();
    if (!isDomainHost(host, origin)) return `https://${host}`;
  }
  return null;
}

/** The Vercel CLI calls this script makes (its only commands; the deploy with --prod only in a live run). */
export const PROTECTION_ARGS = ["project", "protection", PROJECT] as const;
export const ENV_LIST_ARGS = ["env", "ls", "production", "--project", PROJECT, "--format", "json"] as const;
export const PROJECT_API_ARGS = ["api", `/v9/projects/${PROJECT}`] as const;

/** The --meta the dashboard shows for a deployment: which tag (or "rehearsal") and commit it is. */
function metaArgs(label: string, commit: string): string[] {
  return ["--meta", `offersheetCheckpoint=${label}`, "--meta", `offersheetCommit=${commit}`];
}

/** Vercel's dry run in the copy: what would upload, with the deploy's --meta (so a flag the CLI refuses shows before the go). */
export function dryDeployArgs(label: string, commit: string): string[] {
  return ["deploy", "--dry", "--project", PROJECT, ...metaArgs(label, commit)];
}

/** THE production deploy (live only). */
export function liveDeployArgs(tag: string, commit: string): string[] {
  return ["deploy", "--prod", "--project", PROJECT, "--format", "json", ...metaArgs(tag, commit)];
}

/**
 * Words and flags no call of this script may carry (CLAUDE.md §19: never link, env pull, promote, alias, redeploy …).
 * One string, split: prod-deploy.test.ts scans this file's code for any of these words standing alone as a string.
 */
const NEVER_ARGS = new Set("link pull promote alias aliases redeploy rollback remove rm --public --target --force --prebuilt --skip-domain --yes --build-env -b --env -e".split(" "));

/** A --meta value this script sets (metaArgs): which tag (or "rehearsal") and which commit a deployment is. */
const META_VALUE = /^offersheet(?:Checkpoint|Commit)=[A-Za-z0-9._-]{1,200}$/;

/**
 * Whether a Vercel CLI call is one this script may make: the exact calls it makes and nothing else. `project protection
 * offersheet`, the `env ls` of Production's names and the GET of `api /v9/projects/offersheet` exactly as written
 * (PROTECTION_ARGS, ENV_LIST_ARGS, PROJECT_API_ARGS); a deploy as deployAllowed takes it. Refused before that: a word of
 * NEVER_ARGS, a "--flag=value" (so "--skip-domain=true" or "--env=X=1" can't slip past the words; review of the deploy
 * track, deploy-5) and any single-dash option ("-e X=1", "-eX=1", "-b …": this script uses none).
 */
export function allowedVercelCall(args: readonly string[], live: boolean): boolean {
  // Belt and braces: the exact shapes below refuse all of these too.
  for (const a of args) {
    if (NEVER_ARGS.has(a)) return false;
    if (a.startsWith("-") && !a.startsWith("--")) return false;
    if (a.startsWith("--") && a.includes("=")) return false;
  }
  const exactly = (want: readonly string[]) => args.length === want.length && args.every((a, i) => a === want[i]);
  switch (args[0]) {
    case "deploy":
      return deployAllowed(args, live);
    case "project":
      return exactly(PROTECTION_ARGS);
    case "env":
      return exactly(ENV_LIST_ARGS);
    case "api":
      return exactly(PROJECT_API_ARGS);
    default:
      return false;
  }
}

/**
 * A deploy this script may run: --dry (never with --prod), or --prod in a live run; `--project offersheet` exactly once;
 * at most `--format json` and the two --meta (META_VALUE, each once); no other flag, and no path (a path would deploy
 * that folder instead of the copy the call runs in).
 */
function deployAllowed(args: readonly string[], live: boolean): boolean {
  let dry = false;
  let prod = false;
  let project = 0;
  let format = 0;
  const metas = new Set<string>();
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    const value = args[i + 1];
    if (a === "--dry" && !dry) dry = true;
    else if (a === "--prod" && !prod) prod = true;
    else if (a === "--project" && value === PROJECT) {
      project++;
      i++;
    } else if (a === "--format" && value === "json") {
      format++;
      i++;
    } else if (a === "--meta" && value !== undefined && META_VALUE.test(value) && !metas.has(value.split("=")[0] as string)) {
      metas.add(value.split("=")[0] as string);
      i++;
    } else return false;
  }
  if (project !== 1 || format > 1) return false;
  return dry ? !prod : live && prod;
}

// ---------------------------------------------------------------------------------------------
// The production domain after the deploy (pure)

/** What /api/health's answer says about the domain (src/app/api/health/handler.ts HealthBody). */
export type HealthVerdict =
  /** The new deployment answered: its problems (none: all good) and warnings, and a line for the report. */
  | { kind: "new"; problems: string[]; warnings: string[]; text: string }
  /** The domain still serves the deployment from before (the landing page has no /api/health). */
  | { kind: "old" }
  /** No answer, a server error or a rate limit: ask again. */
  | { kind: "retry"; text: string };

/** /api/health's answer (`status` 0: no answer) read as a HealthVerdict (pure). */
export function healthVerdict(status: number, body: string): HealthVerdict {
  if (status === 0) return { kind: "retry", text: "no answer" };
  if (status === 404) return { kind: "old" };
  if (status === 429 || status >= 500) return { kind: "retry", text: `HTTP ${status}` };
  if (status !== 200) return { kind: "new", problems: [`/api/health answered ${status}${status === 401 || status === 403 ? " (does the production domain ask visitors to log in?)" : ""}`], warnings: [], text: "" };
  type Body = { status?: unknown; environment?: unknown; region?: unknown; store?: unknown; storeReason?: unknown; storeCheck?: unknown } | null;
  let b: Body;
  try {
    b = JSON.parse(body) as Body;
  } catch {
    return { kind: "old" };
  }
  if (!b || typeof b !== "object" || typeof b.store !== "string" || typeof b.environment !== "string") return { kind: "old" };
  const problems: string[] = [];
  const warnings: string[] = [];
  if (b.environment !== "production") problems.push(`environment "${b.environment}", not "production" (Vercel's own variables don't reach the app: Settings → Environment Variables → "Automatically expose System Environment Variables")`);
  if (b.store !== "shared") problems.push(`store "${b.store}"${typeof b.storeReason === "string" ? ` (${b.storeReason})` : ""}, not "shared": the app runs without its shared cache, limits and feedback store`);
  const check = b.storeCheck as { ok?: unknown; step?: unknown; errorName?: unknown; setMs?: unknown; getMs?: unknown; delMs?: unknown } | null;
  if (b.store === "shared" && check?.ok !== true) problems.push(`the store check failed${check ? ` (${String(check.step)}: ${String(check.errorName)})` : ""}`);
  if (b.status !== "ok" && !problems.length) problems.push(`status "${String(b.status)}"`);
  if (b.region !== REGION) warnings.push(`region ${b.region === null || b.region === undefined ? "unknown" : String(b.region)}, not ${REGION} (vercel.json)`);
  const timing = check?.ok === true ? ` (set ${String(check.setMs)} ms, get ${String(check.getMs)} ms, del ${String(check.delMs)} ms)` : "";
  return { kind: "new", problems, warnings, text: `${b.environment}, the ${b.store} store${timing}, region ${b.region ?? "unknown"}` };
}

/** A page as the production domain answered it. */
export interface PageRead {
  path: string;
  status: number;
  csp: string | null;
  cspReportOnly: string | null;
  html: string;
}

/** A Content-Security-Policy as its directives (name → sources), for a comparison that ignores spacing. */
function cspDirectives(csp: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of csp.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out.set(name.toLowerCase(), sources.join(" "));
  }
  return out;
}

/** What's wrong with a page the production domain served (none: an empty list), against the tag's own policy (step 4): see the header, steps 15–21. */
export function pageProblems(page: PageRead, expectedCsp: string, origin: string = PRODUCTION_ORIGIN): string[] {
  if (page.status !== 200) return [`${page.path}: HTTP ${page.status}`];
  const out: string[] = [];
  if (page.csp === null) out.push(`${page.path}: no Content-Security-Policy`);
  else {
    const got = cspDirectives(page.csp);
    const want = cspDirectives(expectedCsp);
    const differ = [...new Set([...got.keys(), ...want.keys()])].filter((d) => got.get(d) !== want.get(d));
    if (differ.length) out.push(`${page.path}: its Content-Security-Policy isn't the production one (${differ.join(", ")})`);
  }
  if (page.cspReportOnly !== null) out.push(`${page.path}: it also sends Content-Security-Policy-Report-Only (OFFERSHEET_CSP_REPORT_ONLY was set for the build)`);
  out.push(...fantasyCalcLinkIssues(fantasyCalcLinksInHtml(page.html), { requireFooter: true }).map((p) => `${page.path}: ${p}`));
  out.push(...foreignResourcesInHtml(page.html, origin).map((r) => `${page.path}: loads a ${r}`));
  return out;
}

/** What's wrong with robots.txt (none: an empty list): crawlers kept off /api/, the sitemap on the production domain. */
export function robotsProblems(status: number, text: string, origin: string = PRODUCTION_ORIGIN): string[] {
  if (status !== 200) return [`robots.txt: HTTP ${status}`];
  const out: string[] = [];
  if (!/^disallow:\s*\/api\/\s*$/im.test(text)) out.push("robots.txt doesn't say Disallow: /api/");
  const sitemaps = [...text.matchAll(/^sitemap:\s*(\S+)\s*$/gim)].map((m) => m[1]);
  if (!sitemaps.includes(`${origin}/sitemap.xml`)) out.push(`robots.txt doesn't name ${origin}/sitemap.xml (it names ${sitemaps.length ? sitemaps.join(", ") : "none"}: VERCEL_PROJECT_PRODUCTION_URL at build time?)`);
  return out;
}

/** What's wrong with the cron route's answer to a request without the secret (none: a bare 401). */
export function cronProblems(status: number, body: string): string[] {
  if (status === 401 && body === "") return [];
  return [`${SNAPSHOT_CRON_PATH} answered ${status}${body ? " with a body" : ""} without the secret, not a bare 401`];
}

/**
 * What's wrong with the image optimizer's answers (none: every path 403, the firewall rule), before the deploy (step 10:
 * the rule is the project's, so it already answers for the deployment production serves) and after it.
 */
export function imageRuleProblems(results: ReadonlyArray<{ path: string; status: number }>): string[] {
  const open = results.filter((r) => r.status !== 403);
  if (!open.length) return [];
  return [`${open.map((r) => `${r.path.split("?")[0]} answered ${r.status || "nothing"}`).join(", ")}, not 403: add the "Block image optimizer" firewall rule and publish it now (Vercel → offersheet → Firewall; reports/beta-infrastructure.md, Launch-day step 2)`];
}

/**
 * Whether an answer is the app's own refusal of another site's request (src/app/api/_lib/route.ts withRoute, step 1:
 * BAD_ORIGIN, src/lib/errors.ts), not the firewall's: also a 403, but its JSON names the code. Hardcoded rather than read
 * from the app (this script loads none of its code); prod-deploy.test.ts asks the real withRoute for its answer.
 */
export function isAppCrossSiteRefusal(status: number, body: string): boolean {
  if (status !== 403) return false;
  try {
    return (JSON.parse(body) as { error?: { code?: unknown } | null } | null)?.error?.code === "BAD_ORIGIN";
  } catch {
    return false;
  }
}

/** Where the firewall's rules are set, and which launch-day step sets them (reports/beta-infrastructure.md). */
const FIREWALL_STEP = "Vercel → offersheet → Firewall; reports/beta-infrastructure.md, Launch-day step 2";

/**
 * What's wrong with the answers to CROSS_SITE_PATH asked as a page on another site would ask it (CROSS_SITE) and as the
 * app's own pages do (SAME_ORIGIN), on the production domain (none: an empty list; planner reply to Checkpoint 7c,
 * answer 4: "a request with that header gets 403, and the app still works"). The cross-site one must get the firewall's
 * 403 from CROSS_SITE_RULE: not the app's own BAD_ORIGIN 403 (isAppCrossSiteRefusal: it got past the firewall, so the
 * rate limit counted it toward the visitor's 80), and nothing else. The same-origin one must get through: no 403 and an
 * answer; once production serves the app (`deployed`: after the deploy, --verify), the health check's own 200.
 */
export function crossSiteRuleProblems(cross: { status: number; body: string }, same: { status: number; body: string }, deployed: boolean): string[] {
  const out: string[] = [];
  const rule = `the "${CROSS_SITE_RULE}" firewall rule, first, above "API rate limit", and publish it now (${FIREWALL_STEP})`;
  if (isAppCrossSiteRefusal(cross.status, cross.body)) out.push(`${CROSS_SITE_PATH} with Sec-Fetch-Site: cross-site got the app's own 403 (BAD_ORIGIN), not the firewall's: it passed the firewall, so the rate limit counts it. Add ${rule}`);
  else if (cross.status !== 403) out.push(`${CROSS_SITE_PATH} with Sec-Fetch-Site: cross-site answered ${cross.status || "nothing"}, not 403: add ${rule}`);
  if (same.status === 403) out.push(`${CROSS_SITE_PATH} with Sec-Fetch-Site: same-origin answered 403: a firewall rule denies the app's own requests too ("${CROSS_SITE_RULE}" must match the header sec-fetch-site equals cross-site, nothing else; ${FIREWALL_STEP})`);
  else if (same.status === 0) out.push(`${CROSS_SITE_PATH} with Sec-Fetch-Site: same-origin answered nothing: couldn't confirm the app's own requests get through`);
  else if (deployed && (same.status !== 200 || healthVerdict(same.status, same.body).kind !== "new")) out.push(`${CROSS_SITE_PATH} with Sec-Fetch-Site: same-origin answered ${same.status}, not the health check's 200: the app's own requests must get through`);
  return out;
}

/**
 * What's wrong with the answer to CROSS_SITE_PAGE opened from another site (CROSS_SITE_NAVIGATION) on the production
 * domain (none: an empty list; review of the policy-deploy track, PD-1). A 403 means a firewall rule's cross-site
 * condition lacks "Request Path starts with /api/", so it would deny every page reached from another site, which the
 * /api/ asks alone can't tell from the right rule. Before the app serves (`deployed` false) any other answer passes (the
 * landing page's 200); once it serves (after the deploy, --verify), the page's 200.
 */
export function crossSitePageProblems(status: number, deployed: boolean): string[] {
  const opened = `${CROSS_SITE_PAGE} opened from another site (Sec-Fetch-Site: cross-site)`;
  if (status === 403) return [`${opened} answered 403: a firewall rule denies every page reached from another site (a search result, a link in a post). Its cross-site condition ("${CROSS_SITE_RULE}", or the third OR group of "Block image optimizer") must also require Request Path starts with /api/ (${FIREWALL_STEP})`];
  if (status === 0) return [`${opened} answered nothing: couldn't confirm pages reached from other sites open`];
  if (deployed && status !== 200) return [`${opened} answered ${status}, not 200: pages reached from other sites must open`];
  return [];
}

/**
 * The rollback steps (planner reply to Checkpoint 7b, §2), printed at the end of every live run and in a dry run's summary.
 * `target` is the deployment production served before the deploy; the production domain itself never is (projectFacts).
 */
export function rollbackSteps(target: string | null, origin: string = PRODUCTION_ORIGIN): string {
  const found = vercelHost(target);
  const host = found !== null && !isDomainHost(found, origin) ? found : null;
  const which = host ? `${host} (the deployment production served before the deploy)` : "the deployment production served before the deploy";
  return [
    "To put the previous production deployment back (seconds, no rebuild):",
    `  1. Vercel → offersheet → Deployments → ${which} → ⋯ → Instant Rollback → Confirm.`,
    "     Or in PowerShell, from your home folder (never the project folder):",
    "       cd ~",
    `       npx --yes ${VERCEL_CLI} rollback ${host ? `https://${host}` : "<that deployment's address, from the dashboard>"}`,
    "  2. Hobby rolls back only to the previous production deployment, so this works until the next production deploy.",
    "  3. After a rollback Vercel stops giving new production deployments the domain: Undo Rollback in the dashboard before",
    "     the next npm run prod:deploy can take it. vercel promote, alias and redeploy stay off-limits (CLAUDE.md §19).",
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// The run

/** What runProdDeploy uses from the outside world (realDeps; the tests pass fakes). */
export interface ProdDeployDeps {
  /** git in the main folder (no shell). */
  git: GitRun;
  /** The pinned Vercel CLI (scripts/lib/vercelCli.ts vercel). */
  vercel: (args: readonly string[], opts: { cwd: string; timeoutMs: number }) => CliResult;
  /** An anonymous web request (the production domain). */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** The leak check over `files` read from `base` (true: no hard hit). */
  leakCheck: (files: readonly string[], base: string) => boolean;
  /** The copy's file system. */
  fs: CopyFs;
  /** A file's sha256, null when there's none (.env.local's: never printed). */
  hashFile: (file: string) => string | null;
  /** The versions npm publishes for a spec ("next@16.3"), null when npm couldn't be asked. */
  npmVersions: (spec: string) => string[] | null;
  /** Loads a module by its file (the copy's next.config.ts, step 4: `import()` under tsx). */
  importModule: (file: string) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface ProdDeployOptions {
  /** The main folder (git's; whose .env.local is watched). */
  mainRoot: string;
  /** .env.local's path (tests: a temporary file, never the real one). */
  envLocalPath: string;
  /** The production domain. */
  origin: string;
}

export interface ProdDeployOutcome {
  ok: boolean;
  /** The deploy call was made (files may have gone up). */
  uploaded: boolean;
  /** The new deployment's own address, when the deploy finished. */
  deploymentUrl: string | null;
  /** The deployment production served before (host), when Vercel said. */
  rollbackTarget: string | null;
  failures: number;
  warnings: number;
}

type Mark = "ok" | "warn" | "fail" | "skip";
const ICON: Readonly<Record<Mark, string>> = { ok: "✅", warn: "⚠️", fail: "❌", skip: "–" };

/** The numbered lines (see the header) and their tally. */
class StepLog {
  private n = 0;
  failures = 0;
  warnings = 0;
  constructor(private readonly log: (line: string) => void) {}
  line(mark: Mark, title: string, text: string, detail: readonly string[] = []): void {
    this.n++;
    if (mark === "fail") this.failures++;
    if (mark === "warn") this.warnings++;
    this.log(`${String(this.n).padStart(2)} ${ICON[mark]} ${title}: ${text}`);
    for (const d of detail) this.log(`       ${d}`);
  }
}

/** git's stdout as text, or null when it failed. */
function gitOut(git: GitRun, args: readonly string[]): string | null {
  const r = git(args);
  return r.status === 0 ? r.stdout.toString("utf8") : null;
}

interface Target {
  /** The tag, or "rehearsal" (the deploy's --meta). */
  label: string;
  tag: string | null;
  commit: string | null;
  text: string;
  problems: string[];
}

/** Step 1 (see the header). */
function resolveTarget(args: ProdArgs, git: GitRun): Target {
  if (args.ref) {
    const commit = gitOut(git, ["rev-parse", "--verify", "--quiet", `${args.ref}^{commit}`])?.trim() ?? "";
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) return { label: "rehearsal", tag: null, commit: null, text: `--ref ${args.ref}`, problems: [`${args.ref} isn't a commit of this repository`] };
    const time = Number(gitOut(git, ["show", "-s", "--format=%ct", commit])?.trim());
    const when = Number.isFinite(time) && time > 0 ? ` (committed ${utcTime(time)})` : "";
    return { label: "rehearsal", tag: null, commit, text: `a rehearsal on commit ${commit.slice(0, 7)}${when}, not a tag: a real deploy needs --checkpoint <the approved tag>`, problems: [] };
  }
  const listed = gitOut(git, ["for-each-ref", `--format=${TAG_FORMAT}`, TAG_REFS]);
  if (listed === null) return { label: "rehearsal", tag: null, commit: null, text: "the checkpoint tags", problems: ["git couldn't list the checkpoint tags (is git installed?)"] };
  const v = checkpointVerdict(args.checkpoint, parseTagRefs(listed));
  if (!v.tag) return { label: "rehearsal", tag: null, commit: null, text: args.checkpoint ?? "the newest checkpoint tag", problems: v.problems };
  // --verify checks production against the tag it serves, which needn't be the newest (or annotated) by then.
  if (args.verify) return { label: v.tag.name, tag: v.tag.name, commit: v.tag.commit, text: `${v.tag.name}, commit ${v.tag.commit.slice(0, 7)} (committed ${utcTime(v.tag.time)}): production is checked against it`, problems: [] };
  const kind = v.tag.annotated ? "an annotated tag" : "a lightweight tag";
  const newest = v.tag.commit === v.newest?.commit ? "the newest checkpoint" : "not the newest checkpoint";
  const named = args.checkpoint ? "" : ` (--live needs it named: --checkpoint ${v.tag.name})`;
  return { label: v.tag.name, tag: v.tag.name, commit: v.tag.commit, text: `${v.tag.name}, commit ${v.tag.commit.slice(0, 7)} (committed ${utcTime(v.tag.time)}), ${kind}, ${newest}${named}`, problems: v.problems };
}

/** A web request's status, headers and text; status 0 when nothing answered. `extra`: more request headers (CROSS_SITE …). */
async function get(deps: ProdDeployDeps, url: string, accept: string, extra: Readonly<Record<string, string>> = {}): Promise<{ status: number; headers: Headers; text: string; location: string | null }> {
  try {
    const res = await deps.fetch(url, { redirect: "manual", headers: { accept, ...extra }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return { status: res.status, headers: res.headers, text: await res.text(), location: res.headers.get("location") };
  } catch {
    return { status: 0, headers: new Headers(), text: "", location: null };
  }
}

/** What a run does: a dry run, the local checks only, the deploy, or the checks of the production domain again. */
type Mode = "dry" | "offline" | "live" | "verify";

/** Step 4's title. */
const EXPECT_TITLE = "What the checks after the deploy expect";

/** Runs prod:deploy (see the header) with `deps`; resolves to its outcome (its lines went to deps.log). */
export async function runProdDeploy(args: ProdArgs, deps: ProdDeployDeps, opts: ProdDeployOptions): Promise<ProdDeployOutcome> {
  const mode: Mode = args.live ? "live" : args.verify ? "verify" : args.offline ? "offline" : "dry";
  const steps = new StepLog(deps.log);
  const outcome: ProdDeployOutcome = { ok: false, uploaded: false, deploymentUrl: null, rollbackTarget: null, failures: 0, warnings: 0 };
  deps.log(
    mode === "live"
      ? `prod:deploy: the production deploy of ${args.checkpoint} (checks first; nothing uploads unless every one passes)`
      : mode === "verify"
        ? `prod:deploy --verify: the checks of ${opts.origin} again, against ${args.checkpoint} (no deploy, no Vercel CLI)`
        : mode === "offline"
          ? "prod:deploy --offline: the local checks only (no Vercel CLI, no web request; nothing is uploaded)"
          : "prod:deploy: a dry run (every check; nothing is uploaded; --live --checkpoint <tag> deploys)",
  );
  // The Vercel CLI runs in a dry run and a live run only: .env.local is watched then.
  const watchEnv = mode === "dry" || mode === "live";
  const envBefore = watchEnv ? deps.hashFile(opts.envLocalPath) : null;
  let copy: string | null = null;
  let deployCalls = 0;
  let target: Target | null = null;

  /** Every CLI call goes through here: only the shapes allowedVercelCall takes, a deploy only from the copy, --prod once. */
  const cli = (callArgs: readonly string[], timeoutMs: number): CliResult => {
    if (!allowedVercelCall(callArgs, mode === "live")) throw new Error(`a Vercel CLI call this script never makes was refused (${callArgs[0] ?? "nothing"} …)`);
    if (callArgs[0] === "deploy" && !copy) throw new Error("a deploy outside the clean copy was refused");
    if (callArgs.includes("--prod") && ++deployCalls > 1) throw new Error("a second production deploy in one run was refused");
    return deps.vercel(callArgs, { cwd: copy ?? opts.mainRoot, timeoutMs });
  };

  try {
    // 1. What.
    target = resolveTarget(args, deps.git);
    steps.line(target.problems.length ? "fail" : "ok", "What", target.text, target.problems);
    if (!target.commit) {
      deps.log("       The other checks need a commit to copy: they didn't run.");
      return outcome;
    }
    const commit = target.commit;

    // 2. The clean copy.
    copy = deps.fs.makeTempDir(COPY_PREFIX);
    let exported: ExportedCopy | null = null;
    try {
      exported = exportCommit({ git: deps.git, commit, dest: copy, fs: deps.fs });
    } catch (err) {
      steps.line("fail", "Clean copy", err instanceof CleanCopyError ? err.message : `it couldn't be made (${err instanceof Error ? err.name : "an error"})`);
    }
    const files = exported ? exported.entries.map((e) => e.path) : [];
    if (exported) {
      const differ = verifyCopy(copy, exported.entries, deps.fs);
      steps.line(
        differ.length ? "fail" : "ok",
        "Clean copy",
        differ.length ? "it isn't the commit, byte for byte" : `${files.length} files, ${(exported.bytes / 1e6).toFixed(1)} MB, byte for byte the commit (every blob id checked, nothing else in the folder)`,
        [...differ, `Its .vercelignore lets through: ${exported.roots.join(", ")}.`],
      );

      // 3. What the build needs (not for --verify: nothing is built).
      if (mode !== "verify") {
        const missing: string[] = REQUIRED_IN_COPY.filter((f) => !files.includes(f));
        if (!files.some((f) => f.startsWith("src/app/"))) missing.push("src/app/");
        let vercelJson: string[] = [];
        try {
          vercelJson = files.includes("vercel.json") ? vercelJsonProblems(deps.fs.readFile(path.join(copy, "vercel.json")).toString("utf8")) : [];
        } catch {
          vercelJson = ["it couldn't be read"];
        }
        const buildProblems = [...(missing.length ? [`the copy is missing ${missing.join(", ")}`] : []), ...vercelJson.map((p) => `vercel.json: ${p}`)];
        steps.line(buildProblems.length ? "fail" : "ok", "What the build needs", buildProblems.length ? "see below" : `${REQUIRED_IN_COPY.join(", ")} and src/app/; vercel.json: framework nextjs, region ${REGION}, the daily snapshot cron`, buildProblems);
      }
    }

    // 4. What the checks after the deploy expect, from the tag itself.
    let expectations: Expectations | null = null;
    if (exported) expectations = await expectationsStep(deps, steps, copy, files);
    else steps.line("skip", EXPECT_TITLE, "skipped (no copy)");

    if (mode === "verify") {
      // 15–20, once: the production domain against the tag.
      if (expectations) await afterDeploy(deps, steps, opts.origin, null, expectations, 1);
      else deps.log("       The checks of the production domain need the tag's policy and pages: they didn't run.");
      return outcome;
    }

    if (mode === "offline") {
      // 6 (offline). The leak check is local: it runs; the Vercel steps and the web requests don't.
      if (exported) leakStep(deps, steps, files, copy);
      deps.log("       --offline: Vercel's dry run, Deployment Protection, Production's variables, the production domain, its firewall rules (the image optimizer, cross-site API requests), the rollback target and npm weren't asked.");
      return outcome;
    }

    // 5. Vercel's dry run in the copy.
    if (exported) {
      const r = cli(dryDeployArgs(target.label, commit), READ_TIMEOUT_MS);
      const plan = r.status === 0 ? (jsonOf(r.stdout) as DryRun | null) : null;
      if (r.timedOut) steps.line("fail", "Vercel's dry run in the copy", `it didn't finish in ${READ_TIMEOUT_MS / 60_000} minutes`);
      else if (r.status !== 0) steps.line("fail", "Vercel's dry run in the copy", `it failed (exit ${r.status})`, [tail(r.stderr || r.stdout)]);
      else if (!plan) steps.line("fail", "Vercel's dry run in the copy", "its output couldn't be read");
      else {
        const problems = [...uploadProblems(plan), ...uploadMatchesCopy(uploadPaths(plan), files)];
        const count = plan.fileCount ?? plan.files?.length ?? 0;
        steps.line(problems.length ? "fail" : "ok", "Vercel's dry run in the copy", problems.length ? "what would upload isn't safe" : `${count} files, ${((plan.totalSize ?? 0) / 1e6).toFixed(1)} MB, framework ${plan.framework?.slug}, exactly the copy's files`, problems);
      }
    } else steps.line("skip", "Vercel's dry run in the copy", "skipped (no copy)");

    // 6. The leak check.
    if (exported) leakStep(deps, steps, files, copy);
    else steps.line("skip", "Leak check", "skipped (no copy)");

    // 7. Deployment Protection (protectionVerdict: the name Vercel gives is shown).
    {
      const r = cli(PROTECTION_ARGS, READ_TIMEOUT_MS);
      if (r.status !== 0) steps.line("fail", "Deployment Protection", `reading it failed (exit ${r.status})`, [tail(r.stderr || r.stdout)]);
      else {
        const v = protectionVerdict(protectionMode(jsonOf(r.stdout)));
        steps.line(v.mark, "Deployment Protection", v.text);
      }
    }

    // 8. Production's variables, by name only (never printed: `env ls` can hold a plain variable's value).
    {
      const r = cli(ENV_LIST_ARGS, READ_TIMEOUT_MS);
      const json = r.status === 0 ? jsonOf(r.stdout) : null;
      if (r.status !== 0) steps.line("fail", "Production's variables (names only)", `listing them failed (exit ${r.status})`);
      else if (!json) steps.line("fail", "Production's variables (names only)", "the list couldn't be read");
      else {
        const verdict = productionEnvText(productionEnv(envNames(json, "production")));
        steps.line(verdict.ok ? "ok" : "fail", "Production's variables (names only)", verdict.text, verdict.detail);
      }
    }

    // 9. The production domain answers an anonymous visitor.
    {
      const r = await get(deps, `${opts.origin}/`, "text/html");
      if (r.status === 200) steps.line("ok", "The production domain", `${opts.origin}/ answers 200 to an anonymous visitor (the page it serves now)`);
      else if (looksProtected(r.status, r.location)) steps.line("fail", "The production domain", `${opts.origin}/ asks visitors to log in (${r.status}): it must stay public (Deployment Protection: Standard)`);
      else steps.line("warn", "The production domain", `${opts.origin}/ answered ${r.status || "nothing"}: couldn't confirm it's public (the checks after the deploy will)`);
    }

    // 10. The image optimizer, denied on the production domain already (the firewall rule is the project's).
    {
      const issues = await imageIssues(deps, opts.origin);
      steps.line(issues.length ? "fail" : "ok", "The image optimizer", issues.length ? "open on the production domain" : 'both paths answer 403 on the production domain (the firewall\'s "Block image optimizer" rule)', issues);
    }

    // 11. Cross-site API requests, denied by the firewall already (its rule is the project's too), the app's own not.
    await crossSiteStep(deps, steps, opts.origin, false);

    // 12. The rollback target (and whether Vercel's own variables reach the app).
    {
      const r = cli(PROJECT_API_ARGS, READ_TIMEOUT_MS);
      const facts = r.status === 0 ? projectFacts(jsonOf(r.stdout), opts.origin) : { productionHost: null, namedDomain: false, systemEnvs: null };
      outcome.rollbackTarget = facts.productionHost;
      if (facts.productionHost) steps.line("ok", "Rollback target", `${facts.productionHost} (production serves it now; the rollback steps name it)`);
      else if (facts.namedDomain) steps.line("warn", "Rollback target", `Vercel named a production domain, not a deployment, so it can't be the target (after the deploy the domain serves the new one): the dashboard's Instant Rollback needs no address`);
      else steps.line("warn", "Rollback target", `couldn't read it${r.status !== 0 ? ` (exit ${r.status})` : ""}: the dashboard's Instant Rollback needs no address`);
      if (facts.systemEnvs === false) steps.line("fail", "Vercel's own variables", 'not exposed to the app, so production would run as if off Vercel (no shared store): Settings → Environment Variables → "Automatically expose System Environment Variables"');
    }

    // 13. Next's newest 16.3 patch (warn only).
    if (exported && files.includes("package-lock.json")) {
      const locked = lockedNextVersion(deps.fs.readFile(path.join(copy, "package-lock.json")).toString("utf8"));
      const spec = locked ? `next@${locked.split(".").slice(0, 2).join(".")}` : null;
      const published = spec ? deps.npmVersions(spec) : null;
      const newer = locked && published ? newerPatch(locked, published) : null;
      if (!locked || !published) steps.line("warn", "Next", `couldn't compare the tag's next with npm's (npm view ${spec ?? "next"} version)`);
      else if (newer) steps.line("warn", "Next", `${newer} is on npm and the tag has ${locked}: a patch needs a new approved tag (launch-day step 3)`);
      else steps.line("ok", "Next", `${locked}, the newest ${spec} patch on npm`);
    } else steps.line("skip", "Next", "skipped (no package-lock.json in the copy)");

    if (mode !== "live") return outcome;
    // (No expectations means step 2 or 4 failed: counted above.)
    if (steps.failures || !expectations) {
      deps.log(`\nNothing was uploaded: ${steps.failures} check(s) failed (❌ above).`);
      return outcome;
    }

    // 14. THE deploy, from the copy.
    deps.log("\nDeploying to production: Vercel builds the tag's copy (about 2–3 minutes)…");
    outcome.uploaded = true;
    const dep = cli(liveDeployArgs(target.label, commit), DEPLOY_TIMEOUT_MS);
    const url = dep.status === 0 && !dep.timedOut ? prodDeploymentUrl(dep.stdout, dep.stderr, opts.origin) : null;
    if (dep.timedOut) steps.line("fail", "Deploy", `the CLI didn't finish in ${DEPLOY_TIMEOUT_MS / 60_000} minutes. The build may still finish on Vercel and take the domain: check Vercel → offersheet → Deployments`);
    else if (dep.status !== 0 || !url) steps.line("fail", "Deploy", `it failed (exit ${dep.status}${dep.status === 0 ? ", no deployment address in its answer" : ""}). A build that fails never takes the domain, so production still serves what it served before`, [tail(dep.stderr || dep.stdout)]);
    else {
      outcome.deploymentUrl = url;
      steps.line("ok", "Deploy", `${url.replace(/^https:\/\//, "")}, built and given the production domain (${target.tag}, commit ${commit.slice(0, 7)})`);
      await afterDeploy(deps, steps, opts.origin, url, expectations, HEALTH_TRIES);
    }
    return outcome;
  } catch (err) {
    steps.line("fail", "Stopped", err instanceof Error ? err.message : String(err));
    return outcome;
  } finally {
    if (copy) {
      try {
        deps.fs.removeDir(copy);
      } catch {
        steps.line("warn", "The temp copy", `it couldn't be removed (it holds only the tag's public code): delete the folders named ${COPY_PREFIX}* in your temp folder`);
      }
    }
    if (watchEnv) {
      const after = deps.hashFile(opts.envLocalPath);
      if (after === envBefore) steps.line("ok", ".env.local", "unchanged by the Vercel CLI");
      else steps.line("fail", ".env.local", "CHANGED while the Vercel CLI ran (it may have written a token into it, as `vercel link` once did). Run npm run check-env, and delete any VERCEL_ line it doesn't know");
    }
    outcome.failures = steps.failures;
    outcome.warnings = steps.warnings;
    outcome.ok = steps.failures === 0;
    summary(deps, mode, outcome, target, opts.origin);
  }
}

/**
 * Step 4 (see the header): what the checks after the deploy compare with, from the tag itself. The tag's own policy
 * (tagPolicy over the copy's next.config.ts, loaded with deps.importModule) and the app pages it has (pagesPlan); null
 * when either can't be known, which fails the step.
 */
async function expectationsStep(deps: ProdDeployDeps, steps: StepLog, copy: string, files: readonly string[]): Promise<Expectations | null> {
  let csp: string | null = null;
  let why = "";
  if (!files.includes("next.config.ts")) why = "the copy has no next.config.ts";
  else {
    try {
      csp = tagPolicy(await deps.importModule(path.join(copy, "next.config.ts")));
      if (!csp) why = "its next.config.ts gives no contentSecurityPolicy";
    } catch (err) {
      why = `its next.config.ts couldn't be loaded (${err instanceof Error ? err.name : "an error"})`;
    }
  }
  const plan = pagesPlan(files, APP_PAGES);
  const notes: string[] = [];
  if (plan.missing.length) notes.push(`APP_PAGES lists ${plan.missing.join(", ")}, which the tag doesn't have (this folder has moved past it?): not asked after the deploy.`);
  if (plan.unlisted.length) notes.push(`The tag has ${plan.unlisted.join(", ")}, which APP_PAGES doesn't list: not asked after the deploy.`);
  const problems = [...(csp ? [] : [`the tag's own Content-Security-Policy: ${why}`]), ...(plan.pages.length ? [] : ["the tag has none of the app pages (APP_PAGES)"])];
  if (!csp || problems.length) {
    steps.line("fail", EXPECT_TITLE, "see below", [...problems, ...notes]);
    return null;
  }
  steps.line(notes.length ? "warn" : "ok", EXPECT_TITLE, `the tag's own Content-Security-Policy (its next.config.ts) and its ${plan.pages.length} app pages (APP_PAGES)`, notes);
  return { csp, pages: plan.pages };
}

/** Step 6 (see the header): the leak check over the copy's files, its own lines first. */
function leakStep(deps: ProdDeployDeps, steps: StepLog, files: readonly string[], copy: string): void {
  deps.log("       (the leak check's own lines follow)");
  const passed = deps.leakCheck(files, copy);
  steps.line(passed ? "ok" : "fail", "Leak check", passed ? `no hard hit in the copy's ${files.length} files (.env.local's values, the redaction maps and watch lists)` : "it found something in the copy's files (its lines above)");
}

/** The image optimizer's paths on the production domain (IMAGE_PATHS), as imageRuleProblems reads them (none: all 403). */
async function imageIssues(deps: ProdDeployDeps, origin: string): Promise<string[]> {
  const images: Array<{ path: string; status: number }> = [];
  for (const p of IMAGE_PATHS) images.push({ path: p, status: (await get(deps, `${origin}${p}`, "image/png")).status });
  return imageRuleProblems(images);
}

/**
 * Step 11, and again after the deploy and with --verify (see the header): CROSS_SITE_PATH asked as another site's page
 * would ask it, then as the app's own pages do, read by crossSiteRuleProblems; then CROSS_SITE_PAGE as a link on another
 * site opens it, read by crossSitePageProblems. Its line names statuses and the rule only.
 */
async function crossSiteStep(deps: ProdDeployDeps, steps: StepLog, origin: string, deployed: boolean): Promise<void> {
  const cross = await get(deps, `${origin}${CROSS_SITE_PATH}`, "application/json", CROSS_SITE);
  const same = await get(deps, `${origin}${CROSS_SITE_PATH}`, "application/json", SAME_ORIGIN);
  const page = await get(deps, `${origin}${CROSS_SITE_PAGE}`, "text/html", CROSS_SITE_NAVIGATION);
  const problems = [...crossSiteRuleProblems({ status: cross.status, body: cross.text }, { status: same.status, body: same.text }, deployed), ...crossSitePageProblems(page.status, deployed)];
  const passes = deployed
    ? `with same-origin, 200 (the app's health check); ${CROSS_SITE_PAGE} opened from another site, 200 (the app's home page)`
    : `with same-origin, ${same.status}, not denied; ${CROSS_SITE_PAGE} opened from another site, ${page.status}, not denied (the deployment production serves now)`;
  steps.line(problems.length ? "fail" : "ok", "Cross-site API requests", problems.length ? "see below" : `${CROSS_SITE_PATH} with Sec-Fetch-Site: cross-site answers 403 (the firewall's "${CROSS_SITE_RULE}" rule); ${passes}`, problems);
}

/**
 * Steps 15–21 (see the header): the production domain after the deploy, or again with --verify (`deploymentUrl` null:
 * its own address isn't known, and isn't asked). /api/health is asked up to `tries` times until the domain serves the app.
 */
async function afterDeploy(deps: ProdDeployDeps, steps: StepLog, origin: string, deploymentUrl: string | null, expect: Expectations, tries: number): Promise<void> {
  let health: HealthVerdict = { kind: "retry", text: "not asked" };
  for (let i = 1; i <= tries; i++) {
    const r = await get(deps, `${origin}/api/health`, "application/json");
    health = healthVerdict(r.status, r.text);
    if (health.kind === "new") break;
    if (i < tries) await deps.sleep(HEALTH_WAIT_MS);
  }
  if (health.kind !== "new") {
    const why = health.kind === "old" ? "no /api/health" : health.text;
    steps.line(
      "fail",
      "Health",
      tries > 1
        ? `${origin} still serves the deployment from before (${why}) after ${tries} tries. It may still be switching (ask again in a minute with --verify); after a rollback, though, Vercel stops giving new deployments the domain: Undo Rollback in the dashboard`
        : `${origin} doesn't serve the app (${why}): the deployment from before the deploy still has the domain, a rollback put it back, or it's still switching`,
    );
    deps.log("       The other checks of the production domain didn't run.");
    return;
  }
  steps.line(health.problems.length ? "fail" : health.warnings.length ? "warn" : "ok", "Health", health.problems.length ? "the new deployment isn't right" : health.text, [...health.problems, ...health.warnings]);

  const pageIssues: string[] = [];
  for (const p of expect.pages) {
    const r = await get(deps, `${origin}${p}`, "text/html");
    pageIssues.push(...pageProblems({ path: p, status: r.status, csp: r.headers.get("content-security-policy"), cspReportOnly: r.headers.get("content-security-policy-report-only"), html: r.text }, expect.csp, origin));
  }
  steps.line(pageIssues.length ? "fail" : "ok", "Pages", pageIssues.length ? `${pageIssues.length} problem(s) on the ${expect.pages.length} app pages` : `all ${expect.pages.length} answer 200 with the tag's own Content-Security-Policy, the footer's FantasyCalc link, and nothing loaded from another site`, pageIssues);

  const robots = await get(deps, `${origin}/robots.txt`, "text/plain");
  const robotsIssues = robotsProblems(robots.status, robots.text, origin);
  steps.line(robotsIssues.length ? "fail" : "ok", "robots.txt", robotsIssues.length ? "see below" : `Disallow: /api/, and the sitemap at ${origin}/sitemap.xml`, robotsIssues);

  const cron = await get(deps, `${origin}${SNAPSHOT_CRON_PATH}`, "application/json");
  const cronIssues = cronProblems(cron.status, cron.text);
  steps.line(cronIssues.length ? "fail" : "ok", "The cron route", cronIssues.length ? "see below" : "a bare 401 without the secret", cronIssues);

  const images = await imageIssues(deps, origin);
  steps.line(images.length ? "fail" : "ok", "The image optimizer", images.length ? "open" : "both paths answer 403 (the firewall rule)", images);

  // The cross-site rule again, now with the app behind it: its own refusal must not stand in for the firewall's.
  await crossSiteStep(deps, steps, origin, true);

  if (!deploymentUrl) return;
  const own = await get(deps, deploymentUrl, "text/html");
  if (looksProtected(own.status, own.location)) steps.line("ok", "The deployment's own address", `asks visitors to log in (${own.status})`);
  else steps.line("warn", "The deployment's own address", `answered ${own.status || "nothing"} to an anonymous visitor: check Deployment Protection (a production deployment is never removed here)`);
}

/** Why the summary never suggests a second --live to check again (Hobby's rollback reaches only the previous production deployment). */
const NO_SECOND_LIVE = "never a second --live to check again: a second production deploy leaves the rollback no way back to the landing page";

/** The run's last lines: what happened, and the rollback steps (a live run, a dry run, and a --verify whose checks failed). */
function summary(deps: ProdDeployDeps, mode: Mode, outcome: ProdDeployOutcome, target: Target | null, origin: string): void {
  const warn = outcome.warnings ? `; ${outcome.warnings} warning(s) (⚠️ above)` : "";
  const again = verifyCommand(target?.tag ?? "<the tag>");
  if (mode === "offline") {
    deps.log(`\nOffline: ${outcome.failures ? `${outcome.failures} problem(s) (❌ above)` : "the local checks passed"}${warn}. Nothing was uploaded.`);
    return;
  }
  if (mode === "verify") {
    deps.log(outcome.failures ? `\nVerify: ${outcome.failures} check(s) failed (❌ above)${warn}. Nothing was deployed: decide whether to roll back.` : `\nVerify: ${origin} passes every check${warn}. Nothing was deployed.`);
    if (outcome.failures) deps.log(`\n${rollbackSteps(null, origin)}`);
    return;
  }
  if (mode === "dry") {
    const next = target?.tag ? `npm run prod:deploy -- --live --checkpoint ${target.tag}` : "npm run prod:deploy -- --live --checkpoint <the approved tag>";
    deps.log(outcome.failures ? `\nDry run: ${outcome.failures} check(s) to fix before the go (❌ above)${warn}. Nothing was uploaded.` : `\nDry run: every check passed${warn}. Nothing was uploaded. After Parker's "go":\n  ${next}`);
    deps.log(`\nIf the launch goes wrong, the rollback:\n${rollbackSteps(outcome.rollbackTarget, origin)}`);
    return;
  }
  if (!outcome.uploaded) deps.log(`\nNothing was uploaded${outcome.failures ? `: ${outcome.failures} check(s) failed (❌ above)` : ""}. Production still serves what it served before.`);
  else if (!outcome.deploymentUrl) deps.log(`\nThe deploy didn't finish (❌ above). Production still serves what it served before, unless the build finishes later: check Vercel → offersheet → Deployments, and once it's Ready, ask the domain with:\n  ${again}\n(${NO_SECOND_LIVE}).`);
  else if (outcome.ok) deps.log(`\nProduction serves ${target?.tag ?? "the tag"} at ${origin} (deployment ${outcome.deploymentUrl.replace(/^https:\/\//, "")})${warn}. Open it on your phone and import your league.`);
  else deps.log(`\nThe deploy went up, but ${outcome.failures} check(s) failed (❌ above): decide now whether to roll back. To ask the production domain again without deploying:\n  ${again}\n(${NO_SECOND_LIVE}).`);
  deps.log(`\n${rollbackSteps(outcome.rollbackTarget, origin)}`);
}

// ---------------------------------------------------------------------------------------------
// The real world

/** The versions npm publishes for `spec` (`npm view <spec> version --json`, through npm's own script: no shell), or null. */
function npmVersions(spec: string): string[] | null {
  const cli = npmCliPath(process.env, process.execPath);
  if (!cli) return null;
  const r = spawnSync(process.execPath, [cli, "view", spec, "version", "--json"], { cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 60_000 });
  if (r.status !== 0) return null;
  try {
    const v = JSON.parse(r.stdout) as unknown;
    return (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string");
  } catch {
    return null;
  }
}

/** The real git, CLI, web, leak check, file system and console (main). */
export function realDeps(mainRoot: string = ROOT): ProdDeployDeps {
  return {
    git: (args, input) => {
      const r = spawnSync("git", args, { cwd: mainRoot, windowsHide: true, maxBuffer: 512 * 1024 * 1024, ...(input !== undefined ? { input } : {}) });
      return { status: r.status ?? 1, stdout: r.stdout ?? Buffer.alloc(0), stderr: r.stderr ? r.stderr.toString("utf8") : "" };
    },
    vercel: (args, o) => vercel(args, o),
    fetch: (url, init) => fetch(url, init),
    leakCheck: (files, base) => leakCheckPasses({ files, base }),
    fs: nodeCopyFs,
    hashFile: (file) => (existsSync(file) ? fileSha256(file) : null),
    npmVersions,
    // tsx loads the copy's next.config.ts (its one import, NextConfig, is a type and goes when it's compiled).
    importModule: (file) => import(pathToFileURL(file).href) as Promise<unknown>,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => console.log(line),
  };
}

async function main(): Promise<void> {
  const parsed = parseProdArgs(process.argv.slice(2), process.env);
  if ("error" in parsed) {
    console.error(`prod:deploy: ${parsed.error}`);
    process.exit(1);
  }
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  // Belt and braces (scripts/lib/runMode.ts), as in every script: "off" without --live (networkLive).
  setNetworkMode(networkLive(parsed));
  const outcome = await runProdDeploy(parsed, realDeps(), { mainRoot: ROOT, envLocalPath: path.join(ROOT, ".env.local"), origin: PRODUCTION_ORIGIN });
  process.exitCode = outcome.ok ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(`prod:deploy: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
