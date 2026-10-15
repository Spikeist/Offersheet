/**
 * Anonymous feedback, the browser's half (planner reply to Checkpoint 4c, Part B, B2: "Store anonymized reports and
 * outcomes: player IDs and positions, league format, model inputs and scores, the reason and the outcome. Never store
 * league IDs, team or owner names, usernames, SWIDs or cookies. Add an opt-out toggle and rate limits."; planner reply to
 * Checkpoint 0, decision B; Checkpoint 7a, track FB). The server's half: src/app/api/feedback (the route: same-origin,
 * rate-limited, a strict schema) and src/server/feedbackSink.ts (the schema and the store).
 *
 * A press (src/components/settings/useFeedback.ts saveFeedbackPress) is saved in this browser first, as before
 * (src/lib/feedbackStore.ts, through the league store). Once the browser has kept it, and while "Share anonymous feedback"
 * is on (the Settings page; on by default, saved per browser in localStorage, FEEDBACK_SHARE_KEY, for every league), the
 * record as it now stands becomes one event (feedbackEventOf) that the sender (FeedbackSender) posts to /api/feedback
 * FEEDBACK_SHARE_DEBOUNCE_MS (2 s) later: debounced per record, so Sent then Accepted a moment later sends one copy; posted
 * once (keepalive, so it survives the page closing), never retried, failures silent. A copy still waiting goes at once
 * when the page is hidden or closed, and is dropped when sharing is turned off before it leaves, or when the press that
 * made its record is undone before it leaves (nothing reached the server, so there's nothing to take back). A press that
 * queues a copy shows a one-time note on the card until the first copy this browser sends has left (shareNoteDue,
 * markShareNoted; SHARE_NOTE_TEXT), so a press undone at once never uses it up.
 *
 * The event (FeedbackEvent, v 1), field by field: what the privacy page's "Anonymous feedback" lists in words, some fields
 * summarized with "such as" (src/app/privacy/PrivacyPolicy.tsx; review POL-9), each copy the whole record as it stands (a
 * later copy with the same rid replaces the earlier one when the copies are read: scripts/feedback-report.ts):
 *   rid            the record's share id (feedbackStore.ts FeedbackRecord.rid): random, made in this browser, kept with the
 *                  record so a later press on it (Accepted after Sent) can be matched to the earlier copy
 *   kind           which buttons the press was ("outcome": Sent, Accepted, Rejected, Countered; "report": Report)
 *   outcome        the record's outcome now; absent when it has none (never pressed, or cleared)
 *   reason         the record's report reason now; absent when none. Never the note: notes stay in this browser.
 *   version        which version of the idea was sent, with an outcome only: since Checkpoint 7e a step's place in "How to
 *                  offer it" (open, then, suggested, last) or planB; an older card's offerFirst or full (feedbackStore.ts
 *                  FEEDBACK_VERSIONS, which the server's schema reads: an older browser's copies still pass)
 *   platform, season, week   ESPN or Sleeper; the season and NFL week the numbers were computed for (the record's basis,
 *                  review FB-R6: an outcome pressed a week later still says the week of the numbers it carries; a record
 *                  made before has none, and the league data on screen stands in)
 *   format         numTeams; leagueType; ppr (a WR's points per catch, market.receptionRate); passTd (a QB's points per
 *                  passing TD); tep (a TE's points per catch above a WR's, 0 without a premium); superflex (it starts a
 *                  second QB: FantasyCalc's numQbs 2, market.fantasyCalcFormat); slots (the starting slots by the positions
 *                  they take, "QB", "RB/WR/TE", "QB/RB/WR/TE", each with how many: the same key for ESPN's OP and Sleeper's
 *                  SUPER_FLEX); playoffTeams. ⚠️ The league's settings at the press (they rarely change mid-season).
 *   goal           "What does your league reward?" the numbers were computed under (the record's basis; for a record made
 *                  before, the sent version's, else the cards' on screen); an older version's "balanced" as recorded
 *   prizes         Checkpoint 7c (planner reply to Checkpoint 7b, §6: "only the shares, rounded to whole percents, never the
 *                  amounts"): with goal "prizes" only, the prize split those numbers were weighed by, each prize's whole
 *                  percent of the season's prizes (feedbackEvent.ts FeedbackPrizes; reward.ts prizePercents), from the same
 *                  source as the goal (never one's goal with another's split: feedbackEventOf). "Several prizes" whose
 *                  split can't be read sends goal null (⚠️ ours: what it weighed is unknown), so every copy built here
 *                  passes the server's rule (a split exactly with that goal)
 *   trade          the card's players given and received: canonical ids (feedbackEvent.ts FEEDBACK_PLAYER_ID: Sleeper's,
 *                  else "espn:<id>") with positions, at most config.search.analyzerMaxPerSide a side; never the partner's
 *                  team id
 *   numbers        the card's numbers when the record was made: helps (Helps you), chance (Chance they accept as the card
 *                  printed it, a whole percent, 0 for "<5%"), overall, b, b3 (the scale they were scored on, Phase 7a A2),
 *                  pAccept, pComplete, dPO, dCH, dPPW, gMine, gPartner
 *   features       §11's acceptance features as the card's estimate used them (g, n, h, c, a, hist, ctx, hot, urg, z)
 *   versionTrade   the sent version's players, the same way, when they aren't the card's (review FB-R7: an offer of "How to
 *                  offer it" other than the suggested trade, a Plan B; on an older card a first offer or a throw-in added;
 *                  read from its key, FeedbackRecord.versionKey), with a version only
 *   versionAccept  the sent version's estimate as its line on the card showed it (pAccept, pComplete), with a version only
 *   versionInputs  the sent version's model inputs (feedbackStore.ts VersionInputs: B₃, the scale's reason and the week
 *                  of the league data they came from included; Checkpoint 7c, its goal with its prize split, as `goal` and
 *                  `prizes` above), with a version only
 *   As in the record: trade, numbers and features are the card's (the trade idea the record is for), and the version sent
 *   (an offer of "How to offer it", the suggested trade or "If they won't move: try …") is told by version, versionTrade,
 *   versionAccept and versionInputs.
 * Never: league ids, team ids, team or owner names, usernames, SWIDs, cookies, the league's short hash (leagueKey), the
 * local record id (made from it), when a button was pressed (the server adds only the UTC day a copy arrived) or notes.
 * Numbers are rounded to 6 significant digits. A trade (the card's or the version sent) with a draft pick (not part of
 * trade ideas yet: Phase 5), more players a side than the Analyzer allows, or a player id of another form (a platform
 * added later) sends nothing (a later event version will carry picks).
 *
 * zod stays out of this module (and so out of the pages' bundles: the production Content-Security-Policy has no
 * 'unsafe-eval', and zod's fast path tries eval): the server checks every event against its own strict schema
 * (src/server/feedbackSink.ts FeedbackEventSchema), and src/server/feedbackSink.test.ts checks that schema and these types
 * agree, and that every event built here passes it.
 *
 * Pure but for the parts marked as the browser's (feedbackSender, the localStorage default, newShareId's randomness);
 * tested in feedbackShare.test.ts with injected storage, timers and posts.
 */
