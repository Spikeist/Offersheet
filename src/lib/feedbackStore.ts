/**
 * Feedback on trade ideas, kept in this browser (CLAUDE.md §11 "Feedback on every suggestion": Phase 4 is
 * local only; lead decision L12). A trade card's outcome buttons (Sent, Accepted, Rejected, Countered) and its
 * Report button (Doesn't help me · They'd never accept · Player info is wrong · League settings look wrong ·
 * Other, with an optional note) save a record under FEEDBACK_STORAGE_KEY in localStorage, together with the
 * trade's model inputs and scores. The Settings page's "Export feedback" downloads them as JSON
 * (feedbackExportText; version 3 since Checkpoint 7d: what the user saw and entered, never the model's numbers), and
 * `npm run feedback:summary -- <file>` (scripts/feedback-summary.ts) summarizes an export by reason, by outcome and by
 * version.
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
 * - Phase 4c (planner reply to Checkpoint 4b, change 7 and answer 9): the sent version's model inputs go with it
 *   (`versionInputs`: its acceptance features, raw g_mkt(P), B and the goal B was weighted by), so Phase 6 refits on
 *   the version actually sent. They follow the version: an outcome that names a version replaces them (or drops them
 *   when it carries none), and clearing the outcome clears them.
 * - The list runs from the least to the most recently touched record and keeps the newest
 *   FEEDBACK_MAX_RECORDS (500), so a busy season never fills the browser's storage. Phase 4c: the league store
 *   (src/lib/leagueStore.ts) keeps one such list per league in IndexedDB (so 500 per league), built with the same
 *   functions (applyFeedback, feedbackRecordsFrom); its migration moves the localStorage list in once per browser
 *   (mergeFeedbackRecords), and deleting feedback deletes that old list too. The pages no longer read or write
 *   localStorage: ⚠️ saveFeedback and clearFeedback (the pre-4c writers) are kept with their tests, unused since 4c.
 * - Numbers and features that weren't finite (B before a simulation, for example) are kept as null.
 * - Phase 7a (planner reply to Checkpoint 4c, A2 and Part B, B2; track FB):
 *   - B₃, the "Helps you" scale the card's numbers were scored on (TradeEvaluation.b3), is kept with the numbers
 *     (FeedbackNumbers.b3) and with the sent version's inputs (VersionInputs.b3), with why the scale departs from "+3
 *     points a week reads 63" (VersionInputs.helpsReason: benefit.ts HelpsScale.reason, "odds" when my odds barely move,
 *     "lambda" for the Win now ↔ Future setting), so Phase 6 can compare Helps you across leagues and goals. A record made
 *     before 7a reads null for both (unknown).
 *   - `rid`, the record's share id: a random code made in this browser for the anonymous copy each press sends while
 *     "Share anonymous feedback" is on (src/lib/feedbackShare.ts), so the server can match a later press on the same
 *     record (Accepted after Sent) to the earlier copy. Derived from nothing (16 random bytes, isShareId); a press passes
 *     it in its change (FeedbackChange.rid: the league store hands each press to applyFeedback as it is), and a record
 *     keeps the first one it gets (a record made before 7a gets one on its next press).
 *   - `basis` (review FB-R6): what the card's numbers were computed from besides the trade, the league data's season and
 *     NFL week and "What matters most" (FeedbackBasis), kept with the numbers when the record is made, so an outcome
 *     pressed a week later still says which week and goal the record's numbers belong to. The press passes it
 *     (FeedbackChange.basis); a version the press records keeps that press's week with its inputs (VersionInputs.week),
 *     since its numbers come from the card on screen then. A record made before has none (its copies read the week and
 *     goal on screen, as before).
 * - Checkpoint 7c (planner reply to Checkpoint 7b, §6, league prizes): under "Several prizes" (goal "prizes") the basis and
 *   the version's inputs also keep the prize split the numbers were weighed by, as whole percents of the season's prizes
 *   (FeedbackBasis.prizes, VersionInputs.prizes: feedbackEvent.ts FeedbackPrizes, isFeedbackPrizes), never the amounts
 *   typed. A goal and its split are one fact: "prizes" without a readable split reads as an unknown goal (null), and a
 *   split with any other goal is dropped (recordReward). A version's split is its own when the card gives one, else (⚠️
 *   ours) its press's, like its week: the card and the press's basis come from the same search or evaluation (the pages'
 *   share context reads the engine's reward). An older version's "balanced" stays as recorded (FEEDBACK_GOALS).
 * - Checkpoint 7d (planner reply to Checkpoint 7c, answer 1: the export holds "only what the user saw and entered"):
 *   `shown`, what the card printed when the record was made (FeedbackShown: its three numbers, Helps them when the card
 *   showed the partner's line, its odds lines and weekly line, each as the card's own text, never a model number), from
 *   the press that made the record (FeedbackChange.shown: tradeView.ts TradeCardView.shown, which the card's presses carry).
 *   Like the numbers it's the first press's; a record made before (or by a press that carried none) has none, and the export
 *   works its three numbers out from the record's own with the card's formatting (exportedShownOf). Only texts in
 *   the card's printed forms, at the card's own precision, are kept (parseFeedbackShown; review of Checkpoint 7d,
 *   cards-export-2), so no raw number can ride in it.
 *
 * Privacy: a record holds no names, no league id and nothing about anyone's account: player ids (canonical:
 * Sleeper's), the platform's team id of the partner, the league's short hash, the model's numbers and features (with the
 * season, week and goal they were computed for, and under "Several prizes" the prize split as whole percents, never the
 * amounts), what the card printed, which version was sent (its key: the same team and player ids), the
 * time of each press and its random share id. The note is the user's own words (trimmed, at most FEEDBACK_NOTE_MAX
 * characters).
 * The short hash isn't anonymous (an ESPN league id is a small number: hashing every possible id finds it in
 * seconds, and the record id made from it gives it away the same way), so the export, a file meant to be
 * shared, numbers the leagues instead (feedbackExport). Since Checkpoint 7d the export holds only what the user
 * saw and entered (the trade, the card's printed numbers and lines, the outcome, the version sent with its printed chance,
 * the reason and the note, and the days of its first press and of its latest outcome and report): no model number (B, B₃, P_accept, P_complete, g, the features, ΔPO,
 * ΔCH, ΔPPW), no basis or version inputs, no share id, trade key or record id, so no value ratio can be worked back out of
 * it (planner reply to Checkpoint 7c, answer 1; version 2, planner reply to Checkpoint 7b, Q5, left out only the ratios'
 * own fields, and its raw P_accept and B gave them back). The records in this browser keep everything, and so do the
 * anonymous copies made from them (internal, needed for calibration).
 * The anonymous copy (Phase 7a) is built from a record by src/lib/feedbackShare.ts, which leaves out everything above
 * that could identify a league or a person: the short hash, the record id, the partner's team id, the times and the note
 * (and, since Checkpoint 7d, what the card printed: the copy's own fields are unchanged).
 *
 * Reading never throws and never trusts the stored value (bad JSON or another shape counts as no feedback, and
 * a malformed record is skipped); writing reports failure in plain English. Pure functions over an injected
 * storage (like importStore.ts); the pages' hooks are in src/components/settings/useFeedback.ts.
 */
