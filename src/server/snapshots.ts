/**
 * Automatic pre-game snapshots (planner reply to Checkpoint 7a, §6.3: "a daily Vercel cron at 0 20 * * * … The route checks
 * CRON_SECRET, takes a lock, and is idempotent. Delivery is best effort, so handle missed and duplicate runs. What it saves:
 * when the current NFL week's first kickoff is still ahead, the week's Sleeper projections, overwriting that week's earlier
 * save, so the last pre-kickoff copy wins; the day's FantasyCalc lists for the formats in use. Storage: Upstash, compressed,
 * kept up to 2 seasons. Download: npm run snapshot:pull copies them to data-local/ for Phase 6."), and since Checkpoint 7c
 * each day's rest-of-season levels (planner reply to Checkpoint 7b, question 4: "yes, if they come only from public
 * projections: standard scoring formats only, never per league, and never blended with trade values. Keep them 730 days,
 * like the other snapshots."). vercel.json schedules the route (src/app/api/cron/snapshot), which checks the secret and
 * calls runSnapshots. Public data only: nothing here reads or keeps anything about a league, a person or a request.
 *
 * runSnapshots, in order (Sleeper's NFL state and the NFL schedule read once a run, the first time a part needs them:
 * readCalendar, so the projections and the levels go by the same calendar):
 * 1. The lock (SnapshotStore.lock: SET NX PX snapshotLimits.lockMs under a random token, released at the end by the run that
 *    holds it), so an overlapping or duplicate delivery answers "locked" and does nothing. Every save is idempotent as well,
 *    so a run after a finished one changes nothing that one saved; a missed day only leaves an older copy.
 * 2. Projections, by the rule of `npm run snapshot:projections` (scripts/snapshot-projections.ts): Sleeper's NFL state gives
 *    the season and the current week (in the preseason the week to be played is week 1; any other season type, nothing),
 *    the NFL schedule each week's first kickoff (ESPN, cached 7 days), and the current week and the next one are fetched
 *    while their first kickoff is still ahead (snapshotWeeks; ⚠️ the next one too, as the script does: each week then gets
 *    a save every day for about a week before its kickoff, so a missed run costs a day's age, not the week's copy). They come
 *    through the model build's own loader, gate and cache (src/data/sleeperProjections.ts: all nine positions in one request
 *    a week, cached 6 hours, so a run costs Sleeper at most one request a week) and are merged by the pre-game archive's rule
 *    (src/server/projectionArchive.ts mergeSnapshot: a later pre-kickoff fetch replaces each position's group, so the last
 *    pre-kickoff copy wins). A week whose first kickoff has passed is left alone; when the schedule can't be read, only the
 *    next week counts as ahead (the archive's rule for an unknown kickoff).
 * 3. FantasyCalc's lists: each League page build records the formats it read (src/app/api/cron/snapshot/formats.ts
 *    recordFormatsInUse → noteFormatsInUse: format keys only, a set per UTC day kept snapshotLimits.formatsInUseRetainDays,
 *    nothing about the league), and the run saves today's list of each format used yesterday or today, at most
 *    snapshotLimits.fantasyCalcFormatsPerDay a UTC day counting those already saved today (so a duplicate run looks only at
 *    what the first one left), with the fields the local archive keeps (src/server/fantasyCalcArchive.ts). Past the cap the
 *    formats take turns (formatsToSave; review of Checkpoint 7b's server work: an order by key left the same formats out
 *    every day): the ones with no list saved in the last snapshotLimits.turnLookbackDays days first (as never saved), then
 *    the ones whose newest saved list is oldest, so a format in steady use is saved again within about (formats in use ÷ the
 *    cap) days; the run's answer names the ones left out
 *    (overCapFormats) and the log says the cap was reached ("snapshot_over_cap"). A list is today's when FantasyCalc served
 *    it on the run's UTC day: a copy the cache holds from today costs no request (todaysList reads the cache alone first);
 *    otherwise the model build's loader asks FantasyCalc, at most once every 3 hours a format (TTL.fantasyCalc: FantasyCalc's
 *    conditions, reports/fantasycalc-permission.md), never while its outage memory holds FantasyCalc off, and not again
 *    within 3 hours of an answer for that format the checks turned down (src/data/fantasyCalcValues.ts). A saved copy that
 *    stands in during an outage is another day's list, and isn't saved.
 * 4. The day's rest-of-season levels (snapshotLevels; what a record holds: src/server/projectionLevels.ts), last, and only
 *    with snapshotLimits.levelsMinTimeLeftMs of the route's deadline left: every offense player's mean of Sleeper's own
 *    standard, half-PPR and PPR totals over the weeks from the first whose first kickoff is still ahead (levelsFromWeek, by
 *    the pre-game archive's rule, as in step 2) through week 18, with a mask of the weeks counted. The weeks come through
 *    the model build's own loader, gate, cache and reducer (src/data/sleeperProjections.ts), in the offense group, the
 *    lists every non-IDP League page build reads: a day with builds costs Sleeper about nothing, and a run costs it at most
 *    one request a week. All-or-nothing (levelWeeks): a week that can't be read (Sleeper down, the deadline, a budget, an error
 *    status, or rows the schema can't read with no projection among the rest) saves nothing that day, and the weeks after
 *    it aren't asked for; a week Sleeper answers with no projection in it is left out (⚠️ ours: a few unreadable rows beside
 *    real projections are skipped as a model build skips them, with its PROJECTION_ROWS_UNREADABLE, and the week counts).
 *    Never a league's scoring, the model's (blended) projections or FantasyCalc: the levels part reads Sleeper's lists and
 *    nothing else, and writes its one key.
 *
 * Where (snapshotStoreFor): on Vercel, the shared store (src/server/redis.ts, Upstash), keys under `os:<VERCEL_ENV>:`:
 *   snap:lock                                 the run's lock (a random token; snapshotLimits.lockMs)
 *   fc-formats:<YYYY-MM-DD>                   the formats League page builds read that UTC day (a set of format keys)
 *   snap:proj:<season>:<week>                 a week's record (projectionArchive.ts ProjectionSnapshot)
 *   snap:fc:<season>:<YYYY-MM-DD>:<format>    a format's list of that day (fantasyCalcArchive.ts FantasyCalcSnapshot)
 *   snap:fc-index:<season>:<YYYY-MM-DD>       the formats whose list of that day was saved (a set of format keys; snapshot:pull,
 *                                             and the run's turn order: each format's newest saved day)
 *   snap:lvl:<season>:<YYYY-MM-DD>            a day's rest-of-season levels (projectionLevels.ts ProjectionLevels)
 * each record stored as the base64 of its local file's bytes (the gzip of its JSON: packProjectionSnapshot,
 * packFantasyCalcSnapshot, packProjectionLevels). A week of projections is kept snapshotLimits.retainDays (two seasons) after
 * its last write; a day's lists, its index set and its levels until retainDays after that UTC day began (dayRetainMs),
 * whatever the time of the save, so the archive's record of which formats were in use on a day goes two seasons after that
 * day. Review of Phase 7b: the index was one set a season, its expiry set again by every save, so a day's entries outlived
 * its lists by up to a season (about 3 years in all, past the privacy page's "up to 2 seasons"); a set per day expires with
 * its own lists. A day's levels are written once (SET NX: the day's first record is kept, as a day's lists). The storage
 * arithmetic is in src/server/limits.ts snapshotLimits. Anywhere else, the local archives in data-local/ (projectionArchive.ts,
 * fantasyCalcArchive.ts, and projectionLevels.ts's projection-levels/) where they're on (`next dev`, the stable copy):
 * `next dev` with CRON_SECRET in its own environment runs the route end to end, the formats in use being those the local
 * FantasyCalc archive holds for yesterday or today (every local build files the lists it read), and the lock this
 * process's. `npm run snapshot:pull -- --live` (scripts/snapshot-pull.ts) copies the shared store's records into the local
 * archives.
 *
 * Never throws for a source or a store failure inside a part: each part reports what happened (statuses, codes and error
 * names only; failures logged by the error's name). The run stays inside its route's deadline (deadlines.cronMs): the HTTP
 * client's requests are bounded by it, no FantasyCalc format is started with less than snapshotLimits.listMinTimeLeftMs left
 * nor the levels with less than snapshotLimits.levelsMinTimeLeftMs, and the shared store stops sending after its first failed
 * command (sharedSnapshotStore). Server-side, but no "server-only" import: snapshot:pull (tsx) reads its keys and day rules.
 */
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { OFFENSE_POSITIONS, sleeperUrls } from "@/adapters/sleeper/fetch";
import { hasProjection, LAST_NFL_WEEK } from "@/adapters/sleeper/normalize";
import { StateSchema, type SleeperState } from "@/adapters/sleeper/schemas";
import type { HttpClient } from "@/adapters/types";
import { fantasyCalcGate, loadFantasyCalcValues, type FantasyCalcGate, type FantasyCalcValuesLoad } from "@/data/fantasyCalcValues";
import { loadNflSchedule, type NflScheduleData } from "@/data/nflSchedule";
import {
  loadSleeperWeeklyProjections,
  sleeperCacheKey,
  sleeperGate,
  sleeperRequestPositions,
  type SleeperGate,
  type SleeperProjectionWeek,
  type SleeperRows,
} from "@/data/sleeperProjections";
import { STATIC_DEFENSE_IDS } from "@/data/teamCodes";
import type { FantasyCalcFormat } from "@/engine/inputs";
import { FANTASYCALC_TEAM_SIZES } from "@/engine/market";
import { POSITIONS } from "@/engine/model";
import { defaultSeason } from "@/lib/season";
import { TTL } from "./cache";
import {
  createFantasyCalcArchiver,
  fantasyCalcArchiveRoot,
  fantasyCalcFormatKey,
  fantasyCalcSnapshotOf,
  packFantasyCalcSnapshot,
  type FantasyCalcArchiveInput,
  type FantasyCalcArchiveOutcome,
  type FantasyCalcArchiveSkip,
  type FantasyCalcSnapshotLocation,
} from "./fantasyCalcArchive";
import { timeLeftMs } from "./deadline";
import { snapshotLimits } from "./limits";
import { errorNameOf, logEvent, withTimeout } from "./log";
import {
  beforeKickoff,
  createProjectionArchiver,
  firstKickoffOf,
  mergeSnapshot,
  packProjectionSnapshot,
  projectionArchiveEnabled,
  projectionArchiveFetch,
  unpackProjectionSnapshot,
  type ArchiveOutcome,
  type ArchiveSkip,
  type ProjectionArchiveInput,
  type ProjectionSnapshot,
} from "./projectionArchive";
import { packProjectionLevels, projectionLevelsOf, projectionLevelsRoot, saveProjectionLevelsFile, type ProjectionLevels, type ProjectionLevelsSave } from "./projectionLevels";
import { getRedis, keyPrefix, redisOffReason, type RedisLike, type RedisOffReason } from "./redis";

