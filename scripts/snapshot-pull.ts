/**
 * Copies the daily snapshot cron's archive from the shared store into the local archives (planner reply to Checkpoint 7a,
 * §6.3: "Download: npm run snapshot:pull copies them to data-local/ for Phase 6"; since Checkpoint 7c the daily
 * rest-of-season levels too, planner reply to Checkpoint 7b, question 4; what the cron saves and where:
 * src/server/snapshots.ts).
 *
 *   npm run snapshot:pull -- --live                    production's snapshots (Vercel runs the cron on production only)
 *   npm run snapshot:pull -- --live --env preview      a preview's (only if someone called its cron route by hand)
 *
 * - It talks to Upstash, so it runs only with --live (planner reply to Checkpoint 4c, A5; scripts/lib/runMode.ts). It reads
 *   with the store's read-only token (READONLY_STORE_URL and READONLY_STORE_TOKEN in .env.local, typed in by hand as for
 *   `npm run beta:log`: scripts/lib/storeReader.ts). The app never reads those names, and uses the store on Vercel only.
 * - Read-only in the store: for each season the store can still hold (this one and the two before: it keeps two seasons),
 *   one MGET of the 18 weeks' projection records and one SMEMBERS of each day's FantasyCalc index the store can still hold
 *   (the season's days of the last snapshotLimits.retainDays: pullDays; PULL_DAY_BATCH at a time), then one MGET for each
 *   PULL_BATCH lists not on disk yet, and one for each PULL_BATCH of those days whose levels aren't on disk yet (a day
 *   without a record, out of season or before the cron ran, comes back empty). Every record is checked before it's
 *   written: it unpacks, has the local archive's shape and version, and is what its key says (season, week; format, day;
 *   season, day). One that isn't is counted, never written.
 * - Writes the local archives' own files (git-ignored data-local/, or OFFERSHEET_DATA_LOCAL's folder when it's set, as the
 *   stable copy's): data-local/projection-snapshots/<season>/week-WW.json.gz, merged with a file already there
 *   (src/server/projectionArchive.ts mergeProjectionSnapshots: each position's later pre-kickoff fetch wins),
 *   data-local/fantasycalc-snapshots/<season>/<YYYY-MM-DD>/<format>.json.gz, never replacing a day's file already there
 *   (the archive keeps a day's first copy; either is that day's list), and data-local/projection-levels/<season>/
 *   <YYYY-MM-DD>.json.gz (src/server/projectionLevels.ts), likewise never replacing a day's file. A file in another format
 *   version is left alone. Running it again writes only what's new.
 * - Deletes, on every run, the local FantasyCalc lists of days past the store's own rule (src/server/snapshots.ts
 *   dayExpired: retainDays after the day began; pruneLocalLists), so the copies it made keep the privacy page's "up to 2
 *   seasons": which formats were in use on a day is kept no longer here than in the store (review of Phase 7b). Lists this
 *   computer's own League page builds filed (src/server/fantasyCalcArchive.ts) share those folders and go by the same rule.
 *   Sleeper's projections and the daily levels come from no one's use and are kept.
 * - Prints counts, seasons, weeks and days only: the data is public (Sleeper's projections and levels, FantasyCalc's values).
 */
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { LAST_NFL_WEEK } from "@/adapters/sleeper/normalize";
import { defaultSeason } from "@/lib/season";
import { fantasyCalcArchiveRoot, fantasyCalcFormatKey, fantasyCalcSnapshotFile, readStoredFantasyCalcFile, unpackFantasyCalcSnapshot, writeFantasyCalcSnapshotFile, type FantasyCalcSnapshot } from "@/server/fantasyCalcArchive";
import { snapshotLimits } from "@/server/limits";
import { mergeProjectionSnapshots, projectionArchiveRoot, projectionSnapshotFile, readStoredProjectionFile, unpackProjectionSnapshot, writeProjectionSnapshotFile, type ProjectionSnapshot } from "@/server/projectionArchive";
import { projectionLevelsFile, projectionLevelsRoot, readStoredProjectionLevelsFile, unpackProjectionLevels, writeProjectionLevelsFile, type ProjectionLevels } from "@/server/projectionLevels";
import { keyPrefix, type RedisLike } from "@/server/redis";
import { DAY_PATTERN, dayExpired, daysFromTo, fantasyCalcIndexKey, fantasyCalcSnapshotKey, parseFormatKey, projectionLevelsKey, projectionSnapshotKey, seasonOfDay, utcDay } from "@/server/snapshots";
import { flagValue, isMainModule, requireLive } from "./lib/runMode";
import { openStoreReader, storeFailureText } from "./lib/storeReader";

