/**
 * npm run vercel:secret -- --live — gives Parker's Vercel project "offersheet" a secret of its own: SESSION_SECRET (final
 * review SEC-9: without one a deployment runs with no shared store, no ESPN cookie sessions and no signed imports, and
 * copying the local value would make the deployment's root key one that also lives in .env.local, in the stable copy's
 * folder and in Turbopack's caches on this computer), or CRON_SECRET (planner reply to Checkpoint 7a, §6.3: Vercel sends it
 * as "Authorization: Bearer <CRON_SECRET>" with each cron request, and /api/cron/snapshot answers nothing else).
 *
 *   npm run vercel:secret -- --live                                  SESSION_SECRET for previews (before any preview deployment)
 *   npm run vercel:secret -- --live --env production                 SESSION_SECRET for production (Checkpoint 7b, before the "go")
 *   npm run vercel:secret -- --live --name CRON_SECRET               CRON_SECRET for production (crons run on production only)
 *   npm run vercel:secret -- --live --replace                        a new one in place of the old (see below)
 *
 * - The value is 32 random bytes (base64url, 43 characters: SESSION_SECRET and the cron route need 32+), made here for that
 *   variable and environment alone (so previews and production never share one), sent to `vercel env add <name> <env>
 *   --sensitive` on its stdin (never on the command line, where the process list would show it), and never printed,
 *   written or kept. It never reads .env.local's values.
 * - The environment defaults to previews for SESSION_SECRET and to production for CRON_SECRET; --env picks the other.
 * - An environment that already has the variable is left alone unless --replace. ⚠️ Replacing SESSION_SECRET resets that
 *   environment's ESPN cookie sessions, signed imports, shared-cache keys and rate-limit counts at once
 *   (src/server/redis.ts); replacing CRON_SECRET only changes what Vercel sends the cron. Either takes effect at the
 *   environment's next deployment.
 * - It talks to Vercel, so it runs only with --live (scripts/lib/runMode.ts). The CLI runs as preview:deploy runs it
 *   (scripts/preview-deploy.ts vercel: the pinned version through npx, --project, never `vercel link` or `env pull`).
 *   `env ls`'s output (it can hold a plain variable's value) is read for the names only and never printed.
 */
import { randomBytes } from "node:crypto";
import { flagValue, isMainModule, requireLive } from "./lib/runMode";
import { envNames, jsonOf, PROJECT, tail, vercel } from "./preview-deploy";

export const SECRET_ENVS = ["preview", "production"] as const;
export type SecretEnv = (typeof SECRET_ENVS)[number];

export const SECRET_NAMES = ["SESSION_SECRET", "CRON_SECRET"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

/** Each variable's default environment (see the header): Vercel runs crons on production deployments only. */
export const DEFAULT_SECRET_ENV: Readonly<Record<SecretName, SecretEnv>> = { SESSION_SECRET: "preview", CRON_SECRET: "production" };

/** What a replacement does, in words (see the header). */
const REPLACE_EFFECT: Readonly<Record<SecretName, string>> = {
  SESSION_SECRET: "which resets its sessions, signed imports, cache keys and rate-limit counts",
  CRON_SECRET: "which only changes what Vercel sends the daily snapshot cron",
};

/** The command line (see the header), or what's wrong with it. */
export function vercelSecretArgs(argv: readonly string[]): { name: SecretName; env: SecretEnv; replace: boolean } | { error: string } {
  const usage = "Usage: npm run vercel:secret -- --live [--name SESSION_SECRET|CRON_SECRET] [--env preview|production] [--replace]";
  const known = new Set(["--live", "--env", "--name", "--replace"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--env" || a === "--name") {
      i++;
      continue;
    }
    if (!known.has(a)) return { error: `Unknown option "${a}". ${usage}` };
  }
  const name = flagValue(argv, "--name") ?? (argv.includes("--name") ? "" : "SESSION_SECRET");
  if (!(SECRET_NAMES as readonly string[]).includes(name)) return { error: `--name takes ${SECRET_NAMES.join(" or ")}.` };
  const env = flagValue(argv, "--env") ?? (argv.includes("--env") ? "" : DEFAULT_SECRET_ENV[name as SecretName]);
  if (!(SECRET_ENVS as readonly string[]).includes(env)) return { error: `--env takes ${SECRET_ENVS.join(" or ")}.` };
  return { name: name as SecretName, env: env as SecretEnv, replace: argv.includes("--replace") };
}

/** A new secret (see the header): 32 random bytes, base64url. */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** The name the script had before CRON_SECRET (kept for its tests and readers). */
export const newSessionSecret = newSecret;

/** The CLI's arguments to add (or with `replace`, overwrite) `name` for `env`, its value on stdin. */
export function envAddArgs(env: SecretEnv, replace: boolean, name: SecretName = "SESSION_SECRET"): string[] {
  return ["env", "add", name, env, "--project", PROJECT, "--sensitive", "--yes", ...(replace ? ["--force"] : [])];
}

/** A CLI answer's text with the secret cut out, should the CLI ever echo it. */
export function withoutSecret(text: string, secret: string): string {
  return secret ? text.split(secret).join("[secret]") : text;
}

function fail(message: string): never {
  console.error(`vercel:secret: ${message}`);
  process.exit(1);
}

function main(): void {
  requireLive({ script: "vercel:secret", what: "adds a secret (SESSION_SECRET or CRON_SECRET) to the Vercel project's environment" });
  const args = vercelSecretArgs(process.argv.slice(2));
  if ("error" in args) fail(args.error);
  const { name, env, replace } = args;

  const listed = vercel(["env", "ls", env, "--project", PROJECT, "--format", "json"]);
  if (listed.status !== 0) fail(`listing the ${env} environment's variables failed (exit ${listed.status}). Nothing changed.`);
  const has = envNames(jsonOf(listed.stdout), env).has(name);
  if (has && !replace) {
    console.log(`The ${env} environment already has a ${name}. Nothing changed (--replace makes a new one, ${REPLACE_EFFECT[name]}).`);
    return;
  }

  const secret = newSecret();
  const added = vercel(envAddArgs(env, has, name), secret);
  if (added.status !== 0) fail(`adding ${name} for ${env} failed (exit ${added.status}).\n  ${withoutSecret(tail(added.stderr || added.stdout), secret)}`);
  console.log(`${has ? "Replaced" : "Added"} ${name} for ${env} (a new random value, stored as a sensitive variable; never shown). It takes effect at the next ${env} deployment.`);
}

if (isMainModule(import.meta.url)) {
  try {
    main();
  } catch (err) {
    fail(err instanceof Error ? err.name : typeof err);
  }
}
