/**
 * npm run prod:deploy (planner reply to Checkpoint 7b, §2): its command line, the tag rules, every verdict on Vercel's and
 * the production domain's answers, the rollback steps, and whole runs with a fake git, CLI, web and leak check (the copy
 * is written to real temporary folders, and its next.config.ts is loaded as the script loads it). Nothing here runs the
 * Vercel CLI, reaches the network or reads .env.local.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real withRoute (the app's own answer to a cross-site request) imports server-only modules.
vi.mock("server-only", () => ({}));

import { withRoute } from "@/app/api/_lib/route";
import { createMemoryLimiter } from "@/server/rateLimit";
import { contentSecurityPolicy } from "../next.config";
import { APP_PAGES } from "./check-browser/contracts";
import { gitBlobId, nodeCopyFs, type CopyFs, type GitRun } from "./lib/cleanCopy";
import { NETWORK_ENV, setNetworkMode } from "./lib/runMode";
import { ROOT, type CliResult } from "./lib/vercelCli";
import {
  allowedVercelCall,
  checkpointVerdict,
  cronProblems,
  CROSS_SITE,
  CROSS_SITE_NAVIGATION,
  CROSS_SITE_PAGE,
  CROSS_SITE_PATH,
  CROSS_SITE_RULE,
  crossSitePageProblems,
  crossSiteRuleProblems,
  dryDeployArgs,
  ENV_LIST_ARGS,
  HEALTH_TRIES,
  healthVerdict,
  IMAGE_PATHS,
  imageRuleProblems,
  isAppCrossSiteRefusal,
  LIVE_COMMAND,
  liveDeployArgs,
  lockedNextVersion,
  networkLive,
  newerPatch,
  pageProblems,
  pageRoutes,
  pagesPlan,
  parseProdArgs,
  prodDeploymentUrl,
  PRODUCTION_ORIGIN,
  productionEnv,
  productionEnvText,
  projectFacts,
  PROJECT_API_ARGS,
  PROTECTION_ARGS,
  protectionVerdict,
  robotsProblems,
  rollbackSteps,
  runProdDeploy,
  SAME_ORIGIN,
  STANDARD_PROTECTIONS,
  tagPolicy,
  uploadMatchesCopy,
  USAGE,
  utcTime,
  VERIFY_COMMAND,
  verifyCommand,
  vercelJsonProblems,
  type ProdArgs,
  type ProdDeployDeps,
} from "./prod-deploy";
import { TAG_FORMAT, TAG_REFS, type TagInfo } from "./stable";

let dirs: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const args = (argv: string[]): ProdArgs => {
  const p = parseProdArgs(argv);
  if ("error" in p) throw new Error(p.error);
  return p;
};

// ---------------------------------------------------------------------------------------------

describe("the command line", () => {
  const base = { live: false, offline: false, verify: false, help: false, checkpoint: null, ref: null };

  it("no flags is a dry run on the newest checkpoint; --checkpoint, --ref, --offline, --verify and --help as written", () => {
    expect(parseProdArgs([])).toEqual(base);
    expect(parseProdArgs(["--checkpoint", "checkpoint-7c"])).toEqual({ ...base, checkpoint: "checkpoint-7c" });
    expect(parseProdArgs(["--checkpoint=checkpoint-7c"])).toEqual({ ...base, checkpoint: "checkpoint-7c" });
    expect(parseProdArgs(["--ref", "HEAD"])).toEqual({ ...base, ref: "HEAD" });
    expect(parseProdArgs(["--offline", "--ref", "HEAD~1"])).toEqual({ ...base, offline: true, ref: "HEAD~1" });
    expect(parseProdArgs(["--live", "--checkpoint", "checkpoint-7c"])).toEqual({ ...base, live: true, checkpoint: "checkpoint-7c" });
    expect(parseProdArgs(["--verify", "--checkpoint", "checkpoint-7c"])).toEqual({ ...base, verify: true, checkpoint: "checkpoint-7c" });
    expect(parseProdArgs(["--help"])).toEqual({ ...base, help: true });
  });

  it("--live needs --checkpoint; --ref is for dry runs only; the pairs that don't go together are refused", () => {
    expect(parseProdArgs(["--live"])).toEqual({ error: `--live needs --checkpoint <the approved tag>, so the tag that goes live is named: ${LIVE_COMMAND}` });
    expect(parseProdArgs(["--live", "--ref", "HEAD"])).toMatchObject({ error: expect.stringContaining("--ref is for dry runs only") });
    expect(parseProdArgs(["--live", "--offline", "--checkpoint", "checkpoint-7c"])).toMatchObject({ error: expect.stringContaining("--offline makes no Vercel call") });
    expect(parseProdArgs(["--checkpoint", "checkpoint-7c", "--ref", "HEAD"])).toEqual({ error: "Pick one: --checkpoint <tag> or --ref <commit>." });
    expect(parseProdArgs(["--checkpoint"])).toMatchObject({ error: expect.stringContaining("needs a value") });
    expect(parseProdArgs(["--checkpoint", "--live"])).toMatchObject({ error: expect.stringContaining("needs a value") });
    expect(parseProdArgs(["--checkpoint", "v1.0"])).toMatchObject({ error: expect.stringContaining("checkpoint tag's name") });
    expect(parseProdArgs(["--checkpoint", "checkpoint-7c", "--checkpoint", "checkpoint-7b"])).toMatchObject({ error: expect.stringContaining("twice") });
    expect(parseProdArgs(["--live=yes"])).toMatchObject({ error: "--live takes no value." });
  });

  it("--verify needs --checkpoint (the tag production serves) and goes with nothing else", () => {
    expect(parseProdArgs(["--verify"])).toEqual({ error: `--verify needs --checkpoint <the tag production serves>, so the checks compare with that tag: ${VERIFY_COMMAND}` });
    for (const extra of [["--live"], ["--offline"], ["--ref", "HEAD"]]) {
      expect(parseProdArgs(["--verify", "--checkpoint", "checkpoint-7c", ...extra]), extra.join(" ")).toMatchObject({ error: expect.stringContaining("--verify only asks the production domain again") });
    }
    expect(parseProdArgs(["--verify=1"])).toMatchObject({ error: "--verify takes no value." });
    expect(verifyCommand("checkpoint-7c")).toBe("npm run prod:deploy -- --verify --checkpoint checkpoint-7c");
  });

  it("refuses anything that reads like production, npm's own --tag and --dry-run, unknown options and stray words", () => {
    for (const a of ["--prod", "--production", "--target", "--target=production", "promote", "--public"]) {
      expect(parseProdArgs(["--checkpoint", "checkpoint-7c", a]), a).toMatchObject({ error: expect.stringContaining("Refused") });
    }
    expect(parseProdArgs(["--tag", "checkpoint-7c"])).toMatchObject({ error: expect.stringContaining("Use --checkpoint <the approved tag>") });
    expect(parseProdArgs(["--dry-run"])).toMatchObject({ error: expect.stringContaining("its own dry run") });
    expect(parseProdArgs(["--force"])).toMatchObject({ error: expect.stringContaining('Unknown option "--force"') });
    expect(parseProdArgs(["checkpoint-7c"])).toMatchObject({ error: expect.stringContaining(`Unexpected "checkpoint-7c": was the "--" before the options left out? Write it as: ${LIVE_COMMAND}`) });
  });

  it("sets the offline guard to \"off\" without --live, as every script does (CLAUDE.md §0.9; deploy-7)", () => {
    const modes = [[], ["--offline"], ["--verify", "--checkpoint", "checkpoint-7c"], ["--ref", "HEAD"], ["--live", "--checkpoint", "checkpoint-7c"]].map((argv) => {
      const env: Record<string, string | undefined> = {};
      setNetworkMode(networkLive(args(argv)), env);
      return env[NETWORK_ENV];
    });
    expect(modes).toEqual(["off", "off", "off", "off", "live"]);
  });

  it("a dropped \"--\" (npm keeps --live, --checkpoint, --ref or --verify as its own setting) stops it, with the command spelled out", () => {
    for (const env of [{ npm_config_live: "true" }, { npm_config_checkpoint: "true" }, { npm_config_ref: "HEAD" }, { npm_config_verify: "true" }, { npm_config_live: "" }]) {
      expect(parseProdArgs(["checkpoint-7c"], env)).toMatchObject({ error: expect.stringContaining(`the "--" before the options was left out or dropped. Nothing ran. Write it as: ${LIVE_COMMAND}`) });
    }
    expect(parseProdArgs([], { npm_config_offline: "true", npm_config_tag: "latest" })).toEqual(base); // npm's own settings of other names don't matter
    // The command spelled out names no fixed tag: the launch tag is checkpoint-7d once approved, else checkpoint-7c.
    expect(LIVE_COMMAND).toBe("npm run prod:deploy -- --live --checkpoint <the approved tag>");
    // Nor does the --verify command, the usage or any of the command line's errors (review of Checkpoint 7d, PD7D-5: they
    // named checkpoint-7c, and --verify checks production against any tag it's given, so the one copied after a launch on
    // another tag would have checked production against a tag it doesn't serve). Only a word the command line itself
    // carried comes back (an unexpected word, an option it doesn't know).
    expect(VERIFY_COMMAND).toBe("npm run prod:deploy -- --verify --checkpoint <the tag production serves>");
    expect(USAGE).not.toMatch(/checkpoint-\d/);
    expect(USAGE).toContain(`  ${LIVE_COMMAND} `);
    expect(USAGE).toContain(`  ${VERIFY_COMMAND} `);
    expect(USAGE).toContain("  npm run prod:deploy -- --checkpoint <the approved tag> ");
    const tagless = [["--verify"], ["--verify", "--live"], ["--verify", "--ref", "HEAD"], ["--live"], ["--checkpoint"], ["--checkpoint", "v1.0"], ["--tag", "x"], ["--ref", "--live"], ["--live", "--ref", "HEAD"], ["--force"], ["--dry-run"], ["--prod"], ["stray"]];
    for (const argv of tagless) {
      const parsed = parseProdArgs(argv);
      expect("error" in parsed && parsed.error, argv.join(" ")).toEqual(expect.any(String));
      expect("error" in parsed ? parsed.error : "", argv.join(" ")).not.toMatch(/checkpoint-\d/);
    }
    expect(parseProdArgs(["--verify", "--checkpoint", "checkpoint-zz", "--live"])).toMatchObject({ error: expect.stringContaining(`alone: ${VERIFY_COMMAND}`) });
  });
});

describe("what to deploy: the newest checkpoint, an annotated tag", () => {
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const tags: TagInfo[] = [
    { name: "checkpoint-7b", commit: A, time: 100, annotated: true },
    { name: "checkpoint-7c", commit: B, time: 200, annotated: true },
    { name: "checkpoint-7c-light", commit: B, time: 200, annotated: false },
    { name: "checkpoint-old-light", commit: A, time: 100, annotated: false },
  ];

  it("an annotated tag on the newest checkpoint passes, named or not; another tag on the same commit is the same code", () => {
    expect(checkpointVerdict("checkpoint-7c", tags)).toMatchObject({ tag: { name: "checkpoint-7c" }, problems: [] });
    expect(checkpointVerdict(null, [tags[0] as TagInfo, tags[1] as TagInfo])).toMatchObject({ tag: { name: "checkpoint-7c" }, problems: [] });
  });

  it("refuses a lightweight tag, an older checkpoint, a tag that isn't there, and no tags at all", () => {
    expect(checkpointVerdict("checkpoint-7c-light", tags).problems.join(" ")).toContain("is a lightweight tag: production deploys only an annotated checkpoint tag");
    expect(checkpointVerdict("checkpoint-7b", tags).problems.join(" ")).toContain("checkpoint-7b isn't the newest checkpoint");
    expect(checkpointVerdict("checkpoint-old-light", tags).problems).toHaveLength(2);
    expect(checkpointVerdict("checkpoint-9", tags)).toMatchObject({ tag: null, problems: [expect.stringContaining("there's no checkpoint tag checkpoint-9")] });
    expect(checkpointVerdict(null, [])).toMatchObject({ tag: null, problems: [expect.stringContaining("no checkpoint tag yet")] });
  });

  it("prints commit times in UTC", () => {
    expect(utcTime(1_791_700_000)).toBe("2026-10-11 06:26 UTC");
  });
});

describe("the copy and what would upload", () => {
  it("the project's vercel.json has the framework, the region and the snapshot cron; anything missing is named", () => {
    expect(vercelJsonProblems(readFileSync(path.join(ROOT, "vercel.json"), "utf8"))).toEqual([]);
    expect(vercelJsonProblems('{"framework":"nextjs","regions":["iad1"],"crons":[]}').join(" ")).toContain("snapshot cron");
    expect(vercelJsonProblems('{"framework":null,"regions":["sfo1"],"crons":[{"path":"/api/cron/snapshot"}]}')).toHaveLength(2);
    expect(vercelJsonProblems("not json")).toEqual(["it isn't valid JSON"]);
  });

  it("the CLI must list exactly the copy's files (.vercelignore either way; ./ and backslashes read as the same path)", () => {
    const copy = [".vercelignore", "package.json", "src/app/page.tsx"];
    expect(uploadMatchesCopy(["package.json", "src/app/page.tsx"], copy)).toEqual([]);
    expect(uploadMatchesCopy(["./package.json", "src\\app\\page.tsx", ".vercelignore"], copy)).toEqual([]);
    expect(uploadMatchesCopy(["package.json", "src/app/page.tsx", ".env.local"], copy)).toEqual(["it would upload 1 file(s) the copy doesn't have, e.g. .env.local"]);
    expect(uploadMatchesCopy(["package.json"], copy)).toEqual(["it would leave out 1 of the copy's file(s), e.g. src/app/page.tsx"]);
  });

  it("reads the tag's next from its lock file, and finds a newer patch of the same minor only", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { dependencies: { next: string } };
    expect(lockedNextVersion(readFileSync(path.join(ROOT, "package-lock.json"), "utf8"))).toBe(pkg.dependencies.next);
    expect(lockedNextVersion("{}")).toBeNull();
    expect(lockedNextVersion("not json")).toBeNull();
    expect(newerPatch("16.3.7", ["16.3.6", "16.3.7", "16.3.8", "16.3.10", "16.4.0", "16.3.11-canary.1"])).toBe("16.3.10");
    expect(newerPatch("16.3.7", ["16.3.7"])).toBeNull();
    expect(newerPatch("16.3.7-canary.2", ["16.3.8"])).toBeNull();
  });
});

describe("what the checks after the deploy expect, from the tag itself (deploy-3)", () => {
  it("the app's pages as addresses: route groups left out of the address; dynamic, private and parallel folders skipped", () => {
    const files = [
      "src/app/page.tsx",
      "src/app/connect/page.tsx",
      "src/app/(marketing)/about/page.tsx",
      "src/app/league/[id]/page.tsx",
      "src/app/_parts/page.tsx",
      "src/app/@modal/page.tsx",
      "src/app/api/health/route.ts",
      "src/app/settings/page.jsx",
      "src/app/layout.tsx",
      "src/lib/page.tsx",
    ];
    expect(pageRoutes(files)).toEqual(["/", "/about", "/connect", "/settings"]);
  });

  it("the project's own pages are exactly APP_PAGES (a page added later must join the list, or neither check asks it)", () => {
    const files = nodeCopyFs.listFiles(path.join(ROOT, "src", "app")).map((f) => `src/app/${f}`);
    expect(pagesPlan(files, APP_PAGES)).toEqual({ pages: [...APP_PAGES], missing: [], unlisted: [] });
  });

  it("asks only the app pages the tag has, and names both differences", () => {
    const files = ["src/app/page.tsx", "src/app/league/page.tsx", "src/app/waivers/page.tsx"];
    expect(pagesPlan(files, ["/", "/league", "/feedback"])).toEqual({ pages: ["/", "/league"], missing: ["/feedback"], unlisted: ["/waivers"] });
  });

  it("the tag's policy comes from its own next.config.ts: a named export, one on the default export, or none", () => {
    const csp = contentSecurityPolicy({ vercelPreview: false });
    const fn = (o: { vercelPreview: boolean }) => (o.vercelPreview ? "a preview's" : csp);
    expect(tagPolicy({ contentSecurityPolicy: fn })).toBe(csp);
    expect(tagPolicy({ default: { contentSecurityPolicy: fn } })).toBe(csp);
    expect(tagPolicy({ default: {} })).toBeNull();
    expect(tagPolicy({ contentSecurityPolicy: () => "" })).toBeNull();
    expect(tagPolicy({ contentSecurityPolicy: () => 42 })).toBeNull();
    expect(
      tagPolicy({
        contentSecurityPolicy: () => {
          throw new Error("broken");
        },
      }),
    ).toBeNull();
    expect(tagPolicy(null)).toBeNull();
  });

  it("the project's next.config.ts, copied out of the project and loaded by its file as the script loads it, gives the production policy", async () => {
    const dir = tempDir("proddeploy-config-");
    writeFileSync(path.join(dir, "next.config.ts"), readFileSync(path.join(ROOT, "next.config.ts")));
    writeFileSync(path.join(dir, "package.json"), readFileSync(path.join(ROOT, "package.json")));
    const mod: unknown = await import(pathToFileURL(path.join(dir, "next.config.ts")).href);
    expect(tagPolicy(mod)).toBe(contentSecurityPolicy({ vercelPreview: false }));
  });
});

describe("production's variables, by name only", () => {
  const all = new Set(["SESSION_SECRET", "CRON_SECRET", "KV_REST_API_URL", "KV_REST_API_TOKEN", "KV_REST_API_READ_ONLY_TOKEN", "KV_URL", "REDIS_URL"]);

  it("everything the app reads, with the Marketplace's extras noted as not read", () => {
    expect(productionEnv(all)).toEqual({ present: ["SESSION_SECRET", "CRON_SECRET", "KV_REST_API_URL", "KV_REST_API_TOKEN"], missing: [], forbidden: [], notRead: ["KV_REST_API_READ_ONLY_TOKEN", "KV_URL", "REDIS_URL"] });
    const text = productionEnvText(productionEnv(all));
    expect(text.ok).toBe(true);
    expect(text.text).toBe("SESSION_SECRET, CRON_SECRET, KV_REST_API_URL, KV_REST_API_TOKEN set; none of the names that must not be there");
    expect(text.detail).toEqual(["Present, not read by the app: KV_REST_API_READ_ONLY_TOKEN, KV_URL, REDIS_URL.", "CONTACT_EMAIL is a constant in the code (src/lib/site.ts), not a variable."]);
  });

  it("a mixed pair of store names works (the app reads either), and with both pairs the app's first is the one read", () => {
    expect(productionEnv(new Set(["SESSION_SECRET", "CRON_SECRET", "UPSTASH_REDIS_REST_URL", "KV_REST_API_TOKEN"])).missing).toEqual([]);
    const both = productionEnv(new Set([...all, "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]));
    expect(both.present).toEqual(["SESSION_SECRET", "CRON_SECRET", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]);
    expect(both.notRead).toContain("KV_REST_API_URL");
  });

  it("names what's missing and how to add it, and what must not be there", () => {
    const noCron = productionEnvText(productionEnv(new Set([...all].filter((n) => n !== "CRON_SECRET" && n !== "SESSION_SECRET"))));
    expect(noCron.ok).toBe(false);
    expect(noCron.detail[0]).toBe("Missing: SESSION_SECRET (npm run vercel:secret -- --live --env production); CRON_SECRET (npm run vercel:secret -- --live --name CRON_SECRET).");
    const bad = productionEnv(new Set([...all, "ESPN_S2", "OFFERSHEET_CSP_REPORT_ONLY", "NODE_ENV", "OFFERSHEET_NETWORK", "READONLY_STORE_TOKEN"]));
    expect(bad.forbidden.map((f) => f.name)).toEqual(["ESPN_S2", "NODE_ENV", "OFFERSHEET_CSP_REPORT_ONLY", "OFFERSHEET_NETWORK", "READONLY_STORE_TOKEN"]);
    expect(productionEnvText(bad).ok).toBe(false);
    expect(productionEnv(new Set()).missing.map((m) => m.label)).toEqual(["SESSION_SECRET", "CRON_SECRET", "the store's address", "the store's token"]);
  });

  it("the project's JSON gives the rollback target's host and whether Vercel's own variables reach the app, nothing else", () => {
    expect(projectFacts({ targets: { production: { url: "offersheet-abc-team.vercel.app" } }, autoExposeSystemEnvs: true, env: [{ key: "X", value: "v" }] })).toEqual({ productionHost: "offersheet-abc-team.vercel.app", namedDomain: false, systemEnvs: true });
    expect(projectFacts({ targets: { production: { url: "https://Offersheet-ABC-team.vercel.app/x" } } })).toEqual({ productionHost: "offersheet-abc-team.vercel.app", namedDomain: false, systemEnvs: null });
    expect(projectFacts({ targets: { production: { url: "evil.example.com" } }, autoExposeSystemEnvs: false })).toEqual({ productionHost: null, namedDomain: false, systemEnvs: false });
    expect(projectFacts(null)).toEqual({ productionHost: null, namedDomain: false, systemEnvs: null });
  });

  it("never the production domain itself as the rollback target: after the deploy it serves the new deployment (deploy-2)", () => {
    for (const url of ["offersheet.vercel.app", "https://OFFERSHEET.vercel.app/", PRODUCTION_ORIGIN]) {
      expect(projectFacts({ targets: { production: { url } }, autoExposeSystemEnvs: true }), url).toEqual({ productionHost: null, namedDomain: true, systemEnvs: true });
    }
    // A custom domain later: the project's own offersheet.vercel.app still serves production, never one deployment.
    expect(projectFacts({ targets: { production: { url: "offersheet.vercel.app" } } }, "https://offersheet.app")).toMatchObject({ productionHost: null, namedDomain: true });
    expect(projectFacts({ targets: { production: { url: "offersheet.app" } } }, "https://offersheet.app")).toMatchObject({ productionHost: null, namedDomain: false }); // not a vercel.app host at all
    expect(projectFacts({ targets: { production: { url: "offersheet-x1-team.vercel.app" } } }, "https://offersheet.app")).toMatchObject({ productionHost: "offersheet-x1-team.vercel.app", namedDomain: false });
  });
});

describe("Deployment Protection (deploy-6)", () => {
  it("Standard under either of Vercel's names passes, and the line names the one read", () => {
    expect(STANDARD_PROTECTIONS).toEqual(["all_except_custom_domains", "prod_deployment_urls_and_all_previews"]);
    for (const mode of STANDARD_PROTECTIONS) {
      expect(protectionVerdict(mode)).toEqual({ mark: "ok", text: `Standard ("${mode}"): deployment addresses ask visitors to log in, the production domain doesn't (it's asked below)` });
    }
  });

  it("off and \"all\" fail; \"preview\" and a name it doesn't know only warn (the production domain is asked anyway)", () => {
    expect(protectionVerdict(null)).toMatchObject({ mark: "fail", text: expect.stringContaining("off: previews and deployment addresses would be public") });
    expect(protectionVerdict("all")).toMatchObject({ mark: "fail", text: expect.stringContaining("every visitor of the production domain would have to log in") });
    expect(protectionVerdict("preview")).toMatchObject({ mark: "warn", text: expect.stringContaining("a production deployment's own address doesn't") });
    expect(protectionVerdict("something_new")).toMatchObject({ mark: "warn", text: expect.stringContaining('"something_new", a setting this script doesn\'t know') });
  });
});

describe("the Vercel CLI calls it may make", () => {
  it("its own calls: the dry run, protection, the variables' names and the project's JSON; the deploy with --prod only live", () => {
    for (const live of [false, true]) {
      expect(allowedVercelCall(dryDeployArgs("checkpoint-7c", "a".repeat(40)), live)).toBe(true);
      expect(allowedVercelCall(dryDeployArgs("rehearsal", "a".repeat(40)), live)).toBe(true);
      expect(allowedVercelCall(PROTECTION_ARGS, live)).toBe(true);
      expect(allowedVercelCall(ENV_LIST_ARGS, live)).toBe(true);
      expect(allowedVercelCall(PROJECT_API_ARGS, live)).toBe(true);
    }
    expect(allowedVercelCall(liveDeployArgs("checkpoint-7c", "a".repeat(40)), true)).toBe(true);
    expect(allowedVercelCall(liveDeployArgs("checkpoint-7a-part-a", "a".repeat(40)), true)).toBe(true);
    expect(allowedVercelCall(liveDeployArgs("checkpoint-7c", "a".repeat(40)), false)).toBe(false);
    expect(liveDeployArgs("checkpoint-7c", "abc")).toEqual(["deploy", "--prod", "--project", "offersheet", "--format", "json", "--meta", "offersheetCheckpoint=checkpoint-7c", "--meta", "offersheetCommit=abc"]);
    expect(dryDeployArgs("rehearsal", "abc")).toEqual(["deploy", "--dry", "--project", "offersheet", "--meta", "offersheetCheckpoint=rehearsal", "--meta", "offersheetCommit=abc"]);
  });

  it("never link, env pull or add, promote, alias, redeploy, rollback, remove, a preview deploy, --skip-domain or a write to the API", () => {
    const refused = [
      ["link", "--project", "offersheet", "--yes"],
      ["env", "pull", ".env.local"],
      ["env", "add", "X", "production"],
      ["promote", "https://offersheet-x.vercel.app"],
      ["alias", "set", "x", "offersheet.vercel.app"],
      ["redeploy", "https://offersheet-x.vercel.app", "--target", "production"],
      ["rollback", "https://offersheet-x.vercel.app"],
      ["remove", "https://offersheet-x.vercel.app", "--yes"],
      ["deploy", "--project", "offersheet"],
      ["deploy", "--dry", "--prod", "--project", "offersheet"],
      ["deploy", "--prod", "--skip-domain", "--project", "offersheet"],
      ["deploy", "--prod", "--project", "offersheet", "--force"],
      ["deploy", "--prod", "--project", "offersheet", "--env", "X=1"],
      ["api", "/v9/projects/offersheet", "-X", "PATCH"],
      ["api", "/v1/security/firewall/config"],
      ["project", "protection", "offersheet", "--sso"],
      ["inspect", "https://offersheet.vercel.app"],
      [],
    ];
    for (const a of refused) for (const live of [false, true]) expect(allowedVercelCall(a, live), a.join(" ")).toBe(false);
  });

  it("refuses the '=' and single-dash forms of those flags, another project, a path to deploy, and anything but the exact calls (deploy-5)", () => {
    const dry = ["deploy", "--dry", "--project", "offersheet"];
    const prod = ["deploy", "--prod", "--project", "offersheet"];
    const refused = [
      [...prod, "--skip-domain=true"],
      [...prod, "--build-env=OFFERSHEET_CSP_REPORT_ONLY=1"],
      [...prod, "--env=X=1"],
      [...prod, "--force=true"],
      [...prod, "--public=true"],
      [...prod, "--target=production"],
      [...prod, "-eX=1"],
      [...prod, "-e", "X=1"],
      [...prod, "-bX=1"],
      [...prod, "-f"],
      ["deploy", "--prod=true", "--project", "offersheet"],
      ["deploy", "--dry", "--project=offersheet"],
      ["deploy", "--dry", "--project", "other-project"],
      ["deploy", "--prod", "--project", "other-project"],
      ["deploy", "--dry"],
      [...dry, "--project", "offersheet"],
      [...dry, "--dry"],
      [...prod, "C:/elsewhere"],
      [...dry, "../other-folder"],
      [...dry, "--format", "text"],
      [...dry, "--meta", "somethingElse=1"],
      [...dry, "--meta", "offersheetCommit=a b"],
      [...dry, "--meta", "offersheetCommit=abc", "--meta", "offersheetCommit=def"],
      [...dry, "--archive", "tgz"],
      ["env", "ls", "production", "--project", "other-project", "--format", "json"],
      ["env", "ls", "preview", "--project", "offersheet", "--format", "json"],
      ["env", "ls", "production", "--project", "offersheet", "--format", "json", "--debug"],
      ["api", "/v9/projects/other-project"],
      ["api", "/v9/projects/offersheet/env"],
      ["project", "protection", "other-project"],
    ];
    for (const a of refused) for (const live of [false, true]) expect(allowedVercelCall(a, live), a.join(" ")).toBe(false);
  });

  it("the code holds no such call: none of those words stands alone as a string, and every CLI call goes through the guard", () => {
    for (const file of ["scripts/prod-deploy.ts", "scripts/lib/vercelCli.ts"]) {
      const code = readFileSync(path.join(ROOT, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code.match(/(["'`])(link|pull|promote|alias|aliases|redeploy|rollback|remove|rm)\1/g) ?? [], file).toEqual([]);
    }
    const source = readFileSync(path.join(ROOT, "scripts", "prod-deploy.ts"), "utf8");
    expect(source.match(/deps\.vercel\(/g)).toHaveLength(1);
  });
});

describe("the production domain after the deploy", () => {
  const healthy = { status: "ok", environment: "production", region: "iad1", store: "shared", storeReason: null, storeCheck: { ok: true, setMs: 2.1, getMs: 1, delMs: 0.9 }, storeCheckAgeS: 0 };

  it("health: production on the shared store passes; the old deployment, a slow answer and a broken one are told apart", () => {
    expect(healthVerdict(200, JSON.stringify(healthy))).toEqual({ kind: "new", problems: [], warnings: [], text: "production, the shared store (set 2.1 ms, get 1 ms, del 0.9 ms), region iad1" });
    expect(healthVerdict(404, "Not Found")).toEqual({ kind: "old" });
    expect(healthVerdict(200, "<!DOCTYPE html><html>the landing page</html>")).toEqual({ kind: "old" });
    expect(healthVerdict(200, '{"hello":"world"}')).toEqual({ kind: "old" });
    expect(healthVerdict(0, "")).toMatchObject({ kind: "retry" });
    expect(healthVerdict(503, "")).toMatchObject({ kind: "retry" });
    expect(healthVerdict(429, "")).toMatchObject({ kind: "retry" });
    expect(healthVerdict(401, "")).toMatchObject({ kind: "new", problems: [expect.stringContaining("log in")] });
  });

  it("health: without Vercel's own variables the app answers \"ok\" from a file store, which fails; so does a failed store check; another region warns", () => {
    const offVercel = { status: "ok", environment: "local", region: null, store: "file", storeReason: "not_on_vercel", storeCheck: null, storeCheckAgeS: null };
    const v = healthVerdict(200, JSON.stringify(offVercel));
    expect(v.kind === "new" && v.problems.join(" ")).toContain('environment "local", not "production"');
    expect(v.kind === "new" && v.problems.join(" ")).toContain('store "file" (not_on_vercel), not "shared"');
    const failed = healthVerdict(200, JSON.stringify({ ...healthy, status: "degraded", storeCheck: { ok: false, step: "set", errorName: "TimeoutError" } }));
    expect(failed).toMatchObject({ kind: "new", problems: ["the store check failed (set: TimeoutError)"] });
    expect(healthVerdict(200, JSON.stringify({ ...healthy, region: "sfo1" }))).toMatchObject({ kind: "new", problems: [], warnings: ["region sfo1, not iad1 (vercel.json)"] });
  });

  const csp = contentSecurityPolicy({ vercelPreview: false });
  const footer = '<footer><a href="https://fantasycalc.com" rel="noopener" referrerpolicy="origin">Trade values: FantasyCalc</a></footer>';
  const html = `<html><head><script src="/_next/static/chunks/main.js" async=""></script></head><body><main>Offer Sheet</main>${footer}</body></html>`;
  const page = { path: "/league", status: 200, csp, cspReportOnly: null, html };

  it("a page: 200, the expected policy, the footer's FantasyCalc link and nothing from another site", () => {
    expect(pageProblems(page, csp)).toEqual([]);
    expect(pageProblems({ ...page, csp: `${csp.replace(/; /g, ";  ")} ` }, csp)).toEqual([]); // spacing doesn't matter
    expect(pageProblems({ ...page, status: 500 }, csp)).toEqual(["/league: HTTP 500"]);
    expect(pageProblems({ ...page, csp: null }, csp)).toEqual(["/league: no Content-Security-Policy"]);
    expect(pageProblems({ ...page, csp: csp.replace("script-src 'self'", "script-src 'self' https://cdn.example") }, csp)).toEqual(["/league: its Content-Security-Policy isn't the production one (script-src)"]);
    expect(pageProblems({ ...page, cspReportOnly: csp }, csp).join(" ")).toContain("Report-Only");
    expect(pageProblems({ ...page, html: html.replace("</head>", '<script src="https://cdn.example/x.js"></script></head>') }, csp)).toEqual(["/league: loads a <script src> from cdn.example"]);
    expect(pageProblems({ ...page, html: html.replace(footer, "") }, csp)).toEqual(["/league: no link to https://fantasycalc.com in the footer"]);
    expect(pageProblems({ ...page, html: html.replace('rel="noopener"', 'rel="noopener noreferrer"') }, csp).join(" ")).toContain('not exactly "noopener"');
  });

  it("robots.txt names the production sitemap; the cron route answers a bare 401; the image optimizer 403", () => {
    const robots = "User-Agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://offersheet.vercel.app/sitemap.xml\n";
    expect(robotsProblems(200, robots)).toEqual([]);
    expect(robotsProblems(200, robots.replace("https://offersheet.vercel.app", "http://127.0.0.1:3000")).join(" ")).toContain("VERCEL_PROJECT_PRODUCTION_URL");
    expect(robotsProblems(200, robots.replace("Disallow: /api/\n", ""))).toEqual(["robots.txt doesn't say Disallow: /api/"]);
    expect(robotsProblems(404, "")).toEqual(["robots.txt: HTTP 404"]);
    expect(cronProblems(401, "")).toEqual([]);
    for (const [status, body] of [[200, '{"status":"ok"}'], [403, ""], [503, '{"status":"no_store"}'], [401, "Unauthorized"]] as const) {
      expect(cronProblems(status, body), `${status}`).toHaveLength(1);
    }
    expect(imageRuleProblems([{ path: "/_next/image?url=x", status: 403 }, { path: "/_vercel/image?url=x", status: 403 }])).toEqual([]);
    expect(imageRuleProblems([{ path: "/_next/image?url=x", status: 403 }, { path: "/_vercel/image?url=x", status: 200 }])).toEqual([
      '/_vercel/image answered 200, not 403: add the "Block image optimizer" firewall rule and publish it now (Vercel → offersheet → Firewall; reports/beta-infrastructure.md, Launch-day step 2)',
    ]);
    // No answer at all says nothing about the rule (its Deny always answers 403): unconfirmed, never a rule to add (PD7D-4).
    expect(imageRuleProblems([{ path: "/_next/image?url=x", status: 0 }, { path: "/_vercel/image?url=x", status: 403 }])).toEqual([
      '/_next/image answered nothing: couldn\'t confirm the "Block image optimizer" firewall rule denies it',
    ]);
    expect(imageRuleProblems([{ path: "/_next/image?url=x", status: 0 }, { path: "/_vercel/image?url=x", status: 0 }])).toEqual([
      '/_next/image and /_vercel/image answered nothing: couldn\'t confirm the "Block image optimizer" firewall rule denies them',
    ]);
    expect(imageRuleProblems([{ path: "/_next/image?url=x", status: 200 }, { path: "/_vercel/image?url=x", status: 0 }])).toEqual([
      '/_next/image answered 200, not 403: add the "Block image optimizer" firewall rule and publish it now (Vercel → offersheet → Firewall; reports/beta-infrastructure.md, Launch-day step 2)',
      '/_vercel/image answered nothing: couldn\'t confirm the "Block image optimizer" firewall rule denies it',
    ]);
  });

  it("the new deployment's own address, never the production domain the output also names", () => {
    expect(prodDeploymentUrl('{"deployment":{"url":"offersheet-abc123-team.vercel.app"}}', "")).toBe("https://offersheet-abc123-team.vercel.app");
    expect(prodDeploymentUrl('{"url":"https://offersheet-abc123-team.vercel.app"}', "")).toBe("https://offersheet-abc123-team.vercel.app");
    expect(prodDeploymentUrl('{"deployment":{"url":"offersheet.vercel.app"}}', "Production: https://offersheet.vercel.app [3m]\nInspect: https://offersheet-xyz9-team.vercel.app")).toBe("https://offersheet-xyz9-team.vercel.app");
    expect(prodDeploymentUrl("", "Aliased: https://offersheet.vercel.app")).toBeNull();
    expect(prodDeploymentUrl("nothing", "")).toBeNull();
    // With a custom domain as the origin, the project's own vercel.app alias still isn't the deployment.
    expect(prodDeploymentUrl('{"url":"offersheet.vercel.app"}', "Inspect: https://offersheet-xyz9-team.vercel.app", "https://offersheet.app")).toBe("https://offersheet-xyz9-team.vercel.app");
  });
});

describe("the firewall's cross-site rule (planner reply to Checkpoint 7c, answer 4)", () => {
  const DENIED = { status: 403, body: "Forbidden" };
  const LANDING_404 = { status: 404, body: "Not Found" };
  const HEALTH_200 = { status: 200, body: JSON.stringify({ status: "ok", environment: "production", region: "iad1", store: "shared", storeReason: null, storeCheck: { ok: true, setMs: 2, getMs: 1, delMs: 1 }, storeCheckAgeS: 0 }) };
  const APP_REFUSAL = { status: 403, body: JSON.stringify({ error: { code: "BAD_ORIGIN", message: "This request didn't come from Offer Sheet, so we ignored it." } }) };

  it("passes when the cross-site ask gets the firewall's 403 and the same-origin one gets through: anything but 403 before the deploy, the health check's 200 after", () => {
    expect([CROSS_SITE_RULE, CROSS_SITE_PATH, CROSS_SITE, SAME_ORIGIN]).toEqual(["Deny cross-site API requests", "/api/health", { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-origin" }]);
    expect(crossSiteRuleProblems(DENIED, LANDING_404, false)).toEqual([]);
    expect(crossSiteRuleProblems(DENIED, HEALTH_200, false)).toEqual([]); // production already serves the app (a later deploy)
    expect(crossSiteRuleProblems(DENIED, HEALTH_200, true)).toEqual([]);
    expect(crossSiteRuleProblems({ status: 403, body: "<html>Forbidden</html>" }, HEALTH_200, true)).toEqual([]);
  });

  it("a cross-site ask that isn't denied fails, naming the rule and where to add it, before the deploy and after", () => {
    const fix = `add the "${CROSS_SITE_RULE}" firewall rule, first, above "API rate limit", and publish it now (Vercel → offersheet → Firewall; reports/beta-infrastructure.md, Launch-day step 2)`;
    expect(crossSiteRuleProblems(LANDING_404, LANDING_404, false)).toEqual([`/api/health with Sec-Fetch-Site: cross-site answered 404, not 403: ${fix}`]);
    expect(crossSiteRuleProblems({ status: 429, body: "" }, HEALTH_200, true)).toEqual([`/api/health with Sec-Fetch-Site: cross-site answered 429, not 403: ${fix}`]);
  });

  it("a cross-site ask that gets no answer at all fails as unconfirmed, never as a rule to add: the rule's Deny always answers 403, so nothing means the domain or the network (review of Checkpoint 7d, PD7D-4)", () => {
    const unconfirmed = `/api/health with Sec-Fetch-Site: cross-site answered nothing: couldn't confirm the "${CROSS_SITE_RULE}" firewall rule denies it`;
    for (const deployed of [false, true]) {
      expect(crossSiteRuleProblems({ status: 0, body: "" }, deployed ? HEALTH_200 : LANDING_404, deployed)).toEqual([unconfirmed]);
    }
    expect(crossSiteRuleProblems({ status: 0, body: "" }, LANDING_404, false).join(" ")).not.toMatch(/add the|publish it now/);
    // With the same-origin ask unanswered too, each says what it couldn't confirm.
    expect(crossSiteRuleProblems({ status: 0, body: "" }, { status: 0, body: "" }, false)).toEqual([unconfirmed, "/api/health with Sec-Fetch-Site: same-origin answered nothing: couldn't confirm the app's own requests get through"]);
  });

  it("the app's own 403 (BAD_ORIGIN) isn't the firewall's: the request got past the rate limit's count, so it fails", () => {
    expect(isAppCrossSiteRefusal(APP_REFUSAL.status, APP_REFUSAL.body)).toBe(true);
    expect(isAppCrossSiteRefusal(403, "Forbidden")).toBe(false);
    expect(isAppCrossSiteRefusal(403, '{"error":{"code":"RATE_LIMITED"}}')).toBe(false);
    expect(isAppCrossSiteRefusal(400, APP_REFUSAL.body)).toBe(false);
    expect(crossSiteRuleProblems(APP_REFUSAL, HEALTH_200, true)).toEqual([
      `/api/health with Sec-Fetch-Site: cross-site got the app's own 403 (BAD_ORIGIN), not the firewall's: it passed the firewall, so the rate limit counts it. Add the "${CROSS_SITE_RULE}" firewall rule, first, above "API rate limit", and publish it now (Vercel → offersheet → Firewall; reports/beta-infrastructure.md, Launch-day step 2)`,
    ]);
  });

  it("the same-origin ask must get through: a 403 means the rule catches the app's own requests; no answer, or after the deploy anything but the health check, fails", () => {
    expect(crossSiteRuleProblems(DENIED, DENIED, false)).toEqual([`/api/health with Sec-Fetch-Site: same-origin answered 403: a firewall rule denies the app's own requests too ("${CROSS_SITE_RULE}" must match the header sec-fetch-site equals cross-site, nothing else; Vercel → offersheet → Firewall; reports/beta-infrastructure.md, Launch-day step 2)`]);
    expect(crossSiteRuleProblems(DENIED, { status: 0, body: "" }, false)).toEqual(["/api/health with Sec-Fetch-Site: same-origin answered nothing: couldn't confirm the app's own requests get through"]);
    expect(crossSiteRuleProblems(DENIED, LANDING_404, true)).toEqual(["/api/health with Sec-Fetch-Site: same-origin answered 404, not the health check's 200: the app's own requests must get through"]);
    expect(crossSiteRuleProblems(DENIED, { status: 200, body: "<html>the landing page</html>" }, true)).toHaveLength(1);
    // Both wrong: each is named.
    expect(crossSiteRuleProblems(LANDING_404, DENIED, false)).toHaveLength(2);
  });

  it("a page opened from another site must open: a 403 means the rule lost its /api/ path condition (review of the policy-deploy track, PD-1)", () => {
    expect([CROSS_SITE_PAGE, CROSS_SITE_NAVIGATION]).toEqual(["/", { "sec-fetch-site": "cross-site", "sec-fetch-dest": "document", "sec-fetch-user": "?1" }]);
    // Before the app serves, anything but a 403 or no answer (the landing page's 200, a redirect, a 404); after it, the page's 200.
    for (const status of [200, 302, 404]) expect(crossSitePageProblems(status, false), String(status)).toEqual([]);
    expect(crossSitePageProblems(200, true)).toEqual([]);
    const fix = `/ opened from another site (Sec-Fetch-Site: cross-site) answered 403: a firewall rule denies every page reached from another site (a search result, a link in a post). Its cross-site condition ("${CROSS_SITE_RULE}", or the third OR group of "Block image optimizer") must also require Request Path starts with /api/ (Vercel → offersheet → Firewall; reports/beta-infrastructure.md, Launch-day step 2)`;
    expect(crossSitePageProblems(403, false)).toEqual([fix]);
    expect(crossSitePageProblems(403, true)).toEqual([fix]);
    expect(crossSitePageProblems(0, false)).toEqual(["/ opened from another site (Sec-Fetch-Site: cross-site) answered nothing: couldn't confirm pages reached from other sites open"]);
    expect(crossSitePageProblems(500, true)).toEqual(["/ opened from another site (Sec-Fetch-Site: cross-site) answered 500, not 200: pages reached from other sites must open"]);
  });

  it("the real withRoute's answer to another site's request reads as the app's refusal, never as the firewall's 403; the app's own pages' request gets the handler's answer", async () => {
    const route = withRoute("health", async () => new Response(HEALTH_200.body, { status: 200, headers: { "content-type": "application/json" } }), { limiter: createMemoryLimiter(), env: {} });
    const refused = await route(new Request(`${PRODUCTION_ORIGIN}${CROSS_SITE_PATH}`, { headers: CROSS_SITE }));
    const refusal = { status: refused.status, body: await refused.text() };
    expect(refusal.status).toBe(403);
    expect(isAppCrossSiteRefusal(refusal.status, refusal.body)).toBe(true);
    expect(crossSiteRuleProblems(refusal, HEALTH_200, true).join(" ")).toContain("got the app's own 403 (BAD_ORIGIN), not the firewall's");
    const own = await route(new Request(`${PRODUCTION_ORIGIN}${CROSS_SITE_PATH}`, { headers: SAME_ORIGIN }));
    expect(crossSiteRuleProblems(DENIED, { status: own.status, body: await own.text() }, true)).toEqual([]);
  });
});

describe("the rollback steps", () => {
  it("name the deployment production served before, with the dashboard first and the CLI from the home folder", () => {
    expect(rollbackSteps("offersheet-dtgsgk03x-team.vercel.app")).toBe(
      [
        "To put the previous production deployment back (seconds, no rebuild):",
        "  1. Vercel → offersheet → Deployments → offersheet-dtgsgk03x-team.vercel.app (the deployment production served before the deploy) → ⋯ → Instant Rollback → Confirm.",
        "     Or in PowerShell, from your home folder (never the project folder):",
        "       cd ~",
        "       npx --yes vercel@62.2.0 rollback https://offersheet-dtgsgk03x-team.vercel.app",
        "  2. Hobby rolls back only to the previous production deployment, so this works until the next production deploy.",
        "  3. After a rollback Vercel stops giving new production deployments the domain: Undo Rollback in the dashboard before",
        "     the next npm run prod:deploy can take it. vercel promote, alias and redeploy stay off-limits (CLAUDE.md §19).",
      ].join("\n"),
    );
  });

  it("without a known address, the dashboard's own list; the production domain is never the address (deploy-2)", () => {
    const text = rollbackSteps(null);
    expect(text).toContain("Deployments → the deployment production served before the deploy → ⋯ → Instant Rollback → Confirm.");
    expect(text).toContain("npx --yes vercel@62.2.0 rollback <that deployment's address, from the dashboard>");
    expect(rollbackSteps("not a vercel host")).toBe(text);
    expect(rollbackSteps("offersheet.vercel.app")).toBe(text);
    expect(rollbackSteps("https://offersheet.vercel.app")).toBe(text);
  });
});

// ---------------------------------------------------------------------------------------------
// Whole runs, with fakes

const COMMIT_NEW = "c7".repeat(20);
const COMMIT_OLD = "b7".repeat(20);
const TAG_OBJECT = "d0".repeat(20);
const TAG_NEW = { name: "checkpoint-7c", commit: COMMIT_NEW, time: 1_791_700_000, annotated: true };
const TAG_OLD = { name: "checkpoint-7b", commit: COMMIT_OLD, time: 1_791_300_000, annotated: true };
const LANDING = "offersheet-landing01-team.vercel.app";
const NEW_DEPLOYMENT = "offersheet-new0001-team.vercel.app";
const PROD_ENV = ["SESSION_SECRET", "CRON_SECRET", "KV_REST_API_URL", "KV_REST_API_TOKEN", "KV_REST_API_READ_ONLY_TOKEN", "KV_URL", "REDIS_URL"];
const CSP = contentSecurityPolicy({ vercelPreview: false });
const FOOTER = '<footer><a href="https://fantasycalc.com" rel="noopener" referrerpolicy="origin">Trade values: FantasyCalc</a></footer>';
const APP_HTML = `<!DOCTYPE html><html><head><script src="/_next/static/chunks/main.js" async=""></script><link rel="preload" as="script" href="/_next/static/chunks/a.js"/></head><body><main>Offer Sheet</main>${FOOTER}<script>self.__next_f.push([1,"<script src=\\"https://cdn.example/x.js\\">"])</script></body></html>`;
const HEALTHY = { status: "ok", environment: "production", region: "iad1", store: "shared", storeReason: null, storeCheck: { ok: true, setMs: 2.1, getMs: 1, delMs: 0.9 }, storeCheckAgeS: 0 };
const ROBOTS = "User-Agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://offersheet.vercel.app/sitemap.xml\n";

/** A next.config.ts whose production policy is `csp` (the script loads the copy's, as it does the tag's). */
const nextConfig = (csp: string) =>
  `import type { NextConfig } from "next";\n\nexport function contentSecurityPolicy(opts: { vercelPreview: boolean }): string {\n  return opts.vercelPreview ? "a preview's policy" : ${JSON.stringify(csp)};\n}\n\nconst nextConfig: NextConfig = {};\nexport default nextConfig;\n`;