export const PULL_ENVS = ["production", "preview"] as const;
export type PullEnv = (typeof PULL_ENVS)[number];

/** Lists, or days' levels, asked for in one MGET (each about 6–12 KB stored). */
export const PULL_BATCH = 50;

/** Days' indexes asked for at once (one SMEMBERS each: a season is up to 366 of them). */
export const PULL_DAY_BATCH = 10;

const DAY_MS = 24 * 60 * 60_000;

/** The command line (see the header), or what's wrong with it. */
export function snapshotPullArgs(argv: readonly string[]): { env: PullEnv } | { error: string } {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--env") {
      i++;
      continue;
    }
    if (a !== "--live") return { error: `Unknown option "${a}". Usage: npm run snapshot:pull -- --live [--env production|preview]` };
  }
  const env = flagValue(argv, "--env") ?? (argv.includes("--env") ? "" : "production");
  if (!(PULL_ENVS as readonly string[]).includes(env)) return { error: `--env takes ${PULL_ENVS.join(" or ")}.` };
  return { env: env as PullEnv };
}

/** The seasons the store can still hold at `now`, oldest first: this one and the two before (it keeps two seasons). */
export function pullSeasons(now: number): number[] {
  const season = defaultSeason(new Date(now));
  return [season - 2, season - 1, season];
}

/**
 * The days of `season` whose FantasyCalc index the store can still hold at `now`, oldest first: those of the last
 * snapshotLimits.retainDays days (a day's index goes retainDays after the day began: src/server/snapshots.ts dayRetainMs).
 */
export function pullDays(season: number, now: number): string[] {
  return daysFromTo(utcDay(now - snapshotLimits.retainDays * DAY_MS), utcDay(now)).filter((d) => seasonOfDay(d) === season && !dayExpired(d, now));
}

/** Where the files go: the local archives' folders (default: data-local/ as the app's archives choose it). */
export interface PullRoots {
  projections: string;
  fantasyCalc: string;
  levels: string;
}

export interface SeasonPull {
  season: number;
  projections: { inStore: number; written: number[]; current: number; invalid: number; otherVersion: number };
  fantasyCalc: { indexed: number; written: number; here: number; gone: number; invalid: number; otherVersion: number };
  /** The days' levels: found in the store (of the days not on disk), written, already here (not asked for), refused. */
  levels: { inStore: number; written: number; here: number; invalid: number; otherVersion: number };
}

/** A week's record from the store, checked (the header), or why it can't be used. */
export async function projectionRecordOf(text: string, season: number, week: number): Promise<ProjectionSnapshot | "invalid" | "otherVersion"> {
  const found = await unpackProjectionSnapshot(Buffer.from(text, "base64"));
  if ("otherVersion" in found) return "otherVersion";
  if (!("snapshot" in found)) return "invalid";
  return found.snapshot.season === season && found.snapshot.week === week ? found.snapshot : "invalid";
}

