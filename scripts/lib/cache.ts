/**
 * Development file cache under .cache/ (git-ignored).
 *
 * - Filenames are sha256(key): keys contain ':' '?' etc. that Windows forbids, and may contain IDs.
 * - Writes are atomic (temp file + rename).
 * - withLock() gives cross-process single-flight, so parallel probe runs don't fetch the same
 *   resource twice (FantasyCalc allows at most one fetch per format per day).
 * - Private-league entries must include a credential scope (see credentialScope) in their key.
 */
import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./env";

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

/** Refresh intervals from CLAUDE.md §2.10. */
export const TTL = {
  sleeperPlayers: DAY,
  fantasyCalc: DAY,
  idMap: DAY,
  nflSchedule: 7 * DAY,
  projections: 6 * HOUR,
  league: 10 * 60 * 1000,
  docs: 7 * DAY,
} as const;

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** A short, non-reversible scope for keys of private data (never store or print the credentials). */
export function credentialScope(...parts: Array<string | undefined>): string {
  return "cred-" + sha256(parts.map((p) => p ?? "").join("\u0000")).slice(0, 16);
}

export const CACHE_DIR = path.join(ROOT, ".cache");

export function cacheFile(namespace: string, key: string): string {
  return path.join(CACHE_DIR, namespace, `${sha256(key)}.json`);
}

interface CacheEnvelope<T> {
  storedAt: number;
  value: T;
}

export async function readCache<T>(namespace: string, key: string, ttlMs: number, now = Date.now()): Promise<{ value: T; storedAt: number } | null> {
  try {
    const env = JSON.parse(await readFile(cacheFile(namespace, key), "utf8")) as CacheEnvelope<T>;
    if (typeof env.storedAt !== "number" || now - env.storedAt > ttlMs) return null;
    return { value: env.value, storedAt: env.storedAt };
  } catch {
    return null;
  }
}

export async function writeCache<T>(namespace: string, key: string, value: T, now = Date.now()): Promise<void> {
  const file = cacheFile(namespace, key);
  await writeFileAtomic(file, JSON.stringify({ storedAt: now, value } satisfies CacheEnvelope<T>));
}

export async function writeFileAtomic(file: string, data: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmp, data, "utf8");
  await rename(tmp, file);
}

const inProcess = new Map<string, Promise<unknown>>();

/**
 * Run fn while holding a cross-process lock for (namespace, key). If another process holds it,
 * wait for it (up to waitMs) and then run fn — callers re-check the cache inside fn.
 */
export async function withLock<T>(namespace: string, key: string, fn: () => Promise<T>, waitMs = 180_000): Promise<T> {
  const id = `${namespace}\u0000${key}`;
  const pending = inProcess.get(id);
  if (pending) await pending.catch(() => undefined);
  const run = (async () => {
    const lockPath = cacheFile(namespace, key).replace(/\.json$/, ".lock");
    await mkdir(path.dirname(lockPath), { recursive: true });
    const started = Date.now();
    for (;;) {
      try {
        const handle = await open(lockPath, "wx");
        await handle.close();
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        const age = await stat(lockPath).then((s) => Date.now() - s.mtimeMs).catch(() => 0);
        if (age > waitMs || Date.now() - started > waitMs) {
          await rm(lockPath, { force: true }); // stale lock from a crashed run
          continue;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    try {
      return await fn();
    } finally {
      await rm(lockPath, { force: true });
    }
  })();
  inProcess.set(id, run);
  try {
    return await run;
  } finally {
    if (inProcess.get(id) === run) inProcess.delete(id);
  }
}
