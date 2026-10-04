/**
 * Feedback on trade ideas, kept in this browser (CLAUDE.md §11 "Feedback on every suggestion": Phase 4 is
 * local only; lead decision L12). A trade card's outcome buttons (Sent, Accepted, Rejected, Countered) and its
 * Report button (Doesn't help me · They'd never accept · Player info is wrong · League settings look wrong ·
 * Other, with an optional note) save a record under FEEDBACK_STORAGE_KEY in localStorage, together with the
 * trade's model inputs and scores. The Settings page's "Export feedback" downloads them as JSON
 * (feedbackExportText), and `npm run feedback:summary -- <file>` (scripts/feedback-summary.ts) summarizes an
 * export by reason, by outcome and by model part.
 *
 * The rules:
 * - One record per trade idea: (leagueKey, tradeKey), where leagueKey is settingsStore.ts's short hash of the
 *   league and tradeKey the evaluation's stable key (TradeEvaluation.key, built from the sorted assets).
 * - Its numbers and features are the ones the card showed when the record was made, i.e. the first button
 *   pressed: the prediction the user acted on, which calibration compares outcomes with. Later presses change
 *   only the outcome or the report.
 * - `outcome` is the latest outcome pressed (Sent, then Accepted); `report` the latest report. Passing null
 *   clears either one (the card's buttons toggle), and a record left with neither is removed.
 * - Which version was sent (planner reply to Checkpoint 4, change 6 and answer 8: recorded now, analyzed in Phase 6):
 *   a card can show more than one version of a trade idea (the first offer and the full one of "How to offer it"; the
 *   trade and its "If they say no, try:"), so the first outcome pressed while none is recorded asks which one (a plain
 *   card's only version, "full", is recorded without asking). The record keeps `version` ("offerFirst", "full" or
 *   "planB"), that version's trade key (`versionKey`) and its estimate as its line on the card showed it
 *   (`versionAccept`: the prediction the user acted on, which the summary's calibration reads). Later outcomes keep it;
 *   clearing the outcome clears it (it belongs to the sending). A record without one (made before Phase 4b, or a
 *   version not given) reads as unknown.
 * - The list runs from the least to the most recently touched record and keeps the newest
 *   FEEDBACK_MAX_RECORDS (500), so a busy season never fills the browser's storage.
 * - Numbers and features that weren't finite (B before a simulation, for example) are kept as null.
 *
 * Privacy: a record holds no names, no league id and nothing about anyone's account: player ids (canonical:
 * Sleeper's), the platform's team id of the partner, the league's short hash, the model's numbers and features,
 * which version was sent (its key: the same team and player ids) and the time of each press. The note is the user's
 * own words (trimmed, at most FEEDBACK_NOTE_MAX characters).
 * The short hash isn't anonymous (an ESPN league id is a small number: hashing every possible id finds it in
 * seconds, and the record id made from it gives it away the same way), so the export, a file meant to be
 * shared, numbers the leagues instead and makes each record id again from that number (feedbackExport).
 * Nothing here is sent anywhere: the server-side store, anonymized and with an opt-out, is Phase 7's.
 *
 * Reading never throws and never trusts the stored value (bad JSON or another shape counts as no feedback, and
 * a malformed record is skipped); writing reports failure in plain English. Pure functions over an injected
 * storage (like importStore.ts); the pages' hooks are in src/components/settings/useFeedback.ts.
 */
import { fmix32, hash32 } from "@/engine/rng";
import type { AcceptanceFeatures, TradeAsset, TradeEvaluation, TradeProposal } from "@/engine/tradeModel";
import type { SaveResult, StorageLike } from "./importStore";

export const FEEDBACK_STORAGE_KEY = "offersheet:feedback:v1";
/** Records kept: the most recently touched (L12). */
export const FEEDBACK_MAX_RECORDS = 500;
/** A report's note is cut to this many characters. */
export const FEEDBACK_NOTE_MAX = 500;

/** The outcome buttons (§11), in the card's order. */
export const FEEDBACK_OUTCOMES = ["sent", "accepted", "rejected", "countered"] as const;
export type FeedbackOutcome = (typeof FEEDBACK_OUTCOMES)[number];

