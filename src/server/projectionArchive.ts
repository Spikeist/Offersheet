/**
 * Pre-game projection archive (CLAUDE.md §2.3 "Pre-game snapshots"; planner reply to Checkpoint 2,
 * answer 4). Sleeper re-stamps a week's projections after its games, so the stat SDs Phase 2 fit on past
 * weeks may understate the forecast error; Phase 6 refits them (§5) on the projections as they stood
 * before each week's first kickoff. Whenever a model build (the League page under `npm run dev`, and
 * `npm run league:report`: modelInputs.ts buildModelInputs) or `npm run snapshot:projections` reads a
 * week's projections fetched before that kickoff, this module keeps the last such snapshot, per week and
 * position, in git-ignored data-local/. Importing a league and the probes archive nothing themselves, and
 * no scheduled task runs; `npm run snapshot:projections` does it by hand:
 *
 *   data-local/projection-snapshots/<season>/week-<WW>.json.gz  (gzip)
 *   { version: 1, season, week, firstKickoff: ISO | null,
 *     groups: { <position>: { fetchedAt: ISO, lastModified: epoch ms | null,
 *                             players: { <sleeperId>: { pos, stats } } } } }
 *
 * - Only the fields we use: rows with a real projection (hasProjection: an ADP-only stub is a bye, an
 *   injury, a depth player or a player without a team), each player's Sleeper position, and his numeric
 *   stats in Sleeper's own keys (the keys /stats uses, so Phase 6 compares like with like), minus the
 *   fantasy-point totals, ADP and rank keys (ARCHIVE_DROPPED_STAT; a team defense's pts_allow is a stat
 *   and stays), rounded to 3 decimals. The first
 *   real row per player wins (as in the loader). lastModified is the latest `last_modified` Sleeper
 *   stamped on the group's rows (read from the raw rows; the schema doesn't keep it).
 * - Groups are the positions the request asked for (Sleeper's position[] filter: a league asks for the
 *   positions it can start, `npm run snapshot:projections` for all nine). A row goes in every requested
 *   group its player's fantasy positions (or position) name, so a fullback sits in RB and a cornerback
 *   in DB, with pos "FB" / "CB"; a team defense (id = team code) is DEF; with one position requested,
 *   every row is that position's (Sleeper filtered it). A row naming no requested position is left out
 *   (counted). A requested position without a single real projection adds no group, so it can't wipe a
 *   stored one.
 * - Merge rule, per group: the new fetch replaces the stored group when it was fetched later than the
 *   stored one AND before the week's first kickoff. The fetch time is the response's fetchedAt, so a
 *   cached copy keeps its original time (reading it again changes nothing); a response without one is
 *   skipped. The first kickoff is the week's earliest known kickoff in the NFL schedule. When it is
 *   unknown (the schedule failed, or every game's time is still TBD), a week after the current NFL week
 *   counts as before its kickoff (it can't have started while the current week's games are on) and the
 *   current week doesn't (can't tell, so it is skipped). So each group ends up holding the last
 *   pre-kickoff fetch of its week.
 * - The pure core (archivedStats, rowGroups, lastModifiedById, archivedGroups, beforeKickoff,
 *   mergeSnapshot, firstKickoffOf) is tested without disk. The fs layer (createProjectionArchiver)
 *   writes atomically (a temp file, then a rename, retried while Windows briefly locks the target; a
 *   crash can leave a small temp file behind), one write at a time per file within the process, and
 *   remembers how far each file is known to be up to date, so the League page's repeated builds (the
 *   same cached copies) cost no disk I/O. Two processes writing the same week at the same moment (the
 *   dev server and the script) can lose one update; the next fetch writes it again. An unreadable
 *   snapshot is replaced; one in another format version is left alone.
 * - Never throws into callers: a failure is logged by the error's NAME only (never a path or a URL) and
 *   the projections load as usual. The data is public (Sleeper's league-independent projections, keyed
 *   by Sleeper player id); nothing about any league is stored.
 * - Enabled only where there is a local disk (projectionArchiveEnabled): off in production (NODE_ENV
 *   "production"), on Vercel and under Vitest (tests pass an archiver explicitly); on under `npm run dev`
 *   and tsx scripts.
 * - Server-only in spirit (node:fs, node:zlib), but it doesn't import "server-only", so tsx scripts can
 *   use it.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { z } from "zod";
import { hasProjection } from "@/adapters/sleeper/normalize";
import type { SleeperStatRow } from "@/adapters/sleeper/schemas";
import type { NflScheduleData } from "@/data/nflSchedule";
import { sleeperPositionOf, type SleeperProjectionWeek } from "@/data/sleeperProjections";
import { POSITIONS } from "@/engine/model";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const PROJECTION_ARCHIVE_VERSION = 1;

/** The archive's folder, relative to the project root (git-ignored with the rest of /data-local/). */
export const PROJECTION_ARCHIVE_DIR = path.join("data-local", "projection-snapshots");

