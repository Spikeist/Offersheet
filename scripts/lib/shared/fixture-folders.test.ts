import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NEEDS_CRAWL } from "./crawl-gate";
import { FIXTURE_FILE, MIN_FIXTURES_DIR, assertPrunable, fixtureFolders, folderOfPath, folderStats, isPlainName, partitionLabels, partitionPaths, pruneFolder, pruneFolders, whereSaved, type FixtureFolder } from "./fixture-folders";

const h = (s: string) => createHash("sha256").update(s).digest("hex");
const temps: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), "fixture-folders-"));
  temps.push(d);
  return d;
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fixture folder with index.json and files named sha256(label).json. */
function folderWith(dir: string, labels: string[], extra: { orphans?: string[]; others?: string[]; subfolder?: string } = {}): Record<string, string> {
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {};
  const index: Record<string, { label: string }> = {};
  for (const l of labels) {
    const f = `${h(l)}.json`;
    files[l] = f;
    index[f] = { label: l };
    writeFileSync(path.join(dir, f), "{}");
  }
  writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
  for (const o of extra.orphans ?? []) writeFileSync(path.join(dir, `${h(o)}.json`), "{}");
  for (const o of extra.others ?? []) writeFileSync(path.join(dir, o), "x");
  if (extra.subfolder) {
    mkdirSync(path.join(dir, extra.subfolder), { recursive: true });
    writeFileSync(path.join(dir, extra.subfolder, `${h("nested")}.json`), "{}");
  }
  return files;
}

describe("fixture folders", () => {
  it("names both folders of a platform, committed first", () => {
    const [c, l] = fixtureFolders("espn");
    expect(c.rel).toBe("fixtures/sanitized/espn");
    expect(c.committed).toBe(true);
    expect(l.rel).toBe("data-local/fixtures-sanitized/espn");
    expect(l.committed).toBe(false);
  });

  it("splits saved paths and labels by folder", () => {
    const saved = ["fixtures/sanitized/espn/a.json", "data-local/fixtures-sanitized/espn/b.json", "data-local\\fixtures-sanitized\\espn\\c.json", "somewhere/else/d.json"];
    expect(partitionPaths("espn", saved)).toEqual({ committed: ["fixtures/sanitized/espn/a.json"], local: ["data-local/fixtures-sanitized/espn/b.json", "data-local/fixtures-sanitized/espn/c.json"] });
    expect(folderOfPath("espn", "somewhere/else/d.json")).toBeUndefined();
    // ESPN routes by label alone (no .env.local dependence): the public test league is a stranger's.
    expect(partitionLabels("espn", ["league/{leagueId}/view=mSettings", "public-league/{publicLeagueId}/view=mSettings", "manifest"])).toEqual({
      committed: ["league/{leagueId}/view=mSettings", "manifest"],
      local: ["public-league/{publicLeagueId}/view=mSettings"],
    });
  });

  it("words where a run's fixtures went", () => {
    expect(whereSaved("espn", 31, 2)).toBe("31 in fixtures/sanitized/espn (committed) and 2 in data-local/fixtures-sanitized/espn (git-ignored: strangers' public leagues; tests use minimized copies in fixtures/sanitized/min/espn/)");
    expect(whereSaved("fleaflicker", 0, 5)).toMatch(/^5 in data-local\/fixtures-sanitized\/fleaflicker \(git-ignored/);
    expect(whereSaved("mfl", 0, 0)).toBe("0 in fixtures/sanitized/mfl (committed)");
  });

  it("accepts only plain fixture file names", () => {
    expect(FIXTURE_FILE.test(`${h("x")}.json`)).toBe(true);
    expect(FIXTURE_FILE.test("index.json")).toBe(false);
    expect(FIXTURE_FILE.test(`${h("x")}.json.tmp-1-abc`)).toBe(false);
    expect(isPlainName("a.json")).toBe(true);
    expect(isPlainName("../a.json")).toBe(false);
    expect(isPlainName("sub/a.json")).toBe(false);
    expect(isPlainName("..")).toBe(false);
  });

  it("refuses to prune the minimized fixtures", async () => {
    expect(() => assertPrunable(MIN_FIXTURES_DIR)).toThrow(/minimized/);
    expect(() => assertPrunable(path.join(MIN_FIXTURES_DIR, "sleeper", "test-league"))).toThrow(/minimized/);
    expect(() => assertPrunable(fixtureFolders("sleeper")[0].dir)).not.toThrow();
    await expect(pruneFolder(path.join(MIN_FIXTURES_DIR, "espn"), () => true)).rejects.toThrow(/minimized/);
  });

  it("names the crawl gate so the matrix renders it as untested", () => {
    expect(NEEDS_CRAWL).toMatch(/^untested: needs --allow-crawl/);
  });
});

describe("pruneFolder", () => {
  it("drops stale entries with their files and keeps the rest", async () => {
    const dir = tempDir();
    const files = folderWith(dir, ["a/keep", "a/stale", "b/other"]);
    const out = await pruneFolder(dir, (label) => label.startsWith("a/") && label !== "a/keep");
    expect(out.removed).toEqual(["a/stale"]);
    expect(existsSync(path.join(dir, files["a/stale"] as string))).toBe(false);
    expect(Object.values(JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")) as Record<string, { label: string }>).map((e) => e.label)).toEqual(["a/keep", "b/other"]);
  });

  it("removes fixture-named orphans only when asked, and never other files or subfolders", async () => {
    const dir = tempDir();
    folderWith(dir, ["keep"], { orphans: ["orphan"], others: ["README.txt", "notes.json"], subfolder: "min" });
    const without = await pruneFolder(dir, () => false);
    expect(without.orphans).toEqual([]);
    const withOrphans = await pruneFolder(dir, () => false, { removeOrphans: true });
    expect(withOrphans.orphans).toEqual([`${h("orphan")}.json`]);
    expect(readdirSync(dir).sort()).toEqual([`${h("keep")}.json`, "README.txt", "index.json", "min", "notes.json"].sort());
    expect(existsSync(path.join(dir, "min", `${h("nested")}.json`))).toBe(true);
  });

  it("reports misnamed and missing files without deleting them", async () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "deadbeef.json"), "{}");
    writeFileSync(path.join(dir, "index.json"), JSON.stringify({ "deadbeef.json": { label: "misnamed" }, [`${h("gone")}.json`]: { label: "gone" } }));
    const out = await pruneFolder(dir, () => false);
    expect(out.misnamed).toEqual(["misnamed"]);
    expect(out.missingFiles).toEqual(["gone"]);
    expect(existsSync(path.join(dir, "deadbeef.json"))).toBe(true);
  });

  it("leaves a missing folder or a folder without index.json alone", async () => {
    const dir = tempDir();
    expect(await pruneFolder(path.join(dir, "nope"), () => true, { removeOrphans: true })).toMatchObject({ removed: [], orphans: [] });
    writeFileSync(path.join(dir, `${h("x")}.json`), "{}");
    expect(await pruneFolder(dir, () => true, { removeOrphans: true })).toMatchObject({ removed: [], orphans: [] });
    expect(existsSync(path.join(dir, `${h("x")}.json`))).toBe(true);
    expect(existsSync(path.join(dir, "index.json"))).toBe(false);
  });
});