import { displayAcceptance } from "@/engine/acceptance";
import { config } from "@/engine/config";
import { fantasyCalcFormat, receptionRate } from "@/engine/market";
import { POSITIONS, type LeagueSettings, type LeagueSnapshot, type Platform, type Pos } from "@/engine/model";
import { prizePercents, type Reward } from "@/engine/reward";
import { rateFor } from "@/engine/scoring";
import type { Goal } from "@/engine/settings";
import type { TradeAsset, TradeProposal } from "@/engine/tradeModel";
import {
  FEEDBACK_EVENT_MAX_PER_SIDE,
  FEEDBACK_EVENT_VERSION,
  FEEDBACK_PLAYER_ID,
  type FeedbackEvent,
  type FeedbackEventFeatures,
  type FeedbackEventFormat,
  type FeedbackEventKind,
  type FeedbackEventPlayer,
  type FeedbackEventTrade,
  type FeedbackEventVersionInputs,
  type FeedbackPrizes,
} from "./feedbackEvent";
import { isFeedbackPrizes, isFeedbackWeek, isShareId, recordReward, type FeedbackBasis, type FeedbackChange, type FeedbackFeatures, type FeedbackRecord, type VersionInputs } from "./feedbackStore";
import type { SaveResult, StorageLike } from "./importStore";
import { proposalFromKey } from "./tradeView";