/** A list from the store, checked (the header: its format and its fetch day are its key's), or why it can't be used. */
export async function listRecordOf(text: string, season: number, entry: { day: string; key: string }): Promise<FantasyCalcSnapshot | "invalid" | "otherVersion"> {
  const found = await unpackFantasyCalcSnapshot(Buffer.from(text, "base64"));
  if ("otherVersion" in found) return "otherVersion";
  if (!("snapshot" in found)) return "invalid";
  const s = found.snapshot;
  const at = Date.parse(s.fetchedAt);
  const ok = fantasyCalcFormatKey(s.format) === entry.key && Number.isFinite(at) && utcDay(at) === entry.day && seasonOfDay(entry.day) === season;
  return ok ? s : "invalid";
}

/** A day's levels from the store, checked (the header: its season and day are its key's), or why they can't be used. */
export async function levelsRecordOf(text: string, season: number, day: string): Promise<ProjectionLevels | "invalid" | "otherVersion"> {
  const found = await unpackProjectionLevels(Buffer.from(text, "base64"));
  if ("otherVersion" in found) return "otherVersion";
  if (!("levels" in found)) return "invalid";
  return found.levels.season === season && found.levels.day === day ? found.levels : "invalid";
}

/** One season's records copied into the local archives (see the header); `now` decides which days' indexes are read (pullDays). */
export async function pullSeason(redis: Pick<RedisLike, "mget" | "smembers">, prefix: string, season: number, roots: PullRoots, now: number): Promise<SeasonPull> {
  const out: SeasonPull = {
    season,
    projections: { inStore: 0, written: [], current: 0, invalid: 0, otherVersion: 0 },
    fantasyCalc: { indexed: 0, written: 0, here: 0, gone: 0, invalid: 0, otherVersion: 0 },
    levels: { inStore: 0, written: 0, here: 0, invalid: 0, otherVersion: 0 },
  };

  const weeks = Array.from({ length: LAST_NFL_WEEK }, (_, i) => i + 1);
  const texts = await redis.mget(...weeks.map((w) => projectionSnapshotKey(prefix, season, w)));
  for (const [i, text] of texts.entries()) {
    if (text === null) continue;
    const week = weeks[i] as number;
    out.projections.inStore++;
    const record = await projectionRecordOf(text, season, week);
    if (record === "invalid" || record === "otherVersion") {
      out.projections[record]++;
      continue;
    }
    const file = projectionSnapshotFile(roots.projections, season, week);
    const local = await readStoredProjectionFile(file);
    if ("otherVersion" in local) {
      out.projections.otherVersion++;
      continue;
    }
    // An unreadable local file is replaced, as the fs layer replaces one.
    const { record: merged, replaced } = mergeProjectionSnapshots("snapshot" in local ? local.snapshot : null, record);
    if (!replaced.length) {
      out.projections.current++;
      continue;
    }
    await writeProjectionSnapshotFile(file, merged);
    out.projections.written.push(week);
  }

  // Each day's index (src/server/snapshots.ts: one set a day of the format keys saved that day), a few days at a time.
  const days = pullDays(season, now);
  const entries: Array<{ day: string; key: string }> = [];
  for (let i = 0; i < days.length; i += PULL_DAY_BATCH) {
    const batch = days.slice(i, i + PULL_DAY_BATCH);
    const sets = await Promise.all(batch.map((day) => redis.smembers(fantasyCalcIndexKey(prefix, { season, day }))));
    for (const [j, keys] of sets.entries()) {
      const day = batch[j] as string;
      for (const key of keys) if (parseFormatKey(key) !== null) entries.push({ day, key });
    }
  }
  entries.sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key));
  out.fantasyCalc.indexed = entries.length;
  const missing = entries.filter((e) => {
    const here = existsSync(fantasyCalcSnapshotFile(roots.fantasyCalc, { season, ...e }));
    if (here) out.fantasyCalc.here++;
    return !here;
  });
  for (let i = 0; i < missing.length; i += PULL_BATCH) {
    const batch = missing.slice(i, i + PULL_BATCH);
    const values = await redis.mget(...batch.map((e) => fantasyCalcSnapshotKey(prefix, { season, ...e })));
    for (const [j, text] of values.entries()) {
      const entry = batch[j] as { day: string; key: string };
      if (text === null) {
        out.fantasyCalc.gone++; // expired since its index was read (a day's lists and index go together: dayRetainMs)
        continue;
      }
      const record = await listRecordOf(text, season, entry);
      if (record === "invalid" || record === "otherVersion") {
        out.fantasyCalc[record]++;
        continue;
      }
      const file = fantasyCalcSnapshotFile(roots.fantasyCalc, { season, ...entry });
      const local = await readStoredFantasyCalcFile(file);
      if ("otherVersion" in local) {
        out.fantasyCalc.otherVersion++;
        continue;
      }
      if ("snapshot" in local && local.snapshot) {
        out.fantasyCalc.here++; // filed meanwhile: the day's first copy stays
        continue;
      }
      await writeFantasyCalcSnapshotFile(file, record);
      out.fantasyCalc.written++;
    }
  }

  // Each day's levels (src/server/snapshots.ts: one record a UTC day, kept as long as the day's lists), for the days whose
  // file isn't here yet, PULL_BATCH at a time.
  const levelDays = days.filter((day) => {
    const here = existsSync(projectionLevelsFile(roots.levels, season, day));
    if (here) out.levels.here++;
    return !here;
  });
  for (let i = 0; i < levelDays.length; i += PULL_BATCH) {
    const batch = levelDays.slice(i, i + PULL_BATCH);
    const values = await redis.mget(...batch.map((day) => projectionLevelsKey(prefix, season, day)));
    for (const [j, text] of values.entries()) {
      if (text === null) continue; // no record that day
      const day = batch[j] as string;
      out.levels.inStore++;
      const record = await levelsRecordOf(text, season, day);
      if (record === "invalid" || record === "otherVersion") {
        out.levels[record]++;
        continue;
      }
      const file = projectionLevelsFile(roots.levels, season, day);
      const local = await readStoredProjectionLevelsFile(file);
      if ("otherVersion" in local) {
        out.levels.otherVersion++;
        continue;
      }
      if ("levels" in local && local.levels) {
        out.levels.here++; // filed meanwhile: the day's first record stays
        continue;
      }
      await writeProjectionLevelsFile(file, record);
      out.levels.written++;
    }
  }
  return out;
}

