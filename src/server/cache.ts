/**
 * Server-side cache (CLAUDE.md §3 Cache, §2.10). A small interface with a file implementation for
 * development (.cache/app/, git-ignored); a KV-store version can replace it when we deploy (its
 * native expiry takes the place of the sweep below).
 *
 * - Filenames are sha256(key): keys contain ':' '?' etc. that Windows forbids, and may contain IDs.
 * - Private-league entries (ESPN with cookies, MFL with a login, Yahoo) must include
 *   credentialScope(...) in their key, never the league ID alone.
 * - Every entry is stored with a retention and DELETED once it passes (on read, and by a sweep that
 *   runs at most once a minute), so the privacy page's "kept for about 10 minutes" is true.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
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
  /**
   * Weekly projections of past weeks, the current NFL week and the next PROJECTIONS_NEAR_WEEKS; also
   * Sleeper's season projections and actual stats (§2.10).
   */
  projections: 6 * HOUR,
  /** Weekly projections of later NFL weeks (§2.10, Checkpoint 2: each week is its own cache entry). */
  projectionsLater: DAY,
  league: 10 * MINUTE,
  /** League data when the user presses Refresh: still at most one fetch a minute, so the button can't flood a platform. */
  leagueRefresh: MINUTE,
  /** Transactions of scoring periods that ended over a week ago (they rarely change; Refresh doesn't shorten this). */
  closedTransactions: 6 * HOUR,
  /** Fleaflicker's public HTML rules page (planner reply 13). */
  rulesPage: DAY,
} as const;

/**
 * Weeks after the current NFL week whose projections still refresh every TTL.projections (§2.10: "the
 * current NFL week and the next 2"); later weeks refresh every TTL.projectionsLater.
 */
export const PROJECTIONS_NEAR_WEEKS = 2;

/**
 * Public, league-independent sources (player lists, ID maps, the NFL schedule) are kept this long so
 * a stale copy can stand in while the source is down (HttpRequestOptions.cache.staleIfError).
 */
export const STALE_PUBLIC_RETAIN_MS = 7 * DAY;

/** Cache TTL for league data (settings, rosters, transactions): 10 minutes, or 1 minute after Refresh. */
export function leagueTtl(refresh?: boolean): number {
  return refresh ? TTL.leagueRefresh : TTL.league;
}

export interface CacheEntry<T> {
  value: T;
  /** Epoch ms when it was stored. */
  storedAt: number;
  /** Epoch ms after which it is deleted. */
  expiresAt: number;
}

export interface Cache {
  /** The entry under key if it was stored less than maxAgeMs ago and hasn't expired; expired entries are deleted. */
  get<T>(key: string, maxAgeMs: number, now?: number): Promise<CacheEntry<T> | undefined>;
  /** Store a value; it is deleted once retainMs has passed. */
  set<T>(key: string, value: T, retainMs: number, now?: number): Promise<void>;
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
  /** Missing in entries written before retention existed (treated as stored for a day). */
  expiresAt?: number;
  value: T;
}

/** Entries written before retention existed are kept at most this long. */
const LEGACY_RETAIN_MS = DAY;
const SWEEP_EVERY_MS = MINUTE;
/** A temp file older than this is left over from a crashed write. */
const STALE_TEMP_MS = HOUR;

function expiryOf(env: Envelope<unknown>): number {
  return env.expiresAt ?? env.storedAt + LEGACY_RETAIN_MS;
}

export class FileCache implements Cache {
  private lastSweep = Number.NEGATIVE_INFINITY;
  private sweeping: Promise<void> | undefined;

  /**
   * `sweepEveryMs`: also sweep on a timer (unref'd, so it never keeps the process alive), so expired
   * entries go even when no request comes in; null turns the timer off (tests).
   */
  constructor(
    readonly dir: string = path.join(process.cwd(), ".cache", "app"),
    opts: { sweepEveryMs?: number | null } = {},
  ) {
    const every = opts.sweepEveryMs === undefined ? SWEEP_EVERY_MS : opts.sweepEveryMs;
    if (every !== null) {
      const timer = setInterval(() => void this.sweepIfDue(Date.now()), every);
      timer.unref?.();
    }
  }

