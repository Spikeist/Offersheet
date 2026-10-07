/**
 * The public beta's usage (planner reply to Checkpoint 7a, §2 question 7: "Usage check: add npm run usage:report"; §5.4:
 * FantasyCalc's free use holds while Offer Sheet stays "under about 10,000 sessions a month", and "usage:report shows
 * monthly sessions against 10,000 and warns at 8,000"; reports/fantasycalc-permission.md). It reads the shared store's day
 * counters (src/server/usage.ts: one key per counter and UTC day, no identifiers) and today's budget counters
 * (src/server/budget.ts):
 *
 *   npm run usage:report -- --live                      the preview deployments' usage: the last 30 days and the month
 *   npm run usage:report -- --live --env production     production's (after Parker's "go" at Checkpoint 7b)
 *   npm run usage:report -- --live --days 14            the last 14 days (the month to date is always read whole)
 *
 * - It talks to Upstash, so it runs only with --live (planner reply to Checkpoint 4c, A5; scripts/lib/runMode.ts).
 * - It reads with the store's read-only token (READONLY_STORE_URL and READONLY_STORE_TOKEN in .env.local, typed in by
 *   hand, as for `npm run beta:log`: scripts/lib/storeReader.ts). The app never reads those names, and uses the store on
 *   Vercel only (src/server/redis.ts).
 * - Read-only: one MGET of every day's counters and today's budget counters. It prints counts only: the counters hold no
 *   identifier of any league, person or address.
 *
 * What it prints: the month's sessions (League page builds answered: each one loads FantasyCalc's values) against
 * FantasyCalc's 10,000, with a warning from 8,000 (src/server/limits.ts usageLimits); today's work units against the day's
 * work budget and what its current 2-hour slice opens (workLimits); today's outbound requests against each platform's
 * daily budget (the budgets' own counters, refused attempts included: budgets.perDay); the capacity refusals ("The beta is
 * at capacity today."); the month to date; and the last days, a line a day.
 *
 * Vercel's own usage (Active CPU, Fast Origin Transfer, invocations) isn't in the store. The Vercel CLI reads it without
 * prompts: `npx --yes vercel@62.2.0 usage --group-by project --non-interactive` (add `--json` for JSON), run from a folder
 * other than this one (a Vercel command here could write .vercel/ or .env.local; see the deploy notes in CLAUDE.md §19).
 */
import { budgets, usageLimits, workLimits } from "@/server/limits";
import { keyPrefix, type RedisLike } from "@/server/redis";
import { slicedAllowance, type BudgetPlatform } from "@/server/budget";
import { USAGE_COUNTERS, usageDay, usageKey, type UsageCounter } from "@/server/usage";
import { flagValue, isMainModule, requireLive } from "./lib/runMode";
import { openStoreReader, storeFailureText } from "./lib/storeReader";

export const USAGE_ENVS = ["preview", "production"] as const;
export type UsageEnv = (typeof USAGE_ENVS)[number];

export interface UsageArgs {
  env: UsageEnv;
  /** Days shown a line each, today included. */
  days: number;
}

const MAX_DAYS = 60;
const DAY_MS = 24 * 60 * 60_000;
const PLATFORMS = Object.keys(budgets.perDay) as BudgetPlatform[];
const PLATFORM_LABEL: Readonly<Record<BudgetPlatform, string>> = { espn: "ESPN", sleeper: "Sleeper", fantasycalc: "FantasyCalc", github: "GitHub (DynastyProcess)" };

/** The command line (see the header), or what's wrong with it. */
export function usageArgs(argv: readonly string[]): UsageArgs | { error: string } {
  const env = flagValue(argv, "--env") ?? "preview";
  if (!(USAGE_ENVS as readonly string[]).includes(env)) return { error: `--env takes ${USAGE_ENVS.join(" or ")}.` };
  let days = 30;
  if (argv.includes("--days")) {
    const v = Number(flagValue(argv, "--days"));
    if (!(Number.isInteger(v) && v >= 1 && v <= MAX_DAYS)) return { error: `--days takes a whole number from 1 to ${MAX_DAYS}.` };
    days = v;
  }
  return { env: env as UsageEnv, days };
}

/**
 * The UTC days to read, newest first: the `days` days shown (today and the ones before it) and every day of the month to
 * date, whichever reaches further back.
 */
export function usageDays(now: number, days: number): string[] {
  const dayOfMonth = new Date(now).getUTCDate();
  return Array.from({ length: Math.max(days, dayOfMonth) }, (_, i) => usageDay(now - i * DAY_MS));
}

export type DayCounts = Record<UsageCounter, number>;

export interface UsageRead {
  /** Each day's counters (0 where nothing was counted), newest day first. */
  days: Array<{ day: string; counts: DayCounts }>;
  /** Today's work budget counter (the server's day; refused charges included), null when there is none yet. */
  workToday: number | null;
  /** Today's outbound budget counters by platform (refused attempts included), null where there is none yet. */
  budgetToday: Record<BudgetPlatform, number | null>;
}