type Env = Readonly<Record<string, string | undefined>>;

const DAY_MS = 24 * 60 * 60_000;

// ---------------------------------------------------------------------------------------------
// Keys and days (see the header)

/** The run's lock. */
export function snapshotLockKey(prefix: string): string {
  return `${prefix}snap:lock`;
}

/** The formats League page builds read on a UTC day. */
export function formatsInUseKey(prefix: string, day: string): string {
  return `${prefix}fc-formats:${day}`;
}

/** A week's projection record. */
export function projectionSnapshotKey(prefix: string, season: number, week: number): string {
  return `${prefix}snap:proj:${season}:${week}`;
}

/** A format's list of a day. */
export function fantasyCalcSnapshotKey(prefix: string, at: FantasyCalcSnapshotLocation): string {
  return `${prefix}snap:fc:${at.season}:${at.day}:${at.key}`;
}

/**
 * A UTC day's index: the format keys whose list of that day was saved (a set, kept as long as the day's lists: dayRetainMs).
 * One set a day, not a season (the header: review of Phase 7b), so each entry goes with its own day's lists.
 */
export function fantasyCalcIndexKey(prefix: string, at: Pick<FantasyCalcSnapshotLocation, "season" | "day">): string {
  return `${prefix}snap:fc-index:${at.season}:${at.day}`;
}

/** A UTC day's rest-of-season levels (src/server/projectionLevels.ts; one record a day, kept as long as the day's lists: dayRetainMs). */
export function projectionLevelsKey(prefix: string, season: number, day: string): string {
  return `${prefix}snap:lvl:${season}:${day}`;
}

/** "YYYY-MM-DD" (a calendar day's shape; the index's days and the local folders check it). */
export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The UTC day of an epoch-ms time: "2026-10-05". */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The NFL season a UTC day falls in (src/lib/season.ts defaultSeason: the calendar year, or last year in January and February). */
export function seasonOfDay(day: string): number {
  return defaultSeason(new Date(`${day}T12:00:00.000Z`));
}

/** The UTC days from `from` through `to` ("YYYY-MM-DD" each), oldest first; none when `from` is later or either isn't a day. */
export function daysFromTo(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!DAY_PATTERN.test(from) || !DAY_PATTERN.test(to) || !Number.isFinite(start) || !Number.isFinite(end)) return [];
  const out: string[] = [];
  for (let t = start; t <= end; t += DAY_MS) out.push(utcDay(t));
  return out;
}

/**
 * How long, from `now`, a day's records are kept (ms, at least 1): its FantasyCalc lists, its index set and its levels all go
 * snapshotLimits.retainDays after that UTC day began, whatever the time of the save (the header), so the archive's record of
 * which formats were in use on a day lasts two seasons from that day and no longer (review of Phase 7b).
 */
export function dayRetainMs(day: string, now: number): number {
  const ends = Date.parse(`${day}T00:00:00.000Z`) + snapshotLimits.retainDays * DAY_MS;
  return Number.isFinite(ends) ? Math.max(1, ends - now) : 1;
}

