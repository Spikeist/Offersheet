/**
 * FantasyCalc value archive (planner reply to Checkpoint 4, change 7; CLAUDE.md §2.9, §2.10). Phase 6 backtests the
 * market blend (§6 step 8, config.marketBlend) against the values the market held during the season, but FantasyCalc
 * serves only today's values (/values/current). So every FantasyCalc list a model build reads (modelInputs.ts
 * buildModelInputs: the League page under `npm run dev` or the stable copy, `npm run league:report -- --live`,
 * `npm run trade:report -- --live`; the reports read a saved dump without --live) is also kept,
 * one copy per format per day, in git-ignored data-local/, next to the pre-game projection snapshots (§2.3):
 *
 *   data-local/fantasycalc-snapshots/<season>/<YYYY-MM-DD>/<format key>.json.gz  (gzip)
 *   { version: 1, format: { isDynasty, numQbs, numTeams, ppr, tep? }, fetchedAt: ISO,
 *     players: { <FantasyCalc player id>: { sleeperId?, espnId?, pos, value, redraftValue?, overallRank?, positionRank? } } }
 *
 * - FantasyCalc's terms (reports/probe-output/shared.md FC.terms): caching their responses is encouraged ("ideally
 *   retrieving results once per day"), only the documented endpoints may be called, and "reproducing or creating a
 *   material substitute for substantial portions of FantasyCalc's content on another website is prohibited". This
 *   archive adds no request (it keeps only lists the build already read, through the same 24-hour cache), calls no
 *   other endpoint, and stays on this computer: data-local/ is git-ignored, so nothing is committed or published.
 *   ⚠️ Our reading: consistent with those terms.
 * - Only what a backtest of the blend needs: per player, his ids for the join (Sleeper's, the canonical id, §4; ESPN's
 *   for players without one), FantasyCalc's position and his value in the requested format, plus redraftValue (the
 *   baseline redraft number, src/data/fantasyCalcValues.ts) and FantasyCalc's ranks (overallRank, positionRank) when the
 *   loaded rows carry them: the loader keeps both since Phase 4b (the 2026-10-03 file holds them for 197 of 197 players).
 *   Draft picks (PICK rows) are left out. No league data: `format` holds the request's parameters only (not the league's
 *   settings or the Import Report's substitution notes), and the lists are the same for every league in that format.
 * - Which day and season: the UTC day of the list's fetchedAt (when FantasyCalc served it; a cached copy keeps its
 *   original time, so reading it again files nothing new), and the NFL season that day falls in (src/lib/season.ts
 *   defaultSeason: the calendar year, or last year in January and February). ⚠️ Our reading of the design's
 *   "<season>": the values don't belong to a league, so a list read by leagues of two seasons is filed once.
 * - The format key names the file: "<redraft|dynasty>-<1|2>qb-<n>team-ppr<0|0.5|1>" plus "-teplus" / "-teplusplus"
 *   for tep te+ / te++ (CLAUDE.md §0.7: only characters every file system takes). A format it can't name (anything
 *   outside FantasyCalc's parameters) is skipped.
 * - Merge rule: the first stored copy of a day is kept (each format is fetched at most once a day anyway, §2.10). A
 *   list without a fetch time, or without a single player, is skipped. An unreadable file is replaced; a file in
 *   another format version is left alone.
 * - The pure core (fantasyCalcFormatKey, archiveDay, fantasyCalcSnapshotLocation, archivedValues,
 *   fantasyCalcSnapshotOf, mergeFantasyCalcSnapshot, fantasyCalcListsIn) is tested without disk. The fs layer
 *   (createFantasyCalcArchiver) follows the projection archive's rules (src/server/projectionArchive.ts): atomic writes
 *   (a temp file, then a rename, retried while Windows briefly locks the target), one write at a time per file within
 *   the process, and a memory of the files known to be stored, so the League page's repeated builds cost no disk I/O.
 *   Two processes filing the same day's list at the same moment (the dev server and a script) both write the same list;
 *   the later rename wins.
 * - Never throws into callers: a failure is logged by the error's NAME only (never a path or a URL), and the build
 *   goes on. buildModelInputs hands the lists over and doesn't wait (archiveFantasyCalcLists).
 * - Enabled only where there is a local disk, by the projection archive's rule (projectionArchiveEnabled): off in
 *   production, on Vercel and under Vitest (tests pass an archiver explicitly); on under `npm run dev` and tsx scripts,
 *   and in the stable copy (scripts/stable.ts sets DATA_LOCAL_ENV to the main folder's data-local/, which is then where
 *   the lists go: projectionArchive.ts dataLocalRoot).
 * - Server-only in spirit (node:fs, node:zlib), but it doesn't import "server-only", so tsx scripts can use it.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { z } from "zod";
import type { FantasyCalcRequest } from "@/data/fantasyCalcValues";
import { defaultSeason } from "@/lib/season";
import { dataLocalRoot, projectionArchiveEnabled } from "./projectionArchive";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const FANTASYCALC_ARCHIVE_VERSION = 1;

/** The archive's folder, relative to the project root (git-ignored with the rest of /data-local/). */
export const FANTASYCALC_ARCHIVE_DIR = path.join("data-local", "fantasycalc-snapshots");

