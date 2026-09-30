import type { PathLike } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { credentialScope, DAY, FileCache, HOUR, MemoryCache, MINUTE, sha256, type Cache } from "./cache";

/** Lets a test make the next rename() calls fail with a given error code (Windows locks: EPERM / EBUSY). */
const fsControl = vi.hoisted(() => ({ renameErrors: [] as string[] }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: PathLike, to: PathLike) => {
      const code = fsControl.renameErrors.shift();
      if (code) throw Object.assign(new Error(`${code}: simulated`), { code });
      return actual.rename(from, to);
    },
  };
});

/** Whole seconds, so file times round-trip exactly. */
const T0 = Math.floor(Date.now() / 1000) * 1000;
const KEY = "sleeper:https://api.sleeper.app/v1/players/nfl?position=QB&active=true";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "offer-sheet-cache-test-"));
  fsControl.renameErrors.length = 0;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const fileCache = () => new FileCache(dir, { sweepEveryMs: null });
const fileOf = (key: string) => path.join(dir, `${sha256(key)}.json`);
const exists = (file: string) => stat(file).then(
  () => true,
  () => false,
);

/** The contract both implementations keep. */
function contract(name: string, make: () => Cache) {
  describe(`${name}: the Cache contract`, () => {
    it("round-trips a value with its storage time and expiry", async () => {
      const cache = make();
      await cache.set(KEY, { n: 7 }, 10 * MINUTE, T0);
      expect(await cache.get(KEY, 10 * MINUTE, T0 + MINUTE)).toEqual({ value: { n: 7 }, storedAt: T0, expiresAt: T0 + 10 * MINUTE });
      expect(await cache.get("other", 10 * MINUTE, T0)).toBeUndefined();
    });

    it("separates how old a caller accepts (maxAge) from how long the entry is kept (retention)", async () => {
      const cache = make();
      await cache.set(KEY, "v", HOUR, T0);
      // Too old for this caller (Refresh: 1 minute), but still kept for others.
      expect(await cache.get(KEY, MINUTE, T0 + 20 * MINUTE)).toBeUndefined();
      expect(await cache.get(KEY, HOUR, T0 + 20 * MINUTE)).toMatchObject({ value: "v", storedAt: T0 });
      // A caller accepting any age still gets nothing once the retention has passed.
      expect(await cache.get(KEY, 7 * DAY, T0 + HOUR)).toBeUndefined();
      expect(await cache.get(KEY, 7 * DAY, T0 + HOUR - 1)).toBeUndefined(); // deleted by the read above
    });

    it("replaces an entry on set, and treats a zero retention as already expired", async () => {
      const cache = make();
      await cache.set(KEY, "old", HOUR, T0);
      await cache.set(KEY, "new", HOUR, T0 + MINUTE);
      expect(await cache.get(KEY, HOUR, T0 + 2 * MINUTE)).toMatchObject({ value: "new", storedAt: T0 + MINUTE });
      await cache.set("zero", "x", 0, T0);
      expect(await cache.get("zero", HOUR, T0)).toBeUndefined();
    });
  });
}

contract("MemoryCache", () => new MemoryCache());
contract("FileCache", fileCache);

describe("MemoryCache", () => {
  it("deletes an expired entry when it is read", async () => {
    const cache = new MemoryCache();
    await cache.set(KEY, 1, MINUTE, T0);
    await cache.set("kept", 2, HOUR, T0);
    expect(cache.keys().sort()).toEqual(["kept", KEY].sort());
    expect(await cache.get(KEY, HOUR, T0 + MINUTE)).toBeUndefined();
    expect(cache.keys()).toEqual(["kept"]);
    expect(cache.values()).toEqual([2]);
  });
});

