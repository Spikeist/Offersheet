/**
 * Offline runs of probe:sleeper-codes (CLAUDE.md §0.6: no new crawls of strangers' leagues without
 * asking Parker first; crawlAllowed() in scripts/lib/probe.ts). Without --allow-crawl the salted
 * walk is replayed from the HTTP cache (client.ts offline mode), which reproduces the last crawl
 * exactly while the cache holds it. When the cache has lost part of it, the trimmed records that
 * crawl left in data-local/sleeper-codes/ (git-ignored) are the better sample, so the analysis
 * still runs. This module holds the choice between the two (pure) and the local-record readers.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Current2026, League2026, Prev2025 } from "./crawl";
import type { CrawlStats, Dataset } from "./evaluate";

export interface Sample {
  leagues: League2026[];
  prev: Prev2025[];
  current: Current2026[];
}

/** What a sample covers, most important first: 2026 leagues, previous seasons found, 2026 rosters, pick lists. */
export function sampleSize(s: Sample): [number, number, number, number] {
  return [s.leagues.length, s.prev.filter((p) => p.found).length, s.current.length, s.leagues.filter((l) => l.picks).length];
}

/** -1, 0 or 1 as sample a covers less than, as much as, or more than sample b (sampleSize order). */
export function compareSamples(a: Sample, b: Sample): number {
  const x = sampleSize(a);
  const y = sampleSize(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  return 0;
}

/**
 * Offline: use the local records unless the replay found more. The records are what the last run
 * analyzed, and a cache gap can only lose data (a replay the same size may still miss roster or
 * pick details), so they win ties; a larger replay means the records were lost or cut short.
 */
export function preferLocal(replay: Sample, local: Sample | null): boolean {
  return local !== null && local.leagues.length > 0 && compareSamples(local, replay) >= 0;
}

/** Local file names (data-local/sleeper-codes/, git-ignored). */
export const LOCAL_FILES = { leagues: "leagues-2026.json", prev: "previous-2025.json", current: "current-2026-rosters.json", meta: "crawl-meta.json" } as const;

async function readArray<T>(file: string): Promise<T[] | null> {
  try {
    const v = JSON.parse(await readFile(file, "utf8")) as unknown;
    return Array.isArray(v) ? (v as T[]) : null;
  } catch {
    return null;
  }
}

/** The trimmed records of the last crawl, or null when the 2026 league list is missing or unreadable. */
export async function readLocalSample(dir: string): Promise<Sample | null> {
  const leagues = await readArray<League2026>(path.join(dir, LOCAL_FILES.leagues));
  if (!leagues) return null;
  return {
    leagues: leagues.filter((l) => typeof l?.leagueId === "string" && l.settings && typeof l.settings === "object"),
    prev: (await readArray<Prev2025>(path.join(dir, LOCAL_FILES.prev))) ?? [],
    current: (await readArray<Current2026>(path.join(dir, LOCAL_FILES.current))) ?? [],
  };
}

/** crawl-meta.json: when the 2026 lists were fetched live, plus (since Phase 1) that crawl's NFL state and stats. */
export interface CrawlMeta {
  crawledAt?: string;
  state?: Dataset["state"];
  stats?: CrawlStats;
}

export async function readCrawlMeta(dir: string): Promise<CrawlMeta> {
  try {
    const v = JSON.parse(await readFile(path.join(dir, LOCAL_FILES.meta), "utf8")) as unknown;
    if (!v || typeof v !== "object") return {};
    const m = v as Record<string, unknown>;
    return {
      crawledAt: typeof m.crawledAt === "string" && Number.isFinite(Date.parse(m.crawledAt)) ? m.crawledAt : undefined,
      state: m.state && typeof m.state === "object" ? (m.state as Dataset["state"]) : undefined,
      stats: m.stats && typeof m.stats === "object" ? (m.stats as CrawlStats) : undefined,
    };
  } catch {
    return {};
  }
}
