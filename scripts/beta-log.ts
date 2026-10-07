/**
 * Reads the public beta's error log from the shared store (planner reply to Checkpoint 4c, Part B, B1: "error logging that
 * never records credentials or league data"; Checkpoint 7a, track RL; src/server/log.ts): counts by route and code, by
 * event, and the newest events' allowlisted fields (route, event, code, platform, status, error name, time taken).
 *
 *   npm run beta:log -- --live                      the preview deployments' log, the last 14 days, the newest 50 events
 *   npm run beta:log -- --live --env production     production's log (after Parker's "go" at Checkpoint 7b)
 *   npm run beta:log -- --live --days 3 --last 20   the last 3 days, the newest 20 events
 *
 * - It talks to Upstash, so it runs only with --live (planner reply to Checkpoint 4c, A5; scripts/lib/runMode.ts).
 * - It reads with the store's read-only token, under variable names the app never reads: READONLY_STORE_URL and
 *   READONLY_STORE_TOKEN in .env.local, typed in by hand (scripts/lib/storeReader.ts, which says where to find them,
 *   checks the token can't write before the first read, and says only whether each variable is set, never a value). The
 *   app uses the store on Vercel only (src/server/redis.ts), so `npm run dev`, the stable copy and check:browser never
 *   contact it. Never `vercel env pull`: it would replace .env.local, and with Vercel's system variables (VERCEL among
 *   them) the local server would take itself for a deployment.
 * - Read-only: one LRANGE per day list (`os:<env>:log:<YYYY-MM-DD>`). An entry that doesn't parse as the allowlist is
 *   counted, never printed.
 */
import { keyPrefix, type RedisLike } from "@/server/redis";
import { LOG_ROUTES, StoredLogEventSchema, type StoredLogEvent } from "@/server/log";
import { flagValue, isMainModule, requireLive } from "./lib/runMode";
import { openStoreReader, storeFailureText } from "./lib/storeReader";

export const BETA_LOG_ENVS = ["preview", "production"] as const;
export type BetaLogEnv = (typeof BETA_LOG_ENVS)[number];

export interface BetaLogArgs {
  env: BetaLogEnv;
  /** Days back, today included (at most the log's 14). */
  days: number;
  /** The newest events printed. */
  last: number;
}

const MAX_DAYS = 14;

/** The command line (see the header), or what's wrong with it. */
export function betaLogArgs(argv: readonly string[]): BetaLogArgs | { error: string } {
  const env = flagValue(argv, "--env") ?? "preview";
  if (!(BETA_LOG_ENVS as readonly string[]).includes(env)) return { error: `--env takes ${BETA_LOG_ENVS.join(" or ")}.` };
  const num = (flag: string, fallback: number, max: number): number | { error: string } => {
    if (!argv.includes(flag)) return fallback;
    const v = Number(flagValue(argv, flag));
    return Number.isInteger(v) && v >= 1 && v <= max ? v : { error: `${flag} takes a whole number from 1 to ${max}.` };
  };
  const days = num("--days", MAX_DAYS, MAX_DAYS);
  if (typeof days !== "number") return days;
  const last = num("--last", 50, 2_000);
  if (typeof last !== "number") return last;
  return { env: env as BetaLogEnv, days, last };
}

/** The UTC days to read, newest first: today and the `days − 1` before it. */
export function logDays(now: number, days: number): string[] {
  const DAY = 24 * 60 * 60_000;
  return Array.from({ length: days }, (_, i) => new Date(now - i * DAY).toISOString().slice(0, 10));
}

/** Every entry of the day lists (raw strings, newest day first; one LRANGE per day). */
export async function readLogEntries(redis: Pick<RedisLike, "lrange">, prefix: string, days: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const day of days) out.push(...(await redis.lrange(`${prefix}log:${day}`, 0, -1)));
  return out;
}

