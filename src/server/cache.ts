/**
 * Server-side cache (CLAUDE.md §3 Cache, §2.10). A small interface with a file implementation for
 * development (.cache/app/, git-ignored); a KV-store version can replace it when we deploy.
 *
 * - Filenames are sha256(key): keys contain ':' '?' etc. that Windows forbids, and may contain IDs.
 * - Private-league entries (ESPN with cookies, MFL with a login, Yahoo) must include
 *   credentialScope(...) in their key, never the league ID alone.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Refresh intervals from §2.10. */
export const TTL = {
  sleeperPlayers: DAY,
  fantasyCalc: DAY,
  idMap: DAY,
  nflSchedule: 7 * DAY,
  projections: 6 * HOUR,
  league: 10 * MINUTE,
  /** Fleaflicker's public HTML rules page (planner reply 13). */
  rulesPage: DAY,
} as const;

export interface Cache {
  /** Value stored under key if younger than ttlMs, else undefined. */
  get<T>(key: string, ttlMs: number, now?: number): Promise<T | undefined>;
  set<T>(key: string, value: T, now?: number): Promise<void>;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** A short, non-reversible scope for private-data keys (never store or log the credentials). */
export function credentialScope(...parts: Array<string | undefined>): string {
  return "cred-" + sha256(parts.map((p) => p ?? "").join("\u0000")).slice(0, 16);
}

interface Envelope<T> {
  storedAt: number;
  value: T;
}

export class FileCache implements Cache {
  constructor(readonly dir: string = path.join(process.cwd(), ".cache", "app")) {}

  private file(key: string): string {
    return path.join(this.dir, `${sha256(key)}.json`);
  }

  async get<T>(key: string, ttlMs: number, now: number = Date.now()): Promise<T | undefined> {
    try {
      const env = JSON.parse(await readFile(this.file(key), "utf8")) as Envelope<T>;
      return typeof env.storedAt === "number" && now - env.storedAt <= ttlMs ? env.value : undefined;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T, now: number = Date.now()): Promise<void> {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    await writeFile(tmp, JSON.stringify({ storedAt: now, value } satisfies Envelope<T>), "utf8");
    // Windows: a concurrent reader can briefly lock the target.
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, file);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (attempt >= 5 || !(code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
          await rm(tmp, { force: true });
          throw err;
        }
        await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      }
    }
  }
}

/** In-memory cache for tests. */
export class MemoryCache implements Cache {
  private store = new Map<string, Envelope<unknown>>();
  async get<T>(key: string, ttlMs: number, now: number = Date.now()): Promise<T | undefined> {
    const env = this.store.get(key);
    return env && now - env.storedAt <= ttlMs ? (env.value as T) : undefined;
  }
  async set<T>(key: string, value: T, now: number = Date.now()): Promise<void> {
    this.store.set(key, { storedAt: now, value });
  }
}