import { acceptanceLabel } from "@/engine/acceptance";
import type { HelpsScale } from "@/engine/benefit";
import { config } from "@/engine/config";
import { fmix32, hash32 } from "@/engine/rng";
import { PRIZE_KEYS } from "@/engine/settings";
import { FEEDBACK_GOALS, type FeedbackGoal, type FeedbackPrizes } from "./feedbackEvent";
import type { AcceptanceFeatures, TradeAsset, TradeEvaluation, TradeProposal } from "@/engine/tradeModel";
import type { SaveResult, StorageLike } from "./importStore";
import { acceptText, printedScore, throughText } from "./printed";

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
  /** Phase 4c (planner reply to Checkpoint 4b, change 7): the sent version's model inputs, for Phase 6's refit. */
  inputs?: VersionInputs | undefined;
}

/**
 * Why the "Helps you" scale departs from "+3 points a week reads 63" (benefit.ts HelpsScale.reason, "odds": it's floored; null:
 * it doesn't). "lambda", Checkpoint 7a's Win now ↔ Future note, went with its λ cap (planner reply to Checkpoint 7a, §2
 * question 6): the engine no longer gives it, but records and copies made before can still name it.
 */
export type HelpsReason = NonNullable<HelpsScale["reason"]> | "lambda";

/** The reasons a record may name (HelpsReason). */
export const HELPS_REASONS = ["odds", "lambda"] as const satisfies readonly HelpsReason[];

/**
 * The model inputs of the version sent (planner reply to Checkpoint 4b, change 7: g, n, h, c, a, hist, ctx, the star
 * premium and B), as the card's numbers were computed: its acceptance features (g is the partner's perceived g, with the
 * star premium), the raw g_mkt(P) (so the premium is g's difference from it), B, and the goal B was weighted by. Null where
 * a number wasn't finite or the version doesn't carry it.
 * Phase 7a (planner reply to Checkpoint 4c, A2; the header): B₃, the scale its Helps you was scored on (every version of a
 * card shares the card's), and the scale's reason; and (review FB-R6) `week`, the NFL week of the league data its numbers
 * came from (the press that recorded the version: FeedbackChange.basis). Optional only so that code building inputs before
 * 7a still compiles: a record read back always has all three, null when unknown.
 * Checkpoint 7c (the header): `prizes`, the prize split B was weighed by, exactly when the goal is "prizes".
 */
export interface VersionInputs {
  features: FeedbackFeatures | null;
  gPartner: number | null;
  b: number | null;
  goal: FeedbackGoal | null;
  prizes?: FeedbackPrizes;
  b3?: number | null;
  helpsReason?: HelpsReason | null;
  week?: number | null;
}

/**
 * What a card's numbers were computed from besides the trade (the header, review FB-R6): the league data's season and NFL
 * week, and "What does your league reward?" as the card's numbers were computed (null when unknown), with (Checkpoint 7c)
 * the prize split it weighed, whole percents, exactly when that's "Several prizes" (goal "prizes").
 */
export interface FeedbackBasis {
  season: number;
  week: number;
  goal: FeedbackGoal | null;
  prizes?: FeedbackPrizes;
}

/**
 * Whether a value is a prize split as a record and a copy keep it (feedbackEvent.ts FeedbackPrizes): an object with exactly
 * settings.ts PRIZE_KEYS, each a whole percent from 0 to 100, adding up to exactly 100 (the server's schema takes the same:
 * src/server/feedbackSink.ts). Amounts (2000), finer shares (44.4) and any other field never pass.
 */
export function isFeedbackPrizes(x: unknown): x is FeedbackPrizes {
  if (!isRecordLike(x) || Object.keys(x).length !== PRIZE_KEYS.length) return false;
  let sum = 0;
  for (const k of PRIZE_KEYS) {
    const v = x[k];
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 100) return false;
    sum += v as number;
  }
  return sum === 100;
}

/**
 * A goal and its prize split as a record keeps them (the header): a goal of FEEDBACK_GOALS, else null; "prizes" only with a
 * split that is one (isFeedbackPrizes; copied in PRIZE_KEYS order), else null (⚠️ ours: what it weighed is unknown); any
 * other goal without a split.
 */
export function recordReward(goal: unknown, prizes: unknown): { goal: FeedbackGoal | null; prizes?: FeedbackPrizes } {
  if (!(FEEDBACK_GOALS as readonly unknown[]).includes(goal)) return { goal: null };
  if (goal !== "prizes") return { goal: goal as FeedbackGoal };
  if (!isFeedbackPrizes(prizes)) return { goal: null };
  const split = {} as Record<(typeof PRIZE_KEYS)[number], number>;
  for (const k of PRIZE_KEYS) split[k] = prizes[k];
  return { goal: "prizes", prizes: split };
}

/** A season a basis may name (the server's schema takes the same: src/server/feedbackSink.ts). */
const isSeason = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 2000 && (x as number) <= 2100;

/** An NFL week a basis may name: 0 (before the season) to 30 (the server's schema takes the same). */
export const isFeedbackWeek = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 30;

/**
 * A basis as a record keeps it: undefined unless its season and week are ones (a goal that isn't one reads null; an older
 * version's "balanced" is kept: FEEDBACK_GOALS; Checkpoint 7c, the goal with its prize split: recordReward).
 */
function basisOf(x: unknown): FeedbackBasis | undefined {
  if (!isRecordLike(x) || !isSeason(x.season) || !isFeedbackWeek(x.week)) return undefined;
  return { season: x.season, week: x.week, ...recordReward(x.goal, x.prizes) };
}

