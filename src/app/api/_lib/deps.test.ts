/**
 * The server's file cache folder (planner reply to Checkpoint 4c, A1: the stable copy shares the main folder's cache).
 */
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("app/api/_lib/deps.ts fileCacheDir", () => {
  it("is FileCache's default (.cache/app in the working directory) unless OFFERSHEET_CACHE_DIR names a folder", async () => {
    const { CACHE_DIR_ENV, fileCacheDir } = await import("./deps");
    expect(CACHE_DIR_ENV).toBe("OFFERSHEET_CACHE_DIR");
    expect(fileCacheDir({})).toBeUndefined();
    expect(fileCacheDir({ OFFERSHEET_CACHE_DIR: "  " })).toBeUndefined();
    const main = path.join("D:", "Source Code", "VS Code", "fantasy-trade-finder", ".cache", "app");
    expect(fileCacheDir({ OFFERSHEET_CACHE_DIR: main })).toBe(path.resolve(main));
    expect(fileCacheDir({ OFFERSHEET_CACHE_DIR: "relative/cache" })).toBe(path.resolve("relative/cache"));
  });
});