/** Whether a day's FantasyCalc records are past their retention at `now` (dayRetainMs; snapshot:pull prunes its local copies by it). */
export function dayExpired(day: string, now: number): boolean {
  const ends = Date.parse(`${day}T00:00:00.000Z`) + snapshotLimits.retainDays * DAY_MS;
  return Number.isFinite(ends) && ends <= now;
}

/**
 * The days the turn order reads the index of (SnapshotStore.savedDays): `day` and the snapshotLimits.turnLookbackDays − 1
 * before it, in `day`'s season only, newest first.
 */
export function turnDays(day: string): string[] {
  if (!DAY_PATTERN.test(day)) return [];
  const span = Math.max(1, Math.floor(snapshotLimits.turnLookbackDays));
  const first = utcDay(Date.parse(`${day}T00:00:00.000Z`) - (span - 1) * DAY_MS);
  const season = seasonOfDay(day);
  return daysFromTo(first, day)
    .filter((d) => seasonOfDay(d) === season)
    .reverse();
}

// ---------------------------------------------------------------------------------------------
// FantasyCalc formats

const FORMAT_KEY = /^(redraft|dynasty)-([12])qb-(\d{1,2})team-ppr(0|0\.5|1)(-teplus|-teplusplus)?$/;

/**
 * A format key (src/server/fantasyCalcArchive.ts fantasyCalcFormatKey) back to the request's parameters, or null for
 * anything a league can't ask for: the team counts FantasyCalc supports (src/engine/market.ts FANTASYCALC_TEAM_SIZES), the
 * three reception rates, one or two QBs, no TE premium, te+ or te++ (144 formats in all). So a key in the store can only
 * ever make the cron ask FantasyCalc for one of the lists leagues ask for.
 */
export function parseFormatKey(key: string): FantasyCalcFormat | null {
  const m = FORMAT_KEY.exec(key);
  if (!m) return null;
  const numTeams = Number(m[3]);
  if (!(FANTASYCALC_TEAM_SIZES as readonly number[]).includes(numTeams)) return null;
  const tep = m[5] === "-teplus" ? "te+" : m[5] === "-teplusplus" ? "te++" : undefined;
  const format: FantasyCalcFormat = {
    isDynasty: m[1] === "dynasty",
    numQbs: m[2] === "2" ? 2 : 1,
    numTeams,
    ppr: m[4] === "1" ? 1 : m[4] === "0.5" ? 0.5 : 0,
    ...(tep ? { tep } : {}),
    substitutions: [],
  };
  return fantasyCalcFormatKey(format) === key ? format : null;
}

/**
 * The order the formats in use (used today or yesterday; valid keys only) are saved in (pure; the header's step 3), so that
 * past the day's cap they take turns instead of the same ones always being left out (review of Checkpoint 7b's server
 * work: by key, every dynasty format came before every redraft one, and the same redraft formats were never saved):
 * 1. the ones never saved (no day in `newestSaved`), then the one whose newest saved list is oldest;
 * 2. redraft lists before dynasty ones (⚠️ ours, the review's suggestion: the market blend reads a redraft list in every
 *    league type, so Phase 6's backtest of it needs them most);
 * 3. used both days, then today only, then yesterday only;
 * 4. the key.
 * `newestSaved`: format key → the newest day its list was saved (SnapshotStore.savedDays: the shared store looks back
 * snapshotLimits.turnLookbackDays days, the local archives over the season).
 */
export function formatsToSave(today: readonly string[], yesterday: readonly string[], newestSaved: ReadonlyMap<string, string> = new Map()): string[] {
  const valid = (keys: readonly string[]) => new Set(keys.filter((k) => parseFormatKey(k) !== null));
  const t = valid(today);
  const y = valid(yesterday);
  const use = (k: string) => (t.has(k) && y.has(k) ? 0 : t.has(k) ? 1 : 2);
  // "" sorts before every "YYYY-MM-DD": never saved comes first.
  const saved = (k: string) => newestSaved.get(k) ?? "";
  const dynasty = (k: string) => (k.startsWith("dynasty-") ? 1 : 0);
  return [...new Set([...t, ...y])].sort((a, b) => (saved(a) < saved(b) ? -1 : saved(a) > saved(b) ? 1 : dynasty(a) - dynasty(b) || use(a) - use(b) || (a < b ? -1 : a > b ? 1 : 0)));
}

// ---------------------------------------------------------------------------------------------
// The formats in use (written by League page builds: src/app/api/cron/snapshot/formats.ts)

/** Format keys this process has recorded, per UTC day (that day and the one before only), so a build writes only what's new. */
const noted = new Map<string, Set<string>>();

/** The valid keys among `keys` this process hasn't recorded for `day` yet, deduplicated and sorted. */
export function unnotedFormats(keys: readonly string[], day: string): string[] {
  const seen = noted.get(day);
  return [...new Set(keys)].filter((k) => parseFormatKey(k) !== null && !seen?.has(k)).sort();
}

function markNoted(day: string, keys: readonly string[]): void {
  let seen = noted.get(day);
  if (!seen) {
    const before = utcDay(Date.parse(`${day}T00:00:00.000Z`) - DAY_MS);
    for (const d of [...noted.keys()]) if (d !== before) noted.delete(d);
    seen = new Set();
    noted.set(day, seen);
  }
  for (const k of keys) seen.add(k);
}

/**
 * Records `keys` as read on `day` (see the header): the ones this process hasn't recorded for that day yet go into the
 * day's set in one SADD and PEXPIRE transaction (RedisLike.saddExpire; the set kept snapshotLimits.formatsInUseRetainDays),
 * at most snapshotLimits.redisTimeoutMs; a key counts as recorded only once written, so a failed write is tried again by a
 * later build. Never rejects: a failure is logged by the error's name.
 */
export async function noteFormatsInUse(store: RedisLike, keys: readonly string[], day: string, opts: { env?: Env; timeoutMs?: number } = {}): Promise<void> {
  const fresh = unnotedFormats(keys, day);
  if (!fresh.length || !DAY_PATTERN.test(day)) return;
  try {
    const key = formatsInUseKey(keyPrefix(opts.env ?? process.env), day);
    await withTimeout(store.saddExpire(key, fresh, snapshotLimits.formatsInUseRetainDays * DAY_MS), opts.timeoutMs ?? snapshotLimits.redisTimeoutMs);
    markNoted(day, fresh);
  } catch (err) {
    logEvent({ event: "formats_in_use_failed", platform: "upstash", errorName: errorNameOf(err) });
  }
}

/** Where builds record the formats they read: the shared store on Vercel only (none elsewhere, or when its address can't be used). */
export function formatsInUseStore(env: Env = process.env): RedisLike | null {
  if (!env.VERCEL) return null;
  try {
    return getRedis(env);
  } catch {
    return null; // the cache's selection logs the bad address once (src/app/api/_lib/deps.ts)
  }
}

/** Test hook: forget what this process recorded. */
export function resetFormatsInUseForTests(): void {
  noted.clear();
}

// ---------------------------------------------------------------------------------------------
// Where snapshots go

/** What a week's save did. */
export type WeekSave = { status: "saved"; replaced: string[] } | { status: "unchanged" } | { status: "skipped"; reason: ArchiveSkip } | { status: "failed"; error: string };