/** The Report button's reasons (§11), in the card's order. */
export const FEEDBACK_REASONS = ["doesnt-help", "never-accept", "player-info", "settings", "other"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export const OUTCOME_LABEL: Record<FeedbackOutcome, string> = {
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  countered: "Countered",
};

export const REASON_LABEL: Record<FeedbackReason, string> = {
  "doesnt-help": "Doesn't help me",
  "never-accept": "They'd never accept",
  "player-info": "Player info is wrong (injured, traded, wrong position)",
  settings: "League settings look wrong",
  other: "Other",
};

/**
 * The versions of a trade idea a card can show (the header): the first offer of "How to offer it", the full trade (the
 * card's own, or the full version of its steps), and "If they say no, try:" (Plan B).
 */
export const FEEDBACK_VERSIONS = ["offerFirst", "full", "planB"] as const;
export type FeedbackVersion = (typeof FEEDBACK_VERSIONS)[number];

/** The versions in words, for the summary. */
export const VERSION_LABEL: Record<FeedbackVersion, string> = {
  offerFirst: "First offer",
  full: "Full trade",
  planB: "If they say no (Plan B)",
};

/** The version sent, as a press passes it: which one, its trade key, and its estimate as its line on the card showed it. */
export interface FeedbackSent {
  version: FeedbackVersion;
  key: string;
  pAccept: number | null;
  pComplete: number | null;
}

/** The part of Offer Sheet a report points at (§11 "How the data is used"). */
export type ModelPart = "acceptance" | "benefit" | "adapters" | "review";

export const MODEL_PART_LABEL: Record<ModelPart, string> = {
  acceptance: "Acceptance model (refit the coefficients)",
  benefit: "Benefit and projections (review those cases)",
  adapters: "Data import (the adapters' bug queue)",
  review: "Read by hand",
};

/**
 * §11: "They'd never accept" (and Rejected outcomes) refit the acceptance coefficients; "Doesn't help me" sends
 * the benefit and projection logic to review; wrong player info and wrong league settings go to the adapters'
 * bug queue; "Other" is read by hand.
 */
export const REASON_MODEL_PART: Record<FeedbackReason, ModelPart> = {
  "doesnt-help": "benefit",
  "never-accept": "acceptance",
  "player-info": "adapters",
  settings: "adapters",
  other: "review",
};

/** The card's numbers a record keeps (TradeEvaluation's), null when the card had none (or none that was finite). */
export interface FeedbackNumbers {
  b: number | null;
  tradeScore: number | null;
  pAccept: number | null;
  pComplete: number | null;
  overall: number | null;
  dPO: number | null;
  dCH: number | null;
  dPPW: number | null;
  gMine: number | null;
  gPartner: number | null;
}

const NUMBER_KEYS = ["b", "tradeScore", "pAccept", "pComplete", "overall", "dPO", "dCH", "dPPW", "gMine", "gPartner"] as const satisfies readonly (keyof FeedbackNumbers)[];

/** §11's features as the model used them (AcceptanceFeatures), null where one wasn't finite. */
export type FeedbackFeatures = { [K in keyof AcceptanceFeatures]: number | null };

const FEATURE_KEYS = ["g", "n", "h", "c", "a", "hist", "ctx", "hot", "urg", "z"] as const satisfies readonly (keyof AcceptanceFeatures)[];

export interface FeedbackRecord {
  /** "fb-" and 8 hex digits, from the league, the trade and when the record was made. */
  id: string;
  /** When the record was made (ISO): the first button pressed for this trade idea. */
  savedAt: string;
  leagueKey: string;
  tradeKey: string;
  proposal: TradeProposal;
  numbers: FeedbackNumbers;
  features: FeedbackFeatures;
  outcome?: { kind: FeedbackOutcome; at: string };
  /** Which version was sent (the header), with the outcome only; absent = unknown. */
  version?: FeedbackVersion;
  /** The sent version's trade key (TradeEvaluation.key, a TradeStep's or a PlanB's). */
  versionKey?: string;
  /** The sent version's estimate as its line on the card showed it (null where it wasn't finite). */
  versionAccept?: { pAccept: number | null; pComplete: number | null };
  report?: { reason: FeedbackReason; note?: string; at: string };
}

/** The parts of a trade's evaluation a record keeps (a full TradeEvaluation fits). */
export type FeedbackEvaluation = Pick<TradeEvaluation, "key" | "proposal" | "features" | keyof FeedbackNumbers>;

/**
 * One press: set (or, with null, clear) the outcome or the report. An outcome may say which version was sent (`sent`:
 * recorded with it; without it, a version already recorded stays).
 */
export type FeedbackChange = { outcome: FeedbackOutcome | null; sent?: FeedbackSent | undefined } | { report: { reason: FeedbackReason; note?: string | undefined } | null };

export const FEEDBACK_SAVE_FAILED =
  "Your browser wouldn't let Offer Sheet save this (its storage is full or blocked for this site), so it wasn't kept. Allow site data for Offer Sheet and try again.";

const finite = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** The card's numbers, as a record keeps them. */
export function feedbackNumbers(evaluation: Pick<TradeEvaluation, keyof FeedbackNumbers>): FeedbackNumbers {
  const out = {} as FeedbackNumbers;
  for (const k of NUMBER_KEYS) out[k] = finite(evaluation[k]);
  return out;
}

function feedbackFeatures(features: AcceptanceFeatures | Record<string, unknown>): FeedbackFeatures {
  const f = features as Record<string, unknown>;
  const out = {} as FeedbackFeatures;
  for (const k of FEATURE_KEYS) out[k] = finite(f[k]);
  return out;
}

function copyAsset(a: TradeAsset): TradeAsset {
  return a.kind === "player" ? { kind: "player", id: a.id } : { kind: "pick", season: a.season, round: a.round, originalTeamId: a.originalTeamId };
}

function copyProposal(p: TradeProposal): TradeProposal {
  return { partnerId: p.partnerId, give: p.give.map(copyAsset), get: p.get.map(copyAsset) };
}

function recordId(leagueKey: string, tradeKey: string, at: string): string {
  return `fb-${fmix32(hash32(`${leagueKey}|${tradeKey}|${at}`)).toString(16).padStart(8, "0")}`;
}

/** A note as kept: trimmed, at most FEEDBACK_NOTE_MAX characters; undefined when empty. */
export function cleanNote(note: string | null | undefined): string | undefined {
  const t = typeof note === "string" ? note.trim() : "";
  return t ? t.slice(0, FEEDBACK_NOTE_MAX) : undefined;
}

/** The record for this trade idea, when there is one. */
export function feedbackFor(records: readonly FeedbackRecord[], leagueKey: string, tradeKey: string): FeedbackRecord | undefined {
  return records.find((r) => r.leagueKey === leagueKey && r.tradeKey === tradeKey);
}

/**
 * The list after one press (see the header): the trade idea's record made (with the card's numbers) or
 * updated, moved to the newest end, removed once it holds neither an outcome nor a report, and the list cut
 * to the newest FEEDBACK_MAX_RECORDS. Clearing what isn't there changes nothing. Pure: `records` isn't changed.
 */
export function applyFeedback(
  records: readonly FeedbackRecord[],
  args: { leagueKey: string; evaluation: FeedbackEvaluation; change: FeedbackChange; at: string },
): FeedbackRecord[] {
  const { leagueKey, evaluation, change, at } = args;
  const index = records.findIndex((r) => r.leagueKey === leagueKey && r.tradeKey === evaluation.key);
  const existing = index >= 0 ? records[index] : undefined;
  const clearing = "outcome" in change ? change.outcome === null : change.report === null;
  if (!existing && clearing) return [...records];
  const next: FeedbackRecord = existing
    ? { ...existing }
    : {
        id: recordId(leagueKey, evaluation.key, at),
        savedAt: at,
        leagueKey,
        tradeKey: evaluation.key,
        proposal: copyProposal(evaluation.proposal),
        numbers: feedbackNumbers(evaluation),
        features: feedbackFeatures(evaluation.features),
      };
  if ("outcome" in change) {
    if (change.outcome === null) {
      // The version belongs to the sending: it goes with the outcome.
      delete next.outcome;
      delete next.version;
      delete next.versionKey;
      delete next.versionAccept;
    } else {
      next.outcome = { kind: change.outcome, at };
      const sent = change.sent;
      if (sent && (FEEDBACK_VERSIONS as readonly unknown[]).includes(sent.version)) {
        next.version = sent.version;
        if (isText(sent.key)) next.versionKey = sent.key;
        else delete next.versionKey;
        next.versionAccept = { pAccept: finite(sent.pAccept), pComplete: finite(sent.pComplete) };
      }
    }
  } else if (change.report === null) {
    delete next.report;
  } else {
    const note = cleanNote(change.report.note);
    next.report = { reason: change.report.reason, ...(note ? { note } : {}), at };
  }
  const rest = records.filter((_, i) => i !== index);
  const out = next.outcome || next.report ? [...rest, next] : rest;
  return out.length > FEEDBACK_MAX_RECORDS ? out.slice(out.length - FEEDBACK_MAX_RECORDS) : out;
}

// ---------------------------------------------------------------------------------------------
// Reading

function isRecordLike(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

const isText = (x: unknown): x is string => typeof x === "string" && x.length > 0;

function parseAsset(x: unknown): TradeAsset | null {
  if (!isRecordLike(x)) return null;
  if (x.kind === "player" && isText(x.id)) return { kind: "player", id: x.id };
  if (x.kind === "pick" && typeof x.season === "number" && typeof x.round === "number" && isText(x.originalTeamId)) {
    return { kind: "pick", season: x.season, round: x.round, originalTeamId: x.originalTeamId };
  }
  return null;
}

function parseProposal(x: unknown): TradeProposal | null {
  if (!isRecordLike(x) || !isText(x.partnerId) || !Array.isArray(x.give) || !Array.isArray(x.get)) return null;
  const give = x.give.map(parseAsset);
  const get = x.get.map(parseAsset);
  if (give.some((a) => a === null) || get.some((a) => a === null)) return null;
  return { partnerId: x.partnerId, give: give as TradeAsset[], get: get as TradeAsset[] };
}

function parseNumbers(x: unknown): FeedbackNumbers | null {
  if (!isRecordLike(x)) return null;
  const out = {} as FeedbackNumbers;
  for (const k of NUMBER_KEYS) out[k] = finite(x[k]);
  return out;
}

/** One stored or exported record, checked field by field; null when it isn't one. */
export function parseFeedbackRecord(x: unknown): FeedbackRecord | null {
  if (!isRecordLike(x) || !isText(x.id) || !isText(x.savedAt) || !isText(x.leagueKey) || !isText(x.tradeKey)) return null;
  const proposal = parseProposal(x.proposal);
  const numbers = parseNumbers(x.numbers);
  if (!proposal || !numbers || !isRecordLike(x.features)) return null;
  const record: FeedbackRecord = { id: x.id, savedAt: x.savedAt, leagueKey: x.leagueKey, tradeKey: x.tradeKey, proposal, numbers, features: feedbackFeatures(x.features) };
  const o = x.outcome;
  if (o !== undefined) {
    if (!isRecordLike(o) || !(FEEDBACK_OUTCOMES as readonly unknown[]).includes(o.kind) || !isText(o.at)) return null;
    record.outcome = { kind: o.kind as FeedbackOutcome, at: o.at };
    // The sent version (Phase 4b) goes with the outcome; one that isn't readable is left out (the record stays: older
    // and newer records alike read).
    if ((FEEDBACK_VERSIONS as readonly unknown[]).includes(x.version)) {
      record.version = x.version as FeedbackVersion;
      if (isText(x.versionKey)) record.versionKey = x.versionKey;
      if (isRecordLike(x.versionAccept)) record.versionAccept = { pAccept: finite(x.versionAccept.pAccept), pComplete: finite(x.versionAccept.pComplete) };
    }
  }
  const r = x.report;
  if (r !== undefined) {
    if (!isRecordLike(r) || !(FEEDBACK_REASONS as readonly unknown[]).includes(r.reason) || !isText(r.at) || (r.note !== undefined && typeof r.note !== "string")) return null;
    const note = cleanNote(r.note as string | undefined);
    record.report = { reason: r.reason as FeedbackReason, ...(note ? { note } : {}), at: r.at };
  }
  return record.outcome || record.report ? record : null;
}

/**
 * Records from a list (the stored value, or an export's `records`): malformed ones skipped, and of two records
 * for the same trade idea only the later one kept; the newest `cap` when given.
 */
function recordsFrom(list: readonly unknown[], cap?: number): FeedbackRecord[] {
  // From the newest end, so the later copy of a duplicate is the one kept, at its own (later) place.
  const seen = new Set<string>();
  const out: FeedbackRecord[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const record = parseFeedbackRecord(list[i]);
    if (!record) continue;
    const id = `${record.leagueKey}\u0000${record.tradeKey}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(record);
    if (cap !== undefined && out.length >= cap) break;
  }
  return out.reverse();
}

/** The stored records; [] when nothing is stored or the value isn't ours. Never throws. */
export function parseFeedback(raw: string | null | undefined): FeedbackRecord[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  return Array.isArray(data) ? recordsFrom(data, FEEDBACK_MAX_RECORDS) : [];
}

// ---------------------------------------------------------------------------------------------
// Writing

/** Saves one press (applyFeedback) to the storage. */
export function saveFeedback(storage: StorageLike, args: { leagueKey: string; evaluation: FeedbackEvaluation; change: FeedbackChange; at: string }): SaveResult {
  try {
    const next = applyFeedback(parseFeedback(storage.getItem(FEEDBACK_STORAGE_KEY)), args);
    if (next.length) storage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(next));
    else storage.removeItem(FEEDBACK_STORAGE_KEY);
    return { ok: true };
  } catch {
    return { ok: false, message: FEEDBACK_SAVE_FAILED };
  }
}

/** Deletes every record (the Settings page's "Delete saved feedback"). */
export function clearFeedback(storage: StorageLike): SaveResult {
  try {
    storage.removeItem(FEEDBACK_STORAGE_KEY);
    return { ok: true };
  } catch {
    return { ok: false, message: "Your browser wouldn't let Offer Sheet delete the saved feedback (its storage is blocked for this site)." };
  }
}

// ---------------------------------------------------------------------------------------------
// Export

export const FEEDBACK_EXPORT_KIND = "offersheet-trade-feedback";

/** The exported file: the records (leagues numbered: feedbackExport) with what they are and when they were exported. */
export interface FeedbackExport {
  kind: typeof FEEDBACK_EXPORT_KIND;
  version: 1;
  exportedAt: string;
  count: number;
  records: FeedbackRecord[];
}

/** How the export names a league: "league-1", "league-2", … (numbers that mean something only inside the file). */
export const EXPORT_LEAGUE_PREFIX = "league-";

/**
 * The export: the records with what they are and when they were exported. Each league's key (settingsStore.ts
 * leagueKey) becomes a number that means something only inside the file ("league-1", "league-2", … in the order
 * the leagues first appear), and each record id is made again from that number, since the key, and an id made
 * from it, lead back to an ESPN league id by hashing every possible one (see the header). What the summary
 * needs survives: which records share a league, and one record per trade idea. Pure: `records` isn't changed.
 */
export function feedbackExport(records: readonly FeedbackRecord[], exportedAt: string): FeedbackExport {
  const leagues = new Map<string, string>();
  const out = records.map((r) => {
    let league = leagues.get(r.leagueKey);
    if (league === undefined) {
      league = `${EXPORT_LEAGUE_PREFIX}${leagues.size + 1}`;
      leagues.set(r.leagueKey, league);
    }
    return { ...r, leagueKey: league, id: recordId(league, r.tradeKey, r.savedAt) };
  });
  return { kind: FEEDBACK_EXPORT_KIND, version: 1, exportedAt, count: out.length, records: out };
}

/** The export as the downloaded file's text (indented JSON). */
export function feedbackExportText(records: readonly FeedbackRecord[], exportedAt: string): string {
  return `${JSON.stringify(feedbackExport(records, exportedAt), null, 2)}\n`;
}

/** "offersheet-feedback-2026-09-30.json" (the export's UTC date: no characters Windows refuses in file names). */
export function feedbackExportFileName(exportedAt: string): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(exportedAt)?.[0] ?? "export";
  return `offersheet-feedback-${day}.json`;
}

/**
 * The records in an exported file (feedbackExportText's format, or a bare list of records such as the stored
 * value); null when the text isn't JSON or holds neither.
 */
export function parseFeedbackExport(text: string): FeedbackRecord[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (Array.isArray(data)) return recordsFrom(data);
  if (isRecordLike(data) && Array.isArray(data.records)) return recordsFrom(data.records);
  return null;
}