/** A page file for each app page (the tag's pages are what the checks after the deploy ask). */
const pageFile = (route: string) => `src/app${route === "/" ? "" : route}/page.tsx`;
const PAGES: Record<string, string> = Object.fromEntries(APP_PAGES.map((p) => [pageFile(p), `// ${p}\nexport default function Page() {\n  return null;\n}\n`]));

const REPO_FILES: Record<string, string> = {
  ".vercelignore": "# allowlist\n/*\n!/src\n!/public\n!/package.json\n!/package-lock.json\n!/next.config.ts\n!/vercel.json\n",
  ...PAGES,
  "src/app/layout.tsx": "export default function Layout() {\n  return null;\n}\n",
  "public/robots-note.txt": "public\n",
  "package.json": '{ "name": "fantasy-trade-finder" }\n',
  "package-lock.json": JSON.stringify({ packages: { "node_modules/next": { version: "16.3.7" } } }),
  "next.config.ts": nextConfig(CSP),
  "vercel.json": JSON.stringify({ framework: "nextjs", regions: ["iad1"], crons: [{ path: "/api/cron/snapshot", schedule: "0 20 * * *" }] }),
  "fixtures/raw/league.json": "{}\n",
  "reports/STATUS.md": "never copied\n",
};
/** The files the copy holds (REPO_FILES under the allowlist's roots, .vercelignore included). */
const COPY_COUNT = Object.keys(REPO_FILES).filter((p) => !p.startsWith("fixtures/") && !p.startsWith("reports/")).length;

