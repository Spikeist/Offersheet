/**
 * The anonymous feedback copy's shape (planner reply to Checkpoint 4c, Part B, B2; Checkpoint 7a, track FB), shared by
 * the browser that builds it (src/lib/feedbackShare.ts: what each field holds, and what never goes in) and the server that
 * checks and stores it (src/server/feedbackSink.ts FeedbackEventSchema, which src/server/feedbackSink.test.ts holds to
 * these types). Types and constants only: no zod here, so nothing of it reaches the pages' bundles (the production
 * Content-Security-Policy has no 'unsafe-eval'), and nothing of the engine but types, its config and settings.ts's goal lists.
 */
import { config } from "@/engine/config";
import type { LeagueSettings, Platform, Pos } from "@/engine/model";
import { GOALS, LEGACY_GOALS, type PrizeKey } from "@/engine/settings";
import type { FeedbackFeatures, FeedbackOutcome, FeedbackReason, FeedbackVersion, HelpsReason } from "./feedbackStore";

/** The event's version: bump it when a field changes meaning (readers keep the versions apart). */
export const FEEDBACK_EVENT_VERSION = 1;

/**
 * The goals a feedback record or copy may name (Checkpoint 7c): today's (settings.ts GOALS) and the ones an older version
 * recorded (LEGACY_GOALS: "balanced", "Top finishers too", whose numbers were weighed 0.35 / 0.65 on ΔPO and ΔCH). A record or
 * copy keeps the goal its numbers were computed under, so an old "balanced" one stays "balanced" (never migrated: its numbers
 * don't change), and the store, the server's schema and feedback:report all accept it.
 */
export const FEEDBACK_GOALS = [...GOALS, ...LEGACY_GOALS] as const;
export type FeedbackGoal = (typeof FEEDBACK_GOALS)[number];

/**
 * "Several prizes"' split as a record and a copy hold it (Checkpoint 7c; planner reply to Checkpoint 7b, §6: "the anonymous
 * copy holds only the shares, rounded to whole percents, never the amounts"; §3: "how your league splits its prizes (as
 * shares, never amounts)"): each prize's share of the season's prizes (src/engine/reward.ts PrizeShares, on settings.ts
 * PRIZE_KEYS: 1st, 2nd and 3rd place, every regular-season week's high score together, the most points in the regular
 * season) in whole percents adding up to exactly 100 (reward.ts prizePercents, by the largest remainder): Parker's $2,000 /
 * $1,600 / $900 are 44 / 36 / 20 / 0 / 0. Only with goal "prizes", the split its numbers were weighed by; never the amounts
 * typed (the Settings page keeps those in this browser only). feedbackStore.ts isFeedbackPrizes says which values are one.
 */
export type FeedbackPrizes = Readonly<Record<PrizeKey, number>>;

/** The kind of press a copy follows: the outcome buttons (Sent, Accepted, Rejected, Countered) or Report. */
export const FEEDBACK_EVENT_KINDS = ["outcome", "report"] as const;
export type FeedbackEventKind = (typeof FEEDBACK_EVENT_KINDS)[number];

/** At most this many players a side in a copy: the Trade Analyzer's maximum (no trade idea has more). */
export const FEEDBACK_EVENT_MAX_PER_SIDE = config.search.analyzerMaxPerSide;

/**
 * A player id a copy may carry (review FB-R4): the canonical ids the app makes today (CLAUDE.md §4) and nothing else, so a
 * buggy or hostile client can't store a league id, a username or a team name in their place. Sleeper's ids are digits
 * (2 to 5 of them today; up to 8 allowed) or, for a team defense, its NFL team code (2 or 3 capitals); a player no source
 * maps keeps his ESPN id, `espn:<id>` (negative for a team defense). A platform added later (Phase 5: `mfl:…`,
 * `fleaflicker:…`) widens this; until then its copies aren't sent (feedbackShare.ts), and the server refuses them
 * (src/server/feedbackSink.ts). A league id made of digits still fits, as a Sleeper id would: the server can't prove an id
 * is a player's, only that it has a player id's form.
 */
