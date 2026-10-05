/**
 * Copies the daily snapshot cron's archive from the shared store into the local archives (planner reply to Checkpoint 7a,
 * §6.3: "Download: npm run snapshot:pull copies them to data-local/ for Phase 6"; what the cron saves and where:
 * src/server/snapshots.ts).
 *
 *   npm run snapshot:pull -- --live                    production's snapshots (Vercel runs the cron on production only)
 *   npm run snapshot:pull -- --live --env preview      a preview's (only if someone called its cron route by hand)
 *
 * - It talks to Upstash, so it runs only with --live (planner reply to Checkpoint 4c, A5; scripts/lib/runMode.ts). It needs
 *   the store's REST address and token in .env.local (KV_REST_API_URL and KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL and
 *   UPSTASH_REDIS_REST_TOKEN) and SESSION_SECRET (src/server/redis.ts gives no client without it), typed in by hand as for
 *   `npm run beta:log`; it says only whether each is set, never a value. Having them there never switches the app itself to
 *   Upstash (Vercel only).
 * - Read-only: for each season the store can still hold (this one and the two before: it keeps two seasons), one MGET of
 *   the 18 weeks' projection records and one SMEMBERS of the FantasyCalc index, then one MGET for each PULL_BATCH lists not
 *   on disk yet. Every record is checked before it's written: it unpacks, has the local archive's shape and version, and is
 *   what its key says (season, week; format, day). One that isn't is counted, never written.
 * - Writes the local archives' own files (git-ignored data-local/, or OFFERSHEET_DATA_LOCAL's folder when it's set, as the
 *   stable copy's): data-local/projection-snapshots/<season>/week-WW.json.gz, merged with a file already there
 *   (src/server/projectionArchive.ts mergeProjectionSnapshots: each position's later pre-kickoff fetch wins), and
 *   data-local/fantasycalc-snapshots/<season>/<YYYY-MM-DD>/<format>.json.gz, never replacing a day's file already there
 *   (the archive keeps a day's first copy; either is that day's list). A file in another format version is left alone.
 *   Running it again writes only what's new.
 * - Prints counts, seasons, weeks and days only: the data is public (Sleeper's projections, FantasyCalc's values).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { LAST_NFL_WEEK } from "@/adapters/sleeper/normalize";
import { defaultSeason } from "@/lib/season";
import { fantasyCalcArchiveRoot, fantasyCalcFormatKey, fantasyCalcSnapshotFile, readStoredFantasyCalcFile, unpackFantasyCalcSnapshot, writeFantasyCalcSnapshotFile, type FantasyCalcSnapshot } from "@/server/fantasyCalcArchive";
import { mergeProjectionSnapshots, projectionArchiveRoot, projectionSnapshotFile, readStoredProjectionFile, unpackProjectionSnapshot, writeProjectionSnapshotFile, type ProjectionSnapshot } from "@/server/projectionArchive";
import { REDIS_OPT_IN_ENV, getRedis, keyPrefix, type RedisLike } from "@/server/redis";
import { fantasyCalcIndexKey, fantasyCalcSnapshotKey, parseIndexEntry, projectionSnapshotKey, seasonOfDay, utcDay } from "@/server/snapshots";
import { flagValue, isMainModule, requireLive } from "./lib/runMode";

export const PULL_ENVS = ["production", "preview"] as const;
export type PullEnv = (typeof PULL_ENVS)[number];

/** Lists asked for in one MGET (each about 6–12 KB stored). */
export const PULL_BATCH = 50;

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

/** Where the files go: the local archives' folders (default: data-local/ as the app's archives choose it). */
export interface PullRoots {
  projections: string;
  fantasyCalc: string;
}

export interface SeasonPull {
  season: number;
  projections: { inStore: number; written: number[]; current: number; invalid: number; otherVersion: number };
  fantasyCalc: { indexed: number; written: number; here: number; gone: number; invalid: number; otherVersion: number };
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

/** One season's records copied into the local archives (see the header). */
export async function pullSeason(redis: Pick<RedisLike, "mget" | "smembers">, prefix: string, season: number, roots: PullRoots): Promise<SeasonPull> {
  const out: SeasonPull = {
    season,
    projections: { inStore: 0, written: [], current: 0, invalid: 0, otherVersion: 0 },
    fantasyCalc: { indexed: 0, written: 0, here: 0, gone: 0, invalid: 0, otherVersion: 0 },
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

  const entries = (await redis.smembers(fantasyCalcIndexKey(prefix, season)))
    .map(parseIndexEntry)
    .filter((e): e is { day: string; key: string } => e !== null && seasonOfDay(e.day) === season)
    .sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key));
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
        out.fantasyCalc.gone++; // expired (the index outlives its oldest lists)
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
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The report (pure): counts, weeks and where the files went. */
export function formatSnapshotPull(env: PullEnv, seasons: readonly SeasonPull[], roots: PullRoots, root: string): string {
  const rel = (p: string) => (path.relative(root, p) || ".").split(path.sep).join("/");
  const lines = [`Offer Sheet snapshot archive: ${env}'s store, seasons ${seasons.map((s) => s.season).join(", ")}.`];
  for (const s of seasons) {
    const p = s.projections;
    const f = s.fantasyCalc;
    if (!p.inStore && !f.indexed) {
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
    lines.push(`  ${s.season}: projections: ${proj.join(", ")}.`, `  ${s.season}: FantasyCalc: ${lists.join(", ")}.`);
  }
  lines.push(`Files: ${rel(roots.projections)}/<season>/week-WW.json.gz and ${rel(roots.fantasyCalc)}/<season>/<day>/<format>.json.gz (git-ignored).`);
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
  process.env[REDIS_OPT_IN_ENV] = "1"; // this --live script reads the shared store on purpose (src/server/redis.ts)
  const redis = getRedis(process.env);
  if (!redis) {
    const state = (names: string[]) => names.map((n) => `${n} ${process.env[n]?.trim() ? "set" : "blank"}`).join(", ");
    console.error(
      `No shared store configured in .env.local (${state(["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"])}; SESSION_SECRET ${(process.env.SESSION_SECRET ?? "").length >= 32 ? "set" : "blank or too short"}). Add the store's REST URL and token to .env.local by hand (Checkpoint 7a's steps say where to find them).`,
    );
    process.exit(1);
  }
  // The local archives' folders, chosen as the app chooses them (the stable copy's OFFERSHEET_DATA_LOCAL included), from the
  // project folder.
  process.chdir(ROOT);
  const roots: PullRoots = { projections: projectionArchiveRoot(), fantasyCalc: fantasyCalcArchiveRoot() };
  const prefix = keyPrefix({ VERCEL_ENV: args.env });
  const seasons: SeasonPull[] = [];
  for (const season of pullSeasons(Date.now())) seasons.push(await pullSeason(redis, prefix, season, roots));
  console.log(formatSnapshotPull(args.env, seasons, roots, ROOT));
}

if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    // Only the error's name: an Upstash error message could carry the store's address.
    console.error(`snapshot:pull failed (${err instanceof Error ? err.name : typeof err}).`);
    process.exit(1);
  });
}