/** `files` without `paths`. */
function without(files: Record<string, string>, ...paths: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([p]) => !paths.includes(p)));
}

/** A fake git over a repository of `files` with `tags` (and HEAD at COMMIT_NEW): the commands the run makes, nothing else. */
function fakeGit(tags: typeof TAG_NEW[], files: Record<string, string> = REPO_FILES): { git: GitRun; calls: string[][] } {
  const blobs = new Map(Object.values(files).map((c) => [gitBlobId(Buffer.from(c)), Buffer.from(c)]));
  const commits = new Set([COMMIT_NEW, ...tags.map((t) => t.commit)]);
  const calls: string[][] = [];
  const ok = (out: string | Buffer) => ({ status: 0, stdout: Buffer.isBuffer(out) ? out : Buffer.from(out), stderr: "" });
  const no = { status: 128, stdout: Buffer.alloc(0), stderr: "fatal" };
  const git: GitRun = (a, input) => {
    calls.push([...a]);
    if (a[0] === "for-each-ref") {
      expect([...a]).toEqual(["for-each-ref", `--format=${TAG_FORMAT}`, TAG_REFS]);
      return ok(tags.map((t) => (t.annotated ? `${t.name}\ttag\t${TAG_OBJECT}\t\tcommit\t${t.commit}\t${t.time}` : `${t.name}\tcommit\t${t.commit}\t${t.time}\t\t\t`)).join("\n"));
    }
    if (a[0] === "rev-parse") {
      const ref = (a[3] ?? "").replace(/\^\{commit\}$/, "");
      const commit = ref === "HEAD" ? COMMIT_NEW : (tags.find((t) => t.name === ref)?.commit ?? (commits.has(ref) ? ref : null));
      return commit ? ok(`${commit}\n`) : { ...no, status: 1 };
    }
    if (a[0] === "show" && a[1] === "-s") return ok(`${tags.find((t) => t.commit === a[3])?.time ?? 1_791_800_000}\n`);
    if (a[0] === "cat-file" && a[1] === "blob") {
      const [commit, file] = (a[2] ?? "").split(":");
      const content = file ? files[file] : undefined;
      return commit && commits.has(commit) && content !== undefined ? ok(content) : no;
    }
    if (a[0] === "--literal-pathspecs" && a[1] === "ls-tree") {
      const roots = a.slice(a.indexOf("--") + 1);
      const listed = Object.entries(files).filter(([p]) => roots.some((r) => p === r || p.startsWith(`${r}/`)));
      return ok(listed.map(([p, c]) => `100644 blob ${gitBlobId(Buffer.from(c))} ${String(Buffer.byteLength(c)).padStart(7)}\t${p}\u0000`).join(""));
    }
    if (a[0] === "cat-file" && a[1] === "--batch") {
      const ids = (input ?? "").split("\n").filter(Boolean);
      return ok(Buffer.concat(ids.flatMap((id) => [Buffer.from(`${id} blob ${(blobs.get(id) as Buffer).length}\n`), blobs.get(id) as Buffer, Buffer.from("\n")])));
    }
    return no;
  };
  return { git, calls };
}

