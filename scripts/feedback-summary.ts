/**
 * Summarizes exported trade feedback (CLAUDE.md §11 "Feedback on every suggestion": "A script summarizes reports
 * by reason and by model part"; Phase 4 lead decision L12). Input: the file the Settings page's "Export feedback"
 * downloads (src/lib/feedbackStore.ts feedbackExportText), or a bare list of records. Offline: no network, no
 * .env.local.
 *
 *   npm run feedback:summary -- <file>            the summary, as text
 *   npm run feedback:summary -- <file> --json     the same numbers as JSON
 *   npm run feedback:summary -- <file> --notes    also the notes people typed: they're free text and may name
 *                                                 leaguemates, so they're left out unless asked for, and never
 *                                                 belong in a checkpoint report
 *
 * What it reports:
 * - Totals: trade ideas with feedback, leagues (an export numbers them, league-1, league-2, …; a bare list keys
 *   them by their short hash), with an outcome, with a report, with a note.
 * - By outcome: each trade idea's latest outcome (Sent, Accepted, Rejected, Countered).
 * - By version sent (planner reply to Checkpoint 4, change 6 and answer 8; FeedbackRecord.version): each latest outcome
 *   by the version of the trade idea that was sent (the first offer, the full trade, or "If they say no, try:"), and
 *   "Unknown" for records without one (made before Phase 4b); per version, how many sent the card's own trade
 *   (sentCardTrade: the record's numbers and features are the sent trade's only then; review of track F: "full" is the
 *   card's own trade on a plain card, but the card plus its throw-in when the card is the first offer). ⚠️ Records keep
 *   only the sent version's estimate, not its features (a TradeStep carries only its acceptance terms and a PlanB no model
 *   inputs at all: a question for the lead).
 * - By reason: how many reports gave each Report reason, and the average numbers and acceptance features
 *   (§11's n, h, c, a, ctx, hot and urg) of those trade ideas as the card showed them: what the model saw when people
 *   said it was wrong. Not the value ratios (both sides' g_mkt, the perceived g, hist and the logit z): an export leaves
 *   them out since the planner's reply to Checkpoint 7b, Q5 (feedbackStore.ts EXPORT_LEFT_OUT), so there's nothing to
 *   average (the anonymous copies keep them, for Phase 6's refit).
 * - By model part (§11 "How the data is used"): the acceptance model (refit: "They'd never accept" reports and
 *   Rejected outcomes), benefit and projections ("Doesn't help me": review those cases), the data import
 *   (wrong player info or league settings: the adapters' bug queue), and read by hand ("Other").
 * - Acceptance calibration: trade ideas binned by the predicted P_accept (the sent version's, as its line on the card
 *   showed it, when the record has one: the prediction the user acted on; else the card's own), on the card's own bins
 *   and labels (config.acceptance.labels: Long shot under 15%, Possible, Decent, Likely from 55%), against what happened:
 *   decided = Accepted + Rejected, the observed acceptance rate next to the mean prediction, and per bin the
 *   Countered outcomes, the ones only Sent (no answer yet) and the "They'd never accept" reports. Small bins are
 *   noise: a rate needs a few dozen decided trades before it says much.
 * - Refit readiness: decided outcomes against config.acceptance.refitMinOutcomes (30), when §11's logistic refit
 *   of the β coefficients may run.
 */
import { readFileSync } from "node:fs";
import { config } from "@/engine/config";
import {
  FEEDBACK_OUTCOMES,
  FEEDBACK_REASONS,
  FEEDBACK_VERSIONS,
  MODEL_PART_LABEL,
  OUTCOME_LABEL,
  REASON_LABEL,
  REASON_MODEL_PART,
  VERSION_LABEL,
  parseFeedbackExport,
  type FeedbackOutcome,
  type FeedbackReason,
  type FeedbackRecord,
  type FeedbackVersion,
  type ModelPart,
} from "@/lib/feedbackStore";
import { isMainModule } from "./lib/runMode";

/** The numbers and features averaged per reason, in print order (no value ratios: an export leaves them out, the file header). */
const AVERAGED = ["b", "tradeScore", "pAccept", "pComplete", "dPPW", "n", "h", "c", "a", "ctx", "hot", "urg"] as const;
type Averaged = (typeof AVERAGED)[number];

const MODEL_PARTS: readonly ModelPart[] = ["acceptance", "benefit", "adapters", "review"];

