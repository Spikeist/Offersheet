/**
 * npm run check:leaks's --files and --base, and its refusal of a scan with nothing to look for (Checkpoint 7c: npm run
 * prod:deploy scans its clean copy of the tag with --files --base, started from the main folder, so the needles are the
 * main folder's). The script runs in a child process on a made-up project folder (its own package.json, and a .env.local
 * holding one made-up value), so the real .env.local is never read. No network.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_VARS } from "./lib/env";
import { ROOT } from "./lib/vercelCli";

/** tsx's loader by its file (the made-up project has no node_modules for `--import tsx` to find). */
const LOADER = pathToFileURL(path.join(ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href;
const SCRIPT = path.join(ROOT, "scripts", "check-leaks.ts");
/** A made-up value: the made-up project's whole .env.local. */
const MADE_UP = "zq-made-up-session-value-for-the-leak-test-7c";

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

/** A project folder check-leaks takes as its root (package.json named fantasy-trade-finder), with or without its .env.local. */
function project(withEnv: boolean): string {
  const dir = tempDir("leaks-root-");
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fantasy-trade-finder", private: true }));
  if (withEnv) writeFileSync(path.join(dir, ".env.local"), `SESSION_SECRET=${MADE_UP}\n`);
  return dir;
}

/** A folder of files (path → text), and the list naming them in `root`. */
function folder(files: Record<string, string>, root: string, listed: string[] = Object.keys(files)): { base: string; list: string } {
  const base = tempDir("leaks-base-");
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(path.join(base, path.dirname(p)), { recursive: true });
    writeFileSync(path.join(base, p), text);
  }
  const list = path.join(root, "upload.txt");
  writeFileSync(list, `${listed.join("\n")}\n`);
  return { base, list };
}

/** Runs check-leaks in `root` (no variable of this process's own reaches it: only the made-up .env.local counts). */
function scan(root: string, argv: string[]): { status: number | null; out: string } {
  // tsx reads the "@/…" paths from a tsconfig in the folder it runs in; the made-up project has none, so it gets this one's.
  const env: Record<string, string | undefined> = { ...process.env, TSX_TSCONFIG_PATH: path.join(ROOT, "tsconfig.json") };
  for (const name of ENV_VARS) delete env[name];
  // As npm run check:leaks runs: under Vitest's NODE_ENV "test", @next/env would skip .env.local.
  delete env.NODE_ENV;
  const r = spawnSync(process.execPath, ["--import", LOADER, SCRIPT, ...argv], { cwd: root, env: env as NodeJS.ProcessEnv, encoding: "utf8", windowsHide: true, timeout: 120_000 });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("check-leaks --files --base (prod:deploy's scan of its clean copy)", () => {
  it("reads each listed file from the --base folder: a value there fails the scan, named by its listed path; a clean copy passes", () => {
    const root = project(true);
    const dirty = folder({ "src/app/page.tsx": `export const x = "${MADE_UP}";\n`, "src/ok.ts": "export const y = 1;\n" }, root);
    const hit = scan(root, ["--files", dirty.list, "--base", dirty.base]);
    expect(hit.status).toBe(1);
    expect(hit.out).toContain("❌ src/app/page.tsx: env:SESSION_SECRET ×1");
    expect(hit.out).toContain("scanned 2 files (read from the --base folder)");
    expect(hit.out).not.toContain(MADE_UP);

    const clean = folder({ "src/ok.ts": "export const y = 1;\n" }, root);
    const pass = scan(root, ["--files", clean.list, "--base", clean.base]);
    expect(pass.status).toBe(0);
    expect(pass.out).toContain("0 hard, 0 soft hit(s)");
  }, 120_000);

  it("refuses a --files scan with nothing to look for (no .env.local where it runs: the wrong folder)", () => {
    const root = project(false);
    const clean = folder({ "src/ok.ts": "export const y = 1;\n" }, root);
    const r = scan(root, ["--files", clean.list, "--base", clean.base]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("❌ nothing to look for");
    expect(r.out).not.toContain("scanned");
  }, 120_000);

  it("a listed file it can't read (missing, or outside the base folder) fails the scan; --base needs --files and a folder", () => {
    const root = project(true);
    const some = folder({ "src/ok.ts": "export const y = 1;\n" }, root, ["src/ok.ts", "src/missing.ts", "../outside.ts"]);
    const r = scan(root, ["--files", some.list, "--base", some.base]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("❌ src/missing.ts: listed but couldn't be read, so it wasn't scanned");
    expect(r.out).toContain("❌ ../outside.ts: listed but couldn't be read, so it wasn't scanned");
    expect(scan(root, ["--base", some.base]).out).toContain("❌ --base needs --files");
    expect(scan(root, ["--files", some.list, "--base", path.join(some.base, "nowhere")]).out).toContain("❌ --base: the folder couldn't be read.");
  }, 120_000);
});