/** What a list's save did ("unchanged": the day's copy was there already: the first one is kept). */
export type ListSave = { status: "saved" } | { status: "unchanged" } | { status: "skipped"; reason: FantasyCalcArchiveSkip } | { status: "failed"; error: string };

/** What a day's levels save did ("unchanged": the day's record was there already: the first one is kept). */
export type LevelsSave = ProjectionLevelsSave;

export interface SnapshotLock {
  /** Lets the lock go (only the run that holds it; a lock it can't release expires on its own). Never rejects. */
  release(): Promise<void>;
}

/** The shared store or the local archives (see the header). */
export interface SnapshotStore {
  readonly kind: "shared" | "local";
  /** The run's lock, or null when another run holds it. */
  lock(): Promise<SnapshotLock | null>;
  /** The format keys League page builds read on a UTC day. */
  formatsUsed(day: string): Promise<string[]>;
  /**
   * The format keys with a list saved in `day`'s NFL season, each with the newest day one was saved, up to `day` (so a key
   * whose day is `day` is saved already today); formatsToSave takes turns by it. The shared store looks back
   * snapshotLimits.turnLookbackDays days only (turnDays: one SMEMBERS a day), the local archives over the season.
   */
  savedDays(day: string): Promise<Map<string, string>>;
  /** Saves a fetched week by the archive's merge rule. Never rejects. */
  saveWeek(input: ProjectionArchiveInput): Promise<WeekSave>;
  /** Saves a list as its day's copy (the first one kept). Never rejects. */
  saveList(list: FantasyCalcArchiveInput): Promise<ListSave>;
  /** Saves a day's levels as its day's record (the first one kept). Never rejects. */
  saveLevels(record: ProjectionLevels): Promise<LevelsSave>;
}

/**
 * The shared store (see the header's keys): one GET and, when the merge rule changes something, one SET a week; one SET NX
 * and one index transaction (SADD and PEXPIRE) a list, both expiring retainDays after the list's day began (dayRetainMs, by
 * `clock`: the run's time); one SET NX a day's levels, expiring the same way; one SMEMBERS a day the turn order reads
 * (turnDays); each command waits at most `timeoutMs`
 * (snapshotLimits.redisTimeoutMs). After a command fails or times out, every later command of this store (one run's) fails
 * at once with the same error's name, without being sent: a slow or failing Upstash costs a run one timeout, not one per
 * command (which could outlast the route's maxDuration); tomorrow's run does what this one couldn't.
 */
export function sharedSnapshotStore(redis: RedisLike, opts: { env?: Env; timeoutMs?: number; clock?: () => number } = {}): SnapshotStore {
  const prefix = keyPrefix(opts.env ?? process.env);
  const timeoutMs = opts.timeoutMs ?? snapshotLimits.redisTimeoutMs;
  const retainMs = snapshotLimits.retainDays * DAY_MS;
  const clock = opts.clock ?? Date.now;
  /** The first failure's name: once set, nothing more is sent (see above). */
  let broken: string | null = null;
  const call = async <T>(command: () => Promise<T>): Promise<T> => {
    if (broken !== null) throw Object.assign(new Error("the shared store failed earlier in this run"), { name: broken });
    try {
      return await withTimeout(command(), timeoutMs);
    } catch (err) {
      broken = errorNameOf(err);
      logEvent({ event: "snapshot_store_failed", platform: "upstash", errorName: broken });
      throw err;
    }
  };
  /** A save that failed: the store's own failure was logged when it happened (once a run); anything else is logged here. */
  const failed = (err: unknown): { status: "failed"; error: string } => {
    const error = errorNameOf(err);
    if (broken === null) logEvent({ event: "snapshot_save_failed", errorName: error });
    return { status: "failed", error };
  };
  return {
    kind: "shared",
    async lock() {
      const key = snapshotLockKey(prefix);
      const token = randomUUID();
      if ((await call(() => redis.set(key, token, { nx: true, px: snapshotLimits.lockMs }))) !== "OK") return null;
      return {
        async release() {
          try {
            if ((await call(() => redis.get(key))) === token) await call(() => redis.del(key));
          } catch (err) {
            // It expires on its own (lockMs).
            logEvent({ event: "snapshot_unlock_failed", platform: "upstash", errorName: errorNameOf(err) });
          }
        },
      };
    },
    formatsUsed: (day) => call(() => redis.smembers(formatsInUseKey(prefix, day))),
    async savedDays(day) {
      const entries: Array<{ day: string; key: string }> = [];
      for (const d of turnDays(day)) {
        const keys = await call(() => redis.smembers(fantasyCalcIndexKey(prefix, { season: seasonOfDay(d), day: d })));
        for (const key of keys) if (parseFormatKey(key) !== null) entries.push({ day: d, key });
      }
      return newestDays(entries, day);
    },
    async saveWeek(input) {
      try {
        const built = projectionArchiveFetch(input);
        if ("skipped" in built) return { status: "skipped", reason: built.skipped };
        const key = projectionSnapshotKey(prefix, input.season, input.week);
        const text = await call(() => redis.get(key));
        let stored: ProjectionSnapshot | null = null;
        if (text !== null) {
          const found = await unpackProjectionSnapshot(Buffer.from(text, "base64"));
          // Another format version is left alone, as the fs layer leaves its file; an unreadable record is replaced.
          if ("otherVersion" in found) return { status: "failed", error: "OtherVersion" };
          if ("snapshot" in found) stored = found.snapshot;
          else logEvent({ event: "snapshot_replaced", platform: "upstash" });
        }
        const { record, replaced } = mergeSnapshot(stored, built.fetch);
        if (!replaced.length) return { status: "unchanged" };
        const value = (await packProjectionSnapshot(record)).toString("base64");
        if (value.length > snapshotLimits.maxValueChars) return { status: "failed", error: "TooLarge" };
        await call(() => redis.set(key, value, { px: retainMs }));
        return { status: "saved", replaced };
      } catch (err) {
        return failed(err);
      }
    },
    async saveList(list) {
      try {
        const built = fantasyCalcSnapshotOf(list);
        if ("skipped" in built) return { status: "skipped", reason: built.skipped };
        const value = (await packFantasyCalcSnapshot(built.record)).toString("base64");
        if (value.length > snapshotLimits.maxValueChars) return { status: "failed", error: "TooLarge" };
        // The list and its day's index go together, retainDays after the list's day began (the header).
        const keepMs = dayRetainMs(built.location.day, clock());
        const set = await call(() => redis.set(fantasyCalcSnapshotKey(prefix, built.location), value, { nx: true, px: keepMs }));
        // Indexed either way (idempotent), so a list whose entry an interrupted run left out is found again.
        await call(() => redis.saddExpire(fantasyCalcIndexKey(prefix, built.location), [built.location.key], keepMs));
        return set === "OK" ? { status: "saved" } : { status: "unchanged" };
      } catch (err) {
        return failed(err);
      }
    },
    async saveLevels(record) {
      try {
        const value = (await packProjectionLevels(record)).toString("base64");
        if (value.length > snapshotLimits.maxValueChars) return { status: "failed", error: "TooLarge" };
        // The day's first record is kept, retainDays after its day began (the header).
        const set = await call(() => redis.set(projectionLevelsKey(prefix, record.season, record.day), value, { nx: true, px: dayRetainMs(record.day, clock()) }));
        return set === "OK" ? { status: "saved" } : { status: "unchanged" };
      } catch (err) {
        return failed(err);
      }
    },
  };
}