describe("FileCache", () => {
  it("names files by sha256 of the key, never the key itself (Windows-safe, no IDs on disk names)", async () => {
    const cache = fileCache();
    const key = `espn:${credentialScope("s2", "{swid}")}:https://example.invalid/leagues/123?view=mTeam`;
    await cache.set(key, { ok: true }, HOUR, T0);
    expect(await readdir(dir)).toEqual([`${sha256(key)}.json`]);
    expect(sha256(key)).toMatch(/^[0-9a-f]{64}$/);
    const onDisk = await readFile(fileOf(key), "utf8");
    expect(JSON.parse(onDisk)).toEqual({ storedAt: T0, expiresAt: T0 + HOUR, value: { ok: true } });
    expect(onDisk).not.toContain(key);
  });

  it("stamps each file's mtime with its expiry", async () => {
    const cache = fileCache();
    await cache.set(KEY, 1, 10 * MINUTE, T0);
    expect((await stat(fileOf(KEY))).mtimeMs).toBe(T0 + 10 * MINUTE);
  });

  it("deletes an expired entry's file when it is read", async () => {
    const cache = fileCache();
    await cache.set(KEY, 1, MINUTE, T0);
    expect(await cache.get(KEY, HOUR, T0 + MINUTE - 1)).toBeDefined();
    expect(await exists(fileOf(KEY))).toBe(true);
    expect(await cache.get(KEY, HOUR, T0 + MINUTE)).toBeUndefined();
    expect(await exists(fileOf(KEY))).toBe(false);
  });

  it("treats an unreadable or foreign file as a miss", async () => {
    const cache = fileCache();
    await writeFile(fileOf("corrupt"), "{not json", "utf8");
    await writeFile(fileOf("foreign"), JSON.stringify({ hello: "world" }), "utf8");
    expect(await cache.get("corrupt", HOUR, T0)).toBeUndefined();
    expect(await cache.get("foreign", HOUR, T0)).toBeUndefined();
  });

  it("sweeps expired entries and leftover temp files, stamps legacy entries, and runs at most once a minute", async () => {
    const cache = fileCache();
    await cache.set("expired", 1, MINUTE, T0);
    await cache.set("live", 2, HOUR, T0);
    // Entries written before retention existed carry no expiresAt: kept a day from storedAt.
    await writeFile(fileOf("legacy-old"), JSON.stringify({ storedAt: T0 - 2 * DAY, value: 3 }), "utf8");
    await writeFile(fileOf("legacy-new"), JSON.stringify({ storedAt: T0 - HOUR, value: 4 }), "utf8");
    await utimes(fileOf("legacy-old"), new Date(T0 - 2 * DAY), new Date(T0 - 2 * DAY));
    await utimes(fileOf("legacy-new"), new Date(T0 - HOUR), new Date(T0 - HOUR));
    // A crashed write's temp file (older than an hour) and one still being written.
    const staleTemp = `${fileOf("x")}.tmp-1234-abcd0123`;
    const freshTemp = `${fileOf("y")}.tmp-1234-abcd4567`;
    await writeFile(staleTemp, "partial", "utf8");
    await writeFile(freshTemp, "partial", "utf8");
    await utimes(staleTemp, new Date(T0 - 2 * HOUR), new Date(T0 - 2 * HOUR));
    await utimes(freshTemp, new Date(T0), new Date(T0));

    const now = T0 + 10 * MINUTE;
    await cache.sweepIfDue(now);
    expect(await exists(fileOf("expired"))).toBe(false);
    expect(await exists(fileOf("live"))).toBe(true);
    expect(await exists(fileOf("legacy-old"))).toBe(false);
    expect(await exists(fileOf("legacy-new"))).toBe(true);
    expect((await stat(fileOf("legacy-new"))).mtimeMs).toBe(T0 - HOUR + DAY);
    expect(await cache.get("legacy-new", DAY, now)).toEqual({ value: 4, storedAt: T0 - HOUR, expiresAt: T0 - HOUR + DAY });
    expect(await exists(staleTemp)).toBe(false);
    expect(await exists(freshTemp)).toBe(true);

    // At most once a minute: an entry that expires now waits for the next sweep (or a read).
    await cache.set("soon", 5, MINUTE, T0);
    await cache.sweepIfDue(now + 30_000);
    expect(await exists(fileOf("soon"))).toBe(true);
    await cache.sweepIfDue(now + MINUTE);
    expect(await exists(fileOf("soon"))).toBe(false);
  });

  it("retries a rename the OS briefly refuses (Windows EPERM / EBUSY) and leaves no temp file", async () => {
    const cache = fileCache();
    fsControl.renameErrors.push("EPERM", "EBUSY");
    await cache.set(KEY, "v", HOUR, T0);
    expect(fsControl.renameErrors).toEqual([]);
    expect(await cache.get(KEY, HOUR, T0)).toMatchObject({ value: "v" });
    expect((await readdir(dir)).filter((n) => n.includes(".tmp-"))).toEqual([]);
  });

  it("lets a write failure reach the caller (the HttpClient logs it and serves the response uncached), cleaning up its temp file", async () => {
    const cache = fileCache();
    fsControl.renameErrors.push("EXDEV");
    await expect(cache.set(KEY, "v", HOUR, T0)).rejects.toMatchObject({ code: "EXDEV" });
    expect(await readdir(dir)).toEqual([]);
    // A cache folder that can't be created: set fails, get and the sweep just miss.
    const blocker = path.join(dir, "not-a-folder");
    await writeFile(blocker, "", "utf8");
    const broken = new FileCache(blocker, { sweepEveryMs: null });
    await expect(broken.set(KEY, "v", HOUR, T0)).rejects.toBeInstanceOf(Error);
    await expect(broken.get(KEY, HOUR, T0 + 2 * MINUTE)).resolves.toBeUndefined();
  });
});

describe("credentialScope", () => {
  it("is a short one-way scope that never contains the credentials", () => {
    const scope = credentialScope("espn-s2-value", "{SWID-VALUE}");
    expect(scope).toMatch(/^cred-[0-9a-f]{16}$/);
    expect(scope).not.toContain("espn-s2-value");
    expect(credentialScope("espn-s2-value", "{SWID-VALUE}")).toBe(scope);
    expect(credentialScope("espn-s2-value", "{OTHER}")).not.toBe(scope);
    // Parts are separated, so shifting characters between them changes the scope.
    expect(credentialScope("ab", "c")).not.toBe(credentialScope("a", "bc"));
  });
});