export interface BetaLogSummary {
  total: number;
  /** Entries that didn't parse as the allowlist (never printed). */
  invalid: number;
  /** "route code" → count ("-" for no code). */
  byRouteCode: Array<[string, number]>;
  byEvent: Array<[string, number]>;
  /** The newest events, newest first. */
  newest: StoredLogEvent[];
}

function counted(map: Map<string, number>): Array<[string, number]> {
  return [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Counts and the newest `last` events of raw entries (pure). */
export function summarizeLog(entries: readonly string[], last: number): BetaLogSummary {
  const valid: StoredLogEvent[] = [];
  let invalid = 0;
  for (const raw of entries) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      invalid++;
      continue;
    }
    const ok = StoredLogEventSchema.safeParse(parsed);
    if (ok.success) valid.push(ok.data);
    else invalid++;
  }
  const byRouteCode = new Map<string, number>();
  const byEvent = new Map<string, number>();
  for (const e of valid) {
    const rc = `${e.route} ${e.code ?? "-"}`;
    byRouteCode.set(rc, (byRouteCode.get(rc) ?? 0) + 1);
    byEvent.set(e.event, (byEvent.get(e.event) ?? 0) + 1);
  }
  const newest = [...valid].sort((a, b) => b.at - a.at).slice(0, last);
  return { total: valid.length, invalid, byRouteCode: counted(byRouteCode), byEvent: counted(byEvent), newest };
}

/** One event as a line of its allowlisted fields. */
export function eventLine(e: StoredLogEvent): string {
  const parts = [new Date(e.at).toISOString().slice(0, 19).replace("T", " "), e.route.padEnd(8), e.event];
  if (e.code) parts.push(`code ${e.code}`);
  if (e.platform) parts.push(`platform ${e.platform}`);
  if (e.status !== undefined) parts.push(`status ${e.status}`);
  if (e.errorName) parts.push(`error ${e.errorName}`);
  if (e.ms !== undefined) parts.push(`${e.ms} ms`);
  return parts.join("  ");
}

/** The report (pure). */
export function formatBetaLog(summary: BetaLogSummary, args: BetaLogArgs, days: readonly string[]): string {
  const lines: string[] = [];
  lines.push(`Offer Sheet beta log: ${args.env}, ${days.at(-1)} to ${days[0]} (UTC), ${summary.total} event(s)${summary.invalid ? `, ${summary.invalid} unreadable entr${summary.invalid === 1 ? "y" : "ies"} skipped` : ""}.`);
  if (!summary.total) return `${lines.join("\n")}\nNothing logged.`;
  lines.push("", "By route and code:");
  for (const [rc, n] of summary.byRouteCode) {
    const [route, code] = rc.split(" ");
    lines.push(`  ${String(n).padStart(6)}  ${(route ?? "").padEnd(8)} ${code}`);
  }
  lines.push("", "By event:");
  for (const [event, n] of summary.byEvent) lines.push(`  ${String(n).padStart(6)}  ${event}`);
  lines.push("", `Newest ${summary.newest.length}:`);
  for (const e of summary.newest) lines.push(`  ${eventLine(e)}`);
  lines.push("", `Routes: ${LOG_ROUTES.join(", ")} ("server" is work outside a request).`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  requireLive({ script: "beta:log", what: "reads the beta's error log from the shared store (Upstash)" });
  const args = betaLogArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(args.error);
    process.exit(1);
  }
  const { loadEnv } = await import("./lib/env");
  loadEnv();
  // The store, read-only: the scripts' own variables and a token that can't write (scripts/lib/storeReader.ts).
  const store = await openStoreReader(process.env);
  if ("error" in store) {
    console.error(store.error);
    process.exit(1);
  }
  const redis = store.reader;
  const days = logDays(Date.now(), args.days);
  const entries = await readLogEntries(redis, keyPrefix({ VERCEL_ENV: args.env }), days);
  console.log(formatBetaLog(summarizeLog(entries, args.last), args, days));
}

if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    // Only the error's name: an Upstash error's message carries the command (scripts/lib/storeReader.ts).
    console.error(storeFailureText("beta:log", err));
    process.exit(1);
  });
}