/**
 * Stat keys left out: Sleeper's fantasy-point totals (pts_ppr, pts_half_ppr, pts_std, pts_idp), ADP
 * and ranks (not stats; Phase 6 scores the stats itself). Totals are named one by one: pts_allow and
 * its bracket flags (pts_allow_14_20 …) are a team defense's points allowed, a stat every adapter's D/ST
 * rules score and one Phase 6 refits the SD of (§5), so they're kept, as in the scripts' NON_SCORING_KEY.
 */
export const ARCHIVE_DROPPED_STAT = /^(pts_(ppr|half_ppr|std|idp)$|adp_|pos_adp_|rank)/;

/** Decimals kept per stat (Sleeper publishes 2). */
export const ARCHIVE_STAT_DECIMALS = 3;

export interface ArchivedPlayer {
  /** Sleeper's position for the player ("QB", "FB", "CB", "DEF", …); "" when the row doesn't say. */
  pos: string;
  /** Projected stat means for the game, in Sleeper's keys (see the header). */
  stats: Record<string, number>;
}

export interface ArchivedGroup {
  /** When Sleeper served this fetch (ISO). */
  fetchedAt: string;
  /** The latest last_modified Sleeper stamped on the group's rows (epoch ms), or null when none says. */
  lastModified: number | null;
  /** Sleeper id → his projection. */
  players: Record<string, ArchivedPlayer>;
}

/** One week's archive file (see the header). */
export interface ProjectionSnapshot {
  version: typeof PROJECTION_ARCHIVE_VERSION;
  season: number;
  week: number;
  /** The week's first kickoff as last known (ISO), or null when it wasn't known. */
  firstKickoff: string | null;
  /** Requested position → the last pre-kickoff fetch of it. */
  groups: Record<string, ArchivedGroup>;
}

const playerSchema = z.object({ pos: z.string(), stats: z.record(z.string(), z.number()) });
const groupSchema = z.object({ fetchedAt: z.string(), lastModified: z.number().nullable(), players: z.record(z.string(), playerSchema) });
/** The file's shape (read back by the fs layer, the snapshot script and Phase 6). */
export const projectionSnapshotSchema = z.object({
  version: z.literal(PROJECTION_ARCHIVE_VERSION),
  season: z.number().int(),
  week: z.number().int(),
  firstKickoff: z.string().nullable(),
  groups: z.record(z.string(), groupSchema),
});

// ---------------------------------------------------------------------------------------------
// The pure core

function roundStat(x: number): number {
  const scale = 10 ** ARCHIVE_STAT_DECIMALS;
  const r = Math.round(x * scale) / scale;
  return r === 0 ? 0 : r; // no -0
}

