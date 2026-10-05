/**
 * The anonymous feedback store, the server's half (planner reply to Checkpoint 4c, Part B, B2: "Store anonymized reports
 * and outcomes … Never store league IDs, team or owner names, usernames, SWIDs or cookies. Add an opt-out toggle and rate
 * limits. Use a free-tier store, for example the same Redis."; Checkpoint 7a, track FB). The browser's half, and what each
 * field holds: src/lib/feedbackShare.ts; the copy's types: src/lib/feedbackEvent.ts; the route: src/app/api/feedback.
 *
 * - FeedbackEventSchema: the copy the route accepts, strict at every level (an unknown field anywhere refuses the whole
 *   copy: the allowlist is the privacy page's list), every string a closed set or a narrow pattern, every number bounded.
 *   Review FB-R4: a player id must have the form of the ids the app makes (src/lib/feedbackEvent.ts FEEDBACK_PLAYER_ID:
 *   digits, a 2–3 letter team code, or `espn:<number>`), and a share id the form newShareId makes (feedbackStore.ts
 *   SHARE_ID_PATTERN: exactly 16 random bytes), so no 19-digit league id, short league code, username, team name or SWID
 *   fits a text field. ⚠️ Defense in depth only, behind the honest browser that never puts them there: the schema can't
 *   prove an id is a player's (a short all-digit league id has a Sleeper id's form), and a hostile client could still
 *   spell data out in the bounded numbers. A copy is at most respond.ts's request cap (16 KB).
 * - storeFeedback: the copy, plus the UTC day it arrived ("day": the date, never the time; nothing else is added: no IP
 *   address, no client id, no header), as one JSON line LPUSHed to that day's list, `prefix + "fb:" + YYYY-MM-DD` (the UTC
 *   day of arrival; src/server/redis.ts keyPrefix: preview and production apart; final review SEC-3: a month's list kept
 *   its newest 5,000, so a flood of forged copies from many IPv6 /64s could push a whole month's real outcomes out; a day's
 *   list confines a flood to its own day), trimmed to its newest feedbackLimits.maxPerDay, its expiry reset to
 *   feedbackLimits.retainDays: one MULTI/EXEC transaction (RedisLike.lpushTrimExpire, review FB-R5), applied whole or not
 *   at all, so no list is ever left without its expiry and each day's feedback is deleted a year after that day (the
 *   privacy page's words). Each copy costs 3 commands (LPUSH, LTRIM, PEXPIRE: Upstash bills a transaction's commands one by
 *   one), plus the rate limit's (src/server/rateLimit.ts) and the daily copy quota's (src/server/budget.ts feedbackQuota:
 *   feedbackLimits.perClientPerDay copies a client and perGroupPerDay a group may send a UTC day; the route checks it). The
 *   write gives up after feedbackLimits.writeTimeoutMs; a failure is logged by the error's name only and the copy is
 *   dropped (the browser never retries: the press is saved there either way). ⚠️ A transaction Upstash applied whose
 *   answer was lost (or came after the timeout) is kept though the route says stored: false.
 * - A copy bigger than feedbackLimits.maxStoredBytes as stored (storedFeedbackText) is refused by the route (final review F4:
 *   the store's bound counts copies of at most that size).
 * - feedbackStoreFor: Redis on Vercel only (src/server/redis.ts redisConfigured; `npm run dev`, the stable copy, the tests
 *   and check:browser have none, so they store nothing and answer { stored: false }). A Redis address that can't be used
 *   (UrlError) is logged once by its name, and the route answers as if there were no store.
 * - Reading the store back: scripts/feedback-pull.ts (`npm run feedback:pull -- --live`), with StoredFeedbackEventSchema.
 */
import { z } from "zod";
import { POSITIONS, type Platform } from "@/engine/model";
import { GOALS } from "@/engine/settings";
import { FEEDBACK_EVENT_KINDS, FEEDBACK_EVENT_MAX_PER_SIDE, FEEDBACK_EVENT_VERSION, FEEDBACK_PLAYER_ID, type FeedbackEvent, type StoredFeedbackEvent } from "@/lib/feedbackEvent";
import { FEEDBACK_OUTCOMES, FEEDBACK_REASONS, FEEDBACK_VERSIONS, HELPS_REASONS, SHARE_ID_PATTERN } from "@/lib/feedbackStore";
import { feedbackLimits } from "./limits";
import { errorNameOf, logEvent, withTimeout } from "./log";
import { getRedis, keyPrefix, type RedisLike } from "./redis";

type Env = Readonly<Record<string, string | undefined>>;

/** Every platform a league can come from (src/engine/model.ts Platform); the privacy page names the two that send copies today. */
const PLATFORMS = ["espn", "sleeper", "yahoo", "fleaflicker", "mfl", "fantrax", "manual"] as const satisfies readonly Platform[];