interface Call {
  args: string[];
  cwd: string;
  /** The copy was there when the CLI was called (its package.json). */
  inCopy: boolean;
}

interface RunOptions {
  argv: string[];
  tags?: typeof TAG_NEW[];
  /** The repository's files (REPO_FILES by default). */
  files?: Record<string, string>;
  /** Production's variable names. */
  env?: string[];
  protection?: string | null;
  productionUrl?: string | null;
  /** The project JSON's autoExposeSystemEnvs (true by default). */
  systemEnvs?: boolean;
  /** Vercel's dry run: its exit status, files it would also upload, and copy files it would leave out. */
  dryRun?: { status?: number; extra?: string[]; drop?: string[] };
  deploy?: Partial<CliResult>;
  leakPasses?: boolean;
  npm?: string[] | null;
  /** The copy's writes flip a byte of this file (a copy that isn't the commit). */
  corruptWrite?: string;
  /** The production domain already serves the app (a --verify run). */
  deployed?: boolean;
  /** The policy the app's pages are served with (the folder's CSP by default). */
  servedCsp?: string;
  /** Answers for some of the production domain's paths ("/api/health" …) or the new deployment's host, before and after the deploy. */
  web?: Record<string, () => Response>;
  /** The same, only once the deploy happened. */
  webAfter?: Record<string, () => Response>;
  /**
   * The firewall's "Deny cross-site API requests" rule (the project's, so in front of every deployment): "on" (default)
   * denies /api/ requests with Sec-Fetch-Site: cross-site; "off" lets them through to whatever the domain serves (the
   * app's own BAD_ORIGIN 403 once it serves the app); "broad" denies every /api/ request that sends the header; "noPath"
   * is the rule without its path condition, which denies every cross-site request, pages opened from another site
   * included (review of the policy-deploy track, PD-1).
   */
  crossSiteRule?: "on" | "off" | "broad" | "noPath";
  /** The fake CLI changes .env.local on this command (`vercel link` once wrote into it). */
  touchEnvOn?: string;
  /** The fake CLI throws on this command. */
  throwOn?: string;
}