/** A row's stats as archived (pure): finite numbers only, minus ARCHIVE_DROPPED_STAT keys, rounded to 3 decimals. */
export function archivedStats(stats: Readonly<Record<string, unknown>> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(stats ?? {})) {
    if (typeof value !== "number" || !Number.isFinite(value) || ARCHIVE_DROPPED_STAT.test(key)) continue;
    out[key] = roundStat(value);
  }
  return out;
}

/** The requested positions a row belongs to (pure; see the header), in request order; [] when it names none of them. */
export function rowGroups(row: SleeperStatRow, positions: readonly string[]): string[] {
  if (positions.length === 1) return [...positions];
  const named = new Set<string>();
  for (const p of row.player?.fantasy_positions ?? []) named.add(p.trim());
  const own = sleeperPositionOf(row);
  if (own) named.add(own);
  return positions.filter((p) => named.has(p));
}

/** Sleeper id → the latest `last_modified` on its raw rows (pure; rows without one are skipped). */
export function lastModifiedById(rawRows: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(rawRows)) return out;
  for (const row of rawRows as unknown[]) {
    if (!row || typeof row !== "object") continue;
    const { player_id: id, last_modified: at } = row as { player_id?: unknown; last_modified?: unknown };
    if ((typeof id !== "string" && typeof id !== "number") || typeof at !== "number" || !Number.isFinite(at)) continue;
    const key = String(id);
    out.set(key, Math.max(out.get(key) ?? at, at));
  }
  return out;
}

/** A group one fetch adds, before it has a fetch time. */
export type ArchivedGroupBody = Omit<ArchivedGroup, "fetchedAt">;

/**
 * The groups one fetched week adds (pure): per requested position, the first real projection of every
 * player placed in it, and the group's latest last_modified. Positions without a real projection are
 * missing; `unplaced` counts real projections that named no requested position.
 */
export function archivedGroups(
  rows: readonly SleeperStatRow[],
  positions: readonly string[],
  lastModified: ReadonlyMap<string, number> = new Map(),
): { groups: Record<string, ArchivedGroupBody>; unplaced: number } {
  const groups: Record<string, ArchivedGroupBody> = {};
  let unplaced = 0;
  for (const row of rows) {
    if (!hasProjection(row.stats)) continue;
    const into = rowGroups(row, positions);
    if (!into.length) {
      unplaced++;
      continue;
    }
    const at = lastModified.get(row.player_id);
    for (const position of into) {
      const group = (groups[position] ??= { lastModified: null, players: {} });
      if (group.players[row.player_id]) continue; // the first real row wins
      group.players[row.player_id] = { pos: sleeperPositionOf(row), stats: archivedStats(row.stats) };
      if (at !== undefined) group.lastModified = Math.max(group.lastModified ?? at, at);
    }
  }
  return { groups: inPositionOrder(groups), unplaced };
}

/** Canonical position order (QB, RB, WR, TE, K, P, DEF, DL, LB, DB; anything else after, by name). */
function byPosition(a: string, b: string): number {
  const rank = (p: string) => {
    const i = (POSITIONS as readonly string[]).indexOf(p);
    return i < 0 ? POSITIONS.length : i;
  };
  return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Groups in canonical position order, so a file reads the same whichever fetch came first. */
function inPositionOrder<T>(groups: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(groups).sort(([a], [b]) => byPosition(a, b)));
}

/**
 * A fetch at `fetchedAt` was made before the week's first kickoff (pure; the merge rule): before the
 * known first kickoff; when it's unknown, only a week after the current NFL week counts.
 */
export function beforeKickoff(fetchedAt: number, week: number, currentWeek: number, firstKickoff: number | null): boolean {
  if (firstKickoff !== null && Number.isFinite(firstKickoff)) return fetchedAt < firstKickoff;
  return week > currentWeek;
}

/** The week's earliest known kickoff (epoch ms) in the NFL schedule, or null (no schedule, or no known time that week). */
export function firstKickoffOf(schedule: Pick<NflScheduleData, "kickoffs"> | null | undefined, week: number): number | null {
  const times = Object.values(schedule?.kickoffs[week] ?? {}).filter((t) => Number.isFinite(t));
  return times.length ? Math.min(...times) : null;
}

