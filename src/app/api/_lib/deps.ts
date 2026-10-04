import "server-only";
/**
 * Dependencies for the import routes (CLAUDE.md §3): one polite, cached HTTP client per server
 * process (its per-host pacing only works if requests share it; the player ID resolver is also
 * memoized per client by src/data), plus the time.
 *
 * The file cache's folder (fileCacheDir): FileCache's default, .cache/app in the working directory, unless CACHE_DIR_ENV
 * names another. The stable copy (planner reply to Checkpoint 4c, A1; scripts/stable.ts) runs from a sibling folder and
 * sets it to the main folder's .cache/app, so both copies share one cache: FantasyCalc stays at one fetch a day per format
 * (§2.9) and the platforms see one set of requests. Safe to share: the HTTP client stores raw responses only (status, type,
 * body, fetch time; ESPN's SWIDs replaced by the same one-way pseudonyms in every version), each written atomically
 * (a temp file, then a rename) with its own expiry that either process's sweep honours; the two copies run different
 * versions of the code, so an entry is read only in the shape and format this version stores (src/server/http.ts
 * isCachedResponse, CACHE_FORMAT: anything else is a miss, never an error). ⚠️ Single-flight is per process, so the two
 * copies can fetch the same resource at the same moment (at most one extra request); and a wrong body that work in
 * progress stores under the right key reaches the stable copy until it expires (http.ts header).
 */
import path from "node:path";
import type { HttpClient, ImportDeps } from "@/adapters/types";
import { loadPlayerIdResolver } from "@/data";
import { FileCache } from "@/server/cache";
import { createHttpClient } from "@/server/http";

/** The environment variable naming the file cache's folder (see the header). */
export const CACHE_DIR_ENV = "OFFERSHEET_CACHE_DIR";

/** CACHE_DIR_ENV as an absolute folder, or undefined (FileCache's default) when it isn't set. */
export function fileCacheDir(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const dir = env[CACHE_DIR_ENV]?.trim();
  return dir ? path.resolve(dir) : undefined;
}

let http: HttpClient | undefined;

export function getHttp(): HttpClient {
  http ??= createHttpClient({ cache: new FileCache(fileCacheDir()) });
  return http;
}

export async function getImportDeps(now: Date = new Date()): Promise<ImportDeps> {
  const client = getHttp();
  return { http: client, resolver: await loadPlayerIdResolver({ http: client, now }), now };
}
