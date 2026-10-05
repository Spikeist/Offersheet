/**
 * Environment access for scripts. Values come from .env.local via @next/env (the same loader
 * Next.js uses), so scripts and the app parse the file identically.
 *
 * Never print values from here. Use envStatus() ("set" / "blank") when you need to report on them.
 * Note: loadEnvConfig() also returns the raw file contents (loadedEnvFiles[].contents); we ignore it.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

export function findProjectRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, "utf8")) as { name?: string }).name === "fantasy-trade-finder") return dir;
      } catch {
        // not our package.json; keep walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Could not find the fantasy-trade-finder project root (run scripts from inside the project).");
    dir = parent;
  }
}

export const ROOT = findProjectRoot();

export const ENV_VARS = [
  "ESPN_LEAGUE_ID",
  "ESPN_SEASON",
  "ESPN_S2",
  "ESPN_SWID",
  "SLEEPER_USERNAME",
  "SLEEPER_LEAGUE_ID",
  "FLEAFLICKER_LEAGUE_ID",
  "FANTRAX_LEAGUE_ID",
  "MFL_LEAGUE_ID",
  "MFL_USERNAME",
  "MFL_PASSWORD",
  "YAHOO_CLIENT_ID",
  "YAHOO_CLIENT_SECRET",
  // Not in the spec's list: written/read by probe-yahoo.ts once Yahoo approves the app (Phase 5).
  "YAHOO_AUTH_CODE",
  "YAHOO_REFRESH_TOKEN",
  "SESSION_SECRET",
  // Planner reply to Checkpoint 7a, §6.3: the daily snapshot cron's secret. It lives on Vercel (npm run vercel:secret -- --live
  // --name CRON_SECRET) and is normally blank here; listed so check:leaks and every output scrubber know a value set here.
  "CRON_SECRET",
  // Not a secret (CLAUDE.md §0.5): 1 = development imports Parker's ESPN league with the .env.local cookies.
  "USE_ENV_COOKIES",
  // Checkpoint 7a, optional: the beta's shared store (Upstash) for the --live scripts that read it (beta:log, usage:report,
  // feedback:report, snapshot:pull). The token is a secret; the URL names the database. The local app never uses them
  // (src/server/redis.ts).
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  // The same store under Upstash's own names, which src/server/redis.ts reads first and the scripts accept too (final
  // review SEC-7: listed so check:leaks and every output scrubber know their values), the Marketplace's read-only token,
  // and the redis:// connection strings the Marketplace also offers, whose text carries the password. Offer Sheet never
  // needs the last three: they're listed only so a pasted value is caught.
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_READ_ONLY_TOKEN",
  "KV_URL",
  "REDIS_URL",
] as const;
export type EnvVar = (typeof ENV_VARS)[number];

/** Variables whose values must never appear in any output (secrets, private IDs, usernames). */
export const SENSITIVE_ENV_VARS: readonly EnvVar[] = ENV_VARS.filter((v) => v !== "ESPN_SEASON" && v !== "USE_ENV_COOKIES");

let loaded = false;
export function loadEnv(): void {
  if (loaded) return;
  loadEnvConfig(ROOT, true, {
    info: () => {},
    error: () => console.error("Could not load .env.local (details hidden so no values are printed)."),
  });
  loaded = true;
}

/** Trimmed value, or undefined when blank/missing. */
export function env(name: EnvVar): string | undefined {
  loadEnv();
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function envStatus(): Record<EnvVar, "set" | "blank"> {
  const out = {} as Record<EnvVar, "set" | "blank">;
  for (const name of ENV_VARS) out[name] = env(name) ? "set" : "blank";
  return out;
}