/** One fetched week, ready to merge. */
export interface ArchiveFetch {
  season: number;
  week: number;
  /** The current NFL week (the build's snapshot, or Sleeper's state in the script). */
  currentWeek: number;
  /** The week's earliest known kickoff (epoch ms), or null when unknown. */
  firstKickoff: number | null;
  /** When Sleeper served the response (epoch ms; a cached copy's original time); undefined: skipped. */
  fetchedAt: number | undefined;
  groups: Record<string, ArchivedGroupBody>;
}

/** Why a fetch wasn't archived at all. */
export type ArchiveSkip = "no fetch time" | "after kickoff" | "kickoff unknown" | "no projections";

/** Whether a fetch can go in the archive (pure): the fetch time and kickoff checks, before anything is read. */
export function archiveSkip(fetch: Omit<ArchiveFetch, "groups">): ArchiveSkip | undefined {
  const { fetchedAt, week, currentWeek, firstKickoff } = fetch;
  if (fetchedAt === undefined || !Number.isFinite(fetchedAt)) return "no fetch time";
  if (beforeKickoff(fetchedAt, week, currentWeek, firstKickoff)) return undefined;
  return firstKickoff === null ? "kickoff unknown" : "after kickoff";
}

/**
 * The week's record after one fetch (pure), by the merge rule: nothing changes unless the fetch passes
 * archiveSkip; then each of its groups replaces the stored group of that position when it was fetched
 * later. `replaced` names the groups that changed (empty: nothing to write). A stored record of another
 * season or week is ignored. firstKickoff becomes the fetch's when known, else stays what was stored.
 */
export function mergeSnapshot(stored: ProjectionSnapshot | null, fetch: ArchiveFetch): { record: ProjectionSnapshot; replaced: string[]; skipped?: ArchiveSkip } {
  const base = stored && stored.season === fetch.season && stored.week === fetch.week ? stored : null;
  const knownKickoff = fetch.firstKickoff !== null && Number.isFinite(fetch.firstKickoff) ? new Date(fetch.firstKickoff).toISOString() : null;
  const record: ProjectionSnapshot = {
    version: PROJECTION_ARCHIVE_VERSION,
    season: fetch.season,
    week: fetch.week,
    firstKickoff: knownKickoff ?? base?.firstKickoff ?? null,
    groups: { ...(base?.groups ?? {}) },
  };
  const skipped = archiveSkip(fetch) ?? (Object.keys(fetch.groups).length ? undefined : "no projections");
  if (skipped) return { record, replaced: [], skipped };
  const fetchedAt = fetch.fetchedAt as number;
  const replaced: string[] = [];
  for (const [position, group] of Object.entries(fetch.groups)) {
    const old = record.groups[position];
    const oldAt = old ? Date.parse(old.fetchedAt) : Number.NEGATIVE_INFINITY;
    if (Number.isFinite(oldAt) && !(fetchedAt > oldAt)) continue;
    record.groups[position] = { fetchedAt: new Date(fetchedAt).toISOString(), lastModified: group.lastModified, players: group.players };
    replaced.push(position);
  }
  record.groups = inPositionOrder(record.groups);
  return { record, replaced: replaced.sort(byPosition) };
}

// ---------------------------------------------------------------------------------------------
// The fs layer

/** The archive file of a week: <root>/<season>/week-<WW>.json.gz. */
export function projectionSnapshotFile(root: string, season: number, week: number): string {
  return path.join(root, String(season), `week-${String(week).padStart(2, "0")}.json.gz`);
}

/**
 * Reads one archive file: the snapshot, or null when there is none. Throws when it can't be read or
 * isn't a snapshot of this format (the script and Phase 6 read files this way).
 */
