/**
 * Daily rest-of-season levels (planner reply to Checkpoint 7b, question 4: "Daily rest-of-season levels: yes, if they come
 * only from public projections: standard scoring formats only, never per league, and never blended with trade values. Keep
 * them 730 days, like the other snapshots."). Phase 6 re-measures base-rate stability on them (reports/stability.md): the
 * pre-game archive (src/server/projectionArchive.ts) keeps only the current and the next week, each before its own kickoff,
 * while the later weeks' daily moves drive the swings, and a level per player per day is the practical form of every
 * remaining week's projections. The daily snapshot cron saves one record a UTC day (src/server/snapshots.ts snapshotLevels):
 *
 *   data-local/projection-levels/<season>/<YYYY-MM-DD>.json.gz  (gzip; the shared store keeps the same bytes in base64)
 *   { version: 1, season, day, seasonType, currentWeek, fromWeek, toWeek,
 *     weeks: { <week>: { fetchedAt: ISO | null, lastModified: epoch ms | null } },
 *     players: { <sleeperId>: [<Sleeper position>, <standard>, <half-PPR>, <PPR>, <week mask>] } }
 *
 * - The weeks: fromWeek, the first week whose first kickoff was still ahead when the run started (so a day's level never
 *   mixes in a week whose games are being played; snapshots.ts levelsFromWeek), through toWeek, week 18 (the NFL's regular
 *   season, whatever a league's own weeks). `weeks` names each week read, when Sleeper served it (a cached copy keeps its own
 *   time: ⚠️ a later week's copy can be up to 24 hours old, CLAUDE.md §2.10, so two days can read the same pull) and its
 *   stamp: the latest last_modified of the players it projects in the offense group, each player's latest over all his rows
 *   (weekStamp: the pre-game archive's per-group rule, projectionArchive.ts archivedGroups). Only a real projection counts,
 *   so the stamp doesn't depend on the body's form: the model form the cron usually reads keeps no stub row
 *   (src/data/reduce.ts MODEL_PROJECTIONS_REDUCER, which gives each real row its player's latest stamp), while a body with a
 *   row the schema can't read comes as Sleeper sent it. A player Sleeper only stubs that week (ruled out, say) doesn't move
 *   it. (Review of Checkpoint 7c: the latest over every row read gave one pull two stamps, one per form.) A week Sleeper
 *   answered with no projection in it is absent.
 * - A player's level in each format is the mean of Sleeper's own fantasy-point totals, pts_std, pts_half_ppr and pts_ppr
 *   (LEVEL_TOTALS: Sleeper's default standard, half-PPR and PPR scoring, as Sleeper computes them for every player), over
 *   the weeks his row is a real projection (hasProjection: never a stub for a bye, an injury or a player without a team)
 *   that carries all three: reports/stability.md's "his mean healthy Sleeper projection from this week on". Rounded to
 *   LEVEL_DECIMALS (Sleeper publishes 2). The mask has bit (w − 1) set for each such week w, so Phase 6 has the count (his
 *   rest-of-season points are the level times it) and sees a week flip between projected and stub (the 2-pull rule's
 *   guard). A real row without the three totals (a kick or punt returner's: return yards only) isn't counted, and a player
 *   with no counted week is left out.
 * - Never a league's: no league's scoring (Sleeper's totals as served: nothing here scores a stat), no model projection (so
 *   never the market blend), no FantasyCalc value, and nothing about any league or the formats in use, so the record is the
 *   same for everyone. src/server/projectionLevels.test.ts computes and saves levels with league scoring, the blend, the
 *   market values and FantasyCalc's loader all made to throw.
 * - The offense only (src/adapters/sleeper/fetch.ts OFFENSE_POSITIONS: QB, RB, WR, TE, K and DEF; fullbacks come with the
 *   RBs), the group every non-IDP League page build reads (IDP has no standard format, and its group isn't one most builds
 *   share). A row naming no offense position is left out (the pre-game archive's rowGroups); the first real row per player
 *   wins, as in the loader. A player's position is his row's in the earliest week counted.
 * - The pure core (projectionLevelsOf) and the codec (packProjectionLevels, unpackProjectionLevels: a file's exact bytes)
 *   are tested without disk. The fs layer writes atomically (a temp file, then a rename, retried while Windows briefly
 *   locks the target) and keeps a day's first record, as the store's SET NX does (saveProjectionLevelsFile); an unreadable
 *   file, or one that isn't the day's, is replaced, and one in another format version is left alone.
 * - Server-only in spirit (node:fs, node:zlib), but it doesn't import "server-only", so tsx scripts (snapshot:pull) can use
 *   it.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { z } from "zod";
import { OFFENSE_POSITIONS } from "@/adapters/sleeper/fetch";
import { hasProjection, LAST_NFL_WEEK } from "@/adapters/sleeper/normalize";
import type { SleeperStatRow } from "@/adapters/sleeper/schemas";
import type { HttpResponse } from "@/adapters/types";
import { sleeperPositionOf } from "@/data/sleeperProjections";
import { errorNameOf, logEvent } from "./log";
import { dataLocalRoot, lastModifiedById, rowGroups } from "./projectionArchive";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const PROJECTION_LEVELS_VERSION = 1;

/** The local copies' folder, relative to the project root (git-ignored with the rest of /data-local/). */
export const PROJECTION_LEVELS_DIR = path.join("data-local", "projection-levels");