export type { FeedbackEvent, FeedbackEventFormat, FeedbackEventKind, FeedbackEventPlayer } from "./feedbackEvent";

/** Where the copies go (src/app/api/feedback/route.ts). */
export const FEEDBACK_ENDPOINT = "/api/feedback";

/** A record's copy waits this long for another press on it before it's sent (the header). */
export const FEEDBACK_SHARE_DEBOUNCE_MS = 2_000;

/** What a copy reads of the league besides the record, built once per league data and reward (feedbackShareContext). */
export interface FeedbackShareContext {
  platform: Platform;
  season: number;
  week: number;
  format: FeedbackEventFormat;
  /** The league's players by canonical id (LeagueSnapshot.players), for positions. */
  players: Readonly<Record<string, { pos: Pos } | undefined>>;
  /** "What does your league reward?" as the cards on screen were computed (the Finder's search, the Analyzer's evaluation), or null. */
  goal: Goal | null;
  /**
   * Checkpoint 7c: the prize split those cards were weighed by, whole percents (feedbackEvent.ts FeedbackPrizes), when the
   * goal is "prizes"; null otherwise (feedbackRewardOf).
   */
  prizes: FeedbackPrizes | null;
}

/**
 * What the cards on screen were weighed by, as a page has it (feedbackShareContext): the engine's reward (Checkpoint 7c:
 * TradeSearchResult.reward, TradeAnalysis.reward, the goal with the prize shares every B read), else a goal alone (a result
 * that carries no reward: fakes, tests), or null (nothing shown yet).
 */
export type FeedbackRewardSource = Pick<Reward, "goal" | "shares"> | Goal | null;

/**
 * A page's reward as a copy reads it (FeedbackRewardSource): its goal and, under "Several prizes", its shares as whole
 * percents (reward.ts prizePercents: Parker's 4/9, 16/45 and 1/5 read 44 / 36 / 20 / 0 / 0; "Several prizes" with nothing
 * entered, which weighs 1st place as everything, reads 100 / 0 / 0 / 0 / 0, what its numbers were weighed by). "Several
 * prizes" without its shares (a goal alone), or shares that don't make a split (isFeedbackPrizes), read as an unknown goal
 * (⚠️ ours, as the record's rule: feedbackStore.ts recordReward). Never the amounts typed: they aren't in a reward.
 */
export function feedbackRewardOf(source: FeedbackRewardSource): { goal: Goal | null; prizes: FeedbackPrizes | null } {
  if (source === null) return { goal: null, prizes: null };
  if (typeof source === "string") return { goal: source === "prizes" ? null : source, prizes: null };
  if (source.goal !== "prizes") return { goal: source.goal, prizes: null };
  const prizes = prizePercents(source.shares);
  return isFeedbackPrizes(prizes) ? { goal: "prizes", prizes } : { goal: null, prizes: null };
}

/**
 * What a trade page's cards were weighed by (FeedbackRewardSource; review FB-R3): the engine's own reward on the result shown
 * (the Trade Finder's search, TradeSearchResult.reward; the Analyzer's evaluation, TradeAnalysis.reward), else the goal the
 * page ran it under (both rewards are optional: a result without one), else null (nothing shown yet). Both trade pages build
 * their copies' context from it (feedbackShareContext), never from the settings' goal: under "Several prizes" a goal alone
 * reads as an unknown goal (feedbackRewardOf), so every record and copy made under it would lose its goal and its split
 * (feedbackShare.test.ts checks both pages call it).
 */
export function shownRewardOf(result: { readonly reward?: Pick<Reward, "goal" | "shares"> } | null | undefined, goal: Goal | null | undefined): FeedbackRewardSource {
  return result?.reward ?? goal ?? null;
}

