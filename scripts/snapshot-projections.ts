/**
 * Pre-game projection snapshots by hand (CLAUDE.md §2.3 "Pre-game snapshots"; planner reply to
 * Checkpoint 2, answer 4). A model build (the League page under `npm run dev` or the stable copy,
 * `npm run league:report -- --live`) archives every week it loads that was fetched before that week's first kickoff
 * (src/server/projectionArchive.ts; importing a league and the probes don't); this script archives the
 * weeks about to be played even when nobody opens the League page, for example on Wednesday nights.
 * Nothing is scheduled: Parker runs it by hand.
 *
 *   npm run snapshot:projections
 *
 * It reads Sleeper's NFL state (the season and the current week), loads the NFL schedule (first
 * kickoffs; ESPN, cached 7 days), and for the current week and the next one, each while its first
 * kickoff is still ahead, fetches Sleeper's weekly projections for all positions (QB, RB, WR, TE, K,
 * DEF, DL, LB, DB) through the app's own loader, gate, cached HTTP client and archive, so the cache
 * rules (§2.10: a week fetched in the last 6 hours isn't fetched again) and the archive's merge rule
 * apply exactly as in the app. Then it reads each week's file back (it must decompress and have the
 * snapshot's shape) and prints a short table. When the schedule can't be loaded, first kickoffs are
 * unknown and only next week is fetched (the archive can't tell whether the current week has started).
 *
 * No secrets are needed (Sleeper's projections and ESPN's NFL schedule are public), so .env.local isn't
 * loaded; the output is public NFL data only (counts and times). Exit code 1 when a week fetched here
 * couldn't be archived or read back.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { sleeperUrls } from "@/adapters/sleeper/fetch";
import { LAST_NFL_WEEK } from "@/adapters/sleeper/normalize";
import { StateSchema } from "@/adapters/sleeper/schemas";
import { loadNflSchedule, type NflSchedule } from "@/data/nflSchedule";
import { loadSleeperWeeklyProjections, sleeperCacheKey, sleeperGate, sleeperRequestPositions } from "@/data/sleeperProjections";
import { POSITIONS } from "@/engine/model";
import { FileCache, TTL } from "@/server/cache";
import { createHttpClient } from "@/server/http";
import { createProjectionArchiver, firstKickoffOf, PROJECTION_ARCHIVE_DIR, projectionSnapshotFile, readProjectionSnapshot, type ArchiveOutcome, type ProjectionSnapshot } from "@/server/projectionArchive";
import { ROOT } from "./lib/env";
import { isMainModule } from "./lib/runMode";

/** "2026-10-02 00:15 UTC". */
const utc = (ms: number | null | undefined): string => (ms === null || ms === undefined || !Number.isFinite(ms) ? "unknown" : `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`);
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

function outcomeText(o: ArchiveOutcome | undefined): string {
  if (!o) return "not read (see the warnings)";
  switch (o.status) {
    case "archived":
      return `archived (${o.replaced.join(", ")})`;
    case "unchanged":
      return "already archived (same or newer fetch)";
    case "skipped":
      return `skipped: ${o.reason}`;
    case "failed":
      return `FAILED (${o.error})`;
  }
}

/** "QB 72 · RB 141 …" and the groups' fetch times (one, or the oldest and newest). */
function describe(snapshot: ProjectionSnapshot): { counts: string; fetched: string; players: number } {
  const groups = Object.entries(snapshot.groups);
  const order = (p: string) => {
    const i = (POSITIONS as readonly string[]).indexOf(p);
    return i < 0 ? POSITIONS.length : i;
  };
  groups.sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b));
  const counts = groups.map(([p, g]) => `${p} ${Object.keys(g.players).length}`).join(" · ");
  const times = [...new Set(groups.map(([, g]) => Date.parse(g.fetchedAt)))].sort((a, b) => a - b);
  const fetched = times.length <= 1 ? utc(times[0]) : `${utc(times[0])} … ${utc(times.at(-1))}`;
  const players = new Set(groups.flatMap(([, g]) => Object.keys(g.players))).size;
  return { counts, fetched, players };
}