export interface ReasonSummary {
  reason: FeedbackReason;
  label: string;
  count: number;
  /** Average over the reports whose value is known; null when none is. */
  averages: Record<Averaged, number | null>;
}

export interface CalibrationBin {
  label: string;
  /** P_accept from (inclusive) … to (exclusive; null = no upper bound). */
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
  /** Mean predicted P_accept of the decided trade ideas; observed = accepted / decided. Null when none decided. */
  meanPredicted: number | null;
  observed: number | null;
}

/** One row of "By version sent": the trade ideas with an outcome whose sent version is this one ("unknown": none recorded). */
export interface VersionSummary {
  version: FeedbackVersion | "unknown";
  label: string;
  /** Trade ideas with an outcome, and each latest outcome. */
  total: number;
  outcomes: Record<FeedbackOutcome, number>;
  /**
   * Of `total`, the ones that sent the card's own trade (sentCardTrade): their record's numbers and features are the sent
   * trade's. The others' are the card's, not the version sent (review of track F: "full" is the card's own trade on a
   * plain card and when the ranked trade holds the throw-in, but the card plus its throw-in when the card is the first
   * offer; a Plan B is never the card's).
   */
  cardOwn: number;
}

export interface FeedbackSummary {
  total: number;
  leagues: number;
  withOutcome: number;
  withReport: number;
  withNote: number;
  byOutcome: Record<FeedbackOutcome, number>;
  byVersion: VersionSummary[];
  byReason: ReasonSummary[];
  byModelPart: { part: ModelPart; label: string; reports: number; rejected: number }[];
  calibration: CalibrationBin[];
  /** Trade ideas without a predicted P_accept (left out of the calibration). */
  unpredicted: number;
  refit: { decided: number; needed: number; ready: boolean };
}