/** A model number: finite and bounded (no model number comes near the bound; anything past it is garbage). */
const modelNumber = z.number().min(-1e9).max(1e9);
const maybeNumber = modelNumber.nullable();
const probability = z.number().min(0).max(1).nullable();
const change = z.number().min(-1).max(1).nullable();
const score = z.number().int().min(0).max(100).nullable();

/** A starting slot's key: the positions it takes, in POSITIONS order, each once, joined by "/" (feedbackShare.ts slotKey). */
function isSlotKey(key: string): boolean {
  const at = key.split("/").map((p) => (POSITIONS as readonly string[]).indexOf(p));
  return at.length > 0 && at.every((i, n) => i >= 0 && (n === 0 || i > (at[n - 1] as number)));
}

const FeaturesSchema = z.strictObject({
  g: maybeNumber,
  n: maybeNumber,
  h: maybeNumber,
  c: maybeNumber,
  a: maybeNumber,
  hist: maybeNumber,
  ctx: maybeNumber,
  hot: maybeNumber,
  urg: maybeNumber,
  z: maybeNumber,
});

const FormatSchema = z.strictObject({
  numTeams: z.number().int().min(1).max(64),
  leagueType: z.enum(["redraft", "keeper", "dynasty"]),
  ppr: z.number().min(-100).max(100),
  passTd: z.number().min(-100).max(100),
  tep: z.number().min(0).max(100),
  superflex: z.boolean(),
  slots: z
    .record(z.string().max(64).refine(isSlotKey, "A lineup slot isn't one."), z.number().int().min(1).max(30))
    .refine((slots) => Object.keys(slots).length <= 32, "Too many lineup slots."),
  playoffTeams: z.number().int().min(0).max(64),
});

/** A player: an id of the form the app makes (FEEDBACK_PLAYER_ID; the header) and his position. */
const PlayerSchema = z.strictObject({
  id: z.string().regex(FEEDBACK_PLAYER_ID),
  pos: z.enum(POSITIONS).nullable(),
});

/** A trade's players, each side at most the Analyzer's maximum. */
const TradeSchema = z.strictObject({
  give: z.array(PlayerSchema).max(FEEDBACK_EVENT_MAX_PER_SIDE),
  get: z.array(PlayerSchema).max(FEEDBACK_EVENT_MAX_PER_SIDE),
});

const NumbersSchema = z.strictObject({
  helps: score,
  chance: score,
  overall: score,
  b: maybeNumber,
  b3: z.number().gt(0).max(1e9).nullable(),
  pAccept: probability,
  pComplete: probability,
  dPO: change,
  dCH: change,
  dPPW: maybeNumber,
  gMine: maybeNumber,
  gPartner: maybeNumber,
});

/** An NFL week: 0 (before the season) to 30 (feedbackStore.ts isFeedbackWeek takes the same). */
const week = z.number().int().min(0).max(30);

const VersionInputsSchema = z.strictObject({
  features: FeaturesSchema.nullable(),
  gPartner: maybeNumber,
  b: maybeNumber,
  b3: z.number().gt(0).max(1e9).nullable(),
  helpsReason: z.enum(HELPS_REASONS).nullable(),
  goal: z.enum(GOALS).nullable(),
  week: week.nullable(),
});

/** The copy's fields (FeedbackEventSchema without its cross-field rules, so the stored form can extend it). */
const EventShape = z.strictObject({
  v: z.literal(FEEDBACK_EVENT_VERSION),
  rid: z.string().regex(SHARE_ID_PATTERN),
  kind: z.enum(FEEDBACK_EVENT_KINDS),
  outcome: z.enum(FEEDBACK_OUTCOMES).optional(),
  reason: z.enum(FEEDBACK_REASONS).optional(),
  version: z.enum(FEEDBACK_VERSIONS).optional(),
  platform: z.enum(PLATFORMS),
  season: z.number().int().min(2000).max(2100),
  week,
  format: FormatSchema,
  goal: z.enum(GOALS).nullable(),
  trade: TradeSchema,
  numbers: NumbersSchema,
  features: FeaturesSchema,
  versionTrade: TradeSchema.optional(),
  versionAccept: z.strictObject({ pAccept: probability, pComplete: probability }).optional(),
  versionInputs: VersionInputsSchema.optional(),
});