/** Format key → the newest day among `entries` (a day and a format key each) on or before `upTo` (SnapshotStore.savedDays). */
function newestDays(entries: Iterable<{ day: string; key: string }>, upTo: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of entries) {
    if (e.day > upTo) continue;
    const seen = out.get(e.key);
    if (seen === undefined || e.day > seen) out.set(e.key, e.day);
  }
  return out;
}

/** The local run's lock: this process's (one `next dev` or stable copy), expiring like the shared one. */
let localLockedUntil = Number.NEGATIVE_INFINITY;

function weekSaveOf(o: ArchiveOutcome): WeekSave {
  switch (o.status) {
    case "archived":
      return { status: "saved", replaced: o.replaced };
    case "unchanged":
      return { status: "unchanged" };
    case "skipped":
      return { status: "skipped", reason: o.reason };
    case "failed":
      return { status: "failed", error: o.error };
  }
}

function listSaveOf(o: FantasyCalcArchiveOutcome): ListSave {
  switch (o.status) {
    case "archived":
      return { status: "saved" };
    case "unchanged":
      return { status: "unchanged" };
    case "skipped":
      return { status: "skipped", reason: o.reason };
    case "failed":
      return { status: "failed", error: o.error };
  }
}

/**
 * The local archives (see the header): projectionArchive.ts, fantasyCalcArchive.ts and projectionLevels.ts under their usual
 * folders (or the ones given: tests); the formats in use and the ones saved on a day are the lists the local FantasyCalc
 * archive holds for it, and the days each format was saved are its season folder's day folders.
 */
export function localSnapshotStore(opts: { projectionRoot?: string; fantasyCalcRoot?: string; levelsRoot?: string; clock?: () => number } = {}): SnapshotStore {
  const projections = createProjectionArchiver(opts.projectionRoot ? { root: opts.projectionRoot } : {});
  const fantasyCalcRoot = opts.fantasyCalcRoot ?? fantasyCalcArchiveRoot();
  const lists = createFantasyCalcArchiver({ root: fantasyCalcRoot });
  const levelsRoot = opts.levelsRoot ?? projectionLevelsRoot();
  const clock = opts.clock ?? Date.now;
  const filed = async (day: string): Promise<string[]> => {
    if (!DAY_PATTERN.test(day)) return [];
    let names: string[];
    try {
      names = await readdir(path.join(fantasyCalcRoot, String(seasonOfDay(day)), day));
    } catch {
      return []; // no folder: nothing filed that day
    }
    const keys = names.map((n) => /^(.+)\.json\.gz$/.exec(n)?.[1]).filter((k): k is string => k !== undefined && parseFormatKey(k) !== null);
    return keys.sort();
  };
  return {
    kind: "local",
    async lock() {
      const at = clock();
      if (at < localLockedUntil) return null;
      localLockedUntil = at + snapshotLimits.lockMs;
      return {
        async release() {
          localLockedUntil = Number.NEGATIVE_INFINITY;
        },
      };
    },
    formatsUsed: filed,
    async savedDays(day) {
      if (!DAY_PATTERN.test(day)) return new Map();
      let days: string[];
      try {
        days = (await readdir(path.join(fantasyCalcRoot, String(seasonOfDay(day))))).filter((d) => DAY_PATTERN.test(d) && d <= day);
      } catch {
        return new Map(); // no season folder: nothing filed this season
      }
      const entries: Array<{ day: string; key: string }> = [];
      for (const d of days) for (const key of await filed(d)) entries.push({ day: d, key });
      return newestDays(entries, day);
    },
    saveWeek: async (input) => weekSaveOf(await projections.archive(input)),
    saveList: async (list) => listSaveOf(await lists.archive(list)),
    saveLevels: (record) => saveProjectionLevelsFile(levelsRoot, record),
  };
}

/** Test hook: let the local lock go. */
export function resetLocalSnapshotLockForTests(): void {
  localLockedUntil = Number.NEGATIVE_INFINITY;
}

/** Why there's no store for snapshots: Redis's reasons on Vercel (by name only), an unusable address, or the local archives off. */
export type SnapshotStoreReason = RedisOffReason | "store_address_invalid" | "archive_off";

/**
 * The store for this process (see the header): on Vercel the shared store (none without Redis: the reason by name); anywhere
 * else the local archives where they're on (src/server/projectionArchive.ts projectionArchiveEnabled), else none.
 */
export function snapshotStoreFor(env: Env = process.env): { store: SnapshotStore } | { reason: SnapshotStoreReason } {
  if (env.VERCEL) {
    let redis: RedisLike | null;
    try {
      redis = getRedis(env);
    } catch (err) {
      logEvent({ event: "redis_config_invalid", platform: "upstash", errorName: errorNameOf(err) });
      return { reason: "store_address_invalid" };
    }
    return redis ? { store: sharedSnapshotStore(redis, { env }) } : { reason: redisOffReason(env) ?? "store_variables_missing" };
  }
  return projectionArchiveEnabled(env) ? { store: localSnapshotStore() } : { reason: "archive_off" };
}

// ---------------------------------------------------------------------------------------------
// The run

/** A week the run looks at (snapshotWeeks): its first kickoff (epoch ms, null when unknown) and whether it's still ahead. */
export interface PlannedWeek {
  week: number;
  firstKickoff: number | null;
  ahead: boolean;
}

/**
 * The weeks a run fetches (pure; the header's step 2, scripts/snapshot-projections.ts's plan): the current NFL week and the
 * next, up to week 18, each ahead while its first known kickoff is later than `now`; with no known kickoff, only a week
 * after the current one counts as ahead (src/server/projectionArchive.ts beforeKickoff).
 */
export function snapshotWeeks(currentWeek: number, schedule: Pick<NflScheduleData, "kickoffs"> | null, now: number): PlannedWeek[] {
  return [currentWeek, currentWeek + 1]
    .filter((w) => w >= 1 && w <= LAST_NFL_WEEK)
    .map((week) => {
      const firstKickoff = firstKickoffOf(schedule, week);
      return { week, firstKickoff, ahead: firstKickoff !== null ? now < firstKickoff : week > currentWeek };
    });
}

/**
 * The first week a day's levels count (pure; the header's step 4): the first week from the current NFL week through week 18
 * whose first kickoff is still ahead at `now`, by the pre-game archive's rule (beforeKickoff: a week whose first kickoff
 * isn't known counts as ahead only after the current week), so a level never mixes in a week whose games are being played;
 * null when none is left. On the cron's 20:00 UTC run that's the current week from Tuesday to Thursday and the next one from
 * Friday to Monday.
 */
