/**
 * Summarizes exported trade feedback (CLAUDE.md §11 "Feedback on every suggestion": "A script summarizes reports
 * by reason and by model part"; Phase 4 lead decision L12). Input: the file the Settings page's "Export feedback"
 * downloads (src/lib/feedbackStore.ts feedbackExportText: version 3 since Checkpoint 7d, what the user saw and entered), an older export
 * (versions 1 and 2) or a bare list of records, each read as version 3 holds them (parseFeedbackExport). Offline: no network,
 * no .env.local.
 *
 *   npm run feedback:summary -- <file>            the summary, as text
 *   npm run feedback:summary -- <file> --json     the same numbers as JSON
 *   npm run feedback:summary -- <file> --notes    also the notes people typed: they're free text and may name
 *                                                 leaguemates, so they're left out unless asked for, and never
 *                                                 belong in a checkpoint report
 *
 * What it reports (Checkpoint 7d, the lead's reading of the planner's reply to Checkpoint 7c, answer 1: by reason, outcome,
 * version and the printed numbers, the only numbers a version-3 file holds):
 * - Totals: trade ideas with feedback, leagues (an export numbers them, league-1, league-2, …), with an outcome, with a
 *   report, with a note.
 * - By outcome: each trade idea's latest outcome (Sent, Accepted, Rejected, Countered).
 * - By version sent (planner reply to Checkpoint 4, change 6 and answer 8): each latest outcome by the version of the trade
 *   idea that was sent (the first offer, the full trade, or "If they say no, try:"), and "Unknown" for records without one
 *   (made before Phase 4b); per version, how many sent the card's own trade (sentCardTrade: the version's players are the
 *   card's, or none were kept; review of track F: "full" is the card's own trade on a plain card, but the card plus its
 *   throw-in when the card is the first offer).
 * - By reason: how many reports gave each Report reason, and the averages of the numbers their cards printed: Helps you,
 *   Helps them (where the card showed the partner's line), the chance they accept, Overall. The model's own numbers and its
 *   acceptance features aren't in a version-3 file (an older file read as version 3 leaves them out too); the anonymous
 *   copies keep them, for Phase 6's refit (scripts/feedback-report.ts reads those).
 * - By model part (§11 "How the data is used"): the acceptance model (refit: "They'd never accept" reports and
 *   Rejected outcomes), benefit and projections ("Doesn't help me": review those cases), the data import
 *   (wrong player info or league settings: the adapters' bug queue), and read by hand ("Other").
 * - Acceptance calibration: trade ideas binned by the chance they accept as printed (the sent version's line when the
 *   record has one: the prediction the user acted on; else the card's), on the card's own bins and labels
 *   (config.acceptance.labels: Long shot under 15%, Possible, Decent, Likely from 55%), against what happened: decided =
 *   Accepted + Rejected, the observed acceptance rate next to the mean printed chance (⚠️ ours: "<5%" counts as half of 5%),
 *   and per bin the Countered outcomes, the ones only Sent (no answer yet) and the "They'd never accept" reports. Small bins
 *   are noise: a rate needs a few dozen decided trades before it says much. Printed chances are rounded to 5%, so a bin's
 *   mean is too.
 * - Refit readiness: decided outcomes against config.acceptance.refitMinOutcomes (30), when §11's logistic refit
 *   of the β coefficients may run.
 */
import { readFileSync } from "node:fs";
import { config } from "@/engine/config";
import type { TradeAsset } from "@/engine/tradeModel";
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
  type FeedbackExportEntry,
  type FeedbackOutcome,
  type FeedbackReason,
  type FeedbackVersion,
  type ModelPart,
} from "@/lib/feedbackStore";
import { isMainModule } from "./lib/runMode";

/** The printed numbers averaged per reason, in print order (the file header). */
const AVERAGED = ["helps", "helpsThem", "chance", "overall"] as const;
type Averaged = (typeof AVERAGED)[number];