/**
 * What a trade card printed when the record was made (the header, Checkpoint 7d; planner reply to Checkpoint 7c, answer 1:
 * "the numbers on its card: Helps you, Helps them, the chance they accept, Overall and the odds lines"): each field the
 * card's own text (src/lib/tradeView.ts TradeCardView.shown), never a model number. The export holds it as it is
 * (feedbackExport); for a record without it, the export works out the three numbers alone (exportedShownOf).
 */
export interface FeedbackShown {
  /** Helps you as printed: "57", "0" (a trade that doesn't help), "—" (not scored). */
  helps: string;
  /** The chance they accept as printed: "45%", "<5%"; "—" when there's none to print. */
  chance: string;
  /** Its label (config.acceptance.labels: "Long shot", "Possible", "Decent", "Likely"). */
  label?: string;
  /** When the league's review could veto it and that printed differently, the chance it goes through: "about 20%", "under 5%". */
  through?: string;
  /** Overall as printed. */
  overall: string;
  /** My odds lines as printed, "<label> <value>": "Title odds 12.1% → 13.4%", "Top 3 odds 30% → 32%", "Playoff odds 65% → 69%". */
  odds?: string[];
  /** The weekly line as printed: "Win chance by week: Week 9: 68% → 64% · Week 13: 42% → 55%". */
  weekly?: string;
  /** Helps them as printed, only when the card showed the partner's line (planner reply to Checkpoint 7c, answer 3). */
  helpsThem?: string;
  /** Their odds on that line, "<label> <value>": "Their title odds 6.0% → 6.9%", "Their playoff odds 41% → 45%". */
  theirOdds?: string[];
}

// The card's printed forms, each at the card's own precision and no finer (review of Checkpoint 7d, cards-export-2: any whole
// percent passed for the chance, any number up to 999 for a score and a tenth for every odds value, so a slip that printed a
// raw estimate to the percent would have ridden into the file). Each is what src/lib/printed.ts and tradeView.ts print:
/** A whole percent as a card prints one: 0 to 100, no leading zero. */
const WHOLE = String.raw`(?:100|[1-9]?\d)`;
/** A 0–100 score as a card prints it (printed.ts printedScore: Helps you, Overall; Helps them), or "—" when it wasn't scored. */
const PRINTED_SCORE = new RegExp(`^(?:${WHOLE}|—)$`);
/** The chance's step, a whole percent (config.acceptance.displayStep: 5). */
const STEP = Math.max(1, Math.round(config.acceptance.displayStep * 100));
/** A chance as printed.ts acceptText prints it: a whole step ("45%"; "0%" only for an estimate that isn't a number), "<5%" under the step; or "—". */
const PRINTED_CHANCE = new RegExp(`^(?:<(${WHOLE})%|(${WHOLE})%|—)$`);
/** The chance it goes through as printed.ts throughText prints it: "about 20%" (a whole step from the step up), "under 5%". */
const PRINTED_THROUGH = new RegExp(`^(?:under (${WHOLE})%|about (${WHOLE})%)$`);
/** A whole-percent odds value as tradeView.ts percentText prints it ("<1%" and ">99%" at the edges): the top-N and playoff odds, the weekly line. */
const WHOLE_ODDS = String.raw`(?:<1%|>99%|${WHOLE}%)`;
/** A title odds value as tradeView.ts titleOddsText prints it: one decimal ("<0.1%" and ">99.9%" at the edges). */
const TENTH_ODDS = String.raw`(?:<0\.1%|>99\.9%|(?:100\.0|[1-9]?\d\.\d)%)`;
/** The change alone, without the odds before (tradeView.ts pointsChange: "+4.1 percentage points", "−1 percentage point", "no change"), or "unknown". */
const ODDS_CHANGE = String.raw`(?:unknown|no change|[+−](?:100|[1-9]?\d(?:\.\d)?) percentage points?)`;
/** The title odds' value, and the others' (tradeView.ts oddsView): before → after, or the change alone. */
const TITLE_VALUE = `(?:${ODDS_CHANGE}|${TENTH_ODDS} → ${TENTH_ODDS})`;
const OTHER_VALUE = `(?:${ODDS_CHANGE}|${WHOLE_ODDS} → ${WHOLE_ODDS})`;
/** One of my odds lines as printed (tradeView.ts oddsViews). */
const PRINTED_MY_ODDS = new RegExp(`^(?:Title odds ${TITLE_VALUE}|(?:Top [23]|Playoff) odds ${OTHER_VALUE})$`);
/** One of the partner's odds as printed (tradeView.ts theirOddsViews). */
const PRINTED_THEIR_ODDS = new RegExp(`^Their (?:title odds ${TITLE_VALUE}|(?:top [23]|playoff) odds ${OTHER_VALUE})$`);
/** The weekly line as printed (tradeView.ts weeklyLine): a week of the season, whole percents, at most config.explain.weeklyLineMax weeks. */
const WEEK_MOVE = String.raw`Week (?:[1-9]|[12]\d|30): ${WHOLE_ODDS} → ${WHOLE_ODDS}`;
const PRINTED_WEEKLY = new RegExp(`^Win chance by week: ${WEEK_MOVE}(?: · ${WEEK_MOVE}){0,${Math.max(0, Math.floor(config.explain.weeklyLineMax) - 1)}}$`);
/** At most this many odds lines a side (title, top-N, playoffs). */
const SHOWN_ODDS_MAX = 3;

const printed = (x: unknown, re: RegExp): x is string => typeof x === "string" && x.length <= 300 && re.test(x);

/** Whether a whole percent is one of the chance's steps (STEP). */
const onStep = (n: number): boolean => n % STEP === 0;

/**
 * Whether a value is a chance they accept as a card prints it (printed.ts acceptText: "45%", "<5%"), or "—" when there's none
 * to print: the export's version line reads it too.
 */
export function isPrintedChance(x: unknown): x is string {
  if (!printed(x, PRINTED_CHANCE)) return false;
  const [, under, whole] = PRINTED_CHANCE.exec(x) ?? [];
  if (under !== undefined) return Number(under) === STEP;
  return whole === undefined || onStep(Number(whole));
}

/** Whether a value is the chance a trade goes through as a card prints it (printed.ts throughText: "about 20%", "under 5%"). */
export function isPrintedThrough(x: unknown): x is string {
  if (!printed(x, PRINTED_THROUGH)) return false;
  const [, under, about] = PRINTED_THROUGH.exec(x) ?? [];
  if (under !== undefined) return Number(under) === STEP;
  return about !== undefined && Number(about) >= STEP && onStep(Number(about));
}