function zeroCounts(): DayCounts {
  return Object.fromEntries(USAGE_COUNTERS.map((c) => [c, 0])) as DayCounts;
}

/** A stored counter's value: a whole number, else 0 (a missing key, or anything else). */
function countOf(raw: string | null | undefined): number {
  const n = Number(raw);
  return raw !== null && raw !== undefined && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Every counter of `days` and today's budget counters, in one MGET (see the header). */
export async function readUsage(redis: Pick<RedisLike, "mget">, prefix: string, days: readonly string[], today: string): Promise<UsageRead> {
  const dayKeys = days.flatMap((day) => USAGE_COUNTERS.map((c) => usageKey(prefix, day, c)));
  const workKey = `${prefix}work:${today}`;
  const budgetKeys = PLATFORMS.map((p) => `${prefix}budget:${p}:${today}`);
  const values = await redis.mget(...dayKeys, workKey, ...budgetKeys);
  const out: UsageRead["days"] = days.map((day, d) => {
    const counts = zeroCounts();
    USAGE_COUNTERS.forEach((c, i) => (counts[c] = countOf(values[d * USAGE_COUNTERS.length + i])));
    return { day, counts };
  });
  const after = dayKeys.length;
  const raw = (i: number): number | null => (values[i] === null || values[i] === undefined ? null : countOf(values[i]));
  const budgetToday = Object.fromEntries(PLATFORMS.map((p, i) => [p, raw(after + 1 + i)])) as Record<BudgetPlatform, number | null>;
  return { days: out, workToday: raw(after), budgetToday };
}

/** The sum of every counter over `days`. */
function totals(days: ReadonlyArray<{ counts: DayCounts }>): DayCounts {
  const t = zeroCounts();
  for (const { counts } of days) for (const c of USAGE_COUNTERS) t[c] += counts[c];
  return t;
}

export interface UsageSummary {
  today: string;
  /** "2026-10": the UTC month to date. */
  month: string;
  monthTotals: DayCounts;
  /** Days of the month so far (today included) and in all. */
  dayOfMonth: number;
  daysInMonth: number;
  /** The month's sessions at its pace so far, by its end (whole). */
  sessionsPace: number;
  /** The month's sessions reached the warning (usageLimits.fantasyCalcSessionsWarnAt) or the limit. */
  sessionsWarn: boolean;
  sessionsOver: boolean;
  /** The days shown, newest first. */
  shown: Array<{ day: string; counts: DayCounts }>;
  workToday: number | null;
  /** What the work budget's day opens by now (its slices) and in all. */
  workOpenNow: number;
  budgetToday: Record<BudgetPlatform, number | null>;
  /** What each platform's day opens by now (its 2-hour slices; of ESPN's, budgets.reservedForCookies is kept for requests with cookies). */
  budgetOpenNow: Record<BudgetPlatform, number>;
}

/** The report's numbers (pure; `now` is the time of the read). */
export function summarizeUsage(read: UsageRead, args: UsageArgs, now: number): UsageSummary {
  const today = usageDay(now);
  const month = today.slice(0, 7);
  const d = new Date(now);
  const dayOfMonth = d.getUTCDate();
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const monthTotals = totals(read.days.filter((x) => x.day.startsWith(month)));
  const sessions = monthTotals.model_builds;
  const budgetOpenNow = Object.fromEntries(PLATFORMS.map((p) => [p, slicedAllowance(budgets.perDay[p], now)])) as Record<BudgetPlatform, number>;
  return {
    today,
    month,
    monthTotals,
    dayOfMonth,
    daysInMonth,
    sessionsPace: Math.round((sessions / dayOfMonth) * daysInMonth),
    sessionsWarn: sessions >= usageLimits.fantasyCalcSessionsWarnAt,
    sessionsOver: sessions >= usageLimits.fantasyCalcSessionsPerMonth,
    shown: read.days.slice(0, args.days),
    workToday: read.workToday,
    workOpenNow: slicedAllowance(workLimits.perDay, now),
    budgetToday: read.budgetToday,
    budgetOpenNow,
  };
}

const n = (x: number): string => x.toLocaleString("en-US");

function importsOf(c: DayCounts): number {
  return c.import_espn_browser + c.import_espn_server + c.import_sleeper_browser + c.import_sleeper_server;
}

/** The report (pure). */
export function formatUsageReport(s: UsageSummary, args: UsageArgs): string {
  const L: string[] = [];
  const last = s.shown.at(-1)?.day ?? s.today;
  L.push(`Offer Sheet beta usage: ${args.env}, ${last} to ${s.today} (UTC days). Counts only: the counters hold no identifiers.`);
  L.push("");
  const sessions = s.monthTotals.model_builds;
  L.push(`Sessions this month: ${n(sessions)} of ${n(usageLimits.fantasyCalcSessionsPerMonth)} (FantasyCalc's free limit).`);
  L.push(`  A session is a League page build answered; ${s.month} so far (${s.dayOfMonth} of ${s.daysInMonth} days), at this pace about ${n(s.sessionsPace)} by the month's end.`);
  if (s.sessionsOver) L.push(`  WARNING: past FantasyCalc's free ${n(usageLimits.fantasyCalcSessionsPerMonth)} a month. Write to FantasyCalc now (reports/fantasycalc-permission.md).`);
  else if (s.sessionsWarn) L.push(`  WARNING: past ${n(usageLimits.fantasyCalcSessionsWarnAt)}. Write to FantasyCalc before the month reaches ${n(usageLimits.fantasyCalcSessionsPerMonth)} (reports/fantasycalc-permission.md).`);
  L.push("");
  L.push(`Today (${s.today}, UTC, so far):`);
  const work = s.workToday === null ? "none counted yet" : n(s.workToday);
  L.push(`  Work units: ${work} of ${n(workLimits.perDay)} for the day (${n(s.workOpenNow)} open by this 2-hour slice; refused charges count too).`);
  L.push("  Outbound requests, the budgets' own counts (refused attempts count too):");
  const reserved: Readonly<Partial<Record<BudgetPlatform, number>>> = budgets.reservedForCookies;
  for (const p of PLATFORMS) {
    const used = s.budgetToday[p];
    const kept = reserved[p] ? `; ${n(reserved[p] ?? 0)} of the day kept for requests with ESPN cookies` : "";
    L.push(`    ${PLATFORM_LABEL[p].padEnd(24)} ${(used === null ? "0" : n(used)).padStart(7)} of ${n(budgets.perDay[p]).padStart(6)} (${n(s.budgetOpenNow[p])} open by this slice${kept})`);
  }
  const todayCounts = s.shown.find((x) => x.day === s.today)?.counts ?? zeroCounts();
  L.push(`  Refused for capacity ("The beta is at capacity today."): ${n(todayCounts.refused_capacity)}.`);
  L.push("");
  const m = s.monthTotals;
  L.push(`Month to date (${s.month}):`);
  L.push(`  Sessions ${n(m.model_builds)} · imports ${n(importsOf(m))} (ESPN read by the browser ${n(m.import_espn_browser)}, by the server ${n(m.import_espn_server)}; Sleeper by the browser ${n(m.import_sleeper_browser)}, by the server ${n(m.import_sleeper_server)})`);
  L.push(`  Refused: for capacity ${n(m.refused_capacity)} · a visitor's day used up ${n(m.refused_visitor)} · rate limits ${n(m.refused_rate)}`);
  L.push(`  Work units ${n(m.work_units)} · outbound requests: ESPN ${n(m.outbound_espn)}, Sleeper ${n(m.outbound_sleeper)}, FantasyCalc ${n(m.outbound_fantasycalc)}, GitHub ${n(m.outbound_github)}`);
  L.push("");
  L.push(`Last ${s.shown.length} day(s), newest first (imports: ESPN browser/server, Sleeper browser/server; refused: capacity, a visitor's day, rate limits):`);
  const head = ["Day", "Sessions", "Imports", "E-b/E-s/S-b/S-s", "Capacity", "Visitor", "Rate", "Units", "ESPN", "Sleeper", "FC", "GitHub"];
  const widths = [10, 8, 7, 15, 8, 7, 5, 7, 6, 7, 4, 6];
  const row = (cells: string[]) => `  ${cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[0] ?? 10) : cell.padStart(widths[i] ?? 6))).join("  ")}`;
  L.push(row(head));
  for (const { day, counts: c } of s.shown) {
    const imports = `${c.import_espn_browser}/${c.import_espn_server}/${c.import_sleeper_browser}/${c.import_sleeper_server}`;
    L.push(
      row([
        day,
        n(c.model_builds),
        n(importsOf(c)),
        imports,
        n(c.refused_capacity),
        n(c.refused_visitor),
        n(c.refused_rate),
        n(c.work_units),
        n(c.outbound_espn),
        n(c.outbound_sleeper),
        n(c.outbound_fantasycalc),
        n(c.outbound_github),
      ]),
    );
  }
  L.push("");
  L.push("Refusal counts are a floor: an instance holds them until its next write (src/server/usage.ts).");
  L.push("Vercel's own usage: npx --yes vercel@62.2.0 usage --group-by project --non-interactive (run it outside this folder).");
  return L.join("\n");
}

async function main(): Promise<void> {
  requireLive({ script: "usage:report", what: "reads the beta's usage counters from the shared store (Upstash)" });
  const args = usageArgs(process.argv.slice(2));
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
  const now = Date.now();
  const read = await readUsage(redis, keyPrefix({ VERCEL_ENV: args.env }), usageDays(now, args.days), usageDay(now));
  console.log(formatUsageReport(summarizeUsage(read, args, now), args));
}

if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    // Only the error's name: an Upstash error's message carries the command (scripts/lib/storeReader.ts).
    console.error(storeFailureText("usage:report", err));
    process.exit(1);
  });
}