/** A number as a copy holds it: 6 significant digits, null when it isn't finite. */
export function sig(x: number | null | undefined): number | null {
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  const r = Number(x.toPrecision(6));
  return Object.is(r, -0) ? 0 : r;
}

/** A starting slot's key: the positions it takes in POSITIONS order joined by "/" ("RB/WR/TE"); null for none. */
export function slotKey(eligible: readonly Pos[]): string | null {
  const set = new Set(eligible);
  const parts = POSITIONS.filter((p) => set.has(p));
  return parts.length ? parts.join("/") : null;
}

/** The league's format as a copy holds it (the header). */
export function feedbackFormatOf(settings: LeagueSettings): FeedbackEventFormat {
  const slots: Record<string, number> = {};
  for (const s of settings.lineup) {
    const key = slotKey(s.eligible);
    if (!key || !(s.count > 0)) continue;
    slots[key] = (slots[key] ?? 0) + Math.round(s.count);
  }
  const wr = receptionRate(settings.scoring, "WR");
  const premium = receptionRate(settings.scoring, "TE") - wr;
  return {
    numTeams: settings.numTeams,
    leagueType: settings.leagueType,
    ppr: sig(wr) ?? 0,
    passTd: sig(rateFor(settings.scoring, "pass_td", "QB")) ?? 0,
    tep: premium > 1e-9 ? (sig(premium) ?? 0) : 0,
    superflex: fantasyCalcFormat(settings).numQbs === 2,
    slots,
    playoffTeams: settings.playoffTeams,
  };
}

/**
 * What a copy reads of the league (FeedbackShareContext) from the league data on screen and what its cards were weighed by
 * (feedbackRewardOf: Checkpoint 7c, the engine's reward with its prize shares; a goal alone still reads).
 */
export function feedbackShareContext(snapshot: Pick<LeagueSnapshot, "platform" | "season" | "currentWeek" | "settings" | "players">, reward: FeedbackRewardSource): FeedbackShareContext {
  const { goal, prizes } = feedbackRewardOf(reward);
  return { platform: snapshot.platform, season: snapshot.season, week: snapshot.currentWeek, format: feedbackFormatOf(snapshot.settings), players: snapshot.players, goal, prizes };
}

/**
 * What a press's numbers were computed from (feedbackStore.ts FeedbackBasis, review FB-R6): the season and week of the
 * league data on screen and the goal its cards were computed with, with (Checkpoint 7c) its prize split under "Several
 * prizes". A press passes it (FeedbackChange.basis); a new record keeps it with its numbers.
 */
export function feedbackBasisOf(context: Pick<FeedbackShareContext, "season" | "week" | "goal"> & Partial<Pick<FeedbackShareContext, "prizes">>): FeedbackBasis {
  return { season: context.season, week: context.week, ...recordReward(context.goal, context.prizes) };
}

/**
 * One side of a trade as a copy holds it, or null when it can't be sent: a draft pick, too many players, or an id that
 * isn't a player id's form (FEEDBACK_PLAYER_ID: a platform added later, until it's widened; review FB-R4).
 */
function playersOf(assets: readonly TradeAsset[], ctx: FeedbackShareContext): FeedbackEventPlayer[] | null {
  if (assets.length > FEEDBACK_EVENT_MAX_PER_SIDE) return null;
  const out: FeedbackEventPlayer[] = [];
  for (const a of assets) {
    if (a.kind !== "player" || !FEEDBACK_PLAYER_ID.test(a.id)) return null;
    out.push({ id: a.id, pos: ctx.players[a.id]?.pos ?? null });
  }
  return out;
}

/** A trade's players as a copy holds them, or null when either side can't be sent (playersOf). */
function tradeOf(proposal: Pick<TradeProposal, "give" | "get">, ctx: FeedbackShareContext): FeedbackEventTrade | null {
  const give = playersOf(proposal.give, ctx);
  const get = playersOf(proposal.get, ctx);
  return give && get ? { give, get } : null;
}

