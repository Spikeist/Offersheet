/**
 * The publish pipeline (CLAUDE.md section 0.4), end to end on a made-up repository: scripts/publish-public.ts's
 * buildMirror (a temp bare repository rewritten by rewrite.py with the vendored git-filter-repo) and verifyMirror
 * (verify.py), plus transform.py's own unit tests (test_transform.py). Made-up players and numbers only: no real
 * FantasyCalc value belongs in a test. Skipped where Python 3.8+ or git isn't available.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMirror, findPython, removeMirror, verifyMirror, type Mirror, type PublishOptions } from "../publish-public";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const python = findPython();
const hasGit = spawnSync("git", ["--version"]).status === 0;
const canRun = Boolean(python) && hasGit;

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.autocrlf=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function write(root: string, rel: string, content: string | Buffer): void {
  const p = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}

const INDEX_1 = { "fc1.json": { label: "fantasycalc/values?isDynasty=false", captured: "2031-09-30" }, "keep.json": { label: "sleeper/state/nfl", captured: "2031-09-30" } };
const INDEX_2 = { ...INDEX_1, "fc2.json": { label: "fantasycalc/players (first 100)", captured: "2031-10-01" } };
const json2 = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;
const FC_ROWS = [1, 2, 3].map((i) => ({ player: { id: i, name: i === 1 ? "Zorblax Kickwell" : `Filler ${i}` }, value: i === 1 ? 7777 : 100 + i }));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe.skipIf(!canRun)("publish: the public copy of a made-up history", () => {
  let tmp: string;
  let source: string;
  let rulesFile: string;
  let dictionaryFile: string;
  const mirrors: Mirror[] = [];
  const opts = (): PublishOptions => ({ source, rulesFile, dictionaryFile, main: source, leakCheck: false, liveDictionary: false, python: python ?? undefined });

  beforeAll(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "publish-test-"));
    source = path.join(tmp, "source");
    mkdirSync(source);
    git(source, "init", "-q", "-b", "main");
    write(source, "fixtures/sanitized/shared/index.json", json2(INDEX_1));
    write(source, "fixtures/sanitized/shared/fc1.json", JSON.stringify(FC_ROWS));
    write(source, "fixtures/sanitized/shared/keep.json", '{"week": 4}\n');
    write(source, "reports/r.md", "# Report\n\nZorblax Kickwell (worth 7,777) is the top pick.\n\n| Player | Value | ROS |\n|---|---|---|\n| Zorblax Kickwell | 7777 | 142.5 |\n");
    write(source, "reports/data.json", '{"top": "Zorblax Kickwell: 7777", "count": 3}\n');
    write(source, "private/note.md", "a private note\n");
    write(source, "img.png", PNG);
    git(source, "add", "-A");
    git(source, "commit", "-q", "-m", "first");
    git(source, "tag", "-a", "checkpoint-1", "-m", "checkpoint 1");
    write(source, "fixtures/sanitized/shared/index.json", json2(INDEX_2));
    write(source, "fixtures/sanitized/shared/fc2.json", JSON.stringify(FC_ROWS.map((r) => r.player)));
    write(source, "reports/r.md", "# Report\n\nZorblax Kickwell is now worth 5150.\n");
    git(source, "add", "-A");
    git(source, "commit", "-q", "-m", "second");
    rulesFile = path.join(tmp, "rules.json");
    dictionaryFile = path.join(tmp, "dictionary.json");
    writeFileSync(dictionaryFile, JSON.stringify({ "Zorblax Kickwell": [7777, 5150] }));
    writeFileSync(rulesFile, JSON.stringify({
      dropPaths: ["private/note.md"],
      fantasyCalcFixtures: { indexPath: "fixtures/sanitized/shared/index.json", labelPrefix: "fantasycalc/" },
      columnRules: [{ path: "\\.md$", header: "^Value$", require: "^Player$" }],
      replacements: [{ path: "^reports/data\\.json$", find: '("top": "Zorblax Kickwell: )\\d+', replace: "\\g<1>[value]" }],
      dictionaryMasks: [{ path: "\\.md$", window: 160 }],
      allowlist: [],
      bannedStrings: ["a private note"],
    }));
  });

  afterAll(() => {
    for (const m of mirrors) removeMirror(m);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("transform.py's unit tests pass", () => {
    const [cmd, ...pre] = python!;
    const r = spawnSync(cmd, [...pre, path.join(ROOT, "scripts", "publish", "test_transform.py")], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    expect(r.stderr).toMatch(/OK/);
    expect(r.status).toBe(0);
  }, 60_000);

  it("drops the FantasyCalc fixtures and private paths from every commit, prunes the index, masks every version, keeps the rest byte for byte", () => {
    const m = buildMirror(opts());
    mirrors.push(m);
    const commits = git(m.dir, "rev-list", "--reverse", "refs/heads/main").trim().split("\n");
    expect(commits).toHaveLength(2);
    expect(Object.keys(m.tags)).toEqual(["checkpoint-1"]);
    expect(git(m.dir, "cat-file", "-t", "refs/tags/checkpoint-1").trim()).toBe("tag");
    expect(git(m.dir, "rev-parse", "checkpoint-1^{commit}").trim()).toBe(commits[0]);
    for (const c of commits) {
      const files = git(m.dir, "ls-tree", "-r", "--name-only", c).trim().split("\n");
      expect(files).not.toContain("fixtures/sanitized/shared/fc1.json");
      expect(files).not.toContain("fixtures/sanitized/shared/fc2.json");
      expect(files).not.toContain("private/note.md");
      expect(files).toContain("fixtures/sanitized/shared/keep.json");
      expect(git(m.dir, "show", `${c}:fixtures/sanitized/shared/index.json`)).toBe(json2({ "keep.json": INDEX_1["keep.json"] }));
    }
    const first = git(m.dir, "show", `${commits[0]}:reports/r.md`);
    expect(first).toContain("Zorblax Kickwell (worth [value]) is the top pick.");
    expect(first).toContain("| Zorblax Kickwell | [value] | 142.5 |");
    expect(git(m.dir, "show", `${commits[1]}:reports/r.md`)).toBe("# Report\n\nZorblax Kickwell is now worth [value].\n");
    expect(JSON.parse(git(m.dir, "show", `${commits[0]}:reports/data.json`))).toEqual({ top: "Zorblax Kickwell: [value]", count: 3 });
    expect(git(m.dir, "rev-parse", `${commits[1]}:img.png`)).toBe(git(source, "rev-parse", "HEAD:img.png"));
    expect(verifyMirror(m, opts())).toMatch(/every check passed/);
  }, 120_000);

  it("is deterministic: a second build gives the same main and tags", () => {
    const a = buildMirror(opts());
    const b = buildMirror(opts());
    mirrors.push(a, b);
    expect(b.main).toBe(a.main);
    expect(b.tags).toEqual(a.tags);
  }, 120_000);

  it("the verifier fails a copy whose rules miss a value or leave a dropped path", () => {
    const weak = path.join(tmp, "weak.json");
    writeFileSync(weak, JSON.stringify({ dropPaths: [], dictionaryMasks: [], columnRules: [], replacements: [], allowlist: [] }));
    const m = buildMirror({ ...opts(), rulesFile: weak });
    mirrors.push(m);
    let message = "";
    try {
      verifyMirror(m, opts());
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/dropped path present: fixtures\/sanitized\/shared\/fc1\.json/);
    expect(message).toMatch(/dropped path present: private\/note\.md/);
    expect(message).toMatch(/FantasyCalc value of Zorblax Kickwell \(7777\): reports\/r\.md/);
    expect(message).toMatch(/FantasyCalc value of Zorblax Kickwell \(5150\): reports\/r\.md/);
  }, 120_000);
});
