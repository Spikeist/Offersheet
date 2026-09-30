import "server-only";
/**
 * Dependencies for the import routes (CLAUDE.md §3): one polite, cached HTTP client per server
 * process (its per-host pacing only works if requests share it; the player ID resolver is also
 * memoized per client by src/data), plus the time.
 */
import type { HttpClient, ImportDeps } from "@/adapters/types";
import { loadPlayerIdResolver } from "@/data";
import { FileCache } from "@/server/cache";
import { createHttpClient } from "@/server/http";

let http: HttpClient | undefined;

export function getHttp(): HttpClient {
  http ??= createHttpClient({ cache: new FileCache() });
  return http;
}

export async function getImportDeps(now: Date = new Date()): Promise<ImportDeps> {
  const client = getHttp();
  return { http: client, resolver: await loadPlayerIdResolver({ http: client, now }), now };
}