export async function readProjectionSnapshot(file: string): Promise<ProjectionSnapshot | null> {
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const json: unknown = JSON.parse((await gunzipAsync(body)).toString("utf8"));
  return projectionSnapshotSchema.parse(json) as ProjectionSnapshot;
}

/** What the fs layer finds on disk: a snapshot, none, one it can't read (replaced), or one of another version (left alone). */
type StoredFile = { snapshot: ProjectionSnapshot | null } | { unreadable: true } | { otherVersion: true };

async function readStored(file: string): Promise<StoredFile> {
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { snapshot: null };
    throw err; // e.g. a lock: don't overwrite what we couldn't read
  }
  let json: unknown;
  try {
    json = JSON.parse((await gunzipAsync(body)).toString("utf8"));
  } catch {
    return { unreadable: true };
  }
  const version = (json as { version?: unknown } | null)?.version;
  if (typeof version === "number" && version !== PROJECTION_ARCHIVE_VERSION) return { otherVersion: true };
  const parsed = projectionSnapshotSchema.safeParse(json);
  return parsed.success ? { snapshot: parsed.data as ProjectionSnapshot } : { unreadable: true };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Writes a snapshot atomically: a temp file next to it, then a rename (retried while Windows briefly locks the target). */
async function writeSnapshot(file: string, record: ProjectionSnapshot): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const body = await gzipAsync(Buffer.from(JSON.stringify(record), "utf8"));
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, body);
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 5 || !(code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
        await rm(tmp, { force: true }).catch(() => {});
        throw err;
      }
      await sleep(50 * 2 ** attempt);
    }
  }
}

/** One fetched week for the archive: the loader's week (SleeperProjectionWeek) plus what the build knows of the calendar. */
export interface ProjectionArchiveInput extends SleeperProjectionWeek {
  /** The current NFL week. */
  currentWeek: number;
  /** The week's earliest known kickoff (epoch ms; firstKickoffOf), or null when unknown. */
  firstKickoff: number | null;
}

/** What archive() did with a week. */
export type ArchiveOutcome =
  | { status: "archived"; file: string; replaced: string[] }
  /** Every group on disk is as new as this fetch, or newer. */
  | { status: "unchanged"; file: string }
  | { status: "skipped"; reason: ArchiveSkip }
  /** Error name only (never a path or a URL). */
  | { status: "failed"; error: string };

