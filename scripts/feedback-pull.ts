/**
 * Pulls the public beta's anonymous feedback from the shared store (planner reply to Checkpoint 4c, Part B, B2; Checkpoint
 * 7a, track FB; src/server/feedbackSink.ts): each month's list into a git-ignored file, and counts only on the screen.
 *
 *   npm run feedback:pull -- --live                      the preview deployments' feedback, the last 13 months
 *   npm run feedback:pull -- --live --env production     production's (after Parker's "go" at Checkpoint 7b)
 *   npm run feedback:pull -- --live --months 2           this month and last
 *
 * - It talks to Upstash, so it runs only with --live (planner reply to Checkpoint 4c, A5; scripts/lib/runMode.ts), and it
 *   needs the store's REST address and token in .env.local (KV_REST_API_URL and KV_REST_API_TOKEN, or
 *   UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN) and SESSION_SECRET, as `npm run beta:log` does: it says only
 *   whether each is set, never a value, and having them there never switches the app itself to Upstash (only on Vercel).
 * - Read-only: one LRANGE per UTC day of each month read (`os:<env>:fb:<YYYY-MM-DD>`, newest first in the store; final
 *   review SEC-3: the store keeps one list per day, src/server/feedbackSink.ts), about 400 commands for 13 months. Every
 *   entry is checked against the store's own schema (StoredFeedbackEventSchema); one that doesn't parse is counted, never
 *   printed or written.
 * - Days to check (final review SEC-3): a day whose list is at the store's daily cap (feedbackLimits.maxPerDay: its oldest
 *   copies were let go) or holds SPIKE_FACTOR times the median of the days with copies (and at least SPIKE_MIN) is named
 *   with its count. A flood of forged copies can crowd out at most its own day, so Phase 6 drops or down-weights those
 *   days before the acceptance refit.
 * - Writes `data-local/feedback-server/<env>/<YYYY-MM>.json` in the project folder (git-ignored, like all of data-local/):
 *   the month's copies oldest first, each as stored (the copy and the UTC day it arrived), replacing the file a previous
 *   pull wrote. A month with no copies writes no file. Previews and production go to their own folders, so a preview's
 *   test presses never mix with real feedback.
 * - Downloaded copies follow the store's own rule (review FB-R2; the store deletes each day's feedback a year after that
 *   day): every run, with --live or without (offline: it only deletes local files), first deletes each month file under
 *   data-local/feedback-server/ (both folders) whose time is up, feedbackLimits.retainDays after the UTC day of its newest
 *   copy began (never later than the store drops that day's list: its year runs from the copy's arrival; the month's older
 *   days stay in the file up to a month longer than in the store), or after its month began for a file it can't read; a
 *   month already due isn't written. It prints which files went and the day the next one is due, so Parker can run it
 *   again then. ⚠️ Between runs nothing deletes them: the rule holds as long as the script is run at least that often
 *   (Checkpoint 7a's steps say so).
 * - Prints counts only: copies and records (a record's copies share its random id: the latest copy is the record as it
 *   stands), and per record as it stands its outcome, report reason, version sent, platform, league type and goal, and the
 *   copies taken back. Never a player id, a number or an id.
 * Phase 6 reads the files (the acceptance refit: Accepted and Rejected outcomes against the version's inputs; Helps you
 * across leagues and goals: B₃ and its reason).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { StoredFeedbackEvent } from "@/lib/feedbackEvent";
import { StoredFeedbackEventSchema } from "@/server/feedbackSink";
import { feedbackLimits } from "@/server/limits";
import { REDIS_OPT_IN_ENV, getRedis, keyPrefix, type RedisLike } from "@/server/redis";
import { flagValue, isMainModule, requireLive, setNetworkMode, wantsLive } from "./lib/runMode";

export const FEEDBACK_PULL_ENVS = ["preview", "production"] as const;
export type FeedbackPullEnv = (typeof FEEDBACK_PULL_ENVS)[number];

export interface FeedbackPullArgs {
  env: FeedbackPullEnv;
  /** Months back, this one included. */
  months: number;
}