export const FEEDBACK_PLAYER_ID = /^(?:\d{1,8}|[A-Z]{2,3}|espn:-?\d{1,12})$/;

/** The league's format as a copy holds it (feedbackShare.ts feedbackFormatOf). */
export interface FeedbackEventFormat {
  numTeams: number;
  leagueType: LeagueSettings["leagueType"];
  /** A WR's points per catch. */
  ppr: number;
  /** A QB's points per passing touchdown. */
  passTd: number;
  /** A TE's points per catch above a WR's; 0 without a premium. */
  tep: number;
  /** It starts a second QB (FantasyCalc's numQbs 2). */
  superflex: boolean;
  /** Starting slots by the positions they take ("QB", "RB/WR/TE"), each with how many. */
  slots: Record<string, number>;
  playoffTeams: number;
}

/** A player in a copy's trade: his canonical id and position (null when the league data doesn't know him). */
export interface FeedbackEventPlayer {
  id: string;
  pos: Pos | null;
}

/** The card's numbers as a copy holds them (feedbackShare.ts's header). */
export interface FeedbackEventNumbers {
  helps: number | null;
  chance: number | null;
  overall: number | null;
  b: number | null;
  b3: number | null;
  pAccept: number | null;
  pComplete: number | null;
  dPO: number | null;
  dCH: number | null;
  dPPW: number | null;
  gMine: number | null;
  gPartner: number | null;
}

/** §11's acceptance features as a copy holds them. */
export type FeedbackEventFeatures = FeedbackFeatures;

/**
 * The sent version's model inputs as a copy holds them (feedbackStore.ts VersionInputs, every field present; `week`: the
 * NFL week of the league data they came from, null when unknown). Checkpoint 7c: `prizes`, the prize split B was weighed by,
 * present exactly when the goal is "prizes" (a copy from an older version has none: it never names that goal).
 */
export interface FeedbackEventVersionInputs {
  features: FeedbackEventFeatures | null;
  gPartner: number | null;
  b: number | null;
  b3: number | null;
  helpsReason: HelpsReason | null;
  goal: FeedbackGoal | null;
  prizes?: FeedbackPrizes;
  week: number | null;
}

/** A trade's players as a copy holds them: each side's canonical ids with positions. */
export interface FeedbackEventTrade {
  give: FeedbackEventPlayer[];
  get: FeedbackEventPlayer[];
}

/** One anonymous copy (feedbackShare.ts's header says what each field holds). */
export interface FeedbackEvent {
  v: typeof FEEDBACK_EVENT_VERSION;
  rid: string;
  kind: FeedbackEventKind;
  outcome?: FeedbackOutcome;
  reason?: FeedbackReason;
  version?: FeedbackVersion;
  platform: Platform;
  season: number;
  week: number;
  format: FeedbackEventFormat;
  goal: FeedbackGoal | null;
  /** Checkpoint 7c: the prize split the numbers were weighed by (FeedbackPrizes), exactly when the goal is "prizes". */
  prizes?: FeedbackPrizes;
  trade: FeedbackEventTrade;
  numbers: FeedbackEventNumbers;
  features: FeedbackEventFeatures;
  /** The sent version's players when they aren't the card's (review FB-R7: a first offer, a throw-in added, a Plan B). */
  versionTrade?: FeedbackEventTrade;
  /** The sent version's estimate as its line on the card showed it (feedbackStore.ts FeedbackRecord.versionAccept). */
  versionAccept?: { pAccept: number | null; pComplete: number | null };
  versionInputs?: FeedbackEventVersionInputs;
}

/** A copy as the store keeps it: the event and the UTC day it arrived ("2026-10-04"), nothing else. */
export type StoredFeedbackEvent = FeedbackEvent & { day: string };