describe("pruneFolders", () => {
  it("keeps in each folder exactly the files saved there, so a stranger's copy in the committed folder goes", async () => {
    const root = tempDir();
    const committed: FixtureFolder = { dir: path.join(root, "committed"), rel: "c", committed: true };
    const local: FixtureFolder = { dir: path.join(root, "local"), rel: "l", committed: false };
    // The same stranger label sits in both folders; this run saved it to the git-ignored one only.
    const cFiles = folderWith(committed.dir, ["public-test-league/x", "state/nfl"]);
    const lFiles = folderWith(local.dir, ["public-test-league/x", "public-test-league/old"]);
    const saved = [`l/${lFiles["public-test-league/x"]}`];
    const out = await pruneFolders([committed, local], saved, { owns: (label) => label.startsWith("public-test-league/") });
    expect(out.map((r) => r.removed)).toEqual([["public-test-league/x"], ["public-test-league/old"]]);
    expect(existsSync(path.join(committed.dir, cFiles["public-test-league/x"] as string))).toBe(false);
    expect(existsSync(path.join(committed.dir, cFiles["state/nfl"] as string))).toBe(true); // not owned: untouched
    expect(existsSync(path.join(local.dir, lFiles["public-test-league/x"] as string))).toBe(true);
  });

  it("measures the indexed fixtures per folder", async () => {
    const root = tempDir();
    const a: FixtureFolder = { dir: path.join(root, "a"), rel: "a", committed: true };
    const b: FixtureFolder = { dir: path.join(root, "b"), rel: "b", committed: false };
    folderWith(a.dir, ["one", "two"], { orphans: ["unindexed"] });
    const stats = await folderStats("test", [a, b]);
    expect(stats.map((s) => [s.rel, s.files, s.bytes])).toEqual([
      ["a", 2, 4],
      ["b", 0, 0],
    ]);
  });
});
