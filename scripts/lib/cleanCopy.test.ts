/**
 * The clean copy of a tag that npm run prod:deploy uploads (planner reply to Checkpoint 7b, §2): scripts/lib/cleanCopy.ts's
 * pure parts, and a whole export from a small git repository made here (git runs locally; no network).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { allowlistRoots, CleanCopyError, exportCommit, exportProblems, gitBlobId, nodeCopyFs, parseCatFileBatch, parseLsTree, verifyCopy, type GitRun, type TreeEntry } from "./cleanCopy";
import { ROOT } from "./vercelCli";

let dirs: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const ID_A = "a".repeat(40);
const ID_B = "b".repeat(40);
const entry = (p: string, over: Partial<TreeEntry> = {}): TreeEntry => ({ mode: "100644", type: "blob", id: ID_A, size: 1, path: p, ...over });

describe("the allowlist the copy follows", () => {
  it("the project's own .vercelignore lets through its nine roots, in order", () => {
    expect(allowlistRoots(readFileSync(path.join(ROOT, ".vercelignore"), "utf8"))).toEqual({
      roots: ["src", "public", "package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs", "eslint.config.mjs", "vercel.json"],
    });
    expect(allowlistRoots("# a comment\r\n/*\r\n\r\n!/src\r\n!/src\r\n")).toEqual({ roots: ["src"] });
  });

  it("refuses what it can't follow exactly: no '/*' first, a nested path, a wildcard, a rule without '!/', nothing let through", () => {
    for (const bad of ["!/src\n", "/*\n!/src/app\n", "/*\n!/src*\n", "/*\n!src\n", "/*\nfixtures\n", "/*\n!/..\n", "/*\n", ""]) {
      expect(allowlistRoots(bad), bad).toMatchObject({ error: expect.any(String) });
    }
  });
});

describe("git ls-tree's list", () => {
  it("reads -r -z -l entries (padded sizes, paths with spaces), and refuses a broken one", () => {
    const out = `100644 blob ${ID_A}     120\tsrc/app/page.tsx\u0000100755 blob ${ID_B}      7\tpublic/a b.png\u0000`;
    expect(parseLsTree(out)).toEqual([
      { mode: "100644", type: "blob", id: ID_A, size: 120, path: "src/app/page.tsx" },
      { mode: "100755", type: "blob", id: ID_B, size: 7, path: "public/a b.png" },
    ]);
    expect(parseLsTree("")).toEqual([]);
    expect(() => parseLsTree("100644 blob no-tab")).toThrow();
  });

  it("refuses entries it can't copy exactly: links, submodules, escapes, Windows names, case twins", () => {
    expect(exportProblems([entry("src/app/page.tsx"), entry("package.json", { mode: "100755" })])).toEqual([]);
    const cases: Array<[TreeEntry, string]> = [
      [entry("src/link", { mode: "120000" }), "aren't plain files"],
      [entry("src/sub", { mode: "160000", type: "commit" }), "aren't plain files"],
      [entry("src/x.ts", { id: "not-an-id" }), "aren't git object ids"],
      [entry("../outside.ts"), "could leave the copy"],
      [entry("/abs.ts"), "could leave the copy"],
      [entry("C:/x.ts"), "could leave the copy"],
      [entry("src//x.ts"), "could leave the copy"],
      [entry("src/nul.ts"), "Windows can't hold"],
      [entry("src/con/x.ts"), "Windows can't hold"],
      [entry("src/a:b.ts"), "Windows can't hold"],
      [entry("src/x."), "Windows can't hold"],
      [entry("src/x "), "Windows can't hold"],
      [entry("src/a\\b.ts"), "Windows can't hold"],
      [entry("src/tab\u0001.ts"), "Windows can't hold"],
    ];
    for (const [e, why] of cases) expect(exportProblems([e]).join(" "), e.path).toContain(why);
    expect(exportProblems([entry("src/A.ts"), entry("src/a.ts")]).join(" ")).toContain("differ only in letter case, e.g. src/A.ts and src/a.ts");
  });
});

describe("blobs", () => {
  it("hashes a blob as git does (sha1, and sha256 for a sha256 repository)", () => {
    expect(gitBlobId(new Uint8Array())).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(gitBlobId(Buffer.from("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    expect(gitBlobId(new Uint8Array(), "sha256")).toBe("473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813");
  });

  it("reads git cat-file --batch's stream, binary and newlines included; anything off throws", () => {
    const one = Buffer.from([0, 10, 255, 13, 10]);
    const two = Buffer.from("x\n");
    const batch = Buffer.concat([Buffer.from(`${ID_A} blob 5\n`), one, Buffer.from("\n"), Buffer.from(`${ID_B} blob 2\n`), two, Buffer.from("\n")]);
    const blobs = parseCatFileBatch(batch, [ID_A, ID_B]);
    expect(blobs.get(ID_A)).toEqual(one);
    expect(blobs.get(ID_B)).toEqual(two);
    expect(() => parseCatFileBatch(Buffer.from(`${ID_A} missing\n`), [ID_A])).toThrow();
    expect(() => parseCatFileBatch(Buffer.from(`${ID_A} tree 0\n\n`), [ID_A])).toThrow(/as a blob/);
    expect(() => parseCatFileBatch(Buffer.from(`${ID_A} blob 9\nshort\n`), [ID_A])).toThrow(/cut short/);
    expect(() => parseCatFileBatch(batch, [ID_B, ID_A])).toThrow(/another object/);
    expect(() => parseCatFileBatch(Buffer.concat([batch, Buffer.from("more")]), [ID_A, ID_B])).toThrow(/more than was asked/);
    expect(() => parseCatFileBatch(batch.subarray(0, 10), [ID_A])).toThrow();
  });
});

describe("a whole copy, from a real (small) git repository", () => {
  /** A repository with an allowlist, files it lets through (CRLF and binary bytes kept as committed) and files it doesn't. */
  function repo(files: Record<string, string | Buffer>): { dir: string; git: GitRun; commit: string } {
    const dir = tempDir("cleancopy-repo-");
    const run = (args: string[], input?: string) => spawnSync("git", args, { cwd: dir, windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...(input !== undefined ? { input } : {}) });
    run(["init", "-q"]);
    run(["config", "core.autocrlf", "false"]);
    for (const [p, content] of Object.entries(files)) {
      mkdirSync(path.join(dir, path.dirname(p)), { recursive: true });
      writeFileSync(path.join(dir, p), content);
    }
    run(["add", "-A"]);
    const c = run(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "test"]);
    expect(c.status).toBe(0);
    const commit = run(["rev-parse", "HEAD"]).stdout.toString("utf8").trim();
    const git: GitRun = (args, input) => {
      const r = run([...args], input);
      return { status: r.status ?? 1, stdout: r.stdout ?? Buffer.alloc(0), stderr: r.stderr ? r.stderr.toString("utf8") : "" };
    };
    return { dir, git, commit };
  }

  const binary = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  const files = {
    ".vercelignore": "# allowlist\n/*\n!/src\n!/package.json\n!/vercel.json\n",
    "src/app/page.tsx": "export default function Page() {\r\n  return null;\r\n}\r\n",
    "src/lib/blob.bin": binary,
    "package.json": '{ "name": "x" }\n',
    "vercel.json": '{ "framework": "nextjs" }\n',
    "secret-notes.txt": "not let through\n",
    "fixtures/raw/league.json": "{}\n",
  };

  it("writes exactly the allowlisted files, byte for byte, and verifies every blob id", () => {
    const { git, commit } = repo(files);
    const dest = tempDir("cleancopy-dest-");
    const copy = exportCommit({ git, commit, dest, fs: nodeCopyFs });
    expect(copy.roots).toEqual(["src", "package.json", "vercel.json"]);
    expect(copy.entries.map((e) => e.path).sort()).toEqual([".vercelignore", "package.json", "src/app/page.tsx", "src/lib/blob.bin", "vercel.json"]);
    expect(nodeCopyFs.listFiles(dest).sort()).toEqual([".vercelignore", "package.json", "src/app/page.tsx", "src/lib/blob.bin", "vercel.json"]);
    expect(readFileSync(path.join(dest, "src", "app", "page.tsx"), "utf8")).toBe(files["src/app/page.tsx"]); // CRLF kept: the commit's bytes
    expect(readFileSync(path.join(dest, "src", "lib", "blob.bin"))).toEqual(binary);
    expect(copy.bytes).toBe(copy.entries.reduce((s, e) => s + e.size, 0));
    expect(existsSync(path.join(dest, "secret-notes.txt"))).toBe(false);
    expect(existsSync(path.join(dest, ".git"))).toBe(false);
    expect(verifyCopy(dest, copy.entries, nodeCopyFs)).toEqual([]);

    // Any change to the folder shows: a changed file, an extra one, a missing one.
    writeFileSync(path.join(dest, "package.json"), '{ "name": "y" }\n');
    writeFileSync(path.join(dest, "src", "extra.ts"), "");
    unlinkSync(path.join(dest, "vercel.json"));
    const differ = verifyCopy(dest, copy.entries, nodeCopyFs).join(" ");
    expect(differ).toContain("1 file(s) the commit doesn't have, e.g. src/extra.ts");
    expect(differ).toContain("1 file(s) missing, e.g. vercel.json");
    expect(differ).toContain("1 file(s) whose bytes aren't the commit's, e.g. package.json");

    nodeCopyFs.removeDir(dest);
    expect(existsSync(dest)).toBe(false);
  });

  it("refuses a commit whose .vercelignore isn't an allowlist it can follow, or that has none", () => {
    const notAllowlist = repo({ ...files, ".vercelignore": "fixtures\n" });
    expect(() => exportCommit({ ...notAllowlist, dest: tempDir("cleancopy-dest-"), fs: nodeCopyFs })).toThrow(CleanCopyError);
    const { ".vercelignore": _ignored, ...rest } = files;
    void _ignored;
    const none = repo(rest);
    expect(() => exportCommit({ ...none, dest: tempDir("cleancopy-dest-"), fs: nodeCopyFs })).toThrow(/\.vercelignore/);
    expect(() => exportCommit({ ...none, commit: "HEAD", dest: tempDir("cleancopy-dest-"), fs: nodeCopyFs })).toThrow(/full commit id/);
  });
});