/** "Chance they accept" as the card printed it (tradeView.ts acceptText): a whole percent, 0 for "<5%"; null without one. */
export function printedChance(pAccept: number | null): number | null {
  if (pAccept === null || !Number.isFinite(pAccept)) return null;
  if (pAccept < config.acceptance.displayStep - 1e-9) return 0;
  return Math.round(displayAcceptance(pAccept) * 100);
}

function featuresOf(f: FeedbackFeatures): FeedbackEventFeatures {
  return { g: sig(f.g), n: sig(f.n), h: sig(f.h), c: sig(f.c), a: sig(f.a), hist: sig(f.hist), ctx: sig(f.ctx), hot: sig(f.hot), urg: sig(f.urg), z: sig(f.z) };
}

function versionInputsOf(v: VersionInputs): FeedbackEventVersionInputs {
  // The goal with its prize split, as the record keeps them (Checkpoint 7c: "Several prizes" only with a split).
  const { goal, prizes } = recordReward(v.goal, v.prizes);
  return {
    features: v.features ? featuresOf(v.features) : null,
    gPartner: sig(v.gPartner),
    b: sig(v.b),
    b3: sig(v.b3),
    helpsReason: v.helpsReason ?? null,
    goal,
    ...(prizes ? { prizes } : {}),
    week: isFeedbackWeek(v.week) ? v.week : null,
  };
}

/**
 * The anonymous copy of a record (the header): the record as it stands after a press of `kind`, or, `removed` (the press
 * left it with neither an outcome nor a report, so the league store dropped it), the record as it was, with no outcome,
 * reason or version: the copy that takes back the earlier ones. Null when the record has no share id, or its trade or the
 * sent version's can't be sent (a draft pick, more than config.search.analyzerMaxPerSide players a side, or an id of
 * another form: playersOf). Pure.
 */
export function feedbackEventOf(args: { record: FeedbackRecord; kind: FeedbackEventKind; removed?: boolean; context: FeedbackShareContext }): FeedbackEvent | null {
  const { record, context } = args;
  if (!isShareId(record.rid)) return null;
  const trade = tradeOf(record.proposal, context);
  if (!trade) return null;
  const outcome = args.removed ? undefined : record.outcome?.kind;
  const reason = args.removed ? undefined : record.report?.reason;
  const version = outcome ? record.version : undefined;
  const inputs = version ? record.versionInputs : undefined;
  const accept = version ? record.versionAccept : undefined;
  // The sent version's own players when they aren't the card's (review FB-R7). A version whose players can't be sent sends
  // nothing at all, like the card's own trade: without them the copy would read as if the card's trade had been sent.
  let versionTrade: FeedbackEventTrade | null = null;
  if (version && record.versionKey && record.versionKey !== record.tradeKey) {
    const proposal = proposalFromKey(record.versionKey);
    versionTrade = proposal ? tradeOf(proposal, context) : null;
    if (!versionTrade) return null;
  }
  const basis = record.basis;
  const n = record.numbers;
  // The goal and prize split the record's numbers were weighed by, from one source, never one's goal with another's split
  // (Checkpoint 7c): its basis; a record made before has none: the sent version's when it names a goal, else the cards' on
  // screen. "Several prizes" without a readable split reads as an unknown goal (recordReward).
  const weighed = basis ?? (record.versionInputs && record.versionInputs.goal !== null ? record.versionInputs : context);
  const { goal, prizes } = recordReward(weighed.goal, weighed.prizes);
  return {
    v: FEEDBACK_EVENT_VERSION,
    rid: record.rid,
    kind: args.kind,
    ...(outcome ? { outcome } : {}),
    ...(reason ? { reason } : {}),
    ...(version ? { version } : {}),
    platform: context.platform,
    // The season and week the record's numbers were computed for (its basis); a record made before has none: the league
    // data on screen.
    season: basis?.season ?? context.season,
    week: basis?.week ?? context.week,
    format: context.format,
    goal,
    ...(prizes ? { prizes } : {}),
    trade,
    numbers: {
      helps: sig(n.tradeScore),
      chance: printedChance(n.pAccept),
      overall: sig(n.overall),
      b: sig(n.b),
      b3: sig(n.b3),
      pAccept: sig(n.pAccept),
      pComplete: sig(n.pComplete),
      dPO: sig(n.dPO),
      dCH: sig(n.dCH),
      dPPW: sig(n.dPPW),
      gMine: sig(n.gMine),
      gPartner: sig(n.gPartner),
    },
    features: featuresOf(record.features),
    ...(versionTrade ? { versionTrade } : {}),
    ...(accept ? { versionAccept: { pAccept: sig(accept.pAccept), pComplete: sig(accept.pComplete) } } : {}),
    ...(inputs ? { versionInputs: versionInputsOf(inputs) } : {}),
  };
}