/** What pruneLocalLists deleted: day folders, and the lists in them. */
export interface LocalPrune {
  days: number;
  lists: number;
}

/**
 * Deletes the local FantasyCalc lists of every day past the store's own rule (src/server/snapshots.ts dayExpired: retainDays
 * after the day began; the header), one day folder at a time under `<root>/<season>/<YYYY-MM-DD>/`. Nothing else is
 * touched: another name in the folders is left alone, and a folder that can't be read is skipped.
 */
export async function pruneLocalLists(root: string, now: number): Promise<LocalPrune> {
  const out: LocalPrune = { days: 0, lists: 0 };
  let seasons: string[];
  try {
    seasons = await readdir(root);
  } catch {
    return out; // no archive here yet
  }
  for (const season of seasons) {
    if (!/^\d{4}$/.test(season)) continue;
    let days: string[];
    try {
      days = await readdir(path.join(root, season));
    } catch {
      continue; // not a folder
    }
    for (const day of days) {
      if (!DAY_PATTERN.test(day) || !dayExpired(day, now)) continue;
      const dir = path.join(root, season, day);
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        continue; // not a folder
      }
      await rm(dir, { recursive: true, force: true });
      out.days++;
      out.lists += files.filter((f) => f.endsWith(".json.gz")).length;
    }
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The report (pure): counts, weeks and where the files went, and the local lists pruned (pruneLocalLists) when there were any. */
export function formatSnapshotPull(env: PullEnv, seasons: readonly SeasonPull[], roots: PullRoots, root: string, pruned: LocalPrune = { days: 0, lists: 0 }): string {
  const rel = (p: string) => (path.relative(root, p) || ".").split(path.sep).join("/");
  const lines = [`Offer Sheet snapshot archive: ${env}'s store, seasons ${seasons.map((s) => s.season).join(", ")}.`];
  for (const s of seasons) {
    const p = s.projections;
    const f = s.fantasyCalc;
    const l = s.levels;
    if (!p.inStore && !f.indexed && !l.inStore && !l.here) {
      lines.push(`  ${s.season}: nothing in the store.`);
      continue;
    }
    const proj = [
      `${plural(p.inStore, "week")} in the store`,
      p.written.length ? `${p.written.length} written (week${p.written.length === 1 ? "" : "s"} ${p.written.join(", ")})` : "none new",
      ...(p.current ? [`${p.current} already up to date`] : []),
      ...(p.invalid ? [`${p.invalid} unreadable, skipped`] : []),
      ...(p.otherVersion ? [`${p.otherVersion} in another format version, left alone`] : []),
    ];
    const lists = [
      `${plural(f.indexed, "list")} indexed`,
      `${f.written} written`,
      ...(f.here ? [`${f.here} already here`] : []),
      ...(f.gone ? [`${f.gone} expired`] : []),
      ...(f.invalid ? [`${f.invalid} unreadable, skipped`] : []),
      ...(f.otherVersion ? [`${f.otherVersion} in another format version, left alone`] : []),
    ];
    const levels = [
      l.written ? `${plural(l.written, "day")} written` : "none new",
      ...(l.here ? [`${l.here} already here`] : []),
      ...(l.invalid ? [`${l.invalid} unreadable, skipped`] : []),
      ...(l.otherVersion ? [`${l.otherVersion} in another format version, left alone`] : []),
    ];
    lines.push(`  ${s.season}: projections: ${proj.join(", ")}.`, `  ${s.season}: FantasyCalc: ${lists.join(", ")}.`, `  ${s.season}: daily levels: ${levels.join(", ")}.`);
  }
  lines.push(
    `Files: ${rel(roots.projections)}/<season>/week-WW.json.gz, ${rel(roots.fantasyCalc)}/<season>/<day>/<format>.json.gz and ${rel(roots.levels)}/<season>/<day>.json.gz (git-ignored).`,
  );
  if (pruned.days > 0) {
    lines.push(`Deleted ${plural(pruned.lists, "local FantasyCalc list")} of ${plural(pruned.days, "day")} more than ${snapshotLimits.retainDays} days ago, as the store deletes them.`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  requireLive({ script: "snapshot:pull", what: "reads the daily snapshot cron's archive from the shared store (Upstash)" });
  const args = snapshotPullArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(args.error);
    process.exit(1);
  }
  const { ROOT, loadEnv } = await import("./lib/env");
  loadEnv();
  // The store, read-only: the scripts' own variables and a token that can't write (scripts/lib/storeReader.ts).
  const store = await openStoreReader(process.env);
  if ("error" in store) {
    console.error(store.error);
    process.exit(1);
  }
  const redis = store.reader;
  // The local archives' folders, chosen as the app chooses them (the stable copy's OFFERSHEET_DATA_LOCAL included), from the
  // project folder.
  process.chdir(ROOT);
  const roots: PullRoots = { projections: projectionArchiveRoot(), fantasyCalc: fantasyCalcArchiveRoot(), levels: projectionLevelsRoot() };
  const prefix = keyPrefix({ VERCEL_ENV: args.env });
  const now = Date.now();
  // The store's own retention for the local copies first (the header), then what's new.
  const pruned = await pruneLocalLists(roots.fantasyCalc, now);
  const seasons: SeasonPull[] = [];
  for (const season of pullSeasons(now)) seasons.push(await pullSeason(redis, prefix, season, roots, now));
  console.log(formatSnapshotPull(args.env, seasons, roots, ROOT, pruned));
}

if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    // Only the error's name: an Upstash error's message carries the command (scripts/lib/storeReader.ts).
    console.error(storeFailureText("snapshot:pull", err));
    process.exit(1);
  });
}