export interface ProjectionArchiver {
  /**
   * Archives one fetched week when the merge rule says so. The checks run at once; the disk work runs
   * in the background, one write at a time per file, so the caller (a model build) never waits for it.
   * The promise says what happened and never rejects.
   */
  archive(input: ProjectionArchiveInput): Promise<ArchiveOutcome>;
  /** Resolves once every archive() so far has finished (the script awaits it; the app doesn't). */
  flush(): Promise<void>;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** The fs archiver under `root` (default: data-local/projection-snapshots in the working directory). */
export function createProjectionArchiver(opts: { root?: string } = {}): ProjectionArchiver {
  // Literal segments (= PROJECTION_ARCHIVE_DIR), like FileCache's default folder, so the bundler's file tracing sees one fixed path.
  const root = opts.root ?? path.join(process.cwd(), "data-local", "projection-snapshots");
  /** File → requested position → the latest fetch time the file is known to hold or to have been checked against. */
  const upTo = new Map<string, Map<string, number>>();
  /** File → the tail of its write queue. */
  const queues = new Map<string, Promise<unknown>>();
  const pending = new Set<Promise<unknown>>();

  /** Every requested position is known to be as new as `fetchedAt` or newer. */
  const knownCurrent = (file: string, positions: readonly string[], fetchedAt: number): boolean => {
    const known = upTo.get(file);
    return !!known && positions.every((p) => (known.get(p) ?? Number.NEGATIVE_INFINITY) >= fetchedAt);
  };
  const noteCurrent = (file: string, positions: Iterable<string>, fetchedAt: number): void => {
    let known = upTo.get(file);
    if (!known) upTo.set(file, (known = new Map()));
    for (const p of positions) known.set(p, Math.max(known.get(p) ?? Number.NEGATIVE_INFINITY, fetchedAt));
  };

  function enqueue(file: string, task: () => Promise<ArchiveOutcome>): Promise<ArchiveOutcome> {
    const run = (queues.get(file) ?? Promise.resolve()).then(task, task);
    queues.set(file, run);
    pending.add(run);
    void run.then(() => {
      pending.delete(run);
      if (queues.get(file) === run) queues.delete(file);
    });
    return run;
  }

  async function write(file: string, fetch: ArchiveFetch, positions: readonly string[]): Promise<ArchiveOutcome> {
    const fetchedAt = fetch.fetchedAt as number;
    try {
      if (knownCurrent(file, positions, fetchedAt)) return { status: "unchanged", file };
      const stored = await readStored(file);
      if ("otherVersion" in stored) return { status: "failed", error: "OtherVersion" };
      if ("unreadable" in stored) console.error("[offer-sheet] projection archive: an unreadable snapshot is replaced");
      const { record, replaced } = mergeSnapshot("snapshot" in stored ? stored.snapshot : null, fetch);
      if (replaced.length) await writeSnapshot(file, record);
      // Every position asked for is now checked against this fetch, and each stored group is as new as its own fetch.
      noteCurrent(file, positions, fetchedAt);
      for (const [position, group] of Object.entries(record.groups)) noteCurrent(file, [position], Date.parse(group.fetchedAt));
      return replaced.length ? { status: "archived", file, replaced } : { status: "unchanged", file };
    } catch (err) {
      console.error(`[offer-sheet] projection archive: a week wasn't archived (${errorName(err)})`);
      return { status: "failed", error: errorName(err) };
    }
  }

  const done = (outcome: ArchiveOutcome): Promise<ArchiveOutcome> => Promise.resolve(outcome);

  return {
    archive(input) {
      try {
        const file = projectionSnapshotFile(root, input.season, input.week);
        const head = { season: input.season, week: input.week, currentWeek: input.currentWeek, firstKickoff: input.firstKickoff, fetchedAt: input.res.fetchedAt };
        const skip = archiveSkip(head);
        if (skip) return done({ status: "skipped", reason: skip });
        const fetchedAt = head.fetchedAt as number;
        if (knownCurrent(file, input.positions, fetchedAt)) return done({ status: "unchanged", file });
        // Built now, so neither the rows nor the raw response are kept while the write waits its turn.
        const { groups } = archivedGroups(input.rows, input.positions, lastModifiedById(input.res.json));
        if (!Object.keys(groups).length) return done({ status: "skipped", reason: "no projections" });
        const positions = [...input.positions];
        return enqueue(file, () => write(file, { ...head, groups }, positions));
      } catch (err) {
        console.error(`[offer-sheet] projection archive: a week wasn't archived (${errorName(err)})`);
        return done({ status: "failed", error: errorName(err) });
      }
    },
    async flush() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}

/**
 * Whether this process may write the archive: only where there is a local disk. Off in production
 * (NODE_ENV "production"), on Vercel, and under Vitest (NODE_ENV "test" or VITEST; tests pass an
 * archiver explicitly); on under `npm run dev` and tsx scripts.
 */
export function projectionArchiveEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.NODE_ENV === "production" || env.NODE_ENV === "test") return false;
  return !env.VERCEL && !env.VITEST;
}

let processArchiver: ProjectionArchiver | null | undefined;

/** The process's archiver (one per process, so its per-file queue and memory are shared), or null when disabled. */
export function defaultProjectionArchiver(): ProjectionArchiver | null {
  if (processArchiver === undefined) processArchiver = projectionArchiveEnabled() ? createProjectionArchiver() : null;
  return processArchiver;
}