const MODEL_PARTS: readonly ModelPart[] = ["acceptance", "benefit", "adapters", "review"];

export interface ReasonSummary {
  reason: FeedbackReason;
  label: string;
  count: number;
  /** Average over the reports whose printed value is a number; null when none is. */
  averages: Record<Averaged, number | null>;
}

export interface CalibrationBin {
  label: string;
  /** The printed chance from (inclusive) … to (exclusive; null = no upper bound). */
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
  /** Mean printed chance of the decided trade ideas; observed = accepted / decided. Null when none decided. */
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
   * Of `total`, the ones that sent the card's own trade (sentCardTrade): the trade whose numbers the card printed. The others'
   * printed numbers are the card's, not the version sent, but for its own chance (review of track F: "full" is the card's own
   * trade on a plain card and when the ranked trade holds the throw-in, but the card plus its throw-in when the card is the
   * first offer; a Plan B is never the card's).
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
  /** Trade ideas without a printed chance to read (left out of the calibration). */
  unpredicted: number;
  refit: { decided: number; needed: number; ready: boolean };
}

/** A score as printed ("39"), as a number; "—" (not scored) or nothing: null. */
export function printedScore(text: string | undefined): number | null {
  return text !== undefined && /^\d{1,3}$/.test(text) ? Number(text) : null;
}

/** A chance as printed ("45%"), as a probability; "<5%" counts as half of 5% (the file header); "—" or nothing: null. */
export function printedChance(text: string | undefined): number | null {
  const m = text === undefined ? null : /^(<)?(\d{1,3})%$/.exec(text);
  if (!m) return null;
  const p = Number(m[2]) / 100;
  return m[1] ? p / 2 : p;
}

function valueOf(entry: FeedbackExportEntry, key: Averaged): number | null {
  const s = entry.shown;
  if (key === "chance") return printedChance(s.chance);
  return printedScore(key === "helps" ? s.helps : key === "helpsThem" ? s.helpsThem : s.overall);
}