/**
 * A new share id (FeedbackRecord.rid): 16 random bytes in base64url (22 characters), from the browser's random source
 * (crypto.getRandomValues; `fill` for tests). Derived from nothing.
 */
export function newShareId(fill: (bytes: Uint8Array) => Uint8Array = (bytes) => globalThis.crypto.getRandomValues(bytes)): string {
  const bytes = fill(new Uint8Array(16));
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------------------------
// "Share anonymous feedback" (the Settings page), and the one-time note

/** localStorage: { on, noted } for this browser, every league (the header). */
export const FEEDBACK_SHARE_KEY = "offersheet:feedback-share:v1";

export interface SharePrefs {
  /** "Share anonymous feedback": on by default. */
  on: boolean;
  /** The one-time note has shown (markShareNoted). */
  noted: boolean;
}

export const DEFAULT_SHARE_PREFS: Readonly<SharePrefs> = Object.freeze({ on: true, noted: false });

/** What the Settings page says when the browser won't keep the choice (it lasts for this page only). */
export const SHARE_SAVE_FAILED = "Your browser wouldn't let Offer Sheet save this choice (its storage is blocked for this site), so it lasts only until you close or reload this page.";

/** The one-time note on a press that sends a copy, before its link to Settings (FeedbackControls; shareNoteDue). */
export const SHARE_NOTE_LEAD = "Sent anonymously to help improve Offer Sheet. You can turn this off in";

/** The note in full ("… in Settings."). */
export const SHARE_NOTE_TEXT = `${SHARE_NOTE_LEAD} Settings.`;

/** The stored prefs; the defaults for anything missing or unreadable. Never throws. */
export function parseSharePrefs(raw: string | null | undefined): SharePrefs {
  if (!raw) return { ...DEFAULT_SHARE_PREFS };
  try {
    const x: unknown = JSON.parse(raw);
    if (!x || typeof x !== "object" || Array.isArray(x)) return { ...DEFAULT_SHARE_PREFS };
    const o = x as Record<string, unknown>;
    return { on: typeof o.on === "boolean" ? o.on : DEFAULT_SHARE_PREFS.on, noted: o.noted === true };
  } catch {
    return { ...DEFAULT_SHARE_PREFS };
  }
}

/** This browser's localStorage, or null (the server, or storage blocked). The browser's part. */
function browserLocal(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The choice this page made when its storage refused to keep it (it holds until the page closes). */
let memoryPrefs: SharePrefs | null = null;
/** A copy has left this page (markShareNoted): the one-time note is done, even when storage can't remember it. */
let notedThisPage = false;

/** The prefs now: this page's own choice when storage refused it, else the stored ones, else the defaults. Never throws. */
export function readSharePrefs(storage: StorageLike | null = browserLocal()): SharePrefs {
  if (memoryPrefs) return { ...memoryPrefs };
  try {
    return parseSharePrefs(storage?.getItem(FEEDBACK_SHARE_KEY));
  } catch {
    return { ...DEFAULT_SHARE_PREFS };
  }
}

/** Saves the prefs; false (and the choice held in this page's memory) when storage refuses. Never throws. */
function writeSharePrefs(prefs: SharePrefs, storage: StorageLike | null): boolean {
  try {
    if (!storage) throw new Error("no storage");
    storage.setItem(FEEDBACK_SHARE_KEY, JSON.stringify(prefs));
    memoryPrefs = null;
    return true;
  } catch {
    memoryPrefs = { ...prefs };
    return false;
  }
}

/** Whether "Share anonymous feedback" is on in this browser (on unless turned off). */
export function sharingOn(storage: StorageLike | null = browserLocal()): boolean {
  return readSharePrefs(storage).on;
}

const listeners = new Set<() => void>();

/**
 * useSyncExternalStore's subscribe for the setting (src/components/settings/useFeedback.ts useFeedbackSharing): this page's
 * changes, and another tab's through the storage event.
 */
export function subscribeSharePrefs(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === FEEDBACK_SHARE_KEY) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/**
 * Turns "Share anonymous feedback" on or off for this browser (the Settings page). Off drops the copies still waiting
 * (the header). When storage refuses, the choice holds for this page and the result says why.
 */
export function setSharing(on: boolean, storage: StorageLike | null = browserLocal()): SaveResult {
  const saved = writeSharePrefs({ ...readSharePrefs(storage), on }, storage);
  if (!on) startedSender?.cancelAll();
  for (const l of [...listeners]) l();
  return saved ? { ok: true } : { ok: false, message: SHARE_SAVE_FAILED };
}

/**
 * Whether a press whose copy is on its way shows the one-time note (the header): until the first copy this browser sends
 * has left (markShareNoted), so a press undone before its copy left, or a copy dropped when sharing is turned off, doesn't
 * use it up (review FB-R1: an undone double-click showed the note for a moment and never again). Two presses before the
 * first copy leaves both show it. Never throws.
 */
export function shareNoteDue(storage: StorageLike | null = browserLocal()): boolean {
  return !notedThisPage && !readSharePrefs(storage).noted;
}

/**
 * A copy has left this browser (the sender, FeedbackSenderDeps.onSent): the one-time note won't show again (remembered in
 * this browser; for this page when storage can't remember it). Never throws.
 */
export function markShareNoted(storage: StorageLike | null = browserLocal()): void {
  if (notedThisPage) return;
  notedThisPage = true;
  writeSharePrefsQuietly({ ...readSharePrefs(storage), noted: true }, storage);
}

/** Saves the note's flag without holding it in memory as a choice (a refused write leaves the setting as it was). */
function writeSharePrefsQuietly(prefs: SharePrefs, storage: StorageLike | null): void {
  if (memoryPrefs) {
    memoryPrefs = { ...memoryPrefs, noted: prefs.noted };
    return;
  }
  try {
    storage?.setItem(FEEDBACK_SHARE_KEY, JSON.stringify(prefs));
  } catch {
    // The page's own flag (notedThisPage) keeps the note from showing again on this page.
  }
}

/** Test hook: forget this page's in-memory choice and note flag. */
export function resetSharePrefsForTests(): void {
  memoryPrefs = null;
  notedThisPage = false;
}

// ---------------------------------------------------------------------------------------------
// Sending

/** What the sender needs from the browser (tests pass their own). */
export interface FeedbackSenderDeps {
  /** Posts one copy's JSON (once; whatever happens to it is ignored). */
  post(body: string): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
  /** Whether sharing is on now (read again when a copy leaves). */
  sharing(): boolean;
  /** After a copy has left (the browser's: markShareNoted, so the one-time note is done). */
  onSent?(): void;
}

interface Waiting {
  event: FeedbackEvent;
  timer: unknown;
  /** The record was made by a press since its last copy left (or ever): taking it back needs no copy. */
  fresh: boolean;
}

/** Copies waiting to leave, one per record (the header). */
export class FeedbackSender {
  private readonly waiting = new Map<string, Waiting>();
  /** Records a copy has left for on this page. */
  private readonly sent = new Set<string>();

  constructor(
    private readonly deps: FeedbackSenderDeps,
    private readonly debounceMs: number = FEEDBACK_SHARE_DEBOUNCE_MS,
  ) {}

  /**
   * Queues a record's copy, replacing the one waiting for it (the debounce restarts). `created`: the press made the
   * record. A copy that takes a record back (no outcome, no reason) while the copy of the press that made it is still
   * waiting cancels both (nothing left). True when a copy is waiting.
   */
  queue(event: FeedbackEvent, created: boolean): boolean {
    const prev = this.waiting.get(event.rid);
    if (prev) this.deps.clearTimer(prev.timer);
    const fresh = prev ? prev.fresh : created && !this.sent.has(event.rid);
    if (fresh && !event.outcome && !event.reason) {
      this.waiting.delete(event.rid);
      return false;
    }
    const timer = this.deps.setTimer(() => this.send(event.rid), this.debounceMs);
    this.waiting.set(event.rid, { event, timer, fresh });
    return true;
  }

  private send(rid: string): void {
    const w = this.waiting.get(rid);
    if (!w) return;
    this.waiting.delete(rid);
    if (!this.deps.sharing()) return;
    this.sent.add(rid);
    try {
      this.deps.post(JSON.stringify(w.event));
    } catch {
      // Failures are silent: the press is saved in this browser either way.
    }
    try {
      this.deps.onSent?.();
    } catch {
      // The note's flag only: never in the way of sending.
    }
  }

  /** Sends every waiting copy now (the page is being hidden or closed). */
  flush(): void {
    for (const [rid, w] of [...this.waiting]) {
      this.deps.clearTimer(w.timer);
      this.send(rid);
    }
  }

  /** Drops every waiting copy (sharing turned off). */
  cancelAll(): void {
    for (const w of this.waiting.values()) this.deps.clearTimer(w.timer);
    this.waiting.clear();
  }

  /** How many copies are waiting (tests). */
  get pending(): number {
    return this.waiting.size;
  }
}

/** The page's sender once made (setSharing drops its waiting copies). */
let startedSender: FeedbackSender | null = null;

/**
 * The browser's sender, one per page (null on the server): posts with fetch (same origin, JSON, keepalive so a copy
 * outlives the page, no cache), and sends whatever waits when the page is hidden or closed; the first copy that leaves
 * ends the one-time note (markShareNoted). The browser's part.
 * Credentials stay "same-origin" like every other request of the app's: a protected preview deployment (Vercel
 * Authentication) lets a request through only with its own cookie; the route reads no cookie (src/app/api/feedback).
 */
export function feedbackSender(): FeedbackSender | null {
  if (typeof window === "undefined" || typeof fetch !== "function") return null;
  if (startedSender) return startedSender;
  const sender = new FeedbackSender({
    post(body) {
      void fetch(FEEDBACK_ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true, credentials: "same-origin", cache: "no-store" }).catch(() => {});
    },
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (timer) => window.clearTimeout(timer as number),
    sharing: () => sharingOn(),
    onSent: () => markShareNoted(),
  });
  const flush = () => sender.flush();
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  startedSender = sender;
  return sender;
}

/** A save's result as the trade cards read it: whether a copy is on its way too (the one-time note). */
export type FeedbackSaveResult = SaveResult & { shared?: boolean };

/**
 * After a press the browser has kept (useFeedback.ts saveFeedbackPress): its record's copy queued, while sharing is on.
 * `before`: the record before the press (undefined when the press made it); `after`: after it (undefined when the press
 * removed it), both as this press saw and left it, never the store's state after the save settled (another press on the
 * same card may have landed meanwhile: review FB-R1). Presses must reach this in the order they were made. True when a copy
 * is waiting.
 */
export function shareFeedbackPress(args: {
  before: FeedbackRecord | undefined;
  after: FeedbackRecord | undefined;
  change: FeedbackChange;
  context: FeedbackShareContext;
  sender?: FeedbackSender | null;
  sharing?: () => boolean;
}): boolean {
  if (!(args.sharing ?? (() => sharingOn()))()) return false;
  const sender = args.sender === undefined ? feedbackSender() : args.sender;
  const record = args.after ?? args.before;
  if (!sender || !record) return false;
  const event = feedbackEventOf({ record, kind: "outcome" in args.change ? "outcome" : "report", removed: !args.after, context: args.context });
  return event ? sender.queue(event, !args.before) : false;
}
