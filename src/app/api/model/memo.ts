/**
 * The model routes' memory of the answers they built from a signed import (final review SEC-1: a signed import was a
 * reusable ticket for a full model build, rebuilt from scratch on every post during its 15 minutes; one client could
 * spend Vercel's monthly Active CPU that way). Each answer is filed under its platform and the signed content's digest
 * (src/server/importToken.ts importDigest, which the signature check computes anyway) until the token stops being good
 * (its issue time plus browserFetchLimits.tokenMaxAgeMs), so the same signed import posted again on this instance costs a
 * lookup: the body's read and the signature's check, never a build.
 *
 * - Per instance, in memory only (never in Redis: a private league's numbers stay with the instance that built them, and
 *   whoever posts the signed import could have them built anyway), at most modelMemoLimits.maxBytes of answers (the least
 *   recently used go first; an answer bigger than that isn't kept).
 * - The answer is the response text exactly as it was sent (scrubbed of SWIDs), so a replay gets the same bytes.
 * - An expired answer is never served: a read deletes it, every write deletes every expired one, and a read does too at
 *   most once every rateLimits.sweepEveryMs, so an answer goes soon after its time is up while the instance handles
 *   requests (the privacy page's promise; memory stays bounded either way).
 */
import { modelMemoLimits, rateLimits } from "@/server/limits";

export interface ModelMemo {
  /** The answer filed under `key`, while it's good at `now`; undefined otherwise. */
  get(key: string, now?: number): string | undefined;
  /** Files `text` under `key` until `expiresAt` (epoch ms); nothing when it's already past or bigger than the memory. */
  set(key: string, text: string, expiresAt: number, now?: number): void;
}

/** A memory of at most `maxBytes` of answers (by their text's length; see the header). */
export function createModelMemo(maxBytes: number = modelMemoLimits.maxBytes): ModelMemo & { size(): number; bytes(): number } {
  const entries = new Map<string, { text: string; expiresAt: number }>();
  let total = 0;
  let nextSweep = Number.NEGATIVE_INFINITY;
  const drop = (key: string): void => {
    const e = entries.get(key);
    if (!e) return;
    entries.delete(key);
    total -= e.text.length;
  };
  const sweep = (now: number): void => {
    nextSweep = now + rateLimits.sweepEveryMs;
    for (const [k, e] of entries) if (now >= e.expiresAt) drop(k);
  };
  return {
    size: () => entries.size,
    bytes: () => total,
    get(key, now = Date.now()) {
      if (now >= nextSweep) sweep(now);
      const e = entries.get(key);
      if (!e) return undefined;
      if (now >= e.expiresAt) {
        drop(key);
        return undefined;
      }
      // Most recently used last.
      entries.delete(key);
      entries.set(key, e);
      return e.text;
    },
    set(key, text, expiresAt, now = Date.now()) {
      drop(key);
      sweep(now);
      if (now >= expiresAt || text.length > maxBytes) return;
      entries.set(key, { text, expiresAt });
      total += text.length;
      for (const k of entries.keys()) {
        if (total <= maxBytes) break;
        drop(k);
      }
    },
  };
}

let processMemo: ModelMemo | undefined;

/** The process's memory (one per server instance; both model routes share it, their keys name the platform). */
export function modelMemo(): ModelMemo {
  processMemo ??= createModelMemo();
  return processMemo;
}

/** The key an answer is filed under: its platform and the signed content's digest. */
export function modelMemoKey(platform: "espn" | "sleeper", contentDigest: string): string {
  return `${platform}\u0000${contentDigest}`;
}