export function levelsFromWeek(currentWeek: number, schedule: Pick<NflScheduleData, "kickoffs"> | null, now: number): number | null {
  for (let week = Math.max(1, currentWeek); week <= LAST_NFL_WEEK; week++) if (beforeKickoff(now, week, currentWeek, firstKickoffOf(schedule, week))) return week;
  return null;
}

/** A week's line in the run's answer. */
export interface WeekResult {
  week: number;
  /** Its first kickoff (ISO), or null when the schedule doesn't know it. */
  firstKickoff: string | null;
  /** The save's status, or "not fetched": its first kickoff has passed (or can't be told), or Sleeper's list couldn't be read. */
  status: WeekSave["status"] | "not fetched";
  reason?: string;
  /** The positions whose groups this run replaced. */
  replaced?: string[];
}

export interface ProjectionsPart {
  /** Why no week was looked at: Sleeper's NFL state couldn't be read, or no week is about to be played. */
  skipped?: "sleeper state unavailable" | "not in season";
  season?: number;
  seasonType?: string;
  currentWeek?: number;
  weeks: WeekResult[];
  /** The loaders' warning codes (SLEEPER_DOWN, PROJECTIONS_WEEK_UNAVAILABLE …; NFL_SCHEDULE_UNAVAILABLE), each once. */
  warnings: string[];
  /** The part stopped on an error of its own (a bug, or the store): its name. */
  error?: string;
}

/** A format's line in the run's answer. */
export interface ListResult {
  format: string;
  status: ListSave["status"];
  /** Why it was skipped or failed: "not today's list" (FantasyCalc gave none from today), "unavailable", the archive's reason, an error's name. */
  reason?: string;
}

export interface FantasyCalcPart {
  /** The run's UTC day. */
  day: string;
  /** Formats League page builds read yesterday or today. */
  inUse: number;
  /** Formats whose list of the day was saved before this run. */
  savedBefore: number;
  lists: ListResult[];
  /** Formats in use left out today: past snapshotLimits.fantasyCalcFormatsPerDay. */
  overCap: number;
  /** Their keys, when there are any (formatsToSave's turn order puts them first on a later day). */
  overCapFormats?: string[];
  /** Formats not looked at because the run's deadline came near (snapshotLimits.listMinTimeLeftMs): the next run's. */
  outOfTime?: number;
  error?: string;
}

/**
 * Why a day's levels weren't saved: too little of the deadline left (snapshotLimits.levelsMinTimeLeftMs), Sleeper's NFL state
 * unreadable, no regular season or preseason on (or a day of another NFL season than Sleeper's), no week left whose first
 * kickoff is ahead, a week that couldn't be read (all or nothing), or no player with a level.
 */
export type LevelsSkip = "out of time" | "sleeper state unavailable" | "not in season" | "no week ahead" | "incomplete" | "no projections";

/** The levels' line in the run's answer (the header's step 4): public facts only (statuses, weeks, counts, codes). */
export interface LevelsPart {
  /** The run's UTC day: the record's. */
  day: string;
  /** The save's status, "skipped" (reason: a LevelsSkip) or "failed" (reason: the store's error, by name). */
  status: LevelsSave["status"] | "skipped";
  reason?: string;
  season?: number;
  seasonType?: string;
  currentWeek?: number;
  /** The weeks counted: from the first whose first kickoff was ahead (levelsFromWeek) through week 18. */
  fromWeek?: number;
  toWeek?: number;
  /** The weeks read with projections in them. */
  read: number[];
  /** Weeks Sleeper answered without a single projection (left out of the record). */
  empty?: number[];
  /** Weeks that couldn't be read: the first one's failure, and the weeks after it, never asked (all or nothing). */
  unread?: number[];
  /** Players with a level. */
  players: number;
  /** The loader's warning codes (SLEEPER_DOWN, PROJECTIONS_WEEK_UNAVAILABLE …; NFL_SCHEDULE_UNAVAILABLE), each once. */
  warnings: string[];
  /** The part stopped on an error of its own (a bug): its name. */
  error?: string;
}

export type SnapshotRun =
  /**
   * `levels` is always set by runSnapshots (Checkpoint 7c); ⚠️ optional in the type only, so an answer in Checkpoint 7b's
   * shape still type-checks (the cron route's tests build one).
   */
  | { status: "done"; store: SnapshotStore["kind"]; projections: ProjectionsPart; fantasyCalc: FantasyCalcPart; levels?: LevelsPart }
  /** Another run holds the lock: nothing was done. */
  | { status: "locked"; store: SnapshotStore["kind"] };

export interface SnapshotRunDeps {
  /** The server's polite, cached client (src/app/api/_lib/deps.ts getHttp): its cache rules apply to every request here. */
  http: HttpClient;
  store: SnapshotStore;
  now: Date;
  /** Test hook: formats a day at most (snapshotLimits.fantasyCalcFormatsPerDay). */
  formatsPerDay?: number;
}