/** A list of printed lines, all of them in the form (`re`) and at most SHOWN_ODDS_MAX; else undefined. */
function printedLines(x: unknown, re: RegExp): string[] | undefined {
  if (!Array.isArray(x) || x.length > SHOWN_ODDS_MAX || !x.every((l) => printed(l, re))) return undefined;
  return [...(x as string[])];
}

/**
 * What a card printed, as a record keeps it (FeedbackShown), from a press's or a stored value: only texts in the card's
 * printed forms, at its own precision (a score "57" or "—" from 0 to 100, a chance "45%" in whole steps of
 * config.acceptance.displayStep or "<5%", a label of config.acceptance.labels, "about 20%", the title odds to a tenth and
 * every other odds value and the weekly line in whole percents, as tradeView.ts words them), so no raw number can ride in it.
 * A part that isn't in its form is left out (the partner's score and their odds go together); undefined when Helps you, the
 * chance or Overall isn't, or it isn't an object.
 */
export function parseFeedbackShown(x: unknown): FeedbackShown | undefined {
  if (!isRecordLike(x) || !printed(x.helps, PRINTED_SCORE) || !isPrintedChance(x.chance) || !printed(x.overall, PRINTED_SCORE)) return undefined;
  const labels: readonly string[] = config.acceptance.labels.map((l) => l.label);
  const odds = printedLines(x.odds, PRINTED_MY_ODDS);
  const theirOdds = printedLines(x.theirOdds, PRINTED_THEIR_ODDS);
  const them = printed(x.helpsThem, PRINTED_SCORE) && theirOdds ? { helpsThem: x.helpsThem, theirOdds } : {};
  return {
    helps: x.helps,
    chance: x.chance,
    ...(typeof x.label === "string" && labels.includes(x.label) ? { label: x.label } : {}),
    ...(isPrintedThrough(x.through) ? { through: x.through } : {}),
    overall: x.overall,
    ...(odds ? { odds } : {}),
    ...(printed(x.weekly, PRINTED_WEEKLY) ? { weekly: x.weekly } : {}),
    ...them,
  };
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
  /** Phase 7a: B₃, the scale Helps you and Overall were scored on (TradeEvaluation.b3); null when unknown (before 7a). */
  b3: number | null;
}

const NUMBER_KEYS = ["b", "tradeScore", "pAccept", "pComplete", "overall", "dPO", "dCH", "dPPW", "gMine", "gPartner", "b3"] as const satisfies readonly (keyof FeedbackNumbers)[];

/** TradeEvaluation's fields a record's numbers come from (B₃ optional: an evaluation made before Phase 7a has none). */
export type FeedbackNumberSource = Pick<TradeEvaluation, Exclude<keyof FeedbackNumbers, "b3">> & { b3?: number | null | undefined };

/** §11's features as the model used them (AcceptanceFeatures), null where one wasn't finite. */
export type FeedbackFeatures = { [K in keyof AcceptanceFeatures]: number | null };

const FEATURE_KEYS = ["g", "n", "h", "c", "a", "hist", "ctx", "hot", "urg", "z"] as const satisfies readonly (keyof AcceptanceFeatures)[];

export interface FeedbackRecord {
  /** "fb-" and 8 hex digits, from the league, the trade and when the record was made. */
  id: string;
  /**
   * Phase 7a: the record's share id (the header): random, made in this browser, the one thing the anonymous copies of
   * its presses share (src/lib/feedbackShare.ts). Absent on a record made before 7a until its next press.
   */
  rid?: string;
  /** When the record was made (ISO): the first button pressed for this trade idea. */
  savedAt: string;
  leagueKey: string;
  tradeKey: string;
  proposal: TradeProposal;
  numbers: FeedbackNumbers;
  features: FeedbackFeatures;
  /**
   * Phase 7a (review FB-R6): the season, week and goal the numbers and features were computed for (the header), from the
   * press that made the record; absent on a record made before, or by a press that passed none.
   */
  basis?: FeedbackBasis;
  /**
   * Checkpoint 7d: what the card printed when the record was made (the header: its numbers, odds and weekly lines, and the
   * partner's line when it showed), from the press that made it; absent on a record made before, or by a press that passed none.
   */
  shown?: FeedbackShown;
  outcome?: { kind: FeedbackOutcome; at: string };
  /** Which version was sent (the header), with the outcome only; absent = unknown. */
  version?: FeedbackVersion;
  /** The sent version's trade key (TradeEvaluation.key, a TradeStep's or a PlanB's). */
  versionKey?: string;
  /** The sent version's estimate as its line on the card showed it (null where it wasn't finite). */
  versionAccept?: { pAccept: number | null; pComplete: number | null };
  /** Phase 4c: the sent version's model inputs (FeedbackSent.inputs). */
  versionInputs?: VersionInputs;
  report?: { reason: FeedbackReason; note?: string; at: string };
}

/** The parts of a trade's evaluation a record keeps (a full TradeEvaluation fits). */
export type FeedbackEvaluation = Pick<TradeEvaluation, "key" | "proposal" | "features"> & FeedbackNumberSource;

/**
 * One press: set (or, with null, clear) the outcome or the report. An outcome may say which version was sent (`sent`:
 * recorded with it; without it, a version already recorded stays). Phase 7a: `rid`, the share id the record takes when
 * it has none yet (the header; a share id it already has is never replaced), and `basis`, what the card's numbers were
 * computed from (a new record keeps it; a version this press records keeps its week). The pages' presses carry both
 * (src/components/settings/useFeedback.ts saveFeedbackPress); without them a new record has neither. Checkpoint 7d:
 * `shown`, what the card printed (a new record keeps it, as parseFeedbackShown reads it), which the card's own presses
 * carry (src/components/trades/TradeCard.tsx, tradeView.ts cardPress).
 */
export type FeedbackChange = ({ outcome: FeedbackOutcome | null; sent?: FeedbackSent | undefined } | { report: { reason: FeedbackReason; note?: string | undefined } | null }) & {
  rid?: string | undefined;
  basis?: FeedbackBasis | undefined;
  shown?: FeedbackShown | undefined;
};

/**
 * A record's share id (the header): 16 random bytes in base64url, 22 characters, the last of which carries only the 16th
 * byte's top 2 bits (so it is A, Q, g or w). The server's schema accepts exactly these (src/server/feedbackSink.ts; review
 * FB-R4: no other text of 22 characters, a username's for example, can pass for one).
 */
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{21}[AQgw]$/;

/** Whether a value is a share id (FeedbackRecord.rid). */
export function isShareId(x: unknown): x is string {
  return typeof x === "string" && SHARE_ID_PATTERN.test(x);
}

