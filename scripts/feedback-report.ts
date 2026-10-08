/**
 * The public beta's anonymous feedback, in numbers (planner reply to Checkpoint 7a, §4 privacy item 3: "the analysis and
 * refit scripts read straight from Upstash and save only aggregate results and fitted numbers locally, never raw records.
 * Rename or replace feedback:pull to match"; the store: src/server/feedbackSink.ts). It replaces `npm run feedback:pull`,
 * which saved the copies themselves to data-local/feedback-server/.
 *
 *   npm run feedback:report -- --live                      the preview deployments' feedback, the whole year the store keeps
 *   npm run feedback:report -- --live --env production     production's (after Parker's "go" at Checkpoint 7b)
 *   npm run feedback:report -- --live --days 30            the last 30 UTC days only
 *
 * - It talks to Upstash, so it runs only with --live (planner reply to Checkpoint 4c, A5; scripts/lib/runMode.ts). It reads
 *   with the store's read-only token (READONLY_STORE_URL and READONLY_STORE_TOKEN in .env.local, typed in by hand as for
 *   `npm run beta:log`: scripts/lib/storeReader.ts).
 * - Read-only: one LRANGE per UTC day's list (`os:<env>:fb:<YYYY-MM-DD>`), 366 for the whole year: the store keeps each
 *   day's list a year after that UTC day began (feedbackLimits.retainDays; feedbackSink.ts feedbackDayTtlMs) and deletes it itself, so there is nothing
 *   older to read and nothing here to delete. Every entry is checked against the store's own schema
 *   (StoredFeedbackEventSchema); one that doesn't parse is counted, never printed or kept.
 * - Keeps only aggregates, in memory, on the console and in data-local/feedback-report.md (git-ignored; each run replaces
 *   it): copies, records (a record's copies share its random id: its latest copy is the record as it stands) and the ones
 *   taken back; per record as it stands, its outcome, report reason, version sent (records with an outcome), goal, platform
 *   and league type; (Checkpoint 7c; planner reply to Checkpoint 7b, §6) of the records under "Several prizes", how many pay
 *   each prize (1st, 2nd and 3rd place, the weekly high score, the most points: a share above 0 in the copy's split, which
 *   holds whole percents, never amounts), counts only, never a record's own split;
 *   the acceptance calibration (each record's predicted P_accept, the sent version's when it was recorded,
 *   else the card's, in the card's label bins: config.acceptance.labels, against what happened: decided = Accepted +
 *   Rejected, the share accepted next to the mean prediction); the refit's readiness (config.acceptance.refitMinOutcomes);
 *   and the days to check (a day at the store's daily cap, or far above a usual day: a flood of forged copies crowds out at
 *   most its own day, so Phase 6 drops or down-weights those days before the refit). Never a copy, an id, a player, a
 *   record's own numbers or a note.
 * - When data-local/feedback-server/ is there (the old feedback:pull's downloads, raw copies kept outside the store's
 *   year), it says so: nothing deletes them anymore, so delete the folder.
 * Phase 6's refit reads the store the same way and keeps only the fitted coefficients.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "@/engine/config";
import { PRIZE_KEYS, type PrizeKey } from "@/engine/settings";
import { FEEDBACK_GOALS, type StoredFeedbackEvent } from "@/lib/feedbackEvent";
import { FEEDBACK_OUTCOMES, FEEDBACK_REASONS, FEEDBACK_VERSIONS } from "@/lib/feedbackStore";
import { StoredFeedbackEventSchema } from "@/server/feedbackSink";
import { feedbackLimits } from "@/server/limits";
import { keyPrefix, type RedisLike } from "@/server/redis";
import { calibrationBins } from "./feedback-summary";
import { flagValue, isMainModule, requireLive } from "./lib/runMode";
import { openStoreReader, storeFailureText } from "./lib/storeReader";

export const FEEDBACK_REPORT_ENVS = ["preview", "production"] as const;
export type FeedbackReportEnv = (typeof FEEDBACK_REPORT_ENVS)[number];

export interface FeedbackReportArgs {
  env: FeedbackReportEnv;
  /** UTC days back, today included. */
  days: number;
}

/** The store keeps a day's list a year after that day began (feedbackLimits.retainDays), so this many days reach every list it holds. */
export const MAX_DAYS = feedbackLimits.retainDays + 1;

/** Where the report goes, under data-local/ (git-ignored). */
export const REPORT_FILE = "feedback-report.md";

