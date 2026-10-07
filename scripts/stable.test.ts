/**
 * The stable copy (planner reply to Checkpoint 4c, A1): scripts/stable.ts's pure parts, without git or the network (the
 * port check and the lock use local sockets and pipes only, the lock across two processes), and what the script loads
 * (read from the sources).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DATA_LOCAL_ENV as ARCHIVE_DATA_LOCAL_ENV } from "@/server/projectionArchive";
import { NETWORK_ENV as HTTP_NETWORK_ENV } from "@/server/http";
import {
  BUILD_MARKER,
  CACHE_DIR_ENV,
  DATA_LOCAL_ENV,
  GIT_LOCK_FILES,
  INSTALL_MARKER,
  MAIN_ROOT,
  NETWORK_ENV,
  STABLE_HOST,
  STABLE_PORT,
  STALE_GIT_LOCK_MS,
  TAG_FORMAT,
  TAG_REFS,
  UNFINISHED_LOCK,
  USAGE,
  buildPlan,
  childEnv,
  clearStaleGitLocks,
  fileSha256,
  findWorktree,
  installPlan,
  isInside,
  latestCheckpoint,
  lockAddress,
  npmCliPath,
  parseStableArgs,
  parseTagRefs,
  parseWorktreeList,
  portBusy,
  readBuildMarker,
  readInstallMarker,
  serveEnv,
  stableDirOf,
  takeLock,
  worktreePlan,
  type LockResult,
  type StableArgs,
} from "./stable";

vi.mock("server-only", () => ({}));

const tmp = mkdtempSync(path.join(tmpdir(), "stable-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const args = (argv: string[], env: Record<string, string> = {}): StableArgs => {
  const a = parseStableArgs(argv, env);
  if ("error" in a) throw new Error(a.error);
  return a;
};

describe("the command line", () => {
  it("defaults: update to the latest checkpoint, then serve on 127.0.0.1:3000 (where Parker's saved leagues live)", () => {
    expect(args([])).toEqual({ port: 3000, serve: true, stay: false, ref: null, dir: null, help: false });
    expect([STABLE_HOST, STABLE_PORT]).toEqual(["127.0.0.1", 3000]);
  });

  it("reads --no-serve, --stay, --ref, --port, --dir and --help, with a space or an equals sign", () => {
    expect(args(["--no-serve", "--stay", "--ref", "checkpoint-4c", "--port", "3005", "--dir", "..\\x"])).toEqual({ port: 3005, serve: false, stay: true, ref: "checkpoint-4c", dir: "..\\x", help: false });
    expect(args(["--port=3007", "--ref=958155f"])).toMatchObject({ port: 3007, ref: "958155f" });
    expect(args(["-h"]).help).toBe(true);
  });

  it("refuses what it can't use, saying how (and never passes git an option as a ref)", () => {
    expect(parseStableArgs(["--port", "0"])).toEqual({ error: "--port needs a port number, for example --port 3005." });
    expect(parseStableArgs(["--port", "x"])).toEqual({ error: "--port needs a port number, for example --port 3005." });
    expect(parseStableArgs(["--ref"])).toEqual({ error: "--ref needs a tag or commit, for example --ref checkpoint-4c." });
    expect(parseStableArgs(["--ref=-c"])).toEqual({ error: "--ref needs a tag or commit, for example --ref checkpoint-4c." });
    expect(parseStableArgs(["--ref", "a b"])).toEqual({ error: "--ref needs a tag or commit, for example --ref checkpoint-4c." });
    expect(parseStableArgs(["--serve"])).toEqual({ error: "Unknown option: --serve. Run npm run stable -- --help for the options." });
    expect(parseStableArgs(["now"])).toMatchObject({ error: expect.stringContaining("Unexpected argument: now") });
  });

  it("takes the options npm kept for itself when the \"--\" was left out or a shell dropped it", () => {
    // npm run stable --stay --no-serve
    expect(args([], { npm_config_stay: "true", npm_config_serve: "" })).toMatchObject({ stay: true, serve: false });
    expect(args([], { npm_config_serve: "false" }).serve).toBe(false);
    // npm run stable --port=3005 --ref=checkpoint-4c
    expect(args([], { npm_config_port: "3005", npm_config_ref: "checkpoint-4c" })).toMatchObject({ port: 3005, ref: "checkpoint-4c" });
    // npm run stable --ref checkpoint-4c: npm keeps "true" and leaves the value as a stray argument.
    expect(args(["checkpoint-4c"], { npm_config_ref: "true" }).ref).toBe("checkpoint-4c");
    expect(args(["3009"], { npm_config_port: "true" }).port).toBe(3009);
    // Two options lost their values: npm doesn't say which was whose.
    expect(parseStableArgs(["3009", "checkpoint-4c"], { npm_config_port: "true", npm_config_ref: "true" })).toMatchObject({ error: expect.stringContaining("npm kept --port and --ref for itself") });
    // The command line wins.
    expect(args(["--port", "3002"], { npm_config_port: "3005" }).port).toBe(3002);
    expect(parseStableArgs([], { npm_config_port: "nope" })).toEqual({ error: "--port needs a port number, for example --port 3005." });
  });

  it("says how to start and update it in PowerShell", () => {
    expect(USAGE).toContain('cd "D:\\Source Code\\VS Code\\fantasy-trade-finder"');
    expect(USAGE).toContain("  npm run stable\n");
  });
});

describe("the checkpoint: the newest commit tagged checkpoint-*", () => {
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const C = "c".repeat(40);
  const T = "e".repeat(40);

  it("reads for-each-ref's lines: lightweight tags and annotated ones (peeled to their commit); anything else is left out", () => {
    expect(TAG_REFS).toBe("refs/tags/checkpoint-*");
    expect(TAG_FORMAT).toContain("%(*objectname)");
    const text = [`checkpoint-4b\tcommit\t${A}\t1791077385\t\t\t`, `checkpoint-4c\ttag\t${T}\t\tcommit\t${B}\t1791135364`, `checkpoint-tree\ttag\t${T}\t\ttree\t${C}\t`, "garbage", ""].join("\r\n");
    expect(parseTagRefs(text)).toEqual([
      { name: "checkpoint-4b", commit: A, time: 1791077385, annotated: false },
      { name: "checkpoint-4c", commit: B, time: 1791135364, annotated: true },
    ]);
  });

  it("says which tags are annotated (a tag object, `git tag -a`): npm run prod:deploy deploys only those (Checkpoint 7c)", () => {
    const text = [`checkpoint-7c\ttag\t${T}\t\tcommit\t${C}\t1791900000`, `checkpoint-7c-light\tcommit\t${C}\t1791900000\t\t\t`].join("\n");
    expect(parseTagRefs(text).map((t) => [t.name, t.annotated])).toEqual([
      ["checkpoint-7c", true],
      ["checkpoint-7c-light", false],
    ]);
  });

  it("the latest is the newest commit, not the latest name; ties go to the later name, numbers as numbers", () => {
    expect(latestCheckpoint([])).toBeNull();
    expect(latestCheckpoint([{ name: "checkpoint-9", commit: A, time: 200 }, { name: "checkpoint-10", commit: B, time: 100 }])?.name).toBe("checkpoint-9");
    expect(latestCheckpoint([{ name: "checkpoint-9", commit: A, time: 100 }, { name: "checkpoint-10", commit: A, time: 100 }])?.name).toBe("checkpoint-10");
    expect(latestCheckpoint([{ name: "checkpoint-7a", commit: C, time: 300 }, { name: "checkpoint-4c", commit: B, time: 200 }])?.commit).toBe(C);
  });
});

describe("the worktree", () => {
  it("sits next to the main folder, its name + -stable; never the main folder, inside it or around it", () => {
    const main = path.join(tmp, "VS Code", "fantasy-trade-finder");
    expect(stableDirOf(main)).toBe(path.join(tmp, "VS Code", "fantasy-trade-finder-stable"));
    expect(stableDirOf(`${main}${path.sep}`)).toBe(path.join(tmp, "VS Code", "fantasy-trade-finder-stable"));
    expect(isInside(stableDirOf(main), main)).toBe(false);
    expect(isInside(main, stableDirOf(main))).toBe(false);
    expect(isInside(path.join(main, "x"), main)).toBe(true);
    expect(isInside(main, main)).toBe(true);
    expect(isInside(main, path.dirname(main))).toBe(true);
  });

  it("reads git worktree list --porcelain and finds the copy by its folder (as the file system has it)", () => {
    const head = "9".repeat(40);
    const text = [
      "worktree D:/Source Code/VS Code/fantasy-trade-finder",
      `HEAD ${"1".repeat(40)}`,
      "branch refs/heads/main",
      "",
      "worktree D:/Source Code/VS Code/fantasy-trade-finder-stable",
      `HEAD ${head}`,
      "detached",
      "",
      "worktree D:/gone",
      `HEAD ${head}`,
      "detached",
      "locked initializing",
      "prunable gitdir file points to non-existent location",
      "",
      "worktree D:/by-hand",
      `HEAD ${head}`,
      "detached",
      "locked",
      "",
    ].join("\n");
    const list = parseWorktreeList(text);
    expect(list.map((w) => [w.path, w.prunable, w.locked])).toEqual([
      ["D:/Source Code/VS Code/fantasy-trade-finder", false, null],
      ["D:/Source Code/VS Code/fantasy-trade-finder-stable", false, null],
      ["D:/gone", true, UNFINISHED_LOCK],
      ["D:/by-hand", false, ""],
    ]);
    const same = (a: string, b: string) => a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
    expect(findWorktree(list, "D:\\Source Code\\VS Code\\fantasy-trade-finder-stable", same)?.head).toBe(head);
    expect(findWorktree(list, "D:\\elsewhere", same)).toBeNull();
    // With the real comparison: a temporary folder named in git's forward-slash form.
    const real = path.join(tmp, "wt");
    expect(findWorktree(parseWorktreeList(`worktree ${real.split(path.sep).join("/")}\nHEAD ${head}\ndetached\n`), real)?.head).toBe(head);
  });

  describe("what each run does with the folder (worktreePlan)", () => {
    const dir = "D:\\Source Code\\VS Code\\fantasy-trade-finder-stable";
    const record = (locked: string | null = null) => ({ path: "D:/Source Code/VS Code/fantasy-trade-finder-stable", head: "9".repeat(40), prunable: false, locked });
    const none = { exists: false, empty: true, workingCopy: false };
    const empty = { exists: true, empty: true, workingCopy: false };
    const copy = { exists: true, empty: false, workingCopy: true };
    const plan = (folder: typeof none, found: ReturnType<typeof record> | null, stay = false) => worktreePlan({ dir, folder, found, stay });

    it("creates the copy when there's no folder, or an empty one; a record git still holds is unlocked and cleared first", () => {
      expect(plan(none, null)).toEqual({ do: "create", clearRecord: false });
      expect(plan(empty, null)).toEqual({ do: "create", clearRecord: false });
      // The copy deleted (or emptied) since: git's record of it, locked when a run stopped while git created it.
      expect(plan(none, record())).toEqual({ do: "create", clearRecord: true });
      expect(plan(none, record(UNFINISHED_LOCK))).toEqual({ do: "create", clearRecord: true });
      expect(plan(empty, record(UNFINISHED_LOCK))).toEqual({ do: "create", clearRecord: true });
    });

    it("checks the checkpoint out again on every run, which also finishes a copy a stopped run left half-made (the reviewer's case: HEAD set, files missing, locked)", () => {
      expect(plan(copy, record())).toEqual({ do: "checkout", unfinished: false });
      expect(plan(copy, record(UNFINISHED_LOCK))).toEqual({ do: "checkout", unfinished: true });
      // Locked by hand: still checked out (a lock doesn't stop a checkout), never unlocked.
      expect(plan(copy, record(""))).toEqual({ do: "checkout", unfinished: false });
      expect(plan(copy, record("my reason"))).toEqual({ do: "checkout", unfinished: false });
    });

    it("never touches a folder that isn't this repository's copy, nor one git knows but that isn't a working copy and has something in it", () => {
      expect(plan(copy, null)).toEqual({ do: "refuse", message: expect.stringContaining("isn't this repository's stable copy") });
      expect(plan({ exists: true, empty: false, workingCopy: false }, null)).toMatchObject({ do: "refuse" });
      expect(plan({ exists: true, empty: false, workingCopy: false }, record(UNFINISHED_LOCK))).toEqual({ do: "refuse", message: expect.stringContaining("Delete that folder, then run npm run stable again") });
    });

    it("--stay leaves the copy as it is, but neither makes one nor serves an unfinished one", () => {
      expect(plan(copy, record(), true)).toEqual({ do: "stay" });
      expect(plan(copy, record(""), true)).toEqual({ do: "stay" });
      expect(plan(none, null, true)).toEqual({ do: "refuse", message: expect.stringContaining("run npm run stable (without --stay) first") });
      expect(plan(empty, record(), true)).toMatchObject({ do: "refuse" });
      expect(plan(copy, record(UNFINISHED_LOCK), true)).toEqual({ do: "refuse", message: expect.stringContaining("run npm run stable without --stay to finish it") });
    });
  });

  describe("git's lock files a stopped git left in the copy (clearStaleGitLocks)", () => {
    const gitDir = () => mkdtempSync(path.join(tmp, "gitdir-"));
    const clock = (start: number) => {
      let t = start;
      return { now: () => t, sleep: async (ms: number) => void (t += ms), sleeps: () => t - start };
    };

    it("removes one left by a git stopped a while ago at once (a killed worktree add leaves index.lock)", async () => {
      expect(GIT_LOCK_FILES).toEqual(["index.lock", "HEAD.lock"]);
      const dir = gitDir();
      const lock = path.join(dir, "index.lock");
      writeFileSync(lock, "");
      const past = new Date(Date.now() - 60_000);
      utimesSync(lock, past, past);
      const c = clock(Date.now());
      expect(await clearStaleGitLocks(dir, c)).toEqual(["index.lock"]);
      expect(existsSync(lock)).toBe(false);
      expect(c.sleeps()).toBe(0);
      expect(await clearStaleGitLocks(dir, c)).toEqual([]);
    });

    it("waits for a fresh one (a git running right now): gone meanwhile, it's left alone; still there once it's stale, it goes", async () => {
      const dir = gitDir();
      const head = path.join(dir, "HEAD.lock");
      writeFileSync(head, "");
      let t = Date.now();
      const vanishing = { now: () => t, sleep: async (ms: number) => void ((t += ms), rmSync(head, { force: true })) };
      expect(await clearStaleGitLocks(dir, vanishing)).toEqual([]);
      writeFileSync(head, "");
      const c = clock(Date.now());
      const waits: string[] = [];
      expect(await clearStaleGitLocks(dir, { ...c, onWait: (name) => waits.push(name) })).toEqual(["HEAD.lock"]);
      expect(waits).toEqual(["HEAD.lock"]); // said once, not on every check
      expect(existsSync(head)).toBe(false);
      expect(c.sleeps()).toBeGreaterThanOrEqual(STALE_GIT_LOCK_MS - 1_000);
      expect(c.sleeps()).toBeLessThanOrEqual(STALE_GIT_LOCK_MS + 250);
    });
  });
});

describe("one run at a time (the lock)", () => {
  it("one address per copy folder: a named pipe on Windows, a socket file elsewhere; two spellings of one folder share it", () => {
    const main = path.join(tmp, "VS Code", "fantasy-trade-finder");
    const dir = stableDirOf(main);
    expect(lockAddress(dir, "win32")).toMatch(/^\\\\\.\\pipe\\offersheet-stable-[0-9a-f]{16}$/);
    expect(lockAddress(dir, "linux", "/tmp")).toMatch(/^\/tmp\/offersheet-stable-[0-9a-f]{16}\.sock$/);
    expect(lockAddress(`${dir}${path.sep}`, "win32")).toBe(lockAddress(dir, "win32"));
    expect(lockAddress(path.join(dir, "..", path.basename(dir)), "win32")).toBe(lockAddress(dir, "win32"));
    expect(lockAddress(path.join(tmp, "elsewhere"), "win32")).not.toBe(lockAddress(dir, "win32"));
  });

  it("a second run can't take it while the first holds it; once the first ends (closed, or killed outright), the next can", async () => {
    const address = lockAddress(path.join(tmp, `lock-${process.pid}`));
    const release = (got: LockResult) => new Promise<void>((r) => ("server" in got ? got.server.close(() => r()) : r()));
    const first = await takeLock(address);
    expect(first).toEqual({ server: expect.any(net.Server) });
    expect(await takeLock(address)).toEqual({ busy: true });
    await release(first);
    const again = await takeLock(address);
    expect(again).toEqual({ server: expect.any(net.Server) });
    await release(again);

    // Held by another process, which is then killed outright (no chance to let go): the system frees it.
    const holder = spawn(process.execPath, ["-e", `require("node:net").createServer().listen(${JSON.stringify(address)}, () => console.log("held"))`], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((resolve, reject) => {
      holder.stdout.once("data", () => resolve());
      holder.once("exit", (code) => reject(new Error(`the holder exited first (${code})`)));
    });
    expect(await takeLock(address)).toEqual({ busy: true });
    const gone = new Promise<void>((r) => holder.once("exit", () => r()));
    holder.kill("SIGKILL");
    await gone;
    if (process.platform !== "win32") {
      // A socket file outlives a killed process: nobody answers it, so it's cleared and taken.
      expect(existsSync(address)).toBe(true);
    }
    const after = await takeLock(address);
    expect(after).toEqual({ server: expect.any(net.Server) });
    await release(after);
  });

  it("a lock that can't be taken for another reason doesn't stop the start command: the run goes on unlocked (with a warning)", async () => {
    // Not a pipe (Windows: EACCES) or in a folder that doesn't exist (elsewhere: ENOENT).
    expect(await takeLock(path.join(tmp, "no-such-folder", "lock"))).toEqual({ unavailable: expect.stringMatching(/^E[A-Z]+$/) });
  });
});

describe("what npm run stable loads (planner reply to Checkpoint 4c, A1: a copy that work in progress can't break)", () => {
  /** The specifiers a TypeScript file loads at run time: import and export … from, bare imports and import(); `import type` is erased. */
  function runtimeSpecifiers(file: string): string[] {
    const text = readFileSync(file, "utf8");
    const out: string[] = [];
    for (const m of text.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm)) if (!m[1]) out.push(m[2] as string);
    for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1] as string);
    return out;
  }

  it("only Node's built-ins and dependency-free modules of scripts/: nothing of the app (src/) or its packages", () => {
    const scripts = path.resolve(MAIN_ROOT, "scripts");
    const seen = new Set<string>();
    const outside: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const spec of runtimeSpecifiers(file)) {
        if (spec.startsWith("node:")) continue;
        if (!spec.startsWith(".")) {
          outside.push(`${path.relative(MAIN_ROOT, file)} → ${spec}`);
          continue;
        }
        const base = path.resolve(path.dirname(file), spec);
        const target = [`${base}.ts`, path.join(base, "index.ts"), base].find((p) => existsSync(p) && p.endsWith(".ts"));
        if (!target || !isInside(target, scripts)) outside.push(`${path.relative(MAIN_ROOT, file)} → ${spec}`);
        else visit(target);
      }
    };
    visit(path.join(scripts, "stable.ts"));
    expect(outside).toEqual([]);
    expect([...seen].map((f) => path.relative(scripts, f).split(path.sep).join("/")).sort()).toEqual(["check-browser/chrome.ts", "lib/runMode.ts", "stable.ts"]);
  });

  it("the main folder is the one the script lives in, wherever it's started from", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    expect(MAIN_ROOT).toBe(path.resolve(root));
    expect(existsSync(path.join(MAIN_ROOT, "package.json"))).toBe(true);
  });
});