async function main(): Promise<void> {
  const now = new Date();
  const http = createHttpClient({ cache: new FileCache(path.join(ROOT, ".cache", "app")) });
  const archiveRoot = path.join(ROOT, PROJECTION_ARCHIVE_DIR);

  // 1. Sleeper's NFL state: the season and the current week (cached like the Sleeper import's copy, 10 minutes).
  const stateUrl = sleeperUrls.state();
  const stateRes = await http.get(stateUrl, { cache: { key: sleeperCacheKey(stateUrl), ttlMs: TTL.league, retainMs: TTL.league }, bigIntsAsStrings: true });
  if (!stateRes.ok || stateRes.isHtml) throw new Error(`Sleeper's NFL state couldn't be read (${stateRes.status ? `HTTP ${stateRes.status}` : "no response"}). Try again in a few minutes.`);
  const state = StateSchema.parse(stateRes.json);
  const season = Number(state.season);
  const seasonType = state.season_type ?? "unknown";
  if (seasonType !== "regular" && seasonType !== "pre") {
    console.log(`Sleeper says the ${season} NFL season is "${seasonType}", not the regular season or the preseason: no week is about to be played, so there is nothing to snapshot.`);
    return;
  }
  // In the preseason the week about to be played is week 1.
  const currentWeek = seasonType === "pre" ? 1 : Math.max(1, Math.min(LAST_NFL_WEEK, state.week));

  // 2. The NFL schedule, for each week's first kickoff.
  let schedule: NflSchedule | null = null;
  try {
    // Team codes don't matter for kickoff times: ESPN's own abbreviations are kept.
    schedule = await loadNflSchedule(http, season, { defenseId: () => undefined });
  } catch (err) {
    console.log(`The NFL schedule couldn't be loaded (${err instanceof Error ? err.message : "unknown error"}), so first kickoffs are unknown and only next week is fetched.`);
  }

  // 3. The current week and the next one, each while its first kickoff is still ahead.
  const plan = [currentWeek, currentWeek + 1]
    .filter((w) => w <= LAST_NFL_WEEK)
    .map((week) => {
      const kickoff = firstKickoffOf(schedule, week);
      return { week, kickoff, ahead: kickoff !== null ? now.getTime() < kickoff : week > currentWeek };
    });
  const weeks = plan.filter((p) => p.ahead).map((p) => p.week);
  const positions = sleeperRequestPositions(POSITIONS);

  console.log(`Pre-game projection snapshots: ${season} season, current NFL week ${currentWeek} (Sleeper ${seasonType} week ${state.week}), run at ${utc(now.getTime())}.`);
  console.log(`Positions: ${positions.join(", ")}. Archive: ${PROJECTION_ARCHIVE_DIR.split(path.sep).join("/")}/${season}/`);

  // 4. Fetch through the app's loader and gate, archiving every week read.
  const archiver = createProjectionArchiver({ root: archiveRoot });
  const outcomes = new Map<number, Promise<ArchiveOutcome>>();
  const t0 = performance.now();
  const load = weeks.length
    ? await loadSleeperWeeklyProjections(sleeperGate(http, now), season, weeks, positions, {
        currentWeek,
        onWeek: (w) => outcomes.set(w.week, archiver.archive({ ...w, currentWeek, firstKickoff: firstKickoffOf(schedule, w.week) })),
      })
    : undefined;
  await archiver.flush();
  const elapsed = performance.now() - t0;
  for (const w of load?.warnings ?? []) console.log(`Warning ${w.code}: ${w.message}`);

  // 5. Read every week's file back and print the table.
  console.log("");
  console.log("| Week | First kickoff | This run | Players archived per position | Fetched from Sleeper | File |");
  console.log("|---|---|---|---|---|---|");
  let failed = false;
  for (const p of plan) {
    const file = projectionSnapshotFile(archiveRoot, season, p.week);
    const shown = path.relative(ROOT, file).split(path.sep).join("/");
    const outcome = p.ahead ? await outcomes.get(p.week) : undefined;
    const run = p.ahead ? outcomeText(outcome) : p.kickoff !== null ? "not fetched: its first game has kicked off" : "not fetched: its first kickoff is unknown";
    if (p.ahead && (!outcome || outcome.status === "failed")) failed = true;
    let snapshot: ProjectionSnapshot | null = null;
    try {
      snapshot = await readProjectionSnapshot(file);
    } catch (err) {
      failed = true;
      console.log(`| ${p.week} | ${utc(p.kickoff)} | ${run} | the file can't be read back (${err instanceof Error ? err.name : "error"}) | – | ${shown} |`);
      continue;
    }
    if (!snapshot) {
      console.log(`| ${p.week} | ${utc(p.kickoff)} | ${run} | none | – | – |`);
      continue;
    }
    const d = describe(snapshot);
    const size = (await stat(file)).size;
    console.log(`| ${p.week} | ${utc(p.kickoff)} | ${run} | ${d.counts} (${d.players} players) | ${d.fetched} | ${shown} (${kb(size)}) |`);
  }
  console.log("");
  console.log(`Sleeper projections: ${weeks.length ? `${weeks.length} week(s) in ${(elapsed / 1000).toFixed(1)} s (${load?.fromCache ? "all from the 6-hour cache" : "fetched live or from the cache"})` : "no week to fetch"}.`);
  if (failed) process.exitCode = 1;
}

// Run only as a script (an exact path: scripts/lib/runMode.ts isMainModule; a scratch file that imports it starts nothing).
if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    process.exit(1);
  });
}