/** One player as archived (see the header). */
export interface ArchivedValue {
  /** Sleeper's id (the canonical id when known, §4), when FantasyCalc gives one. */
  sleeperId?: string;
  /** ESPN's id, when FantasyCalc gives one. */
  espnId?: string;
  /** FantasyCalc's position (QB, RB, WR or TE). */
  pos: string;
  /** His value in the requested format (§9 v_i). */
  value: number;
  /** FantasyCalc's baseline redraft number (12 teams, PPR, no TE premium), when the row has one. */
  redraftValue?: number;
  /** FantasyCalc's own ranks, when the loaded rows carry them (see the header). */
  overallRank?: number;
  positionRank?: number;
}

/** The request's parameters (FantasyCalcRequest): what `format` holds in a file. */
export type ArchivedFormat = FantasyCalcRequest;

/** One day's copy of one format's list (see the header). */
export interface FantasyCalcSnapshot {
  version: typeof FANTASYCALC_ARCHIVE_VERSION;
  format: ArchivedFormat;
  /** When FantasyCalc served the list (ISO). */
  fetchedAt: string;
  /** FantasyCalc player id → his values. */
  players: Record<string, ArchivedValue>;
}

const valueSchema = z.object({
  sleeperId: z.string().optional(),
  espnId: z.string().optional(),
  pos: z.string(),
  value: z.number(),
  redraftValue: z.number().optional(),
  overallRank: z.number().optional(),
  positionRank: z.number().optional(),
});
const formatSchema = z.object({
  isDynasty: z.boolean(),
  numQbs: z.union([z.literal(1), z.literal(2)]),
  numTeams: z.number().int(),
  ppr: z.union([z.literal(0), z.literal(0.5), z.literal(1)]),
  tep: z.enum(["te+", "te++"]).optional(),
});
/** The file's shape (read back by the fs layer and Phase 6). */
export const fantasyCalcSnapshotSchema = z.object({
  version: z.literal(FANTASYCALC_ARCHIVE_VERSION),
  format: formatSchema,
  fetchedAt: z.string(),
  players: z.record(z.string(), valueSchema),
});

// ---------------------------------------------------------------------------------------------
// The pure core

/** A loaded row as the archive reads it: FantasyCalcValueRow's fields it keeps, plus the ranks when a loader keeps them. */
export interface ArchivableRow {
  fantasyCalcId: string;
  sleeperId: string | null;
  espnId: string | null;
  position: string;
  value: number;
  redraftValue: number | null;
  overallRank?: number | null;
  positionRank?: number | null;
}

/** One loaded list (a FantasyCalcValuesLoad fits): its format, its player rows and when FantasyCalc served it. */
export interface FantasyCalcArchiveInput {
  format: ArchivedFormat;
  players: readonly ArchivableRow[];
  /** Epoch ms; undefined: skipped (no day to file it under). */
  fetchedAt?: number;
}

/** Why a list wasn't archived at all. */
export type FantasyCalcArchiveSkip = "no fetch time" | "unknown format" | "no players";

/** FantasyCalc's tep values and their file-name parts (a Map: an object would also "know" "toString", "__proto__"…). */
const TEP_KEY: ReadonlyMap<unknown, string> = new Map([
  ["te+", "-teplus"],
  ["te++", "-teplusplus"],
]);