/** Sleeper's NFL state as the imports read it (the same cache entry, 10 minutes), or null when it can't be read. */
async function sleeperState(http: HttpClient): Promise<SleeperState | null> {
  const url = sleeperUrls.state();
  try {
    const res = await http.get(url, { cache: { key: sleeperCacheKey(url), ttlMs: TTL.league, retainMs: TTL.league }, bigIntsAsStrings: true });
    if (!res.ok || res.isHtml) return null;
    const parsed = StateSchema.safeParse(res.json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // a budget's refusal or a client that throws: no state today
  }
}

/**
 * What a run knows of the calendar (readCalendar): why no week is looked at (Sleeper's NFL state couldn't be read, or no
 * regular season or preseason is on), or the season, the season type, the current NFL week and the NFL schedule (null, with
 * NFL_SCHEDULE_UNAVAILABLE in `warnings`, when it couldn't be read).
 */
export type SnapshotCalendar =
  | { skipped: "sleeper state unavailable" }
  | { skipped: "not in season"; season?: number; seasonType: string }
  | { season: number; seasonType: string; currentWeek: number; schedule: NflScheduleData | null; warnings: string[] };

/**
 * Sleeper's NFL state (the season, its type and the current week: in the preseason the week about to be played is week 1,
 * scripts/snapshot-projections.ts) and the NFL schedule (ESPN, cached 7 days), as the header's step 2 reads them. A run reads
 * them once, the first time a part needs them (runSnapshots), so the projections and the levels go by the same calendar and
 * a Sleeper that doesn't answer is asked for its state once a run. Never rejects for a source's failure.
 */
export async function readCalendar(http: HttpClient): Promise<SnapshotCalendar> {
  const state = await sleeperState(http);
  if (!state) return { skipped: "sleeper state unavailable" };
  const season = Number(state.season);
  const seasonType = state.season_type ?? "unknown";
  if (!Number.isInteger(season) || (seasonType !== "regular" && seasonType !== "pre")) {
    return { skipped: "not in season", ...(Number.isInteger(season) ? { season } : {}), seasonType };
  }
  const currentWeek = seasonType === "pre" ? 1 : Math.max(1, Math.min(LAST_NFL_WEEK, state.week));
  const warnings: string[] = [];
  let schedule: NflScheduleData | null = null;
  try {
    schedule = await loadNflSchedule(http, season, STATIC_DEFENSE_IDS);
  } catch {
    warnings.push("NFL_SCHEDULE_UNAVAILABLE");
  }
  return { season, seasonType, currentWeek, schedule, warnings };
}

async function snapshotProjections(http: HttpClient, store: SnapshotStore, now: Date, calendar: () => Promise<SnapshotCalendar>): Promise<ProjectionsPart> {
  const cal = await calendar();
  if ("skipped" in cal) {
    if (cal.skipped === "sleeper state unavailable") return { skipped: cal.skipped, weeks: [], warnings: [] };
    return { skipped: cal.skipped, ...(cal.season !== undefined ? { season: cal.season } : {}), seasonType: cal.seasonType, weeks: [], warnings: [] };
  }
  const { season, seasonType, currentWeek, schedule } = cal;
  const warnings = [...cal.warnings];
  const plan = snapshotWeeks(currentWeek, schedule, now.getTime());
  const ahead = plan.filter((p) => p.ahead).map((p) => p.week);
  const saves = new Map<number, Promise<WeekSave>>();
  if (ahead.length) {
    const load = await loadSleeperWeeklyProjections(sleeperGate(http, now), season, ahead, POSITIONS, {
      currentWeek,
      onWeek: (w) => saves.set(w.week, store.saveWeek({ ...w, currentWeek, firstKickoff: firstKickoffOf(schedule, w.week) })),
    });
    for (const w of load.warnings) if (!warnings.includes(w.code)) warnings.push(w.code);
  }
  const weeks: WeekResult[] = [];
  for (const p of plan) {
    const firstKickoff = p.firstKickoff !== null ? new Date(p.firstKickoff).toISOString() : null;
    const save = saves.get(p.week);
    if (!p.ahead || !save) {
      const reason = !p.ahead ? (p.firstKickoff !== null ? "kicked off" : "kickoff unknown") : "projections unavailable";
      weeks.push({ week: p.week, firstKickoff, status: "not fetched", reason });
      continue;
    }
    const s = await save;
    weeks.push({
      week: p.week,
      firstKickoff,
      status: s.status,
      ...(s.status === "saved" ? { replaced: s.replaced } : {}),
      ...(s.status === "skipped" ? { reason: s.reason } : s.status === "failed" ? { reason: s.error } : {}),
    });
  }
  return { season, seasonType, currentWeek, weeks, warnings };
}

/** Reads the cache alone (FantasyCalcGate.down: nothing is asked of FantasyCalc; neither of its memories is touched). */
const CACHE_ONLY: FantasyCalcGate = { down: () => "the snapshot reads the cache first", saw: () => {}, rejected: () => undefined, sawFormat: () => {} };

/**
 * A format's list of today (the header's step 3): the cache's copy when FantasyCalc served it today (no request), else the
 * model build's loader (FantasyCalc asked only past TTL.fantasyCalc, through its outage memory and its memory of answers the
 * checks turned down); a list from another day (a saved copy standing in) is "not today's list".
 */
export async function todaysList(http: HttpClient, format: FantasyCalcFormat, now: Date): Promise<{ load: FantasyCalcValuesLoad } | { skip: "not today's list" | "unavailable" }> {
  const day = utcDay(now.getTime());
  const today = (l: FantasyCalcValuesLoad) => l.fetchedAt !== undefined && Number.isFinite(l.fetchedAt) && utcDay(l.fetchedAt) === day;
  try {
    const cached = await loadFantasyCalcValues(http, format, { gate: CACHE_ONLY });
    if (today(cached)) return { load: cached };
  } catch {
    // No copy in the cache: ask below.
  }
  try {
    const load = await loadFantasyCalcValues(http, format, { gate: fantasyCalcGate(http, now) });
    return today(load) ? { load } : { skip: "not today's list" };
  } catch {
    return { skip: "unavailable" };
  }
}

async function snapshotFantasyCalc(http: HttpClient, store: SnapshotStore, now: Date, perDay: number): Promise<FantasyCalcPart> {
  const day = utcDay(now.getTime());
  const [usedToday, usedYesterday, savedDays] = await Promise.all([store.formatsUsed(day), store.formatsUsed(utcDay(now.getTime() - DAY_MS)), store.savedDays(day)]);
  const saved = new Set([...savedDays].filter(([, d]) => d === day).map(([k]) => k));
  const order = formatsToSave(usedToday, usedYesterday, savedDays);
  const todo = order.filter((k) => !saved.has(k));
  const room = Math.max(0, perDay - saved.size);
  const lists: ListResult[] = [];
  const turn = todo.slice(0, room);
  const overCapFormats = todo.slice(room);
  // The cap was reached (the keys are in the answer; the log takes no keys): beta:log shows on which days it binds.
  if (overCapFormats.length) logEvent({ event: "snapshot_over_cap", platform: "fantasycalc" });
  let outOfTime = 0;
  for (const [i, key] of turn.entries()) {
    // Inside the route the deadline bounds the run (outside one, in scripts and tests, there is none).
    if (timeLeftMs() < snapshotLimits.listMinTimeLeftMs) {
      outOfTime = turn.length - i;
      break;
    }
    const format = parseFormatKey(key);
    if (!format) continue; // formatsToSave keeps valid keys only
    const got = await todaysList(http, format, now);
    if ("skip" in got) {
      lists.push({ format: key, status: "skipped", reason: got.skip });
      continue;
    }
    const s = await store.saveList(got.load);
    lists.push({ format: key, status: s.status, ...(s.status === "skipped" ? { reason: s.reason } : s.status === "failed" ? { reason: s.error } : {}) });
  }
  return { day, inUse: order.length, savedBefore: saved.size, lists, overCap: overCapFormats.length, ...(overCapFormats.length ? { overCapFormats } : {}), ...(outOfTime ? { outOfTime } : {}) };
}

/** What the levels read of the weeks (levelWeeks). */
export interface LevelWeeksRead {
  /** The weeks read with a real projection in them, as the loader's onWeek hook got them, in week order. */
  read: SleeperProjectionWeek[];
  /** Weeks Sleeper answered without a single projection. */
  empty: number[];
  /** Weeks that couldn't be read, or weren't asked once an earlier one couldn't be. */
  unread: number[];
  /** The loader's warning codes, each once. */
  warnings: string[];
}

/**
 * The weeks of a day's levels (the header's step 4), through the model build's own loader (loadSleeperWeeklyProjections:
 * the offense group, each week's cache policy and MODEL_PROJECTIONS_REDUCER, so a model build's copy of a week serves here
 * and the other way round) and a gate of its own (sleeperGate: its outage memory is the server instance's, so a Sleeper the
 * projections just found down isn't asked again). That gate is wrapped to see each week's own answer and to keep it all or
 * nothing: once a week can't be read (the gate's own failures: no answer, a 429, 5xx or a web page, the deadline or a
 * budget; an error status or a body that isn't a list; or a body with rows the schema can't read and no projection among
 * the rest), the weeks after it aren't asked for, since nothing will be saved today. A week answered with rows the schema
 * can read but no real projection in them is empty, not unread. ⚠️ Ours: a week with a few rows the schema can't read
 * beside real projections is read as a model build reads it (those rows skipped, the loader's PROJECTION_ROWS_UNREADABLE),
 * so one malformed row doesn't cost the day.
 */
export async function levelWeeks(http: HttpClient, now: Date, season: number, weeks: readonly number[], currentWeek: number): Promise<LevelWeeksRead> {
  const positions = sleeperRequestPositions(OFFENSE_POSITIONS);
  const weekOf = new Map(weeks.map((w) => [sleeperUrls.projections(season, w, positions), w] as const));
  const answered = new Set<number>();
  let failed: Extract<SleeperRows, { why: string }> | undefined;
  const inner = sleeperGate(http, now);
  const gate: SleeperGate = {
    down: () => inner.down(),
    async rows(url, policy, reducer) {
      // All-or-nothing: a week already missing means nothing is saved today, so the rest aren't asked for (each says why,
      // as the first one's failure: a SLEEPER_DOWN warning when Sleeper stopped answering, else the week's own).
      if (failed) return { ...failed };
      const got = await inner.rows(url, policy, reducer);
      const week = weekOf.get(url);
      if ("why" in got) failed = { why: got.why, ...(got.down ? { down: true as const } : {}) };
      else if (got.bad > 0 && !got.rows.some((r) => hasProjection(r.stats))) failed = { why: "rows the schema can't read, and no projection among the rest" };
      else if (week !== undefined) answered.add(week);
      return got;
    },
  };
  const read: SleeperProjectionWeek[] = [];
  const load = await loadSleeperWeeklyProjections(gate, season, weeks, OFFENSE_POSITIONS, { currentWeek, onWeek: (w) => read.push(w) });
  const gotWeeks = new Set(read.map((w) => w.week));
  return {
    read: read.sort((a, b) => a.week - b.week),
    empty: weeks.filter((w) => answered.has(w) && !gotWeeks.has(w)),
    unread: weeks.filter((w) => !answered.has(w)),
    warnings: [...new Set(load.warnings.map((w) => w.code))],
  };
}

/**
 * The day's rest-of-season levels (the header's step 4; src/server/projectionLevels.ts): skipped with too little of the
 * route's deadline left (snapshotLimits.levelsMinTimeLeftMs; outside a route there's no deadline), out of season, with no
 * week ahead, or when a week can't be read (all or nothing); else the day's record, saved once (the first kept). Reads the
 * run's calendar (readCalendar, by default its own) and Sleeper's lists, and writes its one key: nothing of FantasyCalc,
 * the formats in use or the other parts' records.
 */
export async function snapshotLevels(http: HttpClient, store: SnapshotStore, now: Date, calendar: () => Promise<SnapshotCalendar> = () => readCalendar(http)): Promise<LevelsPart> {
  const day = utcDay(now.getTime());
  const skipped = (reason: LevelsSkip, more: Partial<LevelsPart> = {}): LevelsPart => ({ day, status: "skipped", reason, read: [], players: 0, warnings: [], ...more });
  if (timeLeftMs() < snapshotLimits.levelsMinTimeLeftMs) return skipped("out of time");
  const cal = await calendar();
  if ("skipped" in cal) return skipped(cal.skipped, cal.skipped === "not in season" ? { ...(cal.season !== undefined ? { season: cal.season } : {}), seasonType: cal.seasonType } : {});
  const { season, seasonType, currentWeek, schedule } = cal;
  const head = { season, seasonType, currentWeek };
  // ⚠️ A day files under its own NFL season (seasonOfDay: snapshot:pull finds a season's records by it), so a preseason that
  // Sleeper already calls next season's before March isn't filed (ours: such levels would be next season's placeholders).
  if (seasonOfDay(day) !== season) return skipped("not in season", { ...head, warnings: [...cal.warnings] });
  const fromWeek = levelsFromWeek(currentWeek, schedule, now.getTime());
  if (fromWeek === null) return skipped("no week ahead", { ...head, warnings: [...cal.warnings] });
  const toWeek = LAST_NFL_WEEK;
  const weeks = Array.from({ length: toWeek - fromWeek + 1 }, (_, i) => fromWeek + i);
  const got = await levelWeeks(http, now, season, weeks, currentWeek);
  const span = {
    ...head,
    fromWeek,
    toWeek,
    read: got.read.map((w) => w.week),
    ...(got.empty.length ? { empty: got.empty } : {}),
    ...(got.unread.length ? { unread: got.unread } : {}),
    warnings: [...new Set([...cal.warnings, ...got.warnings])],
  };
  if (got.unread.length) return skipped("incomplete", span);
  const record = projectionLevelsOf({ season, day, seasonType, currentWeek, fromWeek, toWeek, weeks: got.read });
  if (!record) return skipped("no projections", span);
  const s = await store.saveLevels(record);
  return { day, status: s.status, ...(s.status === "failed" ? { reason: s.error } : {}), ...span, players: Object.keys(record.players).length };
}

/**
 * One run (see the header): the lock, then the projections, the FantasyCalc lists and the day's levels, each part on its own
 * (one that fails says so, and the others still run), then the lock let go. Sleeper's NFL state and the NFL schedule are read
 * once, by the first part that needs them (readCalendar). A store that can't take the lock rejects (the route answers 503).
 */
export async function runSnapshots(deps: SnapshotRunDeps): Promise<SnapshotRun> {
  const { http, store, now } = deps;
  const lock = await store.lock();
  if (!lock) return { status: "locked", store: store.kind };
  try {
    let calendarRead: Promise<SnapshotCalendar> | undefined;
    const calendar = () => (calendarRead ??= readCalendar(http));
    const projections = await snapshotProjections(http, store, now, calendar).catch((err: unknown): ProjectionsPart => {
      logEvent({ event: "snapshot_projections_failed", errorName: errorNameOf(err) });
      return { weeks: [], warnings: [], error: errorNameOf(err) };
    });
    const fantasyCalc = await snapshotFantasyCalc(http, store, now, deps.formatsPerDay ?? snapshotLimits.fantasyCalcFormatsPerDay).catch((err: unknown): FantasyCalcPart => {
      logEvent({ event: "snapshot_fantasycalc_failed", errorName: errorNameOf(err) });
      return { day: utcDay(now.getTime()), inUse: 0, savedBefore: 0, lists: [], overCap: 0, error: errorNameOf(err) };
    });
    // Last, behind its own time guard (snapshotLimits.levelsMinTimeLeftMs), so the parts above keep the time they always had.
    const levels = await snapshotLevels(http, store, now, calendar).catch((err: unknown): LevelsPart => {
      logEvent({ event: "snapshot_levels_failed", errorName: errorNameOf(err) });
      return { day: utcDay(now.getTime()), status: "failed", read: [], players: 0, warnings: [], error: errorNameOf(err) };
    });
    return { status: "done", store: store.kind, projections, fantasyCalc, levels };
  } finally {
    await lock.release();
  }
}