const html = (body: string, headers: Record<string, string> = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

/** A whole run with fakes; the copy goes to a real temporary folder, .env.local is a temporary file with a made-up line. */
async function run(o: RunOptions) {
  const parsed = args(o.argv);
  const root = tempDir("proddeploy-");
  const envFile = path.join(root, ".env.local");
  writeFileSync(envFile, "SESSION_SECRET=made-up-for-this-test-only\n");
  const state = { deployed: o.deployed ?? false, healthAsked: 0 };
  const repo = fakeGit(o.tags ?? [TAG_OLD, TAG_NEW], o.files ?? REPO_FILES);
  const calls: Call[] = [];
  const vercel = (a: readonly string[], opt: { cwd: string; timeoutMs: number }): CliResult => {
    calls.push({ args: [...a], cwd: opt.cwd, inCopy: existsSync(path.join(opt.cwd, "package.json")) });
    if (o.touchEnvOn === a[0]) writeFileSync(envFile, "VERCEL_OIDC_TOKEN=made-up\n");
    if (o.throwOn === a[0]) throw new Error("the fake CLI broke");
    const answer = (out: unknown): CliResult => ({ status: 0, stdout: `${JSON.stringify(out)}\n`, stderr: "Vercel CLI 62.2.0", timedOut: false });
    if (a[0] === "deploy" && a.includes("--dry")) {
      if (o.dryRun?.status) return { status: o.dryRun.status, stdout: "", stderr: "Error: the dry run broke (prj_abc123)", timedOut: false };
      const drop = new Set(o.dryRun?.drop ?? []);
      const listed = [...nodeCopyFs.listFiles(opt.cwd).filter((p) => p !== ".vercelignore" && !drop.has(p)), ...(o.dryRun?.extra ?? [])];
      return answer({ fileCount: listed.length, totalSize: 8_712_345, framework: { slug: "nextjs" }, files: listed.map((p) => ({ path: p, size: 1 })) });
    }
    if (a[0] === "project") return answer({ name: "offersheet", ssoProtection: o.protection === null ? null : { deploymentType: o.protection ?? (STANDARD_PROTECTIONS[0] as string) } });
    if (a[0] === "env") return answer({ envs: (o.env ?? PROD_ENV).map((key) => ({ key, value: `VALUE-OF-${key}`, type: "plain", target: ["production", "preview"] })) });
    if (a[0] === "api") return answer({ name: "offersheet", autoExposeSystemEnvs: o.systemEnvs ?? true, env: [{ key: "PLAIN", value: "PLAIN-VALUE-NEVER-PRINTED" }], targets: { production: o.productionUrl === null ? null : { url: o.productionUrl ?? LANDING } } });
    if (a[0] === "deploy" && a.includes("--prod")) {
      state.deployed = true;
      return { status: 0, stdout: JSON.stringify({ deployment: { url: NEW_DEPLOYMENT } }), stderr: `Production: https://${NEW_DEPLOYMENT}\nAliased: ${PRODUCTION_ORIGIN}`, timedOut: false, ...o.deploy };
    }
    return { status: 1, stdout: "", stderr: "unknown", timedOut: false };
  };
  const web: string[] = [];
  /** Every web request with the Sec-Fetch-Site it sent (null: none, as the script's other requests). */
  const asked: Array<{ url: string; site: string | null }> = [];
  const fetchFake = async (url: string, init?: RequestInit): Promise<Response> => {
    web.push(url);
    const site = new Headers(init?.headers).get("sec-fetch-site");
    asked.push({ url, site });
    const u = new URL(url);
    // The cross-site rule is the project's firewall's: it answers first, in front of whatever deployment the domain serves.
    const rule = o.crossSiteRule ?? "on";
    const api = u.pathname.startsWith("/api/");
    const denied = rule === "noPath" ? site === "cross-site" : api && site !== null && (rule === "broad" || (rule === "on" && site === "cross-site"));
    if (u.host !== NEW_DEPLOYMENT && denied) return new Response("Forbidden", { status: 403 });
    const key = u.host === NEW_DEPLOYMENT ? NEW_DEPLOYMENT : `${u.pathname}${u.search}`;
    const special = (state.deployed ? o.webAfter?.[key] : undefined) ?? o.web?.[key];
    if (special) return special();
    if (u.host === NEW_DEPLOYMENT) return new Response(null, { status: 401 });
    // The firewall rule is the project's: it answers for whatever deployment the domain serves.
    if (u.pathname === "/_next/image" || u.pathname === "/_vercel/image") return new Response("Forbidden", { status: 403 });
    // The app, once the domain serves it, refuses another site's request itself (withRoute's BAD_ORIGIN), uncounted.
    if (state.deployed && u.pathname.startsWith("/api/") && site === "cross-site") {
      return new Response(JSON.stringify({ error: { code: "BAD_ORIGIN", message: "This request didn't come from Offer Sheet, so we ignored it." } }), { status: 403, headers: { "content-type": "application/json" } });
    }
    if (u.pathname === "/api/health") {
      // Counted once the deploy happened (a request before it meets the landing page).
      if (state.deployed) state.healthAsked++;
      // A live run's first ask still meets the deployment from before (the domain switching).
      const ready = state.deployed && (o.deployed === true || state.healthAsked > 1);
      return ready ? new Response(JSON.stringify(HEALTHY), { status: 200, headers: { "content-type": "application/json" } }) : new Response("Not Found", { status: 404 });
    }
    if (!state.deployed) return u.pathname === "/" ? html("<html><body>Offer Sheet is coming</body></html>") : new Response("Not Found", { status: 404 });
    if (u.pathname === "/robots.txt") return new Response(ROBOTS, { status: 200 });
    if (u.pathname === "/api/cron/snapshot") return new Response(null, { status: 401 });
    return html(APP_HTML, { "content-security-policy": o.servedCsp ?? CSP });
  };
  const copies: string[] = [];
  const fs: CopyFs = {
    ...nodeCopyFs,
    makeTempDir: (prefix) => {
      const d = mkdtempSync(path.join(root, prefix));
      copies.push(d);
      return d;
    },
    writeFile: (file, bytes, mode) => {
      const flip = o.corruptWrite !== undefined && file.replace(/\\/g, "/").endsWith(`/${o.corruptWrite}`);
      const out = Buffer.from(bytes);
      if (flip) out[0] = (out[0] as number) ^ 1;
      nodeCopyFs.writeFile(file, out, mode);
    },
  };
  const leaks: Array<{ files: string[]; base: string }> = [];
  const sleeps: number[] = [];
  const lines: string[] = [];
  const imported: string[] = [];
  const deps: ProdDeployDeps = {
    git: repo.git,
    vercel,
    fetch: fetchFake,
    leakCheck: (files, base) => {
      leaks.push({ files: [...files], base });
      return o.leakPasses ?? true;
    },
    fs,
    hashFile: (file) => (existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null),
    npmVersions: () => (o.npm === undefined ? ["16.3.6", "16.3.7"] : o.npm),
    // The real loader, as the script's: the copy's next.config.ts by its file.
    importModule: (file) => {
      imported.push(file);
      return import(pathToFileURL(file).href) as Promise<unknown>;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: (line) => lines.push(line),
  };
  const outcome = await runProdDeploy(parsed, deps, { mainRoot: root, envLocalPath: envFile, origin: PRODUCTION_ORIGIN });
  const text = lines.join("\n");
  // Never, in any run: a value of a variable, a call this script never makes.
  expect(text).not.toMatch(/VALUE-OF-|PLAIN-VALUE-NEVER-PRINTED|made-up/);
  for (const c of calls) expect(allowedVercelCall(c.args, parsed.live), c.args.join(" ")).toBe(true);
  return { outcome, lines, text, calls, web, asked, copies, leaks, sleeps, imported, gitCalls: repo.calls };
}

const prodCalls = (calls: Call[]) => calls.filter((c) => c.args.includes("--prod"));
const IMAGE_URLS = IMAGE_PATHS.map((p) => `${PRODUCTION_ORIGIN}${p}`);
const HEALTH_URL = `${PRODUCTION_ORIGIN}/api/health`;
/** The health check's own asks (no Sec-Fetch-Site), and the cross-site rule's (with it), in order. */
const healthAsks = (asked: ReadonlyArray<{ url: string; site: string | null }>) => asked.filter((a) => a.url === HEALTH_URL && a.site === null);
const ruleAsks = (asked: ReadonlyArray<{ url: string; site: string | null }>) => asked.filter((a) => a.site !== null).map((a) => `${a.url.replace(PRODUCTION_ORIGIN, "")} ${a.site}`);
/** Step 11's asks: /api/health cross-site and same-origin, then the home page opened from another site (PD-1). */
const RULE_ASKS = ["/api/health cross-site", "/api/health same-origin", "/ cross-site"];
const RULE_OK_BEFORE = `✅ Cross-site API requests: /api/health with Sec-Fetch-Site: cross-site answers 403 (the firewall's "${CROSS_SITE_RULE}" rule); with same-origin, 404, not denied; / opened from another site, 200, not denied (the deployment production serves now)`;
const RULE_OK_AFTER = `✅ Cross-site API requests: /api/health with Sec-Fetch-Site: cross-site answers 403 (the firewall's "${CROSS_SITE_RULE}" rule); with same-origin, 200 (the app's health check); / opened from another site, 200 (the app's home page)`;

describe("a dry run (no --live): every check, nothing uploaded", () => {
  it("passes on a good tag: the copy, the tag's own policy and pages, Vercel's read-only answers, the domain; deploy only with --dry, in the copy; the copy removed; the rollback steps shown", async () => {
    const r = await run({ argv: ["--checkpoint", "checkpoint-7c"] });
    expect(r.outcome).toMatchObject({ ok: true, uploaded: false, deploymentUrl: null, rollbackTarget: LANDING, failures: 0, warnings: 0 });
    expect(prodCalls(r.calls)).toEqual([]);
    const deploys = r.calls.filter((c) => c.args[0] === "deploy");
    expect(deploys.map((c) => c.args)).toEqual([dryDeployArgs("checkpoint-7c", COMMIT_NEW)]);
    expect(r.calls.map((c) => c.args[0])).toEqual(["deploy", "project", "env", "api"]);
    expect(r.calls.every((c) => c.cwd === r.copies[0] && c.inCopy)).toBe(true);
    expect(r.copies).toHaveLength(1);
    expect(existsSync(r.copies[0] as string)).toBe(false);
    // The tag's own next.config.ts was loaded, from the copy.
    expect(r.imported).toEqual([path.join(r.copies[0] as string, "next.config.ts")]);
    // The leak check read the copy's files from the copy: exactly the allowlisted ones.
    expect(r.leaks).toEqual([{ files: expect.arrayContaining(["src/app/page.tsx", "package.json", "vercel.json", ".vercelignore"]), base: r.copies[0] }]);
    expect(r.leaks[0]?.files).toHaveLength(COPY_COUNT);
    expect(r.leaks[0]?.files.some((f) => f.startsWith("fixtures/") || f.startsWith("reports/"))).toBe(false);
    // Only the domain's home page, the image optimizer's two paths and the cross-site rule's three asks (the home page
    // again, now opened from another site), once each.
    expect(r.web).toEqual([`${PRODUCTION_ORIGIN}/`, ...IMAGE_URLS, HEALTH_URL, HEALTH_URL, `${PRODUCTION_ORIGIN}/`]);
    expect(ruleAsks(r.asked)).toEqual(RULE_ASKS);
    expect(r.text).toContain(RULE_OK_BEFORE);
    expect(r.text).toContain("✅ What: checkpoint-7c, commit c7c7c7c (committed 2026-10-11 06:26 UTC), an annotated tag, the newest checkpoint");
    expect(r.text).toContain(`✅ Clean copy: ${COPY_COUNT} files`);
    expect(r.text).toContain("✅ What the checks after the deploy expect: the tag's own Content-Security-Policy (its next.config.ts) and its 10 app pages (APP_PAGES)");
    expect(r.text).toContain(`✅ Vercel's dry run in the copy: ${COPY_COUNT - 1} files, 8.7 MB, framework nextjs, exactly the copy's files`);
    expect(r.text).toContain('✅ Deployment Protection: Standard ("all_except_custom_domains")');
    expect(r.text).toContain("✅ Production's variables (names only): SESSION_SECRET, CRON_SECRET, KV_REST_API_URL, KV_REST_API_TOKEN set; none of the names that must not be there");
    expect(r.text).toContain("CONTACT_EMAIL is a constant in the code (src/lib/site.ts), not a variable.");
    expect(r.text).toContain('✅ The image optimizer: both paths answer 403 on the production domain (the firewall\'s "Block image optimizer" rule)');
    expect(r.text).toContain(`✅ Rollback target: ${LANDING}`);
    expect(r.text).toContain("✅ Next: 16.3.7, the newest next@16.3 patch on npm");
    expect(r.text).toContain("✅ .env.local: unchanged by the Vercel CLI");
    expect(r.text).toContain(`Dry run: every check passed. Nothing was uploaded. After Parker's "go":\n  npm run prod:deploy -- --live --checkpoint checkpoint-7c`);
    expect(r.text).toContain(rollbackSteps(LANDING));
  });

  it("a bare dry run checks the newest tag; --ref rehearses an untagged commit and says a deploy needs --checkpoint", async () => {
    const bare = await run({ argv: [] });
    expect(bare.text).toContain("an annotated tag, the newest checkpoint (--live needs it named: --checkpoint checkpoint-7c)");
    const rehearsal = await run({ argv: ["--ref", "HEAD"] });
    expect(rehearsal.outcome.ok).toBe(true);
    expect(rehearsal.text).toContain("✅ What: a rehearsal on commit c7c7c7c");
    expect(rehearsal.calls[0]?.args).toEqual(dryDeployArgs("rehearsal", COMMIT_NEW));
    expect(rehearsal.text).toContain("npm run prod:deploy -- --live --checkpoint <the approved tag>");
  });

  it("collects every problem and goes on: missing secrets, a lightweight tag, the leak check, protection off, the image rule, a newer Next (a warning)", async () => {
    const r = await run({
      argv: [],
      tags: [TAG_OLD, { ...TAG_NEW, annotated: false }],
      env: ["KV_REST_API_URL", "KV_REST_API_TOKEN", "ESPN_S2"],
      leakPasses: false,
      protection: null,
      npm: ["16.3.7", "16.3.8"],
      web: { [IMAGE_PATHS[1]]: () => new Response("png", { status: 200 }) },
    });
    expect(r.outcome).toMatchObject({ ok: false, uploaded: false, failures: 5, warnings: 1 }); // the variables are one step
    expect(prodCalls(r.calls)).toEqual([]);
    expect(r.text).toContain("is a lightweight tag");
    expect(r.text).toContain("Missing: SESSION_SECRET (npm run vercel:secret -- --live --env production); CRON_SECRET (npm run vercel:secret -- --live --name CRON_SECRET).");
    expect(r.text).toContain("ESPN_S2 (Parker's ESPN cookie: it must never sit on Vercel)");
    expect(r.text).toContain("❌ Leak check");
    expect(r.text).toContain("❌ Deployment Protection: off");
    expect(r.text).toContain("❌ The image optimizer: open on the production domain");
    expect(r.text).toContain('/_vercel/image answered 200, not 403: add the "Block image optimizer" firewall rule and publish it now');
    expect(r.text).toContain("⚠️ Next: 16.3.8 is on npm and the tag has 16.3.7");
    expect(r.text).toContain("Dry run: 5 check(s) to fix before the go (❌ above); 1 warning(s) (⚠️ above). Nothing was uploaded.");
    expect(existsSync(r.copies[0] as string)).toBe(false);
  });

  it("--offline: no Vercel call and no web request; the copy, the tag's policy and the leak check still run", async () => {
    const r = await run({ argv: ["--offline", "--checkpoint", "checkpoint-7c"] });
    expect(r.outcome.ok).toBe(true);
    expect(r.calls).toEqual([]);
    expect(r.web).toEqual([]);
    expect(r.leaks).toHaveLength(1);
    expect(r.imported).toHaveLength(1);
    expect(r.text).toContain("Offline: the local checks passed. Nothing was uploaded.");
    expect(r.text).not.toContain("✅ .env.local:"); // no CLI ran, so there was nothing to watch
    expect(existsSync(r.copies[0] as string)).toBe(false);
  });

  it("a cross-site rule not there yet fails its line, naming the rule (planner reply to Checkpoint 7c, answer 4); the others still run", async () => {
    const r = await run({ argv: ["--checkpoint", "checkpoint-7c"], crossSiteRule: "off" });
    expect(r.outcome).toMatchObject({ ok: false, uploaded: false, failures: 1, warnings: 0 });
    expect(prodCalls(r.calls)).toEqual([]);
    expect(r.text).toContain("❌ Cross-site API requests: see below");
    expect(r.text).toContain(`/api/health with Sec-Fetch-Site: cross-site answered 404, not 403: add the "${CROSS_SITE_RULE}" firewall rule, first, above "API rate limit", and publish it now (Vercel → offersheet → Firewall; reports/beta-infrastructure.md, Launch-day step 2)`);
    expect(r.text).toContain("✅ Rollback target"); // the steps after it still ran
    expect(r.text).toContain("Dry run: 1 check(s) to fix before the go (❌ above). Nothing was uploaded.");
  });

  it("a cross-site rule without its /api/ path condition fails its line: it would deny every page opened from another site (review of the policy-deploy track, PD-1)", async () => {
    const r = await run({ argv: ["--checkpoint", "checkpoint-7c"], crossSiteRule: "noPath" });
    expect(r.outcome).toMatchObject({ ok: false, uploaded: false, failures: 1, warnings: 0 });
    expect(prodCalls(r.calls)).toEqual([]);
    expect(ruleAsks(r.asked)).toEqual(RULE_ASKS);
    expect(r.text).toContain("❌ Cross-site API requests: see below");
    // The /api/ asks alone pass (403 cross-site, not denied same-origin): only the page tells the two rules apart.
    expect(r.text).not.toContain("/api/health with Sec-Fetch-Site");
    expect(r.text).toContain(`/ opened from another site (Sec-Fetch-Site: cross-site) answered 403: a firewall rule denies every page reached from another site (a search result, a link in a post). Its cross-site condition ("${CROSS_SITE_RULE}", or the third OR group of "Block image optimizer") must also require Request Path starts with /api/`);
    // Step 9's ask, which sends no Sec-Fetch-Site, still opens, as a typed address (the phone check: Sec-Fetch-Site: none)
    // would: only the cross-site header shows it.
    expect(r.text).toContain(`✅ The production domain: ${PRODUCTION_ORIGIN}/ answers 200 to an anonymous visitor`);
    expect(r.text).toContain("Dry run: 1 check(s) to fix before the go (❌ above). Nothing was uploaded.");
  });

  it("an image optimizer path that gets no answer at all fails as unconfirmed, never as a rule to add (review of Checkpoint 7d, PD7D-4)", async () => {
    const r = await run({
      argv: ["--checkpoint", "checkpoint-7c"],
      web: {
        [IMAGE_PATHS[0]]: () => {
          throw new TypeError("fetch failed");
        },
      },
    });
    expect(r.outcome).toMatchObject({ ok: false, uploaded: false, failures: 1, warnings: 0 });
    expect(prodCalls(r.calls)).toEqual([]);
    expect(r.text).toContain("❌ The image optimizer: no answer from the production domain");
    expect(r.text).toContain('/_next/image answered nothing: couldn\'t confirm the "Block image optimizer" firewall rule denies it');
    expect(r.text).not.toContain("open on the production domain");
    expect(r.text).not.toContain('add the "Block image optimizer" firewall rule');
  });

  it("with the app already on the domain (a later deploy), the app's own 403 for a cross-site request doesn't pass for the firewall's", async () => {
    const r = await run({ argv: ["--checkpoint", "checkpoint-7c"], crossSiteRule: "off", deployed: true });
    expect(r.outcome).toMatchObject({ ok: false, failures: 1 });
    expect(r.text).toContain("/api/health with Sec-Fetch-Site: cross-site got the app's own 403 (BAD_ORIGIN), not the firewall's: it passed the firewall, so the rate limit counts it.");
    const fine = await run({ argv: ["--checkpoint", "checkpoint-7c"], deployed: true });
    expect(fine.outcome).toMatchObject({ ok: true, failures: 0 });
    expect(fine.text).toContain(`✅ Cross-site API requests: /api/health with Sec-Fetch-Site: cross-site answers 403 (the firewall's "${CROSS_SITE_RULE}" rule); with same-origin, 200, not denied; / opened from another site, 200, not denied (the deployment production serves now)`);
  });

  it("names the Standard setting Vercel gives, under either name (deploy-6), and the production domain named as the rollback target only warns (deploy-2)", async () => {
    const r = await run({ argv: ["--checkpoint", "checkpoint-7c"], protection: "prod_deployment_urls_and_all_previews", productionUrl: "offersheet.vercel.app" });
    expect(r.outcome).toMatchObject({ ok: true, warnings: 1, rollbackTarget: null });
    expect(r.text).toContain('✅ Deployment Protection: Standard ("prod_deployment_urls_and_all_previews")');
    expect(r.text).toContain("⚠️ Rollback target: Vercel named a production domain, not a deployment, so it can't be the target");
    expect(r.text).toContain(rollbackSteps(null));
    expect(r.text).not.toContain("rollback https://offersheet.vercel.app");
  });
});

describe("a live run (--live --checkpoint): one deploy, only after every check passed", () => {
  it("deploys exactly once, last, from the copy; then checks the domain, removes the copy and prints the rollback steps", async () => {
    const r = await run({ argv: ["--live", "--checkpoint", "checkpoint-7c"] });
    expect(r.outcome).toMatchObject({ ok: true, uploaded: true, deploymentUrl: `https://${NEW_DEPLOYMENT}`, rollbackTarget: LANDING, failures: 0 });
    const prod = prodCalls(r.calls);
    expect(prod).toHaveLength(1);
    expect(prod[0]?.args).toEqual(liveDeployArgs("checkpoint-7c", COMMIT_NEW));
    expect(prod[0]?.cwd).toBe(r.copies[0]);
    expect(prod[0]?.inCopy).toBe(true);
    expect(r.calls.indexOf(prod[0] as Call)).toBe(r.calls.length - 1);
    expect(r.calls.map((c) => c.args[0])).toEqual(["deploy", "project", "env", "api", "deploy"]);
    // Health asked until the domain served the new deployment (404 first), with one wait between.
    expect(healthAsks(r.asked)).toHaveLength(2);
    expect(r.sleeps).toEqual([10_000]);
    // The image optimizer and the cross-site rule asked before the upload and after it.
    for (const u of IMAGE_URLS) expect(r.web.filter((w) => w === u)).toHaveLength(2);
    expect(ruleAsks(r.asked)).toEqual([...RULE_ASKS, ...RULE_ASKS]);
    expect(r.text).toContain(RULE_OK_BEFORE);
    expect(r.text).toContain(RULE_OK_AFTER);
    expect(r.web).toEqual(expect.arrayContaining([`${PRODUCTION_ORIGIN}/privacy`, `${PRODUCTION_ORIGIN}/robots.txt`, `${PRODUCTION_ORIGIN}/api/cron/snapshot`, `https://${NEW_DEPLOYMENT}`]));
    expect(r.text).toContain(`✅ Deploy: ${NEW_DEPLOYMENT}, built and given the production domain (checkpoint-7c, commit c7c7c7c)`);
    expect(r.text).toContain("✅ Health: production, the shared store (set 2.1 ms, get 1 ms, del 0.9 ms), region iad1");
    expect(r.text).toContain("✅ Pages: all 10 answer 200 with the tag's own Content-Security-Policy, the footer's FantasyCalc link, and nothing loaded from another site");
    expect(r.text).toContain("✅ The cron route: a bare 401 without the secret");
    expect(r.text).toContain("✅ The image optimizer: both paths answer 403 (the firewall rule)");
    expect(r.text).toContain("✅ The deployment's own address: asks visitors to log in (401)");
    expect(existsSync(r.copies[0] as string)).toBe(false);
    expect(r.text.endsWith(`\n${rollbackSteps(LANDING)}`)).toBe(true);
  });

  // Many runs of the whole script (about 0.75 s alone): under the full suite's load it once took over 5 s.
  it("any failing check blocks the upload, each named on its own line (deploy-1)", { timeout: 60_000 }, async () => {
    const live = ["--live", "--checkpoint", "checkpoint-7c"];
    const cases: Array<{ o: RunOptions; line: string }> = [
      { o: { argv: live, env: [...PROD_ENV, "ESPN_SWID"] }, line: "❌ Production's variables (names only)" },
      { o: { argv: ["--live", "--checkpoint", "checkpoint-7b"] }, line: "❌ What: checkpoint-7b" },
      { o: { argv: live, leakPasses: false }, line: "❌ Leak check" },
      { o: { argv: live, protection: "all" }, line: "❌ Deployment Protection" },
      { o: { argv: live, web: { "/": () => new Response(null, { status: 302, headers: { location: "https://vercel.com/login" } }) } }, line: "❌ The production domain" },
      { o: { argv: ["--live", "--checkpoint", "checkpoint-9"] }, line: "❌ What: checkpoint-9" },
      // Vercel's dry run: something private it would upload, a file it would leave out, the dry run failing.
      { o: { argv: live, dryRun: { extra: [".env.local"] } }, line: "❌ Vercel's dry run in the copy: what would upload isn't safe" },
      { o: { argv: live, dryRun: { extra: ["fixtures/raw/x.json"] } }, line: "❌ Vercel's dry run in the copy: what would upload isn't safe" },
      { o: { argv: live, dryRun: { drop: ["src/app/layout.tsx"] } }, line: "it would leave out 1 of the copy's file(s), e.g. src/app/layout.tsx" },
      { o: { argv: live, dryRun: { status: 1 } }, line: "❌ Vercel's dry run in the copy: it failed (exit 1)" },
      // The copy isn't the commit, byte for byte.
      { o: { argv: live, corruptWrite: "src/app/layout.tsx" }, line: "❌ Clean copy: it isn't the commit, byte for byte" },
      // vercel.json without the snapshot cron; the build's files missing.
      { o: { argv: live, files: { ...REPO_FILES, "vercel.json": JSON.stringify({ framework: "nextjs", regions: ["iad1"] }) } }, line: "vercel.json: it doesn't schedule the daily snapshot cron (/api/cron/snapshot)" },
      { o: { argv: live, files: without(REPO_FILES, "package-lock.json") }, line: "❌ What the build needs: see below" },
      // Vercel's own variables don't reach the app.
      { o: { argv: live, systemEnvs: false }, line: "❌ Vercel's own variables: not exposed to the app" },
      // The firewall rule isn't there (or not published) yet.
      { o: { argv: live, web: { [IMAGE_PATHS[0]]: () => new Response("png", { status: 200 }) } }, line: "❌ The image optimizer: open on the production domain" },
      // The cross-site rule isn't there yet, or it denies the app's own requests too (planner reply to Checkpoint 7c, answer 4),
      // or, without its /api/ path condition, every page opened from another site (PD-1).
      { o: { argv: live, crossSiteRule: "off" }, line: `/api/health with Sec-Fetch-Site: cross-site answered 404, not 403: add the "${CROSS_SITE_RULE}" firewall rule` },
      { o: { argv: live, crossSiteRule: "broad" }, line: "/api/health with Sec-Fetch-Site: same-origin answered 403: a firewall rule denies the app's own requests too" },
      { o: { argv: live, crossSiteRule: "noPath" }, line: "/ opened from another site (Sec-Fetch-Site: cross-site) answered 403: a firewall rule denies every page reached from another site" },
      // The tag's own policy can't be known.
      { o: { argv: live, files: { ...REPO_FILES, "next.config.ts": "const nextConfig = {};\nexport default nextConfig;\n" } }, line: "the tag's own Content-Security-Policy: its next.config.ts gives no contentSecurityPolicy" },
    ];
    for (const { o, line } of cases) {
      const r = await run(o);
      const label = `${line} (${JSON.stringify(o.argv)})`;
      expect(r.outcome, label).toMatchObject({ ok: false, uploaded: false });
      expect(prodCalls(r.calls), label).toEqual([]);
      expect(r.text, label).toContain(line);
      expect(r.text, label).toContain("Nothing was uploaded");
      expect(r.text, label).toContain("Instant Rollback"); // every live run ends with the rollback steps
      for (const copy of r.copies) expect(existsSync(copy), label).toBe(false);
    }
  });

  it("compares production with the tag's own policy and pages, not the development folder's (deploy-3)", async () => {
    const tagCsp = CSP.replace("connect-src 'self'", "connect-src 'self' https://api.example-platform.test");
    const r = await run({
      argv: ["--live", "--checkpoint", "checkpoint-7c"],
      files: { ...without(REPO_FILES, pageFile("/feedback")), "next.config.ts": nextConfig(tagCsp), [pageFile("/waivers")]: "export default function Page() {\n  return null;\n}\n" },
      servedCsp: tagCsp,
    });
    expect(r.outcome).toMatchObject({ ok: true, uploaded: true, warnings: 1 });
    expect(r.text).toContain("⚠️ What the checks after the deploy expect: the tag's own Content-Security-Policy (its next.config.ts) and its 9 app pages (APP_PAGES)");
    expect(r.text).toContain("APP_PAGES lists /feedback, which the tag doesn't have (this folder has moved past it?): not asked after the deploy.");
    expect(r.text).toContain("The tag has /waivers, which APP_PAGES doesn't list: not asked after the deploy.");
    expect(r.text).toContain("✅ Pages: all 9 answer 200 with the tag's own Content-Security-Policy");
    expect(r.web).not.toContain(`${PRODUCTION_ORIGIN}/feedback`);
    // The same production, judged by the development folder's policy, would have failed every page.
    expect(pageProblems({ path: "/", status: 200, csp: tagCsp, cspReportOnly: null, html: APP_HTML }, CSP)).toEqual(["/: its Content-Security-Policy isn't the production one (connect-src)"]);
  });

  it("a deploy whose checks after it fail still ends with the rollback steps, a decision to make, and the way to check again without deploying", async () => {
    const r = await run({
      argv: ["--live", "--checkpoint", "checkpoint-7c"],
      webAfter: {
        [IMAGE_PATHS[1]]: () => new Response("png", { status: 200 }),
        "/terms": () => html(APP_HTML, { "content-security-policy": CSP, "content-security-policy-report-only": CSP }),
        [NEW_DEPLOYMENT]: () => html("the deployment"),
      },
    });
    expect(r.outcome).toMatchObject({ ok: false, uploaded: true, deploymentUrl: `https://${NEW_DEPLOYMENT}`, failures: 2, warnings: 1 });
    expect(r.text).toContain("/terms: it also sends Content-Security-Policy-Report-Only");
    expect(r.text).toContain('/_vercel/image answered 200, not 403: add the "Block image optimizer" firewall rule and publish it now');
    expect(r.text).toContain("⚠️ The deployment's own address: answered 200");
    expect(r.text).toContain(`The deploy went up, but 2 check(s) failed (❌ above): decide now whether to roll back. To ask the production domain again without deploying:\n  ${verifyCommand("checkpoint-7c")}\n(never a second --live to check again`);
    expect(r.text.endsWith(`\n${rollbackSteps(LANDING)}`)).toBe(true);
  });

  it("a domain that never switches is said (after a rollback, Vercel stops assigning it), and the other checks don't run", async () => {
    const r = await run({ argv: ["--live", "--checkpoint", "checkpoint-7c"], web: { "/api/health": () => new Response("Not Found", { status: 404 }) } });
    expect(r.outcome).toMatchObject({ ok: false, uploaded: true });
    expect(healthAsks(r.asked)).toHaveLength(HEALTH_TRIES);
    expect(r.sleeps).toHaveLength(HEALTH_TRIES - 1);
    // The cross-site rule was asked before the upload only.
    expect(ruleAsks(r.asked)).toEqual(RULE_ASKS);
    expect(r.text).toContain("Undo Rollback in the dashboard");
    expect(r.text).toContain("ask again in a minute with --verify");
    expect(r.web.some((u) => u.endsWith("/robots.txt"))).toBe(false);
  });

  it("a failed or timed-out deploy says production still serves what it did, and the rollback steps still print", async () => {
    const failed = await run({ argv: ["--live", "--checkpoint", "checkpoint-7c"], deploy: { status: 1, stdout: "", stderr: "Error: build failed (team_abc123)" } });
    expect(failed.outcome).toMatchObject({ ok: false, uploaded: true, deploymentUrl: null });
    expect(failed.text).toContain("❌ Deploy: it failed (exit 1)");
    expect(failed.text).toContain("team_…");
    expect(failed.text).not.toContain("team_abc123");
    expect(failed.text).toContain("The deploy didn't finish (❌ above). Production still serves what it served before");
    expect(failed.text).toContain(verifyCommand("checkpoint-7c"));
    expect(failed.text).toContain("Instant Rollback");
    const slow = await run({ argv: ["--live", "--checkpoint", "checkpoint-7c"], deploy: { status: 1, timedOut: true } });
    expect(slow.text).toContain("the CLI didn't finish in 30 minutes. The build may still finish on Vercel and take the domain");
  });
});

describe("--verify: the checks of the production domain again, no deploy (deploy-4)", () => {
  it("asks the domain once against the tag's own policy and pages: no Vercel CLI call, no wait, no deploy, the copy removed", async () => {
    const r = await run({ argv: ["--verify", "--checkpoint", "checkpoint-7c"], deployed: true });
    expect(r.outcome).toMatchObject({ ok: true, uploaded: false, deploymentUrl: null, failures: 0, warnings: 0 });
    expect(r.calls).toEqual([]);
    expect(r.sleeps).toEqual([]);
    expect(r.leaks).toEqual([]);
    expect(r.imported).toHaveLength(1);
    expect(healthAsks(r.asked)).toHaveLength(1);
    expect(r.web).toEqual(expect.arrayContaining([...APP_PAGES.map((p) => `${PRODUCTION_ORIGIN}${p}`), ...IMAGE_URLS, `${PRODUCTION_ORIGIN}/robots.txt`, `${PRODUCTION_ORIGIN}/api/cron/snapshot`]));
    expect(ruleAsks(r.asked)).toEqual(RULE_ASKS);
    expect(r.text).toContain(RULE_OK_AFTER);
    expect(r.web.some((u) => u.includes(NEW_DEPLOYMENT))).toBe(false);
    expect(r.text).toContain("✅ What: checkpoint-7c, commit c7c7c7c (committed 2026-10-11 06:26 UTC): production is checked against it");
    expect(r.text).not.toContain("What the build needs");
    expect(r.text).toContain("✅ Pages: all 10 answer 200");
    expect(r.text).not.toContain(".env.local");
    expect(r.text).toContain(`Verify: ${PRODUCTION_ORIGIN} passes every check. Nothing was deployed.`);
    expect(r.text).not.toContain("Instant Rollback");
    expect(existsSync(r.copies[0] as string)).toBe(false);
  });

  it("checks against the tag production serves even when it's no longer the newest", async () => {
    const r = await run({ argv: ["--verify", "--checkpoint", "checkpoint-7b"], deployed: true });
    expect(r.outcome.ok).toBe(true);
    expect(r.text).toContain("✅ What: checkpoint-7b, commit b7b7b7b");
  });

  it("a domain that doesn't serve the app fails at once, the other checks don't run, and the rollback steps print", async () => {
    const r = await run({ argv: ["--verify", "--checkpoint", "checkpoint-7c"] });
    expect(r.outcome).toMatchObject({ ok: false, uploaded: false, failures: 1 });
    expect(r.sleeps).toEqual([]);
    expect(r.text).toContain(`❌ Health: ${PRODUCTION_ORIGIN} doesn't serve the app (no /api/health)`);
    expect(r.web.some((u) => u.endsWith("/robots.txt"))).toBe(false);
    expect(ruleAsks(r.asked)).toEqual([]);
    expect(r.text).toContain("Verify: 1 check(s) failed (❌ above). Nothing was deployed: decide whether to roll back.");
    expect(r.text).toContain(rollbackSteps(null));
  });

  it("an open image optimizer fails it (the firewall rule added later is checked without a second deploy)", async () => {
    const r = await run({ argv: ["--verify", "--checkpoint", "checkpoint-7c"], deployed: true, web: { [IMAGE_PATHS[0]]: () => new Response("png", { status: 200 }) } });
    expect(r.outcome).toMatchObject({ ok: false, failures: 1 });
    expect(r.text).toContain("❌ The image optimizer: open");
  });

  it("the cross-site rule again: missing, the app's own 403 fails it; too broad, the app's own requests denied fail it (planner reply to Checkpoint 7c, answer 4)", async () => {
    const missing = await run({ argv: ["--verify", "--checkpoint", "checkpoint-7c"], deployed: true, crossSiteRule: "off" });
    expect(missing.outcome).toMatchObject({ ok: false, failures: 1 });
    expect(missing.text).toContain("❌ Cross-site API requests: see below");
    expect(missing.text).toContain("got the app's own 403 (BAD_ORIGIN), not the firewall's");
    const broad = await run({ argv: ["--verify", "--checkpoint", "checkpoint-7c"], deployed: true, crossSiteRule: "broad" });
    expect(broad.outcome).toMatchObject({ ok: false, failures: 1 });
    expect(broad.text).toContain("/api/health with Sec-Fetch-Site: same-origin answered 403: a firewall rule denies the app's own requests too");
    expect(broad.text).toContain("✅ Health"); // the health check sends no Sec-Fetch-Site, as no script does
    // Without its /api/ path condition (PD-1): the API asks pass, the page opened from another site doesn't, and the
    // app's pages, asked with no Sec-Fetch-Site (a typed address sends Sec-Fetch-Site: none), still pass.
    const noPath = await run({ argv: ["--verify", "--checkpoint", "checkpoint-7c"], deployed: true, crossSiteRule: "noPath" });
    expect(noPath.outcome).toMatchObject({ ok: false, failures: 1 });
    expect(noPath.text).toContain("/ opened from another site (Sec-Fetch-Site: cross-site) answered 403: a firewall rule denies every page reached from another site");
    expect(noPath.text).toContain("✅ Pages: all 10 answer 200");
  });
});

describe("guards that hold in every run", () => {
  it("the Vercel CLI changing .env.local fails the run loudly (its content never printed)", async () => {
    const r = await run({ argv: ["--checkpoint", "checkpoint-7c"], touchEnvOn: "env" });
    expect(r.outcome.ok).toBe(false);
    expect(r.text).toContain("❌ .env.local: CHANGED while the Vercel CLI ran");
  });

  it("a step that throws stops the run, and the copy is still removed", async () => {
    const r = await run({ argv: ["--live", "--checkpoint", "checkpoint-7c"], throwOn: "project" });
    expect(r.outcome).toMatchObject({ ok: false, uploaded: false });
    expect(r.text).toContain("❌ Stopped: the fake CLI broke");
    expect(prodCalls(r.calls)).toEqual([]);
    expect(existsSync(r.copies[0] as string)).toBe(false);
  });

  it("an unreadable rollback target only warns: the dashboard needs no address", async () => {
    const r = await run({ argv: ["--checkpoint", "checkpoint-7c"], productionUrl: null });
    expect(r.outcome).toMatchObject({ ok: true, warnings: 1, rollbackTarget: null });
    expect(r.text).toContain("⚠️ Rollback target: couldn't read it: the dashboard's Instant Rollback needs no address");
    expect(r.text).toContain(rollbackSteps(null));
  });

  it("a tag that isn't there stops before any copy or call", async () => {
    const r = await run({ argv: ["--checkpoint", "checkpoint-9"] });
    expect(r.outcome.ok).toBe(false);
    expect(r.copies).toEqual([]);
    expect(r.calls).toEqual([]);
    expect(r.text).toContain("The other checks need a commit to copy: they didn't run.");
  });
});
