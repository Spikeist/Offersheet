/**
 * Salted ordering for choosing strangers' public leagues (CLAUDE.md §0.6). The salt is random and
 * lives only in a git-ignored choice file, so the committed code can't reproduce which league was
 * picked, and a committed fixture can't be traced back to its league by re-running the selection.
 */
import { createHash, randomBytes } from "node:crypto";

export function newSalt(): string {
  return randomBytes(16).toString("hex");
}

export function saltedHash(salt: string, tag: string, value: string): string {
  return createHash("sha256").update(`${salt}\u0000${tag}\u0000${value}`).digest("hex");
}

/** A copy of `items` in the order of their salted hashes (stable for a given salt and tag). */
export function saltedOrder<T>(items: readonly T[], key: (x: T) => string, salt: string, tag: string): T[] {
  return items
    .map((x) => ({ x, h: saltedHash(salt, tag, key(x)) }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
    .map((e) => e.x);
}
