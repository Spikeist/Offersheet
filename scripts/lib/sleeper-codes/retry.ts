/**
 * Windows sometimes refuses a rename for a moment (EPERM/EBUSY/EACCES) while an indexer, virus
 * scanner or editor has the target open. The shared fixture index is rewritten once per saved
 * response, so a crawl of hundreds of responses hits this; retry with a short backoff.
 */
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);

export async function withFsRetry<T>(fn: () => Promise<T>, attempts = 6, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (attempt >= attempts || !code || !TRANSIENT.has(code)) throw err;
      await sleep(50 * 2 ** attempt);
    }
  }
}

/** Remove temp files a failed atomic write left behind (only in the given folder). */
export async function removeStaleTempFiles(dir: string): Promise<number> {
  let removed = 0;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!/\.tmp-\d+-[a-z0-9]+$/.test(name)) continue;
    await rm(path.join(dir, name), { force: true });
    removed++;
  }
  return removed;
}