function valueOf(record: FeedbackRecord, key: Averaged): number | null {
  const v = key in record.numbers ? record.numbers[key as keyof FeedbackRecord["numbers"]] : record.features[key as keyof FeedbackRecord["features"]];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function averages(records: readonly FeedbackRecord[]): Record<Averaged, number | null> {
  const out = {} as Record<Averaged, number | null>;
  for (const key of AVERAGED) {
    const xs = records.map((r) => valueOf(r, key)).filter((x): x is number => x !== null);
    out[key] = xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
  }
  return out;
}

/** The calibration bins: the card's acceptance labels (config.acceptance.labels) and their bounds. */
export function calibrationBins(): Pick<CalibrationBin, "label" | "from" | "to">[] {
  let from = 0;
  return config.acceptance.labels.map((l) => {
    const bin = { label: l.label, from, to: Number.isFinite(l.below) ? l.below : null };
    from = l.below;
    return bin;
  });
}

/** The predicted P_accept a record's outcome answers (the file header): the sent version's when recorded, else the card's. */
export function predictedAccept(record: FeedbackRecord): number | null {
  const sent = record.versionAccept?.pAccept;
  return typeof sent === "number" && Number.isFinite(sent) ? sent : record.numbers.pAccept;
}

/**
 * Whether a record's outcome is about the card's own trade, the one its numbers and features describe: no other version
 * was recorded (no version key, as a plain card's or an older record's), or the sent version's key is the card's.
 */
export function sentCardTrade(record: Pick<FeedbackRecord, "tradeKey" | "versionKey">): boolean {
  return record.versionKey === undefined || record.versionKey === record.tradeKey;
}

export function summarizeFeedback(records: readonly FeedbackRecord[]): FeedbackSummary {
  const byOutcome = Object.fromEntries(FEEDBACK_OUTCOMES.map((o) => [o, records.filter((r) => r.outcome?.kind === o).length])) as Record<FeedbackOutcome, number>;
  const byVersion: VersionSummary[] = [...FEEDBACK_VERSIONS, "unknown" as const].map((version) => {
    const mine = records.filter((r) => r.outcome && (r.version ?? "unknown") === version);
    return {
      version,
      label: version === "unknown" ? "Unknown (not recorded)" : VERSION_LABEL[version],
      total: mine.length,
      outcomes: Object.fromEntries(FEEDBACK_OUTCOMES.map((o) => [o, mine.filter((r) => r.outcome?.kind === o).length])) as Record<FeedbackOutcome, number>,
      cardOwn: mine.filter(sentCardTrade).length,
    };
  });
  const byReason = FEEDBACK_REASONS.map((reason) => {
    const mine = records.filter((r) => r.report?.reason === reason);
    return { reason, label: REASON_LABEL[reason], count: mine.length, averages: averages(mine) };
  });
  const byModelPart = MODEL_PARTS.map((part) => ({
    part,
    label: MODEL_PART_LABEL[part],
    reports: records.filter((r) => r.report && REASON_MODEL_PART[r.report.reason] === part).length,
    // §11: Rejected outcomes refit the acceptance coefficients too.
    rejected: part === "acceptance" ? byOutcome.rejected : 0,
  }));

  let unpredicted = 0;
  const calibration: CalibrationBin[] = calibrationBins().map((b) => ({ ...b, decided: 0, accepted: 0, rejected: 0, countered: 0, pending: 0, neverAccept: 0, meanPredicted: null, observed: null }));
  const predictedSum = new Map<CalibrationBin, number>();
  for (const r of records) {
    const p = predictedAccept(r);
    if (p === null) {
      unpredicted++;
      continue;
    }
    // Below the first bound can't happen (P_accept is clamped above 0); it would count in the first bin.
    const bin = calibration.find((b) => p >= b.from && (b.to === null || p < b.to)) ?? calibration[0];
    if (!bin) continue;
    const kind = r.outcome?.kind;
    if (kind === "accepted" || kind === "rejected") {
      bin.decided++;
      bin[kind]++;
      predictedSum.set(bin, (predictedSum.get(bin) ?? 0) + p);
    } else if (kind === "countered") bin.countered++;
    else if (kind === "sent") bin.pending++;
    if (r.report?.reason === "never-accept") bin.neverAccept++;
  }
  for (const bin of calibration) {
    if (!bin.decided) continue;
    bin.meanPredicted = (predictedSum.get(bin) ?? 0) / bin.decided;
    bin.observed = bin.accepted / bin.decided;
  }

  const decided = byOutcome.accepted + byOutcome.rejected;
  return {
    total: records.length,
    leagues: new Set(records.map((r) => r.leagueKey)).size,
    withOutcome: records.filter((r) => r.outcome).length,
    withReport: records.filter((r) => r.report).length,
    withNote: records.filter((r) => r.report?.note).length,
    byOutcome,
    byVersion,
    byReason,
    byModelPart,
    calibration,
    unpredicted,
    refit: { decided, needed: config.acceptance.refitMinOutcomes, ready: decided >= config.acceptance.refitMinOutcomes },
  };
}

// ---------------------------------------------------------------------------------------------
// Text

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
const num = (x: number | null, d = 2) => (x === null ? "–" : x.toFixed(d));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function table(header: string[], rows: (string | number)[][]): string[] {
  return [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)];
}

