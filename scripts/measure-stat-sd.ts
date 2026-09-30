/**
 * Where config.scoring.statSd comes from (CLAUDE.md §5, §15): the residual SD of a week's ACTUAL team
 * defense stats minus Sleeper's PROJECTION for them, per stat, from the cached public,
 * league-independent Sleeper data (no request is made; the probes cache it).
 *
 *   npm run measure:stat-sd              weeks 1–3
 *   npm run measure:stat-sd -- 3 4       chosen weeks
 *
 * Caveat (⚠️): Sleeper re-stamps past weeks' projections after kickoff (Phase 0), so a residual from a
 * cached past week may understate the true forecast error; Phase 6 re-measures on pre-kickoff
 * snapshots. Output is aggregates only (counts, means, SDs).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { CACHE_DIR, readCache } from "./lib/cache";

const SEASON = 2026;
const STATS = ["pts_allow", "yds_allow"] as const;
const weeks = process.argv.slice(2).map(Number).filter((w) => Number.isInteger(w) && w > 0);
const WEEKS = weeks.length ? weeks : [1, 2, 3];

interface Row {
  player_id: string;
  stats?: Record<string, number> | null;
  player?: { position?: string | null } | null;
  last_modified?: number;
}

const isDefense = (r: Row) => r.player?.position === "DEF" || /^[A-Z]{2,3}$/.test(String(r.player_id));

async function cachedStats(week: number): Promise<Row[] | null> {
  const url = `https://api.sleeper.app/stats/nfl/${SEASON}/${week}?season_type=regular`;
  for (const [namespace, key] of [
    ["sleeper-stats", `sleeper:${url}`],
    ["stats", `stats:${url}`],
  ] as const) {
    const hit = await readCache<{ status: number; text: string }>(namespace, key, Number.POSITIVE_INFINITY);
    if (hit?.value.status === 200) return JSON.parse(hit.value.text) as Row[];
  }
  return null;
}

/** Any cached week projection response that includes team defenses (the probes use several URL shapes). */
async function cachedDefenseProjections(week: number): Promise<Row[] | null> {
  const wanted = new RegExp(`projections/nfl/${SEASON}/${week}\\?`);
  for (const namespace of ["sleeper-projections", "projections", "sleeper"]) {
    let files: string[];
    try {
      files = await readdir(path.join(CACHE_DIR, namespace));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const env = JSON.parse(await readFile(path.join(CACHE_DIR, namespace, file), "utf8")) as { value?: { finalUrl?: string; url?: string; status?: number; text?: string } };
        const url = env.value?.finalUrl ?? env.value?.url ?? "";
        if (env.value?.status !== 200 || !wanted.test(url) || !/DEF/.test(url) || !env.value.text) continue;
        const rows = (JSON.parse(env.value.text) as Row[]).filter(isDefense);
        if (rows.length) return rows;
      } catch {
        // not a projections envelope
      }
    }
  }
  return null;
}

function summary(d: number[]): string {
  if (d.length < 2) return `n ${d.length}`;
  const mean = d.reduce((s, x) => s + x, 0) / d.length;
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / (d.length - 1));
  return `n ${d.length}, mean residual ${mean.toFixed(1)}, SD ${sd.toFixed(1)}`;
}

async function main(): Promise<void> {
  const residuals: Record<(typeof STATS)[number], number[]> = { pts_allow: [], yds_allow: [] };
  for (const week of WEEKS) {
    const [actual, projected] = await Promise.all([cachedStats(week), cachedDefenseProjections(week)]);
    if (!actual || !projected) {
      console.log(`week ${week}: ${!actual ? "no cached /stats" : "no cached DEF projections"}; skipped`);
      continue;
    }
    const byId = new Map(actual.filter(isDefense).map((r) => [String(r.player_id), r.stats ?? {}]));
    const stamps = projected.map((r) => r.last_modified).filter((x): x is number => typeof x === "number");
    for (const s of STATS)
      for (const r of projected) {
        const a = byId.get(String(r.player_id))?.[s];
        const p = r.stats?.[s];
        if (typeof a === "number" && typeof p === "number") residuals[s].push(a - p);
      }
    console.log(`week ${week}: ${projected.length} DEF projections; last modified ${stamps.length ? new Date(Math.max(...stamps)).toISOString() : "n/a"}`);
  }
  for (const s of STATS) console.log(`${s}: ${summary(residuals[s])}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