/** The store keeps a day's list a year past that day, so 13 months reach every list it can hold. */
export const MAX_MONTHS = 13;

/** The command line (see the header), or what's wrong with it. */
export function feedbackPullArgs(argv: readonly string[]): FeedbackPullArgs | { error: string } {
  const env = flagValue(argv, "--env") ?? "preview";
  if (!(FEEDBACK_PULL_ENVS as readonly string[]).includes(env)) return { error: `--env takes ${FEEDBACK_PULL_ENVS.join(" or ")}.` };
  let months = MAX_MONTHS;
  if (argv.includes("--months")) {
    const v = Number(flagValue(argv, "--months"));
    if (!Number.isInteger(v) || v < 1 || v > MAX_MONTHS) return { error: `--months takes a whole number from 1 to ${MAX_MONTHS}.` };
    months = v;
  }
  return { env: env as FeedbackPullEnv, months };
}

/** The UTC months to read, newest first: this one and the `months − 1` before it ("2026-10", "2026-09", …). */
export function pullMonths(now: number, months: number): string[] {
  const d = new Date(now);
  return Array.from({ length: months }, (_, i) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
}

/** A month's UTC days ("2026-10-01" …), newest first, none after `now`'s day. */
export function monthDays(month: string, now: number): string[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = new Date(now).toISOString().slice(0, 10);
  const out: string[] = [];
  for (let d = last; d >= 1; d--) {
    const day = `${month}-${String(d).padStart(2, "0")}`;
    if (day <= today) out.push(day);
  }
  return out;
}

/** What the store holds for the months read: each month's raw entries (newest first) and each day's count of entries. */
export interface FeedbackRead {
  byMonth: Map<string, string[]>;
  byDay: Map<string, number>;
}

/** Each month's raw entries as the store holds them, newest first, from its days' lists (one LRANGE a day; see the header). */
export async function readFeedbackMonths(redis: Pick<RedisLike, "lrange">, prefix: string, months: readonly string[], now: number = Date.now()): Promise<FeedbackRead> {
  const byMonth = new Map<string, string[]>();
  const byDay = new Map<string, number>();
  for (const month of months) {
    const entries: string[] = [];
    for (const day of monthDays(month, now)) {
      const list = await redis.lrange(`${prefix}fb:${day}`, 0, -1);
      if (list.length) byDay.set(day, list.length);
      entries.push(...list);
    }
    byMonth.set(month, entries);
  }
  return { byMonth, byDay };
}

/** A day with this many times the median of the days with copies, and at least SPIKE_MIN, is named (see the header). */
export const SPIKE_FACTOR = 3;
export const SPIKE_MIN = 20;

/** A day to check before using its copies (see the header). */
export interface FlaggedDay {
  day: string;
  copies: number;
  why: "cap" | "spike";
}

/** The days to check (pure; see the header), oldest first. */
export function flaggedDays(byDay: ReadonlyMap<string, number>, cap: number = feedbackLimits.maxPerDay): FlaggedDay[] {
  const counts = [...byDay.values()].filter((n) => n > 0).sort((a, b) => a - b);
  const mid = Math.floor(counts.length / 2);
  const median = counts.length ? (counts.length % 2 ? (counts[mid] as number) : ((counts[mid - 1] as number) + (counts[mid] as number)) / 2) : 0;
  const out: FlaggedDay[] = [];
  for (const [day, copies] of [...byDay].sort(([a], [b]) => a.localeCompare(b))) {
    if (copies >= cap) out.push({ day, copies, why: "cap" });
    else if (copies >= SPIKE_MIN && copies >= SPIKE_FACTOR * median) out.push({ day, copies, why: "spike" });
  }
  return out;
}

/** A month's entries checked: the copies oldest first, and how many didn't parse (never kept). */
export function parseFeedbackEntries(entries: readonly string[]): { events: StoredFeedbackEvent[]; invalid: number } {
  const events: StoredFeedbackEvent[] = [];
  let invalid = 0;
  // The store's list is newest first; a file reads oldest first.
  for (let i = entries.length - 1; i >= 0; i--) {
    let data: unknown;
    try {
      data = JSON.parse(entries[i] as string);
    } catch {
      invalid++;
      continue;
    }
    const parsed = StoredFeedbackEventSchema.safeParse(data);
    if (parsed.success) events.push(parsed.data);
    else invalid++;
  }
  return { events, invalid };
}

export interface FeedbackPullSummary {
  copies: number;
  invalid: number;
  /** Records: distinct random ids; each as its latest copy says. */
  records: number;
  /** Records whose latest copy takes them back (no outcome, no reason). */
  takenBack: number;
  byOutcome: Array<[string, number]>;
  byReason: Array<[string, number]>;
  byVersion: Array<[string, number]>;
  byPlatform: Array<[string, number]>;
  byLeagueType: Array<[string, number]>;
  byGoal: Array<[string, number]>;
  /** Per month: copies and unreadable entries. */
  months: Array<{ month: string; copies: number; invalid: number }>;
  /** The days to check before using their copies (flaggedDays; final review SEC-3). */
  flagged: FlaggedDay[];
}

function counted(map: Map<string, number>): Array<[string, number]> {
  return [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * Counts over the months read (pure): copies, unreadable entries, and per record as it stands (its latest copy: the
 * newest month's, the later one within a month) its outcome, reason, version, platform, league type and goal; and the days
 * to check (`byDay`: each day's count of entries, FeedbackRead.byDay).
 */
export function summarizeFeedback(byMonth: ReadonlyMap<string, { events: readonly StoredFeedbackEvent[]; invalid: number }>, byDay: ReadonlyMap<string, number> = new Map()): FeedbackPullSummary {
  const latest = new Map<string, StoredFeedbackEvent>();
  const months: FeedbackPullSummary["months"] = [];
  let copies = 0;
  let invalid = 0;
  for (const month of [...byMonth.keys()].sort()) {
    const m = byMonth.get(month) as { events: readonly StoredFeedbackEvent[]; invalid: number };
    copies += m.events.length;
    invalid += m.invalid;
    months.push({ month, copies: m.events.length, invalid: m.invalid });
    for (const e of m.events) latest.set(e.rid, e);
  }
  const byOutcome = new Map<string, number>();
  const byReason = new Map<string, number>();
  const byVersion = new Map<string, number>();
  const byPlatform = new Map<string, number>();
  const byLeagueType = new Map<string, number>();
  const byGoal = new Map<string, number>();
  let takenBack = 0;
  for (const e of latest.values()) {
    if (!e.outcome && !e.reason) {
      takenBack++;
      continue;
    }
    bump(byOutcome, e.outcome ?? "none");
    bump(byReason, e.reason ?? "none");
    if (e.outcome) bump(byVersion, e.version ?? "unknown");
    bump(byPlatform, e.platform);
    bump(byLeagueType, e.format.leagueType);
    bump(byGoal, e.goal ?? "unknown");
  }
  return {
    copies,
    invalid,
    records: latest.size,
    takenBack,
    byOutcome: counted(byOutcome),
    byReason: counted(byReason),
    byVersion: counted(byVersion),
    byPlatform: counted(byPlatform),
    byLeagueType: counted(byLeagueType),
    byGoal: counted(byGoal),
    months,
    flagged: flaggedDays(byDay),
  };
}

/** The report (pure): counts only. */
export function formatFeedbackPull(summary: FeedbackPullSummary, args: FeedbackPullArgs, written: readonly string[]): string {
  const lines: string[] = [];
  const span = summary.months.length ? `${summary.months[0]?.month} to ${summary.months.at(-1)?.month}` : "no months";
  lines.push(`Offer Sheet anonymous feedback: ${args.env}, ${span} (UTC), ${summary.copies} cop${summary.copies === 1 ? "y" : "ies"} of ${summary.records} record(s)${summary.invalid ? `, ${summary.invalid} unreadable entr${summary.invalid === 1 ? "y" : "ies"} skipped` : ""}.`);
  if (!summary.copies) return `${lines.join("\n")}\nNothing stored.`;
  const block = (title: string, rows: Array<[string, number]>) => {
    lines.push("", `${title}:`);
    for (const [k, n] of rows) lines.push(`  ${String(n).padStart(6)}  ${k}`);
  };
  lines.push(`Records as they stand: ${summary.records - summary.takenBack}, and ${summary.takenBack} taken back (every button cleared).`);
  block("By outcome", summary.byOutcome);
  block("By report reason", summary.byReason);
  block("By version sent (records with an outcome)", summary.byVersion);
  block("By platform", summary.byPlatform);
  block("By league type", summary.byLeagueType);
  block("By goal", summary.byGoal);
  lines.push("", "By month (copies, unreadable):");
  for (const m of summary.months) lines.push(`  ${m.month}  ${String(m.copies).padStart(6)}  ${m.invalid}`);
  if (summary.flagged.length) {
    lines.push("", "Days to check (a flood of forged copies crowds out at most its own day: Phase 6 drops or down-weights these days):");
    for (const f of summary.flagged) lines.push(`  ${f.day}  ${String(f.copies).padStart(6)}  ${f.why === "cap" ? "at the day's cap: its oldest copies were let go" : `over ${SPIKE_FACTOR} times a usual day's`}`);
  }
  lines.push("", written.length ? `Wrote ${written.length} file(s): ${written.join(", ")}` : "Wrote no files.");
  return lines.join("\n");
}

/** Where a month's file goes: data-local/feedback-server/<env>/<YYYY-MM>.json under `dataLocal`. */
export function feedbackPullFile(dataLocal: string, env: FeedbackPullEnv, month: string): string {
  return path.join(dataLocal, "feedback-server", env, `${month}.json`);
}

// ---------------------------------------------------------------------------------------------
// Downloaded copies follow the store's own rule (the header; review FB-R2)

const DAY_MS = 24 * 60 * 60_000;

/** A month file's name: "2026-10.json". */
const MONTH_FILE = /^(\d{4}-(?:0[1-9]|1[0-2]))\.json$/;

/**
 * When a downloaded month's copies are due for deletion (ms): feedbackLimits.retainDays after the UTC day of its newest
 * copy began (`newestDay`, "2026-10-04"), never later than the store drops that day's list (its year runs from the newest
 * copy's arrival); without a newest day (a file that can't be read), the same span after the month began.
 */
export function feedbackFileDueAt(month: string, newestDay: string | null): number {
  return Date.parse(`${newestDay ?? `${month}-01`}T00:00:00.000Z`) + feedbackLimits.retainDays * DAY_MS;
}

/** The newest copy's UTC day in a month file's text, when it is one of that month's days; null when it can't be read. */
export function newestDayIn(text: string, month: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const events = data && typeof data === "object" ? (data as { events?: unknown }).events : undefined;
  if (!Array.isArray(events)) return null;
  let newest: string | null = null;
  for (const e of events) {
    const day = e && typeof e === "object" ? (e as { day?: unknown }).day : undefined;
    if (typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && day.startsWith(`${month}-`) && (newest === null || day > newest)) newest = day;
  }
  return newest;
}

export interface PruneResult {
  /** The month files deleted, as paths relative to `dataLocal`'s parent ("data-local/feedback-server/preview/2025-09.json"). */
  deleted: string[];
  /** How many month files are kept. */
  kept: number;
  /** When the first kept file is due (ms), or null when none is kept. */
  nextDueAt: number | null;
}

/**
 * Deletes the downloaded month files (data-local/feedback-server/<env>/<YYYY-MM>.json, both env folders) whose copies are
 * due at `now` (feedbackFileDueAt). Other files there are left alone. Never reads the network.
 */
export function pruneFeedbackFiles(dataLocal: string, now: number): PruneResult {
  const out: PruneResult = { deleted: [], kept: 0, nextDueAt: null };
  for (const env of FEEDBACK_PULL_ENVS) {
    const dir = path.join(dataLocal, "feedback-server", env);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      const month = MONTH_FILE.exec(name)?.[1];
      if (!month) continue;
      const file = path.join(dir, name);
      let text = "";
      try {
        text = readFileSync(file, "utf8");
      } catch {
        // Unreadable: due by its month alone.
      }
      const dueAt = feedbackFileDueAt(month, newestDayIn(text, month));
      if (now >= dueAt) {
        rmSync(file, { force: true });
        out.deleted.push(path.relative(path.dirname(dataLocal), file).split(path.sep).join("/"));
      } else {
        out.kept++;
        out.nextDueAt = out.nextDueAt === null ? dueAt : Math.min(out.nextDueAt, dueAt);
      }
    }
  }
  return out;
}

/** What a run says about the downloaded copies (pure): what went, and when the next one is due. */
export function formatPruned(result: PruneResult): string {
  const lines = [
    result.deleted.length
      ? `Deleted ${result.deleted.length} downloaded month file(s) whose year was up (the store's own rule): ${result.deleted.join(", ")}.`
      : "No downloaded month file was due for deletion.",
  ];
  if (result.nextDueAt !== null) {
    lines.push(`Downloaded month files kept: ${result.kept}. The next is due for deletion on ${new Date(result.nextDueAt).toISOString().slice(0, 10)} (UTC): run npm run feedback:pull again on or after that day.`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  // The offline guard first (scripts/lib/runMode.ts); then, --live or not, the downloaded copies whose year is up go.
  setNetworkMode(wantsLive(process.argv.slice(2)));
  const { ROOT, loadEnv } = await import("./lib/env");
  const dataLocal = path.join(ROOT, "data-local");
  console.log(formatPruned(pruneFeedbackFiles(dataLocal, Date.now())));
  requireLive({ script: "feedback:pull", what: "reads the beta's anonymous feedback from the shared store (Upstash)" });
  const args = feedbackPullArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(args.error);
    process.exit(1);
  }
  loadEnv();
  process.env[REDIS_OPT_IN_ENV] = "1"; // this --live script reads the shared store on purpose (src/server/redis.ts)
  const redis = getRedis(process.env);
  if (!redis) {
    const state = (names: string[]) => names.map((n) => `${n} ${process.env[n]?.trim() ? "set" : "blank"}`).join(", ");
    console.error(
      `No shared store configured in .env.local (${state(["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"])}; SESSION_SECRET ${(process.env.SESSION_SECRET ?? "").length >= 32 ? "set" : "blank or too short"}). Add the store's REST URL and token to .env.local by hand (Checkpoint 7a's steps say where to find them).`,
    );
    process.exit(1);
  }
  const now = Date.now();
  const months = pullMonths(now, args.months);
  const { byMonth: raw, byDay } = await readFeedbackMonths(redis, keyPrefix({ VERCEL_ENV: args.env }), months, now);
  const parsed = new Map([...raw].map(([month, entries]) => [month, parseFeedbackEntries(entries)] as const));
  const written: string[] = [];
  const pulledAt = new Date(now).toISOString();
  for (const [month, m] of parsed) {
    if (!m.events.length) continue;
    // A month already due isn't kept here (the store drops it within the day).
    const newest = m.events.reduce((d, e) => (e.day > d ? e.day : d), "");
    if (now >= feedbackFileDueAt(month, newest || null)) continue;
    const file = feedbackPullFile(dataLocal, args.env, month);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ kind: "offersheet-feedback-server", version: 1, env: args.env, month, pulledAt, count: m.events.length, events: m.events }, null, 2)}\n`);
    written.push(path.relative(ROOT, file).split(path.sep).join("/"));
  }
  console.log(formatFeedbackPull(summarizeFeedback(parsed, byDay), args, written));
}

if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    // Only the error's name: an Upstash error message could carry the store's address.
    console.error(`feedback:pull failed (${err instanceof Error ? err.name : typeof err}).`);
    process.exit(1);
  });
}