  private file(key: string): string {
    return path.join(this.dir, `${sha256(key)}.json`);
  }

  async get<T>(key: string, maxAgeMs: number, now: number = Date.now()): Promise<CacheEntry<T> | undefined> {
    await this.sweepIfDue(now);
    const file = this.file(key);
    let env: Envelope<T>;
    try {
      env = JSON.parse(await readFile(file, "utf8")) as Envelope<T>;
    } catch {
      return undefined;
    }
    if (typeof env.storedAt !== "number") return undefined;
    const expiresAt = expiryOf(env);
    if (now >= expiresAt) {
      await rm(file, { force: true }).catch(() => {});
      return undefined;
    }
    return now - env.storedAt <= maxAgeMs ? { value: env.value, storedAt: env.storedAt, expiresAt } : undefined;
  }

  async set<T>(key: string, value: T, retainMs: number, now: number = Date.now()): Promise<void> {
    await this.sweepIfDue(now);
    const file = this.file(key);
    const expiresAt = now + Math.max(0, retainMs);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    await writeFile(tmp, JSON.stringify({ storedAt: now, expiresAt, value } satisfies Envelope<T>), "utf8");
    // Windows: a concurrent reader can briefly lock the target.
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, file);
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (attempt >= 5 || !(code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
          await rm(tmp, { force: true });
          throw err;
        }
        await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      }
    }
    // The file's mtime holds its expiry, so the sweep can skip live entries without reading them.
    await utimes(file, new Date(now), new Date(expiresAt)).catch(() => {});
  }

  /** Delete expired entries and leftover temp files, at most once a minute. Never throws. */
  sweepIfDue(now: number): Promise<void> {
    if (this.sweeping) return this.sweeping;
    if (now - this.lastSweep < SWEEP_EVERY_MS) return Promise.resolve();
    this.lastSweep = now;
    this.sweeping = this.sweep(now).finally(() => (this.sweeping = undefined));
    return this.sweeping;
  }

  private async sweep(now: number): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return; // no cache folder yet
    }
    for (const name of names) {
      const file = path.join(this.dir, name);
      try {
        const st = await stat(file);
        if (!st.isFile()) continue;
        if (name.includes(".tmp-")) {
          if (now - st.mtimeMs > STALE_TEMP_MS) await rm(file, { force: true });
          continue;
        }
        if (!name.endsWith(".json") || st.mtimeMs > now) continue; // mtime = expiry, still ahead
        const env = JSON.parse(await readFile(file, "utf8")) as Envelope<unknown>;
        const expiresAt = expiryOf(env);
        if (now >= expiresAt) await rm(file, { force: true });
        else await utimes(file, new Date(now), new Date(expiresAt)); // an older entry: stamp its expiry
      } catch {
        // removed or being written concurrently; the next sweep sees it again
      }
    }
  }
}

/** In-memory cache for tests. */
export class MemoryCache implements Cache {
  private store = new Map<string, Required<Envelope<unknown>>>();
  async get<T>(key: string, maxAgeMs: number, now: number = Date.now()): Promise<CacheEntry<T> | undefined> {
    const env = this.store.get(key);
    if (!env) return undefined;
    if (now >= env.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return now - env.storedAt <= maxAgeMs ? { value: env.value as T, storedAt: env.storedAt, expiresAt: env.expiresAt } : undefined;
  }
  async set<T>(key: string, value: T, retainMs: number, now: number = Date.now()): Promise<void> {
    this.store.set(key, { storedAt: now, expiresAt: now + Math.max(0, retainMs), value });
  }
  /** Keys currently stored (tests). */
  keys(): string[] {
    return [...this.store.keys()];
  }
  /** Stored values (tests: e.g. assert nothing secret was cached). */
  values(): unknown[] {
    return [...this.store.values()].map((e) => e.value);
  }
}