describe("install and build only when needed", () => {
  const lock = "f".repeat(64);
  const marker = { lockSha256: lock, installedAt: "2026-10-04T12:00:00.000Z" };

  it("npm ci when the lock file changed since the last install, or the packages or the record are missing", () => {
    expect(installPlan({ lockSha256: lock, marker, nextInstalled: true })).toEqual({ run: false, why: "package-lock.json is unchanged since the last install" });
    expect(installPlan({ lockSha256: "0".repeat(64), marker, nextInstalled: true })).toEqual({ run: true, why: "package-lock.json changed since the last install" });
    expect(installPlan({ lockSha256: lock, marker: null, nextInstalled: true }).run).toBe(true);
    expect(installPlan({ lockSha256: lock, marker, nextInstalled: false })).toEqual({ run: true, why: "the packages aren't installed yet" });
  });

  it("npm run build when the commit changed since the last build, or the build or the record is missing", () => {
    const a = "958155f8a609fe56442e2ccc349ce32acdf4e41e";
    const b = "da4b6b538ccca717ba8710158f45f127ccc87596";
    const built = { commit: a, builtAt: "2026-10-04T12:00:00.000Z" };
    expect(buildPlan({ commit: a, marker: built, buildIdExists: true })).toEqual({ run: false, why: "already built for 958155f" });
    expect(buildPlan({ commit: b, marker: built, buildIdExists: true })).toEqual({ run: true, why: "the checkpoint changed since the last build (958155f → da4b6b5)" });
    expect(buildPlan({ commit: a, marker: null, buildIdExists: true }).run).toBe(true);
    expect(buildPlan({ commit: a, marker: built, buildIdExists: false })).toEqual({ run: true, why: "there's no production build yet" });
  });

  it("the markers live in node_modules/ and .next/ (gone with them), and read back only when they're ours", () => {
    expect(INSTALL_MARKER.split(path.sep)[0]).toBe("node_modules");
    expect(BUILD_MARKER.split(path.sep)[0]).toBe(".next");
    const good = path.join(tmp, "install.json");
    writeFileSync(good, JSON.stringify(marker));
    expect(readInstallMarker(good)).toEqual(marker);
    const bad = path.join(tmp, "bad.json");
    writeFileSync(bad, "{not json");
    expect(readInstallMarker(bad)).toBeNull();
    expect(readInstallMarker(path.join(tmp, "missing.json"))).toBeNull();
    const build = path.join(tmp, "build.json");
    writeFileSync(build, JSON.stringify({ commit: "x", builtAt: "y" }));
    expect(readBuildMarker(build)).toEqual({ commit: "x", builtAt: "y" });
    writeFileSync(build, JSON.stringify({ commit: 1 }));
    expect(readBuildMarker(build)).toBeNull();
    const file = path.join(tmp, "lock.json");
    writeFileSync(file, "abc");
    expect(fileSha256(file)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("the child processes' environment", () => {
  const main = path.join(tmp, "fantasy-trade-finder");
  const base = {
    PATH: "C:\\Windows",
    npm_config_cache: "C:\\npm-cache",
    npm_execpath: "C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
    npm_config_local_prefix: main,
    npm_package_json: path.join(main, "package.json"),
    npm_package_name: "fantasy-trade-finder",
    npm_lifecycle_event: "stable",
    npm_lifecycle_script: "tsx scripts/stable.ts",
    npm_command: "run-script",
    INIT_CWD: main,
    npm_config_stay: "true",
    NODE_ENV: "production",
    [NETWORK_ENV]: "off",
  };

  it("npm in the copy: none of the parent npm's per-run variables naming the main folder (a precaution), no NODE_ENV (npm ci would skip the dev packages), no offline guard, telemetry off", () => {
    const env = childEnv(base);
    expect(env).toEqual({ PATH: "C:\\Windows", npm_config_cache: "C:\\npm-cache", npm_execpath: "C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", NEXT_TELEMETRY_DISABLED: "1" });
  });

  it("the server: production, the main folder's data-local/ (the archives) and .cache/app (one shared cache), never the offline guard", () => {
    const env = serveEnv(base, main);
    expect(env.NODE_ENV).toBe("production");
    expect(env[DATA_LOCAL_ENV]).toBe(path.join(main, "data-local"));
    expect(env[CACHE_DIR_ENV]).toBe(path.join(main, ".cache", "app"));
    expect(env[NETWORK_ENV]).toBeUndefined();
    expect(env.npm_config_local_prefix).toBeUndefined();
    expect(env.NEXT_TELEMETRY_DISABLED).toBe("1");
  });

  it("names the same variables as the modules that read them (named here so the script imports nothing of the app)", async () => {
    expect(NETWORK_ENV).toBe(HTTP_NETWORK_ENV);
    expect(DATA_LOCAL_ENV).toBe(ARCHIVE_DATA_LOCAL_ENV);
    const deps = await import("@/app/api/_lib/deps");
    expect(CACHE_DIR_ENV).toBe(deps.CACHE_DIR_ENV);
  });

  it("runs npm through Node with npm's own CLI (no shell): npm_execpath when it's npm-cli.js, else the one next to Node", () => {
    const node = path.join("C:", "nodejs", "node.exe");
    const nextToNode = path.join("C:", "nodejs", "node_modules", "npm", "bin", "npm-cli.js");
    const files = new Set([base.npm_execpath, nextToNode, "C:\\npx\\npx-cli.js"]);
    const exists = (p: string) => files.has(p);
    expect(npmCliPath({ npm_execpath: base.npm_execpath }, node, exists)).toBe(base.npm_execpath);
    expect(npmCliPath({ npm_execpath: "C:\\npx\\npx-cli.js" }, node, exists)).toBe(nextToNode); // npx's isn't npm's
    expect(npmCliPath({}, node, exists)).toBe(nextToNode);
    expect(npmCliPath({}, node, () => false)).toBeNull();
  });
});

describe("the port check", () => {
  it("sees a server listening on the port, and a free port as free", async () => {
    const srv = net.createServer((s) => s.end());
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as net.AddressInfo).port;
    expect(await portBusy(port)).toBe(true);
    await new Promise<void>((r) => srv.close(() => r()));
    expect(await portBusy(port)).toBe(false);
  });
});