/** Sleeper's own fantasy-point totals a level averages, in the record's order: standard, half-PPR, PPR (see the header). */
export const LEVEL_TOTALS = ["pts_std", "pts_half_ppr", "pts_ppr"] as const;

/** Decimals a level keeps (Sleeper publishes its totals with 2). */
export const LEVEL_DECIMALS = 2;

/** One week a day's levels read. */
export interface ProjectionLevelWeek {
  /** When Sleeper served the copy read (ISO; a cached copy keeps its own time), or null when the response doesn't say. */
  fetchedAt: string | null;
  /** The latest last_modified of the week's real offense projections (epoch ms; see the header), or null when none says. */
  lastModified: number | null;
}

/** A player's levels: his Sleeper position, his mean standard, half-PPR and PPR points, and the mask of the weeks counted. */
export type PlayerLevels = [pos: string, std: number, halfPpr: number, ppr: number, mask: number];

/** One UTC day's record (see the header). */
export interface ProjectionLevels {
  version: typeof PROJECTION_LEVELS_VERSION;
  season: number;
  /** The run's UTC day ("YYYY-MM-DD"). */
  day: string;
  /** Sleeper's season type that day ("regular", "pre"). */
  seasonType: string;
  /** Sleeper's current NFL week that day (in the preseason: 1). */
  currentWeek: number;
  /** The first week counted and the last (week 18). */
  fromWeek: number;
  toWeek: number;
  /** Week → when it was served; a week absent wasn't read (Sleeper answered it with no projection). */
  weeks: Record<string, ProjectionLevelWeek>;
  /** Sleeper id → his levels. */
  players: Record<string, PlayerLevels>;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const week = z.number().int().min(1).max(LAST_NFL_WEEK);
const weekSchema = z.object({ fetchedAt: z.string().nullable(), lastModified: z.number().nullable() });
const levelsSchema = z.tuple([z.string(), z.number(), z.number(), z.number(), z.number().int().min(1).max(2 ** LAST_NFL_WEEK - 1)]);
/** The record's shape (read back by the fs layer, snapshot:pull and Phase 6). */
export const projectionLevelsSchema = z.object({
  version: z.literal(PROJECTION_LEVELS_VERSION),
  season: z.number().int(),
  day: z.string().regex(DAY),
  seasonType: z.string(),
  currentWeek: week,
  fromWeek: week,
  toWeek: week,
  weeks: z.record(z.string().regex(/^\d{1,2}$/), weekSchema),
  players: z.record(z.string().min(1), levelsSchema),
});

// ---------------------------------------------------------------------------------------------
// The pure core

/** One week as the loader read it (a SleeperProjectionWeek fits): its rows, and the response (when it was served; its rows' last_modified). */
export interface ProjectionLevelsWeekInput {
  week: number;
  rows: readonly SleeperStatRow[];
  res: Pick<HttpResponse, "fetchedAt" | "json">;
}

/** What a day's record is made of: the run's calendar and the weeks read. */
export interface ProjectionLevelsInput {
  season: number;
  day: string;
  seasonType: string;
  currentWeek: number;
  fromWeek: number;
  toWeek: number;
  weeks: readonly ProjectionLevelsWeekInput[];
}

/** A row's three totals (Sleeper's own, in LEVEL_TOTALS order), or null when it doesn't carry all three as numbers. */
function totalsOf(stats: Readonly<Record<string, unknown>> | null | undefined): [number, number, number] | null {
  const [std, half, ppr] = LEVEL_TOTALS.map((k) => stats?.[k]);
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  return finite(std) && finite(half) && finite(ppr) ? [std, half, ppr] : null;
}

function roundLevel(x: number): number {
  const scale = 10 ** LEVEL_DECIMALS;
  const r = Math.round(x * scale) / scale;
  return r === 0 ? 0 : r; // no -0
}

/**
 * A week's stamp (see the header): the latest last_modified of the players with a real projection placed in the offense
 * group, each player's latest over all his rows (lastModifiedById reads the response's own rows; the schema drops the
 * field), or null when none says. A stub row counts only for a player who also has a real row, so the model form and
 * Sleeper's body agree.
 */
function weekStamp(w: ProjectionLevelsWeekInput): number | null {
  const stamps = lastModifiedById(w.res.json);
  let latest: number | null = null;
  for (const row of w.rows) {
    if (!hasProjection(row.stats) || !rowGroups(row, OFFENSE_POSITIONS).length) continue;
    const at = stamps.get(String(row.player_id));
    if (at !== undefined) latest = latest === null ? at : Math.max(latest, at);
  }
  return latest;
}

function isoOf(ms: number | undefined): string | null {
  return ms !== undefined && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * A day's record (pure; see the header): every week in [fromWeek, toWeek] read (a week given twice: its first copy; weeks
 * outside the span ignored), and each offense player's levels over the weeks his first real row carries Sleeper's three
 * totals. Null when no player has a counted week (nothing to save). Players go in by id, so the same weeks always give the
 * same bytes.
 */
export function projectionLevelsOf(input: ProjectionLevelsInput): ProjectionLevels | null {
  const { fromWeek, toWeek } = input;
  const counted = new Map<string, { pos: string; sums: [number, number, number]; n: number; mask: number }>();
  const weeks: Record<string, ProjectionLevelWeek> = {};
  const inSpan = input.weeks.filter((w) => Number.isInteger(w.week) && w.week >= fromWeek && w.week <= toWeek).sort((a, b) => a.week - b.week);
  for (const w of inSpan) {
    if (Object.hasOwn(weeks, String(w.week))) continue;
    weeks[String(w.week)] = { fetchedAt: isoOf(w.res.fetchedAt), lastModified: weekStamp(w) };
    const seen = new Set<string>();
    for (const row of w.rows) {
      const id = String(row.player_id);
      if (seen.has(id) || !hasProjection(row.stats)) continue;
      seen.add(id); // the first real row per player wins (the loader's rule)
      if (!rowGroups(row, OFFENSE_POSITIONS).length) continue;
      const totals = totalsOf(row.stats);
      if (!totals) continue;
      let p = counted.get(id);
      if (!p) counted.set(id, (p = { pos: sleeperPositionOf(row), sums: [0, 0, 0], n: 0, mask: 0 }));
      p.sums[0] += totals[0];
      p.sums[1] += totals[1];
      p.sums[2] += totals[2];
      p.n += 1;
      p.mask |= 1 << (w.week - 1);
    }
  }
  if (!counted.size) return null;
  const players: Record<string, PlayerLevels> = {};
  for (const id of [...counted.keys()].sort()) {
    const p = counted.get(id) as { pos: string; sums: [number, number, number]; n: number; mask: number };
    players[id] = [p.pos, roundLevel(p.sums[0] / p.n), roundLevel(p.sums[1] / p.n), roundLevel(p.sums[2] / p.n), p.mask];
  }
  return {
    version: PROJECTION_LEVELS_VERSION,
    season: input.season,
    day: input.day,
    seasonType: input.seasonType,
    currentWeek: input.currentWeek,
    fromWeek,
    toWeek,
    weeks,
    players,
  };
}

/** The weeks a mask names, in order (pure; Phase 6 and the tests read a player's weeks this way). */
export function maskWeeks(mask: number): number[] {
  const out: number[] = [];
  for (let w = 1; w <= LAST_NFL_WEEK; w++) if (mask & (1 << (w - 1))) out.push(w);
  return out;
}

// ---------------------------------------------------------------------------------------------
// The codec: a day's record as stored, in a file or (base64) in the shared store

/** A record's stored bytes: the gzip of its JSON (a file's whole content; src/server/snapshots.ts keeps them in base64). */
export async function packProjectionLevels(record: ProjectionLevels): Promise<Buffer> {
  return gzipAsync(Buffer.from(JSON.stringify(record), "utf8"));
}

/** What stored bytes hold: a record, one that can't be read, or one of another format version (left alone). */
export type UnpackedProjectionLevels = { levels: ProjectionLevels } | { unreadable: true } | { otherVersion: true };

/** Stored bytes back to a record (see UnpackedProjectionLevels); never throws. */
export async function unpackProjectionLevels(body: Buffer): Promise<UnpackedProjectionLevels> {
  let json: unknown;
  try {
    json = JSON.parse((await gunzipAsync(body)).toString("utf8"));
  } catch {
    return { unreadable: true };
  }
  const version = (json as { version?: unknown } | null)?.version;
  if (typeof version === "number" && version !== PROJECTION_LEVELS_VERSION) return { otherVersion: true };
  const parsed = projectionLevelsSchema.safeParse(json);
  return parsed.success ? { levels: parsed.data as ProjectionLevels } : { unreadable: true };
}

// ---------------------------------------------------------------------------------------------
// The fs layer

/**
 * The local copies' folder: projection-levels in the stable copy's data-local/ when it's set (DATA_LOCAL_ENV,
 * src/server/projectionArchive.ts dataLocalRoot), else data-local/projection-levels in the working directory.
 */
export function projectionLevelsRoot(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const dataLocal = dataLocalRoot(env);
  // Literal segments (= PROJECTION_LEVELS_DIR), like the archives' folders, so the bundler's file tracing sees one fixed
  // path (next.config.ts leaves data-local/ out of the server bundles' traces).
  return dataLocal ? path.join(dataLocal, "projection-levels") : path.join(process.cwd(), "data-local", "projection-levels");
}

/** The file of a day's record: <root>/<season>/<YYYY-MM-DD>.json.gz. */
export function projectionLevelsFile(root: string, season: number, day: string): string {
  return path.join(root, String(season), `${day}.json.gz`);
}

/** Reads one file: the record, or null when there is none. Throws when it can't be read or isn't a record of this version (Phase 6 reads files this way). */
export async function readProjectionLevels(file: string): Promise<ProjectionLevels | null> {
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const json: unknown = JSON.parse((await gunzipAsync(body)).toString("utf8"));
  return projectionLevelsSchema.parse(json) as ProjectionLevels;
}

/** What a file holds before a write: a record, none, one that can't be read (replaced), or one of another version (left alone). */
export type StoredProjectionLevelsFile = { levels: ProjectionLevels | null } | { unreadable: true } | { otherVersion: true };

/**
 * One file as the fs layer and `npm run snapshot:pull` read it before writing (see StoredProjectionLevelsFile). Throws only
 * when the file exists but can't be read (a lock, say: never overwrite what couldn't be read).
 */
export async function readStoredProjectionLevelsFile(file: string): Promise<StoredProjectionLevelsFile> {
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { levels: null };
    throw err;
  }
  return unpackProjectionLevels(body);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Writes a record atomically: a temp file next to it, then a rename (retried while Windows briefly locks the target). */
export async function writeProjectionLevelsFile(file: string, record: ProjectionLevels): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const body = await packProjectionLevels(record);
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

/** What a save of a day's record did ("unchanged": the day's record was there already: the first is kept). */
export type ProjectionLevelsSave = { status: "saved" } | { status: "unchanged" } | { status: "failed"; error: string };

/**
 * Saves a day's record under `root` unless that day's file holds one already (the first is kept, as the shared store's SET
 * NX keeps it): the local snapshot store's save (`next dev` or the stable copy with CRON_SECRET). Never rejects: a failure
 * is logged by the error's name only (never a path) and comes back by name ("OtherVersion": a file in another format
 * version, left alone).
 */
export async function saveProjectionLevelsFile(root: string, record: ProjectionLevels): Promise<ProjectionLevelsSave> {
  try {
    const file = projectionLevelsFile(root, record.season, record.day);
    const found = await readStoredProjectionLevelsFile(file);
    if ("otherVersion" in found) return { status: "failed", error: "OtherVersion" };
    if ("levels" in found && found.levels && found.levels.season === record.season && found.levels.day === record.day) return { status: "unchanged" };
    if (!("levels" in found) || found.levels) logEvent({ event: "projection_levels_replaced" });
    await writeProjectionLevelsFile(file, record);
    return { status: "saved" };
  } catch (err) {
    logEvent({ event: "projection_levels_failed", errorName: errorNameOf(err) });
    return { status: "failed", error: errorNameOf(err) };
  }
}
