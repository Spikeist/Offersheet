/**
 * Offline by default (planner reply to Checkpoint 4c, A5): scripts/lib/runMode.ts on temporary folders, and the scripts'
 * HTTP client's offline guard. No network.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NETWORK_ENV, NetworkOffError } from "@/server/http";
import { writeCache } from "./cache";
import { request } from "./http";
import {
  DUMP_FILES,
  NETWORK_ENV as RUNMODE_NETWORK_ENV,
  canonicalPath,
  commandText,
  displayPath,
  dumpTime,
  flagValue,
  isMainModule,
  listDumps,
  liveRequiredText,
  newestDump,
  npmFlag,
  reportArgs,
  reportCommandText,
  reportSourceLine,
  requireLive,
  samePath,
  setNetworkMode,
  wantsLive,
  type DumpInfo,
} from "./runMode";

let dirs: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
  vi.unstubAllEnvs();
});

/** A dump folder under <root>/data-local (DUMP_FILES; meta.json's now as given, or none). */
function dump(root: string, name: string, now: string | null, opts: { skip?: string } = {}): string {
  const dir = path.join(root, "data-local", name);
  mkdirSync(dir, { recursive: true });
  for (const f of DUMP_FILES) {
    if (f === opts.skip) continue;
    writeFileSync(path.join(dir, f), f === "meta.json" ? JSON.stringify(now === null ? {} : { now }) : "{}");
  }
  return dir;
}