function averages(entries: readonly FeedbackExportEntry[]): Record<Averaged, number | null> {
  const out = {} as Record<Averaged, number | null>;
  for (const key of AVERAGED) {
    const xs = entries.map((e) => valueOf(e, key)).filter((x): x is number => x !== null);
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

/** The printed chance a record's outcome answers (the file header): the sent version's line's when recorded, else the card's. */
export function predictedAccept(entry: Pick<FeedbackExportEntry, "shown" | "version">): number | null {
  return printedChance(entry.version?.chance) ?? printedChance(entry.shown.chance);
}

const assetKey = (a: TradeAsset): string => (a.kind === "player" ? `p:${a.id}` : `k:${a.season}:${a.round}:${a.originalTeamId}`);
const sameSide = (a: readonly TradeAsset[], b: readonly TradeAsset[]): boolean => a.length === b.length && a.map(assetKey).sort().join("|") === b.map(assetKey).sort().join("|");

/**
 * Whether a record's outcome is about the card's own trade, the one whose numbers the card printed: no other version's
 * players were kept (a plain card's, or an older record's without a key), or the sent version's players are the card's.
 */
export function sentCardTrade(entry: Pick<FeedbackExportEntry, "trade" | "version">): boolean {
  const v = entry.version;
  if (!v?.give || !v.get) return true;
  return sameSide(v.give, entry.trade.give) && sameSide(v.get, entry.trade.get);
}

export function summarizeFeedback(entries: readonly FeedbackExportEntry[]): FeedbackSummary {
  const byOutcome = Object.fromEntries(FEEDBACK_OUTCOMES.map((o) => [o, entries.filter((r) => r.outcome?.kind === o).length])) as Record<FeedbackOutcome, number>;
  const byVersion: VersionSummary[] = [...FEEDBACK_VERSIONS, "unknown" as const].map((version) => {
    const mine = entries.filter((r) => r.outcome && (r.version?.kind ?? "unknown") === version);
    return {
      version,
      label: version === "unknown" ? "Unknown (not recorded)" : VERSION_LABEL[version],
      total: mine.length,
      outcomes: Object.fromEntries(FEEDBACK_OUTCOMES.map((o) => [o, mine.filter((r) => r.outcome?.kind === o).length])) as Record<FeedbackOutcome, number>,
      cardOwn: mine.filter(sentCardTrade).length,
    };
  });
  const byReason = FEEDBACK_REASONS.map((reason) => {
    const mine = entries.filter((r) => r.report?.reason === reason);
    return { reason, label: REASON_LABEL[reason], count: mine.length, averages: averages(mine) };
  });
  const byModelPart = MODEL_PARTS.map((part) => ({
    part,
    label: MODEL_PART_LABEL[part],
    reports: entries.filter((r) => r.report && REASON_MODEL_PART[r.report.reason] === part).length,
    // §11: Rejected outcomes refit the acceptance coefficients too.
    rejected: part === "acceptance" ? byOutcome.rejected : 0,
  }));

  let unpredicted = 0;
  const calibration: CalibrationBin[] = calibrationBins().map((b) => ({ ...b, decided: 0, accepted: 0, rejected: 0, countered: 0, pending: 0, neverAccept: 0, meanPredicted: null, observed: null }));
  const predictedSum = new Map<CalibrationBin, number>();
  for (const r of entries) {
    const p = predictedAccept(r);
    if (p === null) {
      unpredicted++;
      continue;
    }
    // Below the first bound can't happen (a printed chance is at least 0); it would count in the first bin.
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
    total: entries.length,
    leagues: new Set(entries.map((r) => r.league)).size,
    withOutcome: entries.filter((r) => r.outcome).length,
    withReport: entries.filter((r) => r.report).length,
    withNote: entries.filter((r) => r.report?.note).length,
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
    "Each trade idea with an outcome, by the version of it that was sent (asked when its card showed more than one). Unknown: records made before versions were recorded. The card's own trade: how many sent the trade the card showed, whose numbers it printed; for the rest (a first offer without the throw-in, the throw-in added to a first offer, a Plan B) the calibration reads the chance that version's own line printed.",
    "",
  );

  lines.push("## By reason", "");
  lines.push(
    ...table(
      ["Reason", "Reports", "Helps you", "Helps them", "Chance they accept", "Overall"],
      s.byReason.map((r) => [r.label, r.count, num(r.averages.helps, 0), num(r.averages.helpsThem, 0), pct(r.averages.chance), num(r.averages.overall, 0)]),
    ),
    "",
    "Averages of the numbers each reason's trade ideas showed on their cards (Helps them where the card showed it; – = none known).",
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
      ["Chance they accept (as printed)", "Decided", "Accepted", "Rejected", "Observed", "Mean printed", "Countered", "Sent, no answer", "\"Never accept\" reports"],
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
    "Decided = Accepted + Rejected. A bin's observed rate means little until it holds a few dozen decided trades. The chance is the one the sent version's line printed, else the card's; “<5%” counts as half of 5%.",
    ...(s.unpredicted ? [`${plural(s.unpredicted, "trade idea")} had no printed chance and ${s.unpredicted === 1 ? "is" : "are"} left out.`] : []),
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
export function feedbackNotes(entries: readonly FeedbackExportEntry[]): { reason: FeedbackReason; note: string }[] {
  return entries.flatMap((r) => (r.report?.note ? [{ reason: r.report.reason, note: r.report.note }] : []));
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
  const entries = parseFeedbackExport(text);
  if (entries === null) return { ok: false, error: "That file isn't an Offer Sheet feedback export (Settings → Export feedback)." };
  const summary = summarizeFeedback(entries);
  if (args.json) return { ok: true, output: `${JSON.stringify(args.notes ? { ...summary, notes: feedbackNotes(entries) } : summary, null, 2)}\n` };
  return { ok: true, output: formatSummary(summary, args.notes ? feedbackNotes(entries) : undefined) };
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