/** The summary as text (markdown tables). `notes` (with --notes) adds the notes people typed. */
export function formatSummary(summary: FeedbackSummary, notes?: readonly { reason: FeedbackReason; note: string }[]): string {
  const s = summary;
  const lines: string[] = ["# Trade feedback summary", ""];
  lines.push(
    `${plural(s.total, "trade idea")} with feedback from ${plural(s.leagues, "league")}: ${s.withOutcome} with an outcome, ${s.withReport} with a report, ${plural(s.withNote, "note")}.`,
    "",
  );

  lines.push("## By outcome (the latest per trade idea)", "");
  lines.push(...table(["Outcome", "Trade ideas"], FEEDBACK_OUTCOMES.map((o) => [OUTCOME_LABEL[o], s.byOutcome[o]])), "");

  lines.push("## By version sent", "");
  lines.push(
    ...table(
      ["Version", "Trade ideas", ...FEEDBACK_OUTCOMES.map((o) => OUTCOME_LABEL[o]), "The card's own trade"],
      s.byVersion.map((v) => [v.label, v.total, ...FEEDBACK_OUTCOMES.map((o) => v.outcomes[o]), v.cardOwn]),
    ),
    "",
    "Each trade idea with an outcome, by the version of it that was sent (asked when its card showed more than one). Unknown: records made before versions were recorded. The card's own trade: how many sent the trade the card ranked, whose numbers and features the record keeps; for the rest (a first offer without the throw-in, the throw-in added to a first offer, a Plan B) the record keeps the card's numbers, not the version's, except its estimate.",
    "",
  );

  lines.push("## By reason", "");
  lines.push(
    ...table(
      ["Reason", "Reports", "B", "Helps you", "P_accept", "ΔPPW", "n", "h", "c", "a", "ctx", "hot", "urg"],
      s.byReason.map((r) => [
        r.label,
        r.count,
        num(r.averages.b),
        num(r.averages.tradeScore, 0),
        pct(r.averages.pAccept),
        num(r.averages.dPPW, 1),
        num(r.averages.n),
        num(r.averages.h),
        num(r.averages.c),
        num(r.averages.a),
        num(r.averages.ctx),
        num(r.averages.hot),
        num(r.averages.urg),
      ]),
    ),
    "",
    "Averages of the trade ideas each reason was given for, as their cards showed them (– = none known).",
    "",
  );

  lines.push("## By model part (§11 \"How the data is used\")", "");
  lines.push(
    ...table(
      ["Part", "Reports", "Rejected outcomes"],
      s.byModelPart.map((p) => [p.label, p.reports, p.part === "acceptance" ? p.rejected : "–"]),
    ),
    "",
  );

  lines.push("## Acceptance calibration", "");
  lines.push(
    ...table(
      ["Predicted P_accept", "Decided", "Accepted", "Rejected", "Observed", "Mean predicted", "Countered", "Sent, no answer", "\"Never accept\" reports"],
      s.calibration.map((b) => [
        `${b.label} (${pct(b.from)}${b.to === null ? "+" : `–${pct(b.to)}`})`,
        b.decided,
        b.accepted,
        b.rejected,
        pct(b.observed),
        pct(b.meanPredicted),
        b.countered,
        b.pending,
        b.neverAccept,
      ]),
    ),
    "",
    "Decided = Accepted + Rejected. A bin's observed rate means little until it holds a few dozen decided trades.",
    ...(s.unpredicted ? [`${plural(s.unpredicted, "trade idea")} had no predicted P_accept and ${s.unpredicted === 1 ? "is" : "are"} left out.`] : []),
    "",
  );

  lines.push(
    "## Refit",
    "",
    s.refit.ready
      ? `${s.refit.decided} decided outcomes: enough (${s.refit.needed}+) to refit the acceptance coefficients (§11).`
      : `${s.refit.decided} decided outcomes of the ${s.refit.needed} the acceptance refit needs (§11).`,
    "",
  );

  if (notes) {
    lines.push("## Notes (free text: may name people; keep out of reports)", "");
    if (!notes.length) lines.push("None.", "");
    for (const n of notes) lines.push(`- ${REASON_LABEL[n.reason]}: ${n.note.replace(/\s+/g, " ")}`);
    if (notes.length) lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** The notes people typed, with their reasons (oldest touched first). */
export function feedbackNotes(records: readonly FeedbackRecord[]): { reason: FeedbackReason; note: string }[] {
  return records.flatMap((r) => (r.report?.note ? [{ reason: r.report.reason, note: r.report.note }] : []));
}

export interface SummaryArgs {
  file: string | null;
  json: boolean;
  notes: boolean;
}

export function parseArgs(argv: readonly string[]): SummaryArgs {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  return { file: argv.find((a) => !a.startsWith("--")) ?? null, json: flags.has("--json"), notes: flags.has("--notes") };
}

const USAGE = "Usage: npm run feedback:summary -- <exported feedback .json file> [--json] [--notes]";

/** The whole run on a file's text: the output, or what's wrong with the input. */
export function runSummary(text: string, args: Pick<SummaryArgs, "json" | "notes">): { ok: true; output: string } | { ok: false; error: string } {
  const records = parseFeedbackExport(text);
  if (records === null) return { ok: false, error: "That file isn't an Offer Sheet feedback export (Settings → Export feedback)." };
  const summary = summarizeFeedback(records);
  if (args.json) return { ok: true, output: `${JSON.stringify(args.notes ? { ...summary, notes: feedbackNotes(records) } : summary, null, 2)}\n` };
  return { ok: true, output: formatSummary(summary, args.notes ? feedbackNotes(records) : undefined) };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error(USAGE);
    process.exit(1);
  }
  let text: string;
  try {
    text = readFileSync(args.file, "utf8");
  } catch (err) {
    console.error(`Couldn't read ${args.file}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  const result = runSummary(text, args);
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  process.stdout.write(result.output);
}

// Run only as a script (npm run feedback:summary), never when a test or a scratch file imports the logic above (an exact
// path: scripts/lib/runMode.ts isMainModule).
if (isMainModule(import.meta.url)) main();