/** The rules between fields: a version only with an outcome, the version's players, estimate and inputs only with a version. */
function crossFieldRules(e: { outcome?: unknown; version?: unknown; versionTrade?: unknown; versionAccept?: unknown; versionInputs?: unknown }, ctx: z.RefinementCtx): void {
  if (e.version !== undefined && e.outcome === undefined) ctx.addIssue({ code: "custom", path: ["version"], message: "A version goes with an outcome." });
  if (e.versionTrade !== undefined && e.version === undefined) ctx.addIssue({ code: "custom", path: ["versionTrade"], message: "A version's players go with a version." });
  if (e.versionAccept !== undefined && e.version === undefined) ctx.addIssue({ code: "custom", path: ["versionAccept"], message: "A version's estimate goes with a version." });
  if (e.versionInputs !== undefined && e.version === undefined) ctx.addIssue({ code: "custom", path: ["versionInputs"], message: "Version inputs go with a version." });
}

/** One anonymous copy as the route accepts it (the header). */
export const FeedbackEventSchema = EventShape.superRefine(crossFieldRules);

/**
 * The code a refused copy is logged with (src/app/api/feedback/handler.ts; review FB-R8: a builder and a schema that drift
 * apart would otherwise drop every copy without a trace): the copy's top-level field that failed first ("INVALID_TRADE",
 * "INVALID_NUMBERS", "INVALID_VERSIONINPUTS" …), with "_EXTRA_FIELD" for a field it may not have, else "INVALID_REQUEST".
 * From a closed set: the schema's own field names, never a value or a name the client chose.
 */
export function refusedCopyCode(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "INVALID_REQUEST";
  const top = issue.path[0];
  const field = typeof top === "string" && Object.hasOwn(EventShape.shape, top) ? `_${top.toUpperCase()}` : "";
  if (issue.code === "unrecognized_keys") return `INVALID${field}_EXTRA_FIELD`;
  return field ? `INVALID${field}` : "INVALID_REQUEST";
}

/** A copy as the store keeps it: the event and the UTC day it arrived. */
export const StoredFeedbackEventSchema = EventShape.extend({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).superRefine(crossFieldRules);

const DAY_MS = 24 * 60 * 60_000;

/** The list a copy arriving at `at` goes to: `prefix + "fb:" + YYYY-MM-DD` (UTC). */
export function feedbackDayKey(at: number, env: Env = process.env): string {
  return `${keyPrefix(env)}fb:${new Date(at).toISOString().slice(0, 10)}`;
}

/** The copy as stored: the event and the UTC day it arrived, nothing else. */
export function storedFeedbackEvent(event: FeedbackEvent, at: number): StoredFeedbackEvent {
  return { ...event, day: new Date(at).toISOString().slice(0, 10) };
}

/** The copy as the store keeps it, as text (its size is what feedbackLimits.maxStoredBytes bounds). */
export function storedFeedbackText(event: FeedbackEvent, at: number): string {
  return JSON.stringify(storedFeedbackEvent(event, at));
}

/** Whether a copy fits the store's bound (feedbackLimits.maxStoredBytes as stored; final review F4). */
export function fitsFeedbackStore(event: FeedbackEvent, at: number): boolean {
  return Buffer.byteLength(storedFeedbackText(event, at), "utf8") <= feedbackLimits.maxStoredBytes;
}

let configSaid = false;

/** The store: Redis on Vercel only (the header); null elsewhere, or when its address can't be used (logged once). */
export function feedbackStoreFor(env: Env = process.env): RedisLike | null {
  if (!env.VERCEL) return null;
  try {
    return getRedis(env);
  } catch (err) {
    if (!configSaid) {
      configSaid = true;
      logEvent({ event: "redis_config_invalid", platform: "upstash", errorName: errorNameOf(err) });
    }
    return null;
  }
}

/**
 * Stores one copy (the header): LPUSH to its day's list, LTRIM to the newest feedbackLimits.maxPerDay and PEXPIRE to
 * feedbackLimits.retainDays, in one transaction (RedisLike.lpushTrimExpire: all three or none); true once written. Never
 * throws: a failure or a write slower than feedbackLimits.writeTimeoutMs is logged by the error's name and answers false.
 */
export async function storeFeedback(store: RedisLike, event: FeedbackEvent, opts: { now?: number; env?: Env; timeoutMs?: number } = {}): Promise<boolean> {
  const now = opts.now ?? Date.now();
  const key = feedbackDayKey(now, opts.env ?? process.env);
  const entry = storedFeedbackText(event, now);
  try {
    await withTimeout(store.lpushTrimExpire(key, [entry], feedbackLimits.maxPerDay, feedbackLimits.retainDays * DAY_MS), opts.timeoutMs ?? feedbackLimits.writeTimeoutMs);
    return true;
  } catch (err) {
    logEvent({ event: "feedback_store_failed", platform: "upstash", errorName: errorNameOf(err) });
    return false;
  }
}

/** Test hook: say a bad Redis address again. */
export function resetFeedbackSinkForTests(): void {
  configSaid = false;
}
