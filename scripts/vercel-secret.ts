/**
 * npm run vercel:secret -- --live — gives Parker's Vercel project "offersheet" a SESSION_SECRET of its own (final review
 * SEC-9: without one a deployment runs with no shared store, no ESPN cookie sessions and no signed imports, and copying the
 * local value would make the deployment's root key one that also lives in .env.local, in the stable copy's folder and in
 * Turbopack's caches on this computer).
 *
 *   npm run vercel:secret -- --live                        previews (before any preview deployment)
 *   npm run vercel:secret -- --live --env production       production (Checkpoint 7b, before Parker's "go")
 *   npm run vercel:secret -- --live --replace              a new one in place of the old (see below)
 *
 * - The value is 32 random bytes (base64url, 43 characters: SESSION_SECRET needs 32+), made here for that environment alone
 *   (so previews and production never share one), sent to `vercel env add SESSION_SECRET <env> --sensitive` on its stdin
 *   (never on the command line, where the process list would show it), and never printed, written or kept. It never reads
 *   .env.local's SESSION_SECRET.
 * - An environment that already has one is left alone unless --replace: ⚠️ replacing it resets that environment's ESPN
 *   cookie sessions, signed imports, shared-cache keys and rate-limit counts at once (src/server/redis.ts), and takes
 *   effect at its next deployment.
 * - It talks to Vercel, so it runs only with --live (scripts/lib/runMode.ts). The CLI runs as preview:deploy runs it
 *   (scripts/preview-deploy.ts vercel: the pinned version through npx, --project, never `vercel link` or `env pull`).
 *   `env ls`'s output (it can hold a plain variable's value) is read for the names only and never printed.
 */
import { randomBytes } from "node:crypto";
import { flagValue, isMainModule, requireLive } from "./lib/runMode";
import { envNames, jsonOf, PROJECT, tail, vercel } from "./preview-deploy";

export const SECRET_ENVS = ["preview", "production"] as const;
export type SecretEnv = (typeof SECRET_ENVS)[number];

/** The command line (see the header), or what's wrong with it. */
export function vercelSecretArgs(argv: readonly string[]): { env: SecretEnv; replace: boolean } | { error: string } {
  const known = new Set(["--live", "--env", "--replace"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--env") {
      i++;
      continue;
    }
    if (!known.has(a)) return { error: `Unknown option "${a}". Usage: npm run vercel:secret -- --live [--env preview|production] [--replace]` };
  }
  const env = flagValue(argv, "--env") ?? (argv.includes("--env") ? "" : "preview");
  if (!(SECRET_ENVS as readonly string[]).includes(env)) return { error: `--env takes ${SECRET_ENVS.join(" or ")}.` };
  return { env: env as SecretEnv, replace: argv.includes("--replace") };
}

/** A new secret (see the header): 32 random bytes, base64url. */
export function newSessionSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** The CLI's arguments to add (or with `replace`, overwrite) SESSION_SECRET for `env`, its value on stdin. */
export function envAddArgs(env: SecretEnv, replace: boolean): string[] {
  return ["env", "add", "SESSION_SECRET", env, "--project", PROJECT, "--sensitive", "--yes", ...(replace ? ["--force"] : [])];
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
  requireLive({ script: "vercel:secret", what: "adds a SESSION_SECRET to the Vercel project's environment" });
  const args = vercelSecretArgs(process.argv.slice(2));
  if ("error" in args) fail(args.error);
  const { env, replace } = args;

  const listed = vercel(["env", "ls", env, "--project", PROJECT, "--format", "json"]);
  if (listed.status !== 0) fail(`listing the ${env} environment's variables failed (exit ${listed.status}). Nothing changed.`);
  const has = envNames(jsonOf(listed.stdout), env).has("SESSION_SECRET");
  if (has && !replace) {
    console.log(`The ${env} environment already has a SESSION_SECRET. Nothing changed (--replace makes a new one, which resets its sessions, signed imports, cache keys and rate-limit counts).`);
    return;
  }

  const secret = newSessionSecret();
  const added = vercel(envAddArgs(env, has), secret);
  if (added.status !== 0) fail(`adding SESSION_SECRET for ${env} failed (exit ${added.status}).\n  ${withoutSecret(tail(added.stderr || added.stdout), secret)}`);
  console.log(`${has ? "Replaced" : "Added"} SESSION_SECRET for ${env} (a new random value, stored as a sensitive variable; never shown). It takes effect at the next ${env} deployment.`);
}

if (isMainModule(import.meta.url)) {
  try {
    main();
  } catch (err) {
    fail(err instanceof Error ? err.name : typeof err);
  }
}