/** The command line (see the header), or what's wrong with it. */
export function feedbackReportArgs(argv: readonly string[]): FeedbackReportArgs | { error: string } {
  const env = flagValue(argv, "--env") ?? "preview";
  if (!(FEEDBACK_REPORT_ENVS as readonly string[]).includes(env)) return { error: `--env takes ${FEEDBACK_REPORT_ENVS.join(" or ")}.` };
  let days = MAX_DAYS;
  if (argv.includes("--days")) {
    const v = Number(flagValue(argv, "--days"));
    if (!Number.isInteger(v) || v < 1 || v > MAX_DAYS) return { error: `--days takes a whole number from 1 to ${MAX_DAYS}.` };
    days = v;
  }
  return { env: env as FeedbackReportEnv, days };
}

const DAY_MS = 24 * 60 * 60_000;

/** The UTC days to read, oldest first: the `days − 1` before today, and today. */
export function reportDays(now: number, days: number): string[] {
  return Array.from({ length: days }, (_, i) => new Date(now - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

/** What the store holds for the days read: every entry, oldest first, and each day's count. */
export interface FeedbackRead {
  entries: string[];
  byDay: Map<string, number>;
}

/** The days' lists as the store holds them (one LRANGE a day; each list is newest first in the store), entries oldest first. */
export async function readFeedbackDays(redis: Pick<RedisLike, "lrange">, prefix: string, days: readonly string[]): Promise<FeedbackRead> {
  const entries: string[] = [];
  const byDay = new Map<string, number>();
  for (const day of [...days].sort()) {
    const list = await redis.lrange(`${prefix}fb:${day}`, 0, -1);
    if (list.length) byDay.set(day, list.length);
    for (let i = list.length - 1; i >= 0; i--) entries.push(list[i] as string);
  }
  return { entries, byDay };
}

/** Entries checked against the store's schema (the header), in the order given; the rest counted, never kept. */
export function parseFeedbackEntries(entries: readonly string[]): { events: StoredFeedbackEvent[]; invalid: number } {
  const events: StoredFeedbackEvent[] = [];
  let invalid = 0;
  for (const raw of entries) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
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

/** A day with this many times the median of the days with copies, and at least SPIKE_MIN, is one to check (see the header). */
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

/** One calibration bin (the card's acceptance labels), counted over the records as they stand. */
export interface ReportBin {
  label: string;
  from: number;
  to: number | null;
  /** Accepted + Rejected. */
  decided: number;
  accepted: number;
  rejected: number;
  countered: number;
  /** Sent, with no answer yet. */
  pending: number;
  /** "They'd never accept" reports. */
  neverAccept: number;
  /** Mean predicted P_accept of the decided records, and the share of them accepted; null with none decided. */
  meanPredicted: number | null;
  observed: number | null;
}

export interface FeedbackReport {
  copies: number;
  invalid: number;
  records: number;
  /** Records whose latest copy takes them back (every button cleared: no outcome, no reason). */
  takenBack: number;
  byOutcome: Array<[string, number]>;
  byReason: Array<[string, number]>;
  byVersion: Array<[string, number]>;
  byGoal: Array<[string, number]>;
  /**
   * Checkpoint 7c: the records as they stand under "Several prizes" (goal "prizes"), and how many of them pay each prize (its
   * whole percent above 0), in PRIZE_KEYS order. Counts only.
   */
  prizes: { records: number; paying: Array<[PrizeKey, number]> };
  byPlatform: Array<[string, number]>;
  byLeagueType: Array<[string, number]>;
  calibration: ReportBin[];
  /** Records with an outcome or a "never accept" report but no predicted P_accept (left out of the calibration). */
  unpredicted: number;
  refit: { decided: number; needed: number; ready: boolean };
  flagged: FlaggedDay[];
}

function counted(map: Map<string, number>, order: readonly string[] = []): Array<[string, number]> {
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  return [...map].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** The prediction a record's outcome answers: the sent version's P_accept when the record has one, else the card's. */
export function predictedAccept(e: Pick<StoredFeedbackEvent, "versionAccept" | "numbers">): number | null {
  const sent = e.versionAccept?.pAccept;
  return typeof sent === "number" && Number.isFinite(sent) ? sent : e.numbers.pAccept;
}

/** The aggregates (pure; see the header) of the copies read, oldest first, and each day's count. */
export function summarizeFeedback(events: readonly StoredFeedbackEvent[], invalid: number, byDay: ReadonlyMap<string, number> = new Map()): FeedbackReport {
  // The later copy of a record replaces the earlier: the copies come oldest first.
  const latest = new Map<string, StoredFeedbackEvent>();
  for (const e of events) latest.set(e.rid, e);
  const byOutcome = new Map<string, number>();
  const byReason = new Map<string, number>();
  const byVersion = new Map<string, number>();
  const byGoal = new Map<string, number>();
  const byPlatform = new Map<string, number>();
  const byLeagueType = new Map<string, number>();
  const calibration: ReportBin[] = calibrationBins().map((b) => ({ ...b, decided: 0, accepted: 0, rejected: 0, countered: 0, pending: 0, neverAccept: 0, meanPredicted: null, observed: null }));
  const predictedSum = new Map<ReportBin, number>();
  let takenBack = 0;
  let unpredicted = 0;
  let prizeRecords = 0;
  const paying = new Map<PrizeKey, number>(PRIZE_KEYS.map((k) => [k, 0]));
  for (const e of latest.values()) {
    if (!e.outcome && !e.reason) {
      takenBack++;
      continue;
    }
    bump(byOutcome, e.outcome ?? "none");
    bump(byReason, e.reason ?? "none");
    if (e.outcome) bump(byVersion, e.version ?? "unknown");
    bump(byGoal, e.goal ?? "unknown");
    // The store's schema holds a split exactly with "Several prizes" (feedbackSink.ts); counted, never kept.
    if (e.goal === "prizes" && e.prizes) {
      prizeRecords++;
      for (const k of PRIZE_KEYS) if (e.prizes[k] > 0) paying.set(k, (paying.get(k) ?? 0) + 1);
    }
    bump(byPlatform, e.platform);
    bump(byLeagueType, e.format.leagueType);
    if (!e.outcome && e.reason !== "never-accept") continue;
    const p = predictedAccept(e);
    if (p === null) {
      unpredicted++;
      continue;
    }
    // Below the first bound can't happen (P_accept is clamped above 0); it would count in the first bin.
    const bin = calibration.find((b) => p >= b.from && (b.to === null || p < b.to)) ?? calibration[0];
    if (!bin) continue;
    if (e.outcome === "accepted" || e.outcome === "rejected") {
      bin.decided++;
      bin[e.outcome]++;
      predictedSum.set(bin, (predictedSum.get(bin) ?? 0) + p);
    } else if (e.outcome === "countered") bin.countered++;
    else if (e.outcome === "sent") bin.pending++;
    if (e.reason === "never-accept") bin.neverAccept++;
  }
  for (const bin of calibration) {
    if (!bin.decided) continue;
    bin.meanPredicted = (predictedSum.get(bin) ?? 0) / bin.decided;
    bin.observed = bin.accepted / bin.decided;
  }
  const decided = (byOutcome.get("accepted") ?? 0) + (byOutcome.get("rejected") ?? 0);
  return {
    copies: events.length,
    invalid,
    records: latest.size,
    takenBack,
    byOutcome: counted(byOutcome, FEEDBACK_OUTCOMES),
    byReason: counted(byReason, FEEDBACK_REASONS),
    byVersion: counted(byVersion, FEEDBACK_VERSIONS),
    // Today's goals and an older version's ("balanced", "Top finishers too": its copies keep it; feedbackEvent.ts).
    byGoal: counted(byGoal, FEEDBACK_GOALS),
    prizes: { records: prizeRecords, paying: PRIZE_KEYS.map((k) => [k, paying.get(k) ?? 0]) },
    byPlatform: counted(byPlatform),
    byLeagueType: counted(byLeagueType),
    calibration,
    unpredicted,
    refit: { decided, needed: config.acceptance.refitMinOutcomes, ready: decided >= config.acceptance.refitMinOutcomes },
    flagged: flaggedDays(byDay),
  };
}

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

/** The prizes in the Settings page's words ("What does your league reward?", "Several prizes"). */
export const PRIZE_WORDS: Readonly<Record<PrizeKey, string>> = {
  first: "1st place",
  second: "2nd place",
  third: "3rd place",
  weeklyHigh: "High score, each regular-season week",
  pointsLeader: "Most points in the regular season",
};

function table(header: string[], rows: (string | number)[][]): string[] {
  return [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)];
}

/** The report as markdown (pure): aggregates only (see the header). */
export function formatFeedbackReport(r: FeedbackReport, args: FeedbackReportArgs, days: readonly string[], generatedAt: string): string {
  const span = days.length ? `${days[0]} to ${days.at(-1)}` : "no days";
  const lines: string[] = [
    "# Offer Sheet anonymous feedback: totals",
    "",
    `${args.env}'s store, ${span} (UTC). Generated ${generatedAt}. Totals only: no copy, id, player or note is kept.`,
    "",
    `${r.copies} cop${r.copies === 1 ? "y" : "ies"} of ${r.records} record(s)${r.invalid ? `, ${r.invalid} unreadable entr${r.invalid === 1 ? "y" : "ies"} skipped` : ""}.`,
  ];
  if (!r.copies) return `${lines.join("\n")}\n\nNothing stored.\n`;
  lines.push(`Records as they stand: ${r.records - r.takenBack}, and ${r.takenBack} taken back (every button cleared).`, "");
  const block = (title: string, rows: Array<[string, number]>) => lines.push(`## ${title}`, "", ...table(["", "Records"], rows), "");
  block("By outcome", r.byOutcome);
  block("By report reason", r.byReason);
  block("By version sent (records with an outcome)", r.byVersion);
  block("By goal", r.byGoal);
  if (r.prizes.records) {
    lines.push(
      "## Prizes paid (records under “Several prizes”)",
      "",
      `${r.prizes.records} record(s) under “Several prizes”; how many of them pay each prize (its share above 0). Counts only: a copy holds its league's split as whole percents, never amounts, and no split is kept here.`,
      "",
      ...table(["Prize", "Records"], r.prizes.paying.map(([k, n]) => [PRIZE_WORDS[k], n])),
      "",
    );
  }
  block("By platform", r.byPlatform);
  block("By league type", r.byLeagueType);
  lines.push(
    "## Acceptance calibration",
    "",
    ...table(
      ["Predicted P_accept", "Decided", "Accepted", "Rejected", "Share accepted", "Mean predicted", "Countered", "Sent, no answer", "\"Never accept\" reports"],
      r.calibration.map((b) => [`${b.label} (${pct(b.from)}${b.to === null ? "+" : `–${pct(b.to)}`})`, b.decided, b.accepted, b.rejected, pct(b.observed), pct(b.meanPredicted), b.countered, b.pending, b.neverAccept]),
    ),
    "",
    "Each record as it stands, binned by the P_accept the card printed for the version sent (the card's own when no version was recorded). Decided = Accepted + Rejected; a bin's share means little until it holds a few dozen decided records.",
    ...(r.unpredicted ? [`${r.unpredicted} record(s) had no predicted P_accept and are left out.`] : []),
    "",
    "## Refit",
    "",
    r.refit.ready ? `${r.refit.decided} decided outcomes: enough (${r.refit.needed}+) to refit the acceptance coefficients (§11).` : `${r.refit.decided} decided outcomes of the ${r.refit.needed} the acceptance refit needs (§11).`,
    "",
  );
  if (r.flagged.length) {
    lines.push("## Days to check", "", "A flood of forged copies crowds out at most its own day: Phase 6 drops or down-weights these days before the refit.", "");
    lines.push(...table(["Day (UTC)", "Copies", "Why"], r.flagged.map((f) => [f.day, f.copies, f.why === "cap" ? "at the day's cap: its oldest copies were let go" : `over ${SPIKE_FACTOR} times a usual day's`])), "");
  }
  return lines.join("\n");
}

/** What the old feedback:pull left (see the header): how many files, or null when the folder isn't there. */
export function oldDownloads(dataLocal: string): number | null {
  const dir = path.join(dataLocal, "feedback-server");
  if (!existsSync(dir)) return null;
  let files = 0;
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files++;
    }
  };
  walk(dir);
  return files;
}

async function main(): Promise<void> {
  requireLive({ script: "feedback:report", what: "reads the beta's anonymous feedback from the shared store (Upstash)" });
  const args = feedbackReportArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(args.error);
    process.exit(1);
  }
  const { ROOT, loadEnv } = await import("./lib/env");
  loadEnv();
  // The store, read-only: the scripts' own variables and a token that can't write (scripts/lib/storeReader.ts).
  const store = await openStoreReader(process.env);
  if ("error" in store) {
    console.error(store.error);
    process.exit(1);
  }
  const redis = store.reader;
  const now = Date.now();
  const days = reportDays(now, args.days);
  const read = await readFeedbackDays(redis, keyPrefix({ VERCEL_ENV: args.env }), days);
  const { events, invalid } = parseFeedbackEntries(read.entries);
  const text = formatFeedbackReport(summarizeFeedback(events, invalid, read.byDay), args, days, new Date(now).toISOString());
  const dataLocal = path.join(ROOT, "data-local");
  mkdirSync(dataLocal, { recursive: true });
  writeFileSync(path.join(dataLocal, REPORT_FILE), `${text.trimEnd()}\n`);
  console.log(text.trimEnd());
  console.log(`\nWrote data-local/${REPORT_FILE} (totals only).`);
  const old = oldDownloads(dataLocal);
  if (old !== null) {
    console.log(
      `Note: data-local/feedback-server/ holds ${old} file(s) the old feedback:pull downloaded: raw copies kept outside the store's year, which nothing deletes anymore. Delete the folder: Remove-Item -Recurse -Force "data-local\\feedback-server"`,
    );
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    // Only the error's name: an Upstash error's message carries the command (scripts/lib/storeReader.ts).
    console.error(storeFailureText("feedback:report", err));
    process.exit(1);
  });
}