describe("--live and the offline guard", () => {
  it("wantsLive: --live, or npm's npm_config_live when the \"--\" was left out or a shell dropped it", () => {
    expect(wantsLive(["--live"], {})).toBe(true);
    expect(wantsLive(["--team", "3"], { npm_config_live: "true" })).toBe(true);
    expect(wantsLive([], {})).toBe(false);
    expect(wantsLive(["--lively"], { npm_config_live: "" })).toBe(false);
  });

  it("names the guard's variable as src/server/http.ts does (written out: this module loads nothing of the app)", () => {
    expect(RUNMODE_NETWORK_ENV).toBe(NETWORK_ENV);
  });

  it("setNetworkMode sets the guard's variable: off without --live, live with it", () => {
    const env: Record<string, string | undefined> = {};
    setNetworkMode(false, env);
    expect(env[NETWORK_ENV]).toBe("off");
    setNetworkMode(true, env);
    expect(env[NETWORK_ENV]).toBe("live");
  });

  it("requireLive: with --live it returns (guard live); without, it says how to run it and exits with the code asked", () => {
    vi.stubEnv(NETWORK_ENV, "");
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    requireLive({ script: "probe:espn", what: "fetches ESPN's API", argv: ["--live"], env: {} });
    expect(process.env[NETWORK_ENV]).toBe("live");
    expect(exit).not.toHaveBeenCalled();
    expect(() => requireLive({ script: "probe:espn", what: "fetches ESPN's API", argv: [], env: {} })).toThrow("exit 1");
    expect(process.env[NETWORK_ENV]).toBe("off");
    expect(err).toHaveBeenCalledWith(liveRequiredText("probe:espn", "fetches ESPN's API"));
    expect(liveRequiredText("probe:espn", "fetches ESPN's API")).toBe("probe:espn fetches ESPN's API, so it runs only with --live: npm run probe:espn -- --live. Nothing was fetched.");
    expect(() => requireLive({ script: "check:browser", what: "imports your league", argv: [], env: {}, exitCode: 2 })).toThrow("exit 2");
  });

  it("the scripts' HTTP client refuses a live fetch with the network off, before any request or lock; a cached copy still serves", async () => {
    vi.stubEnv(NETWORK_ENV, "off");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(request("https://example.invalid/never")).rejects.toBeInstanceOf(NetworkOffError);
    await expect(request("https://example.invalid/never-cached", { cache: { key: "runmode-guard:missing", ttlMs: 1, namespace: "runmode-guard" } })).rejects.toBeInstanceOf(NetworkOffError);
    const key = "runmode-guard:fixed"; // one fixed key: the test rewrites the same cache file every run
    await writeCache("runmode-guard", key, { status: 200, contentType: "application/json", finalUrl: "https://example.invalid/c", headers: {}, text: '{"ok":2}' });
    const res = await request("https://example.invalid/c", { cache: { key, ttlMs: 60_000, namespace: "runmode-guard" } });
    expect(res.json).toEqual({ ok: 2 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("isMainModule: exact resolved paths", () => {
  it("a scratch file named run-trade-report.ts is not the report; the report itself is, with or without its extension or letter case", () => {
    const dir = tempDir("ismain-");
    const report = path.join(dir, "trade-report.ts");
    const scratch = path.join(dir, "run-trade-report.ts");
    writeFileSync(report, "");
    writeFileSync(scratch, "");
    const url = pathToFileURL(report).href;
    expect(isMainModule(url, scratch)).toBe(false);
    expect(isMainModule(url, report)).toBe(true);
    expect(isMainModule(report, report)).toBe(true); // a plain path works too
    expect(isMainModule(url, path.join(dir, "trade-report"))).toBe(true); // tsx scripts/trade-report
    expect(isMainModule(url, path.join(dir, "other", "trade-report.ts"))).toBe(false);
    expect(isMainModule(url, undefined)).toBe(false);
    if (process.platform === "win32") expect(isMainModule(url, report.toUpperCase())).toBe(true);
  });

  it("canonicalPath: real paths, and a path that doesn't exist yet resolves through its nearest existing folder", () => {
    const dir = tempDir("canon-");
    expect(samePath(path.join(dir, "missing", "x.ts"), path.join(dir, ".", "missing", "x.ts"))).toBe(true);
    expect(canonicalPath(path.join(dir, "missing"))).toBe(path.join(canonicalPath(dir), "missing"));
    expect(samePath(dir, path.join(dir, ".."))).toBe(false);
  });

  it("every script that starts work at its top level does so only as itself: isMainModule(import.meta.url), never a file-name pattern", () => {
    // Scripts that still start when imported, on purpose: offline, and run as the pre-commit check.
    const unguarded = new Set(["scripts/check-leaks.ts"]);
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) files.push(p);
      }
    };
    walk(path.join(root, "scripts"));
    expect(files.length).toBeGreaterThan(40);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      // A call that starts the script, unindented (so not inside an `if (isMainModule(import.meta.url))` block).
      const start = lines.find((l) => /^(?:void |await )?(?:main|runProbe)\(/.test(l));
      if (start && !unguarded.has(rel)) offenders.push(`${rel}: ${start.trim()}`);
      // The old test by file name: a scratch run-trade-report.ts matched /trade-report\.ts$/ and started the report.
      const byName = lines.find((l) => /\.test\(process\.argv\[1\]\)/.test(l));
      if (byName) offenders.push(`${rel}: ${byName.trim()}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("saved dumps: the reports' default data", () => {
  it("lists complete parker-league* dumps and picks the newest by meta.json's time (not by name or folder date)", () => {
    const root = tempDir("dumps-");
    dump(root, "parker-league", "2026-10-01T19:01:20.447Z");
    dump(root, "parker-league-final", "2026-10-04T00:51:45.970Z");
    const newest = dump(root, "parker-league-4c", "2026-10-04T09:24:34.901Z");
    dump(root, "parker-league-zz-broken", "2026-10-09T00:00:00.000Z", { skip: "inputs.json" }); // not complete
    dump(root, "parker-league-zz-badtime", "not a time");
    dump(root, "other-league", "2026-10-10T00:00:00.000Z"); // not a dump name
    writeFileSync(path.join(root, "data-local", "parker-league-file"), "a file, not a folder");
    const all = listDumps(root);
    expect(all.map((d) => path.basename(d.dir))).toEqual(["parker-league", "parker-league-4c", "parker-league-final"]);
    expect(newestDump(all)?.dir).toBe(newest);
    expect(newestDump([])).toBeNull();
    expect(listDumps(path.join(root, "nowhere"))).toEqual([]);
    expect(dumpTime(newest)?.toISOString()).toBe("2026-10-04T09:24:34.901Z");
    // Ties on the time go to the later folder name.
    const t = new Date("2026-10-04T00:00:00.000Z");
    const tie: DumpInfo[] = [
      { dir: path.join(root, "data-local", "parker-league-b"), now: t },
      { dir: path.join(root, "data-local", "parker-league-a"), now: t },
    ];
    expect(path.basename(newestDump(tie)?.dir ?? "")).toBe("parker-league-b");
  });

  it("reportArgs: the newest dump by default, --dump <dir> (--offline kept as an alias), --live; and what goes wrong, in words", () => {
    const root = tempDir("args-");
    const older = dump(root, "parker-league-final", "2026-10-04T00:51:45.970Z");
    const newest = dump(root, "parker-league-4c", "2026-10-04T09:24:34.901Z");
    expect(reportArgs([], root, { env: {} })).toEqual({ dump: newest, newest: true, team: undefined, cookies: null });
    expect(reportArgs(["--team", "3"], root, { env: {} })).toEqual({ dump: newest, newest: true, team: "3", cookies: null });
    expect(reportArgs(["--dump", "data-local/parker-league-final", "--team", "3"], root, { env: {} })).toEqual({ dump: older, newest: false, team: "3", cookies: null });
    expect(reportArgs(["--offline", "data-local/parker-league-final"], root, { env: {} })).toEqual({ dump: older, newest: false, team: undefined, cookies: null });
    expect(reportArgs(["--dump"], root, { env: {} })).toMatchObject({ dump: newest, newest: true });
    expect(reportArgs(["--offline", "--team", "3"], root, { env: {} })).toMatchObject({ dump: newest, newest: true, team: "3" });
    expect(reportArgs(["--live", "--team", "3", "--cookies"], root, { env: {} })).toEqual({ dump: null, newest: false, team: "3", cookies: "on" });
    expect(reportArgs(["--no-cookies"], root, { env: { npm_config_live: "true" } })).toEqual({ dump: null, newest: false, team: undefined, cookies: "off" });
    expect(reportArgs(["--live", "--dump", "data-local/parker-league-4c"], root, { env: {} })).toEqual({ error: "--live and --dump don't go together: --live fetches your league, --dump reads a saved dump. Pick one." });
    expect(reportArgs(["--dump", "data-local/nope"], root, { env: {} })).toEqual({ error: "data-local/nope isn't a saved dump: it needs snapshot.json, inputs.json, meta.json with a valid `now` in meta.json." });
    expect(reportArgs([], root, { env: {}, dumps: () => [] })).toEqual({
      error: "No saved dump of your league in data-local/ (a parker-league-* folder with snapshot.json, inputs.json, meta.json). Pass --dump <folder>, or --live to fetch the league.",
    });
  });

  it("the header's command names the dump (so it reruns on the same data) or --live; cookies only with --live", () => {
    const root = path.join(tmpdir(), "repo");
    const d = path.join(root, "data-local", "parker-league-4c");
    expect(reportCommandText("trade:report", { dump: d, newest: true, team: "3", cookies: "on" }, root)).toBe("npm run trade:report -- --dump data-local/parker-league-4c --team 3");
    expect(reportCommandText("league:report", { dump: null, newest: false, team: "3", cookies: "on" }, root)).toBe("npm run league:report -- --live --team 3 --cookies");
    expect(reportCommandText("league:report", { dump: null, newest: false, team: undefined, cookies: "off" }, root)).toBe("npm run league:report -- --live --no-cookies");
    // A folder outside the project: its name only (no folders of the machine in a report).
    expect(reportCommandText("trade:report", { dump: path.join(tmpdir(), "elsewhere", "dump"), newest: false, team: undefined, cookies: null }, root)).toBe("npm run trade:report -- --dump dump");
    expect(reportSourceLine({ dump: d, newest: true, team: undefined, cookies: null }, root)).toBe(
      "Offline: the newest saved dump, data-local/parker-league-4c (no network; --live fetches your league instead, --dump <folder> reads another dump).",
    );
    expect(reportSourceLine({ dump: null, newest: false, team: undefined, cookies: null }, root)).toBe("Live: fetching your league (the network is on: --live).");
  });

  it("command-line helpers: flagValue, commandText, displayPath, npmFlag", () => {
    expect(flagValue(["--team", "3"], "--team")).toBe("3");
    expect(flagValue(["--team", "--dump"], "--team")).toBeUndefined();
    expect(flagValue([], "--team")).toBeUndefined();
    expect(commandText("league:report", [])).toBe("npm run league:report");
    expect(commandText("league:report", ["--dump data-local/x", null, undefined, false, "--team 3"])).toBe("npm run league:report -- --dump data-local/x --team 3");
    const root = path.join(tmpdir(), "repo");
    expect(displayPath(root, path.join(root, "data-local", "x"))).toBe("data-local/x");
    expect(displayPath(root, path.join(tmpdir(), "elsewhere", "dump"))).toBe("dump");
    expect(npmFlag({ npm_config_no_serve: "true", npm_config_stay: "true" }, "stay")).toBe("true");
    expect(npmFlag({ npm_config_no_serve: "true" }, "no-serve")).toBe("true");
    expect(npmFlag({}, "ref")).toBeUndefined();
  });
});