/**
 * The file name of a format (pure; see the header): "redraft-1qb-10team-ppr0.5", "dynasty-2qb-12team-ppr1-teplus", …;
 * null for parameters FantasyCalc doesn't take (so nothing outside the known set can reach a path).
 */
export function fantasyCalcFormatKey(f: ArchivedFormat): string | null {
  if (typeof f.isDynasty !== "boolean" || (f.numQbs !== 1 && f.numQbs !== 2)) return null;
  if (!Number.isInteger(f.numTeams) || f.numTeams < 1 || f.numTeams > 99) return null;
  if (f.ppr !== 0 && f.ppr !== 0.5 && f.ppr !== 1) return null;
  // A falsy tep is no TE premium, as in the request (fantasyCalcValuesUrl leaves it out).
  const tep = f.tep ? TEP_KEY.get(f.tep) : "";
  if (tep === undefined) return null;
  return `${f.isDynasty ? "dynasty" : "redraft"}-${f.numQbs}qb-${f.numTeams}team-ppr${f.ppr}${tep}`;
}

/** The UTC day of an epoch-ms time, "YYYY-MM-DD" (pure); null when it isn't a time. */
export function archiveDay(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Where a list is filed. */
export interface FantasyCalcSnapshotLocation {
  season: number;
  day: string;
  key: string;
}

/** Where a list goes (pure; see the header), or why it can't be archived (before any player is read). */
export function fantasyCalcSnapshotLocation(list: Pick<FantasyCalcArchiveInput, "format" | "fetchedAt">): { location: FantasyCalcSnapshotLocation } | { skipped: FantasyCalcArchiveSkip } {
  const day = archiveDay(list.fetchedAt);
  if (day === null) return { skipped: "no fetch time" };
  const key = fantasyCalcFormatKey(list.format);
  if (key === null) return { skipped: "unknown format" };
  return { location: { season: defaultSeason(new Date(list.fetchedAt as number)), day, key } };
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const filled = (x: string | null | undefined): x is string => typeof x === "string" && x.trim() !== "";

/**
 * The players as archived (pure): per FantasyCalc id (the first row wins), the fields in the header; a row without an
 * id or a finite value is left out, and ids and ranks only when present.
 */
export function archivedValues(rows: readonly ArchivableRow[]): Record<string, ArchivedValue> {
  const out: Record<string, ArchivedValue> = {};
  for (const row of rows) {
    const id = String(row.fantasyCalcId ?? "").trim();
    if (!id || Object.hasOwn(out, id) || !finite(row.value)) continue;
    out[id] = {
      ...(filled(row.sleeperId) ? { sleeperId: row.sleeperId.trim() } : {}),
      ...(filled(row.espnId) ? { espnId: row.espnId.trim() } : {}),
      pos: String(row.position ?? "").trim(),
      value: row.value,
      ...(finite(row.redraftValue) ? { redraftValue: row.redraftValue } : {}),
      ...(finite(row.overallRank) ? { overallRank: row.overallRank } : {}),
      ...(finite(row.positionRank) ? { positionRank: row.positionRank } : {}),
    };
  }
  return out;
}

/** The request's parameters only (pure): what a file's `format` holds (never the league's substitution notes). */
export function archivedFormat(f: ArchivedFormat): ArchivedFormat {
  return { isDynasty: f.isDynasty, numQbs: f.numQbs, numTeams: f.numTeams, ppr: f.ppr, ...(f.tep ? { tep: f.tep } : {}) };
}

/** A list's day copy and where it goes (pure), or why it can't be archived. */
export function fantasyCalcSnapshotOf(list: FantasyCalcArchiveInput): { location: FantasyCalcSnapshotLocation; record: FantasyCalcSnapshot } | { skipped: FantasyCalcArchiveSkip } {
  const where = fantasyCalcSnapshotLocation(list);
  if ("skipped" in where) return where;
  const players = archivedValues(list.players);
  if (!Object.keys(players).length) return { skipped: "no players" };
  return {
    location: where.location,
    record: { version: FANTASYCALC_ARCHIVE_VERSION, format: archivedFormat(list.format), fetchedAt: new Date(list.fetchedAt as number).toISOString(), players },
  };
}

/** The merge rule (pure): the day's file keeps the first copy stored; `write` says whether `fresh` goes to disk. */
export function mergeFantasyCalcSnapshot(stored: FantasyCalcSnapshot | null, fresh: FantasyCalcSnapshot): { record: FantasyCalcSnapshot; write: boolean } {
  return stored ? { record: stored, write: false } : { record: fresh, write: true };
}

/** A loaded list (pure check): an object with a `format` object and a `players` array (a FantasyCalcValuesLoad). */
function isList(x: unknown): x is FantasyCalcArchiveInput {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const { format, players } = x as { format?: unknown; players?: unknown };
  return !!format && typeof format === "object" && Array.isArray(players);
}

/**
 * Every loaded list in a build's FantasyCalc loads (pure; modelInputs.ts FantasyCalcLoads): its own list, a keeper
 * league's redraft list, and any list a league type adds later, in field order. /players (an array of ids, no values)
 * and missing lists are skipped, so a new list is archived without touching the hook.
 */
export function fantasyCalcListsIn(loads: object | null | undefined): FantasyCalcArchiveInput[] {
  return loads ? Object.values(loads).filter(isList) : [];
}

// ---------------------------------------------------------------------------------------------
// The fs layer

/** The archive file of a list: <root>/<season>/<YYYY-MM-DD>/<format key>.json.gz. */
export function fantasyCalcSnapshotFile(root: string, location: FantasyCalcSnapshotLocation): string {
  return path.join(root, String(location.season), location.day, `${location.key}.json.gz`);
}

/**
 * Reads one archive file: the snapshot, or null when there is none. Throws when it can't be read or isn't a snapshot of
 * this format version (Phase 6 reads files this way).
 */
export async function readFantasyCalcSnapshot(file: string): Promise<FantasyCalcSnapshot | null> {
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const json: unknown = JSON.parse((await gunzipAsync(body)).toString("utf8"));
  return fantasyCalcSnapshotSchema.parse(json) as FantasyCalcSnapshot;
}

/** What the fs layer finds on disk: a snapshot, none, one it can't read (replaced), or one of another version (left alone). */
type StoredFile = { snapshot: FantasyCalcSnapshot | null } | { unreadable: true } | { otherVersion: true };

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
  if (typeof version === "number" && version !== FANTASYCALC_ARCHIVE_VERSION) return { otherVersion: true };
  const parsed = fantasyCalcSnapshotSchema.safeParse(json);
  return parsed.success ? { snapshot: parsed.data as FantasyCalcSnapshot } : { unreadable: true };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Writes a snapshot atomically: a temp file next to it, then a rename (retried while Windows briefly locks the target). */
async function writeSnapshot(file: string, record: FantasyCalcSnapshot): Promise<void> {
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

/** What archive() did with a list. */
export type FantasyCalcArchiveOutcome =
  | { status: "archived"; file: string }
  /** The day's file already holds a copy (the first one is kept). */
  | { status: "unchanged"; file: string }
  | { status: "skipped"; reason: FantasyCalcArchiveSkip }
  /** Error name only (never a path or a URL); "OtherVersion" when the day's file is in another format version (left alone). */
  | { status: "failed"; error: string };

export interface FantasyCalcArchiver {
  /**
   * Archives one loaded list when its day's file doesn't hold a copy yet. The checks run at once; the disk work runs in
   * the background, one write at a time per file, so the caller (a model build) never waits for it. The promise says
   * what happened and never rejects.
   */
  archive(list: FantasyCalcArchiveInput): Promise<FantasyCalcArchiveOutcome>;
  /** Resolves once every archive() so far has finished (tests await it; the app doesn't). */
  flush(): Promise<void>;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function logFailure(err: unknown): void {
  console.error(`[offer-sheet] FantasyCalc archive: a list wasn't archived (${errorName(err)})`);
}

/**
 * The fs archiver under `root` (default: fantasycalc-snapshots in DATA_LOCAL_ENV's folder when it's set, the stable copy;
 * else data-local/fantasycalc-snapshots in the working directory).
 */
export function createFantasyCalcArchiver(opts: { root?: string } = {}): FantasyCalcArchiver {
  const dataLocal = dataLocalRoot();
  // Literal segments (= FANTASYCALC_ARCHIVE_DIR), like the projection archive's: the bundler's file tracing resolves
  // this one folder instead of guessing. ⚠️ So once the folder exists, `next build` lists its files in the model
  // routes' traces (it already lists data-local/, fixtures/ and .cache/ files for several routes): a deploy built on
  // this computer (vercel build, --prebuilt) would upload them. Before Phase 7, next.config.ts should leave data-local/,
  // fixtures/, .cache/ and reports/ out of tracing (outputFileTracingExcludes). A Git-based deploy doesn't have them.
  const root = opts.root ?? (dataLocal ? path.join(dataLocal, "fantasycalc-snapshots") : path.join(process.cwd(), "data-local", "fantasycalc-snapshots"));
  /** Files known to hold their day's copy (written here, or found on disk). */
  const stored = new Set<string>();
  /** File → the tail of its write queue. */
  const queues = new Map<string, Promise<unknown>>();
  const pending = new Set<Promise<unknown>>();

  function enqueue(file: string, task: () => Promise<FantasyCalcArchiveOutcome>): Promise<FantasyCalcArchiveOutcome> {
    const run = (queues.get(file) ?? Promise.resolve()).then(task, task);
    queues.set(file, run);
    pending.add(run);
    void run.then(() => {
      pending.delete(run);
      if (queues.get(file) === run) queues.delete(file);
    });
    return run;
  }

  async function write(file: string, fresh: FantasyCalcSnapshot): Promise<FantasyCalcArchiveOutcome> {
    try {
      if (stored.has(file)) return { status: "unchanged", file };
      const found = await readStored(file);
      if ("otherVersion" in found) return { status: "failed", error: "OtherVersion" };
      if ("unreadable" in found) console.error("[offer-sheet] FantasyCalc archive: an unreadable snapshot is replaced");
      const { record, write: changed } = mergeFantasyCalcSnapshot("snapshot" in found ? found.snapshot : null, fresh);
      if (changed) await writeSnapshot(file, record);
      stored.add(file);
      return changed ? { status: "archived", file } : { status: "unchanged", file };
    } catch (err) {
      logFailure(err);
      return { status: "failed", error: errorName(err) };
    }
  }

  const done = (outcome: FantasyCalcArchiveOutcome): Promise<FantasyCalcArchiveOutcome> => Promise.resolve(outcome);

  return {
    archive(list) {
      try {
        // Where it goes first (cheap), so a list already filed costs no work: the League page builds again and again.
        const where = fantasyCalcSnapshotLocation(list);
        if ("skipped" in where) return done({ status: "skipped", reason: where.skipped });
        const file = fantasyCalcSnapshotFile(root, where.location);
        if (stored.has(file)) return done({ status: "unchanged", file });
        // Built now, so the loaded rows aren't kept while the write waits its turn.
        const built = fantasyCalcSnapshotOf(list);
        if ("skipped" in built) return done({ status: "skipped", reason: built.skipped });
        return enqueue(file, () => write(file, built.record));
      } catch (err) {
        logFailure(err);
        return done({ status: "failed", error: errorName(err) });
      }
    },
    async flush() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}

/**
 * Hands every list in a build's FantasyCalc loads to the archive (fantasyCalcListsIn), without waiting: fire and
 * forget, never throws (modelInputs.ts buildModelInputs). No archiver or no loads: nothing.
 */
export function archiveFantasyCalcLists(archiver: FantasyCalcArchiver | null | undefined, loads: object | null | undefined): void {
  if (!archiver || !loads) return;
  try {
    for (const list of fantasyCalcListsIn(loads)) void Promise.resolve(archiver.archive(list)).catch(() => {});
  } catch (err) {
    logFailure(err);
  }
}

/**
 * Whether this process may write the archive: only where there is a local disk, by the projection archive's rule
 * (projectionArchiveEnabled: off in production, on Vercel and under Vitest; on under `npm run dev`, tsx scripts and the
 * stable copy, which sets DATA_LOCAL_ENV).
 */
export function fantasyCalcArchiveEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return projectionArchiveEnabled(env);
}

let processArchiver: FantasyCalcArchiver | null | undefined;

/** The process's archiver (one per process, so its per-file queue and memory are shared), or null when disabled. */
export function defaultFantasyCalcArchiver(): FantasyCalcArchiver | null {
  if (processArchiver === undefined) processArchiver = fantasyCalcArchiveEnabled() ? createFantasyCalcArchiver() : null;
  return processArchiver;
}