export const FEEDBACK_SAVE_FAILED =
  "Your browser wouldn't let Offer Sheet save this (its storage is full or blocked for this site), so it wasn't kept. Allow site data for Offer Sheet and try again.";

const finite = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** The card's numbers, as a record keeps them (B₃ null when the evaluation has none). */
export function feedbackNumbers(evaluation: FeedbackNumberSource): FeedbackNumbers {
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

/**
 * The sent version's model inputs as a record keeps them (a press's FeedbackSent.inputs, or a stored record's): only
 * the known fields, numbers that weren't finite as null, a goal that isn't one of "What does your league reward?" as null
 * (Checkpoint 7c: with its prize split, recordReward), B₃ that isn't above 0, a scale reason that isn't one of HELPS_REASONS
 * and a week that isn't one as null (Phase 7a; null too on inputs from before it); undefined when it isn't an object at all.
 */
function versionInputsOf(x: unknown): VersionInputs | undefined {
  if (!isRecordLike(x)) return undefined;
  const b3 = finite(x.b3);
  return {
    features: isRecordLike(x.features) ? feedbackFeatures(x.features) : null,
    gPartner: finite(x.gPartner),
    b: finite(x.b),
    ...recordReward(x.goal, x.prizes),
    b3: b3 !== null && b3 > 0 ? b3 : null,
    helpsReason: (HELPS_REASONS as readonly unknown[]).includes(x.helpsReason) ? (x.helpsReason as HelpsReason) : null,
    week: isFeedbackWeek(x.week) ? x.week : null,
  };
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
 * A version's inputs as a press passes them, with the press's prize split (its basis's) when they name "Several prizes"
 * without a readable split of their own and the basis names it too (the header; Checkpoint 7c). Anything else as given.
 */
function withPressPrizes(inputs: unknown, basis: FeedbackBasis | undefined): unknown {
  if (!isRecordLike(inputs) || inputs.goal !== "prizes" || isFeedbackPrizes(inputs.prizes)) return inputs;
  return basis?.goal === "prizes" && basis.prizes ? { ...inputs, prizes: basis.prizes } : inputs;
}

/**
 * The list after one press (see the header): the trade idea's record made (with the card's numbers) or
 * updated, moved to the newest end, removed once it holds neither an outcome nor a report, and the list cut
 * to the newest FEEDBACK_MAX_RECORDS. Clearing what isn't there changes nothing. A record without a share id takes the
 * change's (FeedbackChange.rid; one it has is kept); a new record keeps the change's basis (FeedbackChange.basis: an
 * existing record keeps its own, or none, since its numbers are its first press's) and (Checkpoint 7d) what its card printed
 * (FeedbackChange.shown, as parseFeedbackShown reads it; likewise its first press's), and a version the change records
 * keeps the change's week with its inputs. Pure: `records` isn't changed.
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
  const rid = existing?.rid ?? (isShareId(change.rid) ? change.rid : undefined);
  const basis = basisOf(change.basis);
  const shown = existing ? undefined : parseFeedbackShown(change.shown);
  const next: FeedbackRecord = existing
    ? { ...existing, ...(rid ? { rid } : {}) }
    : {
        id: recordId(leagueKey, evaluation.key, at),
        ...(rid ? { rid } : {}),
        savedAt: at,
        leagueKey,
        tradeKey: evaluation.key,
        proposal: copyProposal(evaluation.proposal),
        numbers: feedbackNumbers(evaluation),
        features: feedbackFeatures(evaluation.features),
        ...(basis ? { basis } : {}),
        ...(shown ? { shown } : {}),
      };
  if ("outcome" in change) {
    if (change.outcome === null) {
      // The version belongs to the sending: it goes with the outcome.
      delete next.outcome;
      delete next.version;
      delete next.versionKey;
      delete next.versionAccept;
      delete next.versionInputs;
    } else {
      next.outcome = { kind: change.outcome, at };
      const sent = change.sent;
      if (sent && (FEEDBACK_VERSIONS as readonly unknown[]).includes(sent.version)) {
        next.version = sent.version;
        if (isText(sent.key)) next.versionKey = sent.key;
        else delete next.versionKey;
        next.versionAccept = { pAccept: finite(sent.pAccept), pComplete: finite(sent.pComplete) };
        // The inputs belong to the version named now: an earlier version's never stay with this one. Their week is this
        // press's (the card on screen now), whatever week the record's own numbers are from; so is their prize split
        // (Checkpoint 7c, ⚠️ ours) when the card gives none: tradeView.ts writes the goal alone, and the press's basis comes
        // from the same search or evaluation as the card.
        const inputs = versionInputsOf(withPressPrizes(sent.inputs, basis));
        if (inputs) next.versionInputs = { ...inputs, week: basis?.week ?? inputs.week ?? null };
        else delete next.versionInputs;
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

/** One side of a trade as a record holds it (players and picks, each checked), or null when it isn't one. */
export function parseFeedbackAssets(x: unknown): TradeAsset[] | null {
  if (!Array.isArray(x)) return null;
  const out = x.map(parseAsset);
  return out.some((a) => a === null) ? null : (out as TradeAsset[]);
}

/**
 * A trade's key read back into a proposal (TradeEvaluation.key, evaluate.ts proposalKey: "<partner>|give:<ids>|get:<ids>",
 * each side's assets sorted, a pick as "pick:<season>:<round>:<original team>"; the test fixtures' "<partner>|<ids>|<ids>"
 * too), for naming a recorded version the card no longer shows (tradeView.ts CardFeedback.versionWords), its players in the
 * anonymous copy (feedbackShare.ts) and in the export (exportedVersionOf); null when it isn't one. Here since Checkpoint 7d
 * (tradeView.ts re-exports it).
 */
export function proposalFromKey(key: string | null | undefined): TradeProposal | null {
  if (typeof key !== "string") return null;
  const parts = key.split("|");
  if (parts.length !== 3) return null;
  const [partnerId = "", give = "", get = ""] = parts;
  if (!partnerId) return null;
  const side = (text: string, prefix: string): TradeAsset[] | null => {
    const list = text.startsWith(prefix) ? text.slice(prefix.length) : text;
    if (!list) return [];
    const out: TradeAsset[] = [];
    for (const id of list.split(",")) {
      if (!id) return null;
      const pick = /^pick:(\d+):(\d+):(.+)$/.exec(id);
      out.push(pick ? { kind: "pick", season: Number(pick[1]), round: Number(pick[2]), originalTeamId: pick[3] ?? "" } : { kind: "player", id });
    }
    return out;
  };
  const g = side(give, "give:");
  const r = side(get, "get:");
  return g && r && g.length + r.length > 0 ? { partnerId, give: g, get: r } : null;
}

/** A trade as a record holds it (the partner's team id, the players and picks each side), or null when it isn't one. */
export function parseFeedbackProposal(x: unknown): TradeProposal | null {
  if (!isRecordLike(x) || !isText(x.partnerId)) return null;
  const give = parseFeedbackAssets(x.give);
  const get = parseFeedbackAssets(x.get);
  return give && get ? { partnerId: x.partnerId, give, get } : null;
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
  const proposal = parseFeedbackProposal(x.proposal);
  const numbers = parseNumbers(x.numbers);
  if (!proposal || !numbers || !isRecordLike(x.features)) return null;
  // Phase 7a's basis; one that isn't readable is left out (the copies read the league data on screen instead).
  const basis = basisOf(x.basis);
  // Checkpoint 7d's printed numbers; ones that aren't in the card's printed forms are left out (the export works the three
  // numbers out instead).
  const shown = parseFeedbackShown(x.shown);
  const record: FeedbackRecord = {
    id: x.id,
    // Phase 7a's share id; one that isn't one is left out (the record's next press gives it a new one).
    ...(isShareId(x.rid) ? { rid: x.rid } : {}),
    savedAt: x.savedAt,
    leagueKey: x.leagueKey,
    tradeKey: x.tradeKey,
    proposal,
    numbers,
    features: feedbackFeatures(x.features),
    ...(basis ? { basis } : {}),
    ...(shown ? { shown } : {}),
  };
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
      const inputs = versionInputsOf(x.versionInputs);
      if (inputs) record.versionInputs = inputs;
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
 * Records from a list (the stored value, or an older export's `records`): malformed ones skipped, and of two records
 * for the same trade idea only the later one kept; the newest `cap` when given (none: every one, as an export of several
 * leagues holds; parseFeedbackExport reads files of versions 1 and 2 this way).
 */
export function parseFeedbackRecords(list: readonly unknown[], cap?: number): FeedbackRecord[] {
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
  return Array.isArray(data) ? parseFeedbackRecords(data, FEEDBACK_MAX_RECORDS) : [];
}

/**
 * parseFeedback for a list already parsed (the league store's IndexedDB rows hold arrays, not text): malformed records
 * skipped, one per trade idea, the newest FEEDBACK_MAX_RECORDS; [] for anything that isn't a list. Never throws.
 */
export function feedbackRecordsFrom(list: unknown): FeedbackRecord[] {
  return Array.isArray(list) ? parseFeedbackRecords(list, FEEDBACK_MAX_RECORDS) : [];
}

/** The latest time a record says it was pressed (made, outcome, report), in ms; 0 when none can be read. */
export function feedbackTouchedAt(record: FeedbackRecord): number {
  let latest = 0;
  for (const at of [record.savedAt, record.outcome?.at, record.report?.at]) {
    const ms = at ? Date.parse(at) : Number.NaN;
    if (Number.isFinite(ms) && ms > latest) latest = ms;
  }
  return latest;
}

/**
 * A stored list with more records added (the league store's migration: the localStorage list joins a league's list in
 * IndexedDB): one record per trade idea, the copy pressed later when both have it (the stored one on a tie), in its
 * place; the added records the list didn't hold go first, in their own order (they're older: the localStorage list
 * predates the league store); the newest FEEDBACK_MAX_RECORDS. Pure.
 */
export function mergeFeedbackRecords(stored: readonly FeedbackRecord[], added: readonly FeedbackRecord[]): FeedbackRecord[] {
  const ideaOf = (r: FeedbackRecord) => `${r.leagueKey}\u0000${r.tradeKey}`;
  const addedByIdea = new Map(added.map((r) => [ideaOf(r), r]));
  const storedIdeas = new Set(stored.map(ideaOf));
  const kept = stored.map((r) => {
    const other = addedByIdea.get(ideaOf(r));
    return other && feedbackTouchedAt(other) > feedbackTouchedAt(r) ? other : r;
  });
  const before: FeedbackRecord[] = [];
  const placed = new Set<string>();
  for (const r of added) {
    const idea = ideaOf(r);
    if (storedIdeas.has(idea) || placed.has(idea)) continue;
    placed.add(idea);
    before.push(addedByIdea.get(idea) ?? r); // a trade idea added twice: its later copy, at the first one's place
  }
  const out = [...before, ...kept];
  return out.length > FEEDBACK_MAX_RECORDS ? out.slice(out.length - FEEDBACK_MAX_RECORDS) : out;
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

/** What a failed "Delete saved feedback" says (nothing was deleted). */
export const FEEDBACK_DELETE_FAILED = "Your browser wouldn't let Offer Sheet delete the saved feedback (its storage is blocked for this site).";

/** Deletes every record (the Settings page's "Delete saved feedback"). */
export function clearFeedback(storage: StorageLike): SaveResult {
  try {
    storage.removeItem(FEEDBACK_STORAGE_KEY);
    return { ok: true };
  } catch {
    return { ok: false, message: FEEDBACK_DELETE_FAILED };
  }
}

// ---------------------------------------------------------------------------------------------
// Export
//
// The file the Settings page's "Export feedback" downloads (src/components/settings/useFeedback.ts downloadFeedback), and
// reading one back (`npm run feedback:summary`, scripts/feedback-summary.ts).
//
// Version 3 (Checkpoint 7d; planner reply to Checkpoint 7c, answer 1: "export only what the user saw and entered: the trade;
// the numbers on its card: Helps you, Helps them, the chance they accept, Overall and the odds lines; the outcome, the version
// sent and the notes. Leave out everything else the model used, so no value ratio can be worked back out. The anonymous server
// copies keep everything, as before."). Each record (FeedbackExportEntry), field by field:
//   league    the league as the file numbers it ("league-1", "league-2", … in the order the leagues first appear: the short
//             hash leads back to an ESPN league id by hashing every possible one, the header)
//   madeOn    the UTC day the record was made, its first press ("2026-10-01"; ⚠️ ours: when the user acted, to the day, as the
//             file's name gives its own day)
//   trade     the partner's team id and the players given and received, as the record holds them
//   shown     the card's numbers and lines as printed (FeedbackShown): Helps you, the chance they accept with its label (and the
//             chance it goes through when the league's review could veto it and that printed differently), Overall, my odds
//             lines and weekly line, and Helps them with their odds when the card showed the partner's line. ⚠️ Ours: a record
//             made before Checkpoint 7d kept none, so its three numbers are worked out from its own with the card's formatting
//             (src/lib/printed.ts printedScore, acceptText, throughText; the label, the engine's acceptanceLabel), which prints
//             exactly what its card did, and its lines are left out (they weren't kept): exportedShownOf
//   outcome   the latest outcome pressed, with its UTC day
//   version   with the outcome, the version sent: which one, its players (read from its key, FeedbackRecord.versionKey) and its
//             chance as its line showed it (from the estimate the record keeps for it, versionAccept, with the card's
//             formatting: the step's, Plan B's and the card's own lines print exactly that), and the chance it goes through
//             when that printed differently: exportedVersionOf
//   report    the report's reason, the note (the user's own words) and its UTC day
// Around them, what the file is (kind, version), how many records it holds and the UTC day it was exported (exportedAt: the
// day, as the file's name gives it; review of Checkpoint 7d, cards-export-1: until then its time to the millisecond, the one
// time of day in the file).
// Never: B, B₃, the raw P_accept or P_complete, g_mkt, the acceptance features, ΔPO, ΔCH or ΔPPW, the basis, the version's
// inputs, the share id, a trade key or a record id (made from the trade key and the first press's time to the millisecond, an
// id would give that time back). Every number in the file is one a card printed (whole scores, percents rounded as the card
// rounds them, the title odds to a tenth), and every printed text is checked against the card's forms at the card's own
// precision (parseFeedbackShown, isPrintedChance, isPrintedThrough: a chance in whole steps of 5%, never finer; review of
// Checkpoint 7d, cards-export-2), so no value ratio can be worked back out of it (feedbackStore.test.ts: two records whose
// model numbers differ but print the same export the same, byte for byte). The records in this browser keep everything, and
// so do the anonymous copies made from them (src/lib/feedbackShare.ts: unchanged). Versions 1 (Phase 4: every record as
// stored) and 2 (planner reply to Checkpoint 7b, Q5: the value ratios' own fields left out, though its raw P_accept and B gave
// them back) still read (parseFeedbackExport).

export const FEEDBACK_EXPORT_KIND = "offersheet-trade-feedback";

/**
 * The export file's format: 3 since Checkpoint 7d (what the user saw and entered: the section's header); 2 left out the value
 * ratios' fields (planner reply to Checkpoint 7b, Q5); 1 held every record as stored. parseFeedbackExport reads all three.
 */
export const FEEDBACK_EXPORT_VERSION = 3;

/** How the export names a league: "league-1", "league-2", … (numbers that mean something only inside the file). */
export const EXPORT_LEAGUE_PREFIX = "league-";

/** The version sent, as the export holds it (the section's header). */
export interface ExportedVersion {
  kind: FeedbackVersion;
  /** Its players, read from its key (FeedbackRecord.versionKey); absent when the record kept no key. */
  give?: TradeAsset[];
  get?: TradeAsset[];
  /** Its chance they accept as its line printed it ("35%", "<5%"); absent when the record kept no estimate for it. */
  chance?: string;
  /** The chance it goes through, when the league's review could veto it and that printed differently ("about 20%"). */
  through?: string;
}

/** One record as the export holds it (the section's header): what the user saw and entered, nothing else the model used. */
export interface FeedbackExportEntry {
  /** "league-1", … */
  league: string;
  /** The UTC day the record was made (its first press): "2026-10-01". */
  madeOn?: string;
  /** The partner's team id and the players given and received, as the record holds them. */
  trade: TradeProposal;
  /** The card's numbers and lines as printed. */
  shown: FeedbackShown;
  outcome?: { kind: FeedbackOutcome; on?: string };
  /** With the outcome: the version sent. */
  version?: ExportedVersion;
  report?: { reason: FeedbackReason; note?: string; on?: string };
}

/** The exported file: the records (FeedbackExportEntry) with what they are and the day they were exported. */
export interface FeedbackExport {
  kind: typeof FEEDBACK_EXPORT_KIND;
  version: typeof FEEDBACK_EXPORT_VERSION;
  /** The UTC day of the export, "2026-10-13", as the file's name gives it (feedbackExportFileName); never its time of day. */
  exportedAt: string;
  count: number;
  records: FeedbackExportEntry[];
}

/** A day as the export says it. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A league as the export names it. */
const EXPORT_LEAGUE = new RegExp(`^${EXPORT_LEAGUE_PREFIX}\\d{1,6}$`);

/** The UTC day of a press's time (ISO): "2026-10-01"; undefined when it isn't a time. */
export function dayOf(at: string | null | undefined): string | undefined {
  if (typeof at !== "string" || !at) return undefined;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : undefined;
}

/** No number at all: what a record that kept none of its card's numbers shows (the record's own checks never let one be). */
const NOTHING_PRINTED: FeedbackShown = { helps: "—", chance: "—", overall: "—" };

/**
 * What a record's card printed, as the export holds it (the section's header): the record's own `shown` (checked again), else,
 * for a record made before Checkpoint 7d, its three numbers worked out from its own with the card's formatting: Helps you and
 * Overall as printedScore prints them, the chance they accept as acceptText prints it with its label (acceptanceLabel, the
 * engine's own), the chance it goes through when that printed differently (throughText); no lines.
 */
export function exportedShownOf(r: Pick<FeedbackRecord, "shown" | "numbers">): FeedbackShown {
  const own = parseFeedbackShown(r.shown);
  if (own) return own;
  const n = r.numbers;
  const p = n.pAccept;
  const through = p !== null && n.pComplete !== null ? throughText(p, n.pComplete) : null;
  const worked = {
    helps: printedScore(n.tradeScore, n.b),
    chance: p !== null ? acceptText(p) : "—",
    ...(p !== null ? { label: acceptanceLabel(p) } : {}),
    ...(through ? { through } : {}),
    overall: printedScore(n.overall, n.b),
  };
  return parseFeedbackShown(worked) ?? NOTHING_PRINTED;
}

/**
 * The version sent, as the export holds it (the section's header), or undefined without an outcome or a version: which one,
 * its players read from its key, and its chance as its line printed it (acceptText, throughText on the estimate the record
 * keeps for it, FeedbackRecord.versionAccept), checked against the card's forms like the card's own (isPrintedChance,
 * isPrintedThrough: an estimate no card could print, above 100%, is left out, and the chance it goes through with it).
 */
export function exportedVersionOf(r: Pick<FeedbackRecord, "outcome" | "version" | "versionKey" | "versionAccept">): ExportedVersion | undefined {
  if (!r.outcome || !r.version) return undefined;
  const players = proposalFromKey(r.versionKey);
  const p = r.versionAccept?.pAccept ?? null;
  const c = r.versionAccept?.pComplete ?? null;
  const chance = p !== null ? acceptText(p) : null;
  const through = p !== null && c !== null ? throughText(p, c) : null;
  return {
    kind: r.version,
    ...(players ? { give: players.give.map(copyAsset), get: players.get.map(copyAsset) } : {}),
    ...(isPrintedChance(chance) ? { chance } : {}),
    ...(isPrintedChance(chance) && isPrintedThrough(through) ? { through } : {}),
  };
}

/** One record as the export holds it (the section's header), its league named `league`. Pure: the record isn't changed. */
export function feedbackExportEntryOf(r: FeedbackRecord, league: string): FeedbackExportEntry {
  const madeOn = dayOf(r.savedAt);
  const version = exportedVersionOf(r);
  const outcomeOn = dayOf(r.outcome?.at);
  const reportOn = dayOf(r.report?.at);
  const note = cleanNote(r.report?.note);
  return {
    league,
    ...(madeOn ? { madeOn } : {}),
    trade: copyProposal(r.proposal),
    shown: exportedShownOf(r),
    ...(r.outcome ? { outcome: { kind: r.outcome.kind, ...(outcomeOn ? { on: outcomeOn } : {}) } } : {}),
    ...(version ? { version } : {}),
    ...(r.report ? { report: { reason: r.report.reason, ...(note ? { note } : {}), ...(reportOn ? { on: reportOn } : {}) } } : {}),
  };
}

/** The records as the export holds them, each league numbered in the order it first appears (the section's header). */
function exportEntriesOf(records: readonly FeedbackRecord[]): FeedbackExportEntry[] {
  const leagues = new Map<string, string>();
  return records.map((r) => {
    let league = leagues.get(r.leagueKey);
    if (league === undefined) {
      league = `${EXPORT_LEAGUE_PREFIX}${leagues.size + 1}`;
      leagues.set(r.leagueKey, league);
    }
    return feedbackExportEntryOf(r, league);
  });
}

/**
 * The export (version 3: the section's header): the records as FeedbackExportEntry holds them, with what they are and the UTC
 * day of `exportedAt`, the export's time (the text as given when it isn't one). Pure: `records` isn't changed (the browser's
 * records, and the anonymous copies made from them, keep everything).
 */
export function feedbackExport(records: readonly FeedbackRecord[], exportedAt: string): FeedbackExport {
  const out = exportEntriesOf(records);
  return { kind: FEEDBACK_EXPORT_KIND, version: FEEDBACK_EXPORT_VERSION, exportedAt: dayOf(exportedAt) ?? exportedAt, count: out.length, records: out };
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

/** `{ [key]: day }` when `x` is a day as the export says it, else nothing. */
function dayFieldAs<K extends string>(key: K, x: unknown): Partial<Record<K, string>> {
  return typeof x === "string" && DAY.test(x) ? ({ [key]: x } as Partial<Record<K, string>>) : {};
}

/** A version-3 version, checked field by field; undefined when it isn't one. Its players come in pairs (both sides or neither). */
function parseExportedVersion(x: unknown): ExportedVersion | undefined {
  if (!isRecordLike(x) || !(FEEDBACK_VERSIONS as readonly unknown[]).includes(x.kind)) return undefined;
  const give = parseFeedbackAssets(x.give);
  const get = parseFeedbackAssets(x.get);
  return {
    kind: x.kind as FeedbackVersion,
    ...(give && get ? { give, get } : {}),
    ...(isPrintedChance(x.chance) ? { chance: x.chance } : {}),
    ...(isPrintedThrough(x.through) ? { through: x.through } : {}),
  };
}

/**
 * One record of a version-3 file, checked field by field (the section's header: the league's number, the days, the trade, the
 * card's printed numbers and lines, an outcome, version and report of the app's own kinds, a note cut as a record's is);
 * anything else in it is left out, and null when it isn't one (no league, trade or printed numbers, or neither an outcome nor
 * a report). A version comes with an outcome only.
 */
export function parseFeedbackExportEntry(x: unknown): FeedbackExportEntry | null {
  if (!isRecordLike(x) || typeof x.league !== "string" || !EXPORT_LEAGUE.test(x.league)) return null;
  const trade = parseFeedbackProposal(x.trade);
  const shown = parseFeedbackShown(x.shown);
  if (!trade || !shown) return null;
  const o = x.outcome;
  const outcome = isRecordLike(o) && (FEEDBACK_OUTCOMES as readonly unknown[]).includes(o.kind) ? { kind: o.kind as FeedbackOutcome, ...dayFieldAs("on", o.on) } : undefined;
  const r = x.report;
  const note = isRecordLike(r) && typeof r.note === "string" ? cleanNote(r.note) : undefined;
  const report = isRecordLike(r) && (FEEDBACK_REASONS as readonly unknown[]).includes(r.reason) ? { reason: r.reason as FeedbackReason, ...(note ? { note } : {}), ...dayFieldAs("on", r.on) } : undefined;
  if (!outcome && !report) return null;
  const version = outcome ? parseExportedVersion(x.version) : undefined;
  return {
    league: x.league,
    ...dayFieldAs("madeOn", x.madeOn),
    trade,
    shown,
    ...(outcome ? { outcome } : {}),
    ...(version ? { version } : {}),
    ...(report ? { report } : {}),
  };
}

/**
 * The records in an exported file as version 3 holds them (the section's header): a file of version 3, each record checked
 * (parseFeedbackExportEntry; one that isn't one is skipped); of version 1 or 2, or a bare list of records such as the stored
 * value, each record read (parseFeedbackRecords: one per trade idea) and turned into what version 3 holds, its leagues numbered
 * again in the order they appear; null when the text isn't JSON or holds none of these (a version this code doesn't know too).
 */
export function parseFeedbackExport(text: string): FeedbackExportEntry[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (Array.isArray(data)) return exportEntriesOf(parseFeedbackRecords(data));
  if (!isRecordLike(data) || !Array.isArray(data.records)) return null;
  if (data.version === FEEDBACK_EXPORT_VERSION) return data.records.flatMap((x) => parseFeedbackExportEntry(x) ?? []);
  if (data.version === undefined || data.version === 1 || data.version === 2) return exportEntriesOf(parseFeedbackRecords(data.records));
  return null;
}

