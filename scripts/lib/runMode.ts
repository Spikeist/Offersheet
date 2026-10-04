/**
 * Offline by default (planner reply to Checkpoint 4c, A5: "Verification and report scripts never touch the network
 * unless given --live"): what every networked script shares.
 *
 * - `--live` (wantsLive): the network is allowed. When the "--" is left out (`npm run x --live`), or a shell drops it,
 *   npm keeps the option as its own setting, npm_config_live "true", which counts too. ⚠️ Which shells drop it: npm
 *   10's npm.ps1 keeps the "--" when npm is typed at a PowerShell prompt (seen with npm 10.9.3 on Windows PowerShell
 *   5.1: `npm run x -- --live` reaches the script as `--live`), but passes PowerShell's own arguments, without the "--",
 *   when npm is run from piped input or `powershell -File`, as npm.ps1 files before npm 10 always did.
 * - setNetworkMode: every networked script sets this process's offline guard first thing (NETWORK_ENV, the variable
 *   src/server/http.ts reads: "off" without --live, "live" with it). With it off, the HTTP clients refuse any live fetch
 *   (src/server/http.ts refuseIfNetworkOff, also scripts/lib/http.ts): belt and braces behind each script's own choice.
 *   Child processes inherit it. The app never sets it.
 * - Reports (trade:report, league:report, import:report) read a saved dump by default (reportArgs): `--dump <dir>`
 *   (`--offline <dir>` kept as an alias), else the newest data-local/parker-league* dump by its meta.json time
 *   (listDumps, newestDump); `--live` fetches the league instead (the two don't go together). Their header prints the
 *   command line with the dump always named (reportCommandText), so a report can be run again on the same data.
 *   `--out <file>` writes a report somewhere other than its committed reports/ file (a check run).
 * - Scripts whose job is the network (the probes, check:browser, check:sleeper-cors, measure:stat-sd) need --live:
 *   without it they say so and exit (requireLive). snapshot:projections stays as it is (its job is fetching).
 * - isMainModule: whether a module is the script node was started with, by exact resolved file paths (a scratch file
 *   named run-trade-report.ts that imports the report must not start it, as the old /trade-report\.ts$/ test did).
 *   Every script that calls main() or runProbe() at its top level does so under it, the fixture generators and
 *   snapshot:projections included (runMode.test.ts checks; check-leaks, the pre-commit check, offline, is the one left).
 * - npmFlag: npm's own settings for a script's options when the "--" was left out or dropped (the stable copy's flags,
 *   scripts/stable.ts; check:browser has its own, scripts/check-browser/args.ts).
 *
 * Pure but for listDumps (reads data-local/) and isMainModule (resolves real paths); tested in runMode.test.ts.
 *
 * It imports Node's built-ins only: scripts/stable.ts (`npm run stable`, Parker's start command) imports it from the
 * development folder, so nothing of the app or its packages may load through it (planner reply to Checkpoint 4c, A1:
 * "a copy that in-progress work can't break"; stable.test.ts checks the import graph).
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * The offline guard's variable: src/server/http.ts NETWORK_ENV, written out here rather than imported so this module
 * loads nothing of the app (see the header); runMode.test.ts checks the two match.
 */
export const NETWORK_ENV = "OFFERSHEET_NETWORK";

export const LIVE_FLAG = "--live";

/** --live on the command line, or npm's npm_config_live "true" (the "--" left out or dropped; see the header). */
export function wantsLive(argv: readonly string[], env: Env = process.env): boolean {
  return argv.includes(LIVE_FLAG) || env.npm_config_live === "true";
}

/** Sets this process's offline guard (NETWORK_ENV, read by src/server/http.ts): "live" with --live, else "off". */
export function setNetworkMode(live: boolean, env: Record<string, string | undefined> = process.env): void {
  env[NETWORK_ENV] = live ? "live" : "off";
}

/**
 * What a script whose job is the network prints without --live: `script` (its npm script, or a name), `what` it fetches,
 * and the command that runs it (default `npm run <script> -- --live`).
 */
export function liveRequiredText(script: string, what: string, command = `npm run ${script} -- ${LIVE_FLAG}`): string {
  return `${script} ${what}, so it runs only with ${LIVE_FLAG}: ${command}. Nothing was fetched.`;
}

/**
 * For scripts whose job is the network: with --live, sets the guard to "live" and returns; without it, sets it to "off",
 * prints liveRequiredText and exits with `exitCode` (1; check:browser passes its "couldn't run" code, 2).
 */
export function requireLive(opts: { script: string; what: string; command?: string; argv?: readonly string[]; env?: Env; exitCode?: number }): void {
  const live = wantsLive(opts.argv ?? process.argv.slice(2), opts.env ?? process.env);
  setNetworkMode(live);
  if (live) return;
  console.error(liveRequiredText(opts.script, opts.what, opts.command));
  process.exit(opts.exitCode ?? 1);
}

// ---------------------------------------------------------------------------------------------
// isMain

/** A path as the file system has it: real path (8.3 short names, junctions, letter case), the nearest existing folder's when it doesn't exist; lower case on Windows. */
export function canonicalPath(p: string): string {
  const abs = path.resolve(p);
  let real = abs;
  try {
    real = realpathSync.native(abs);
  } catch {
    // Not there (yet): resolve the nearest folder that is, and keep the rest as given.
    const rest: string[] = [];
    let dir = abs;
    for (;;) {
      const parent = path.dirname(dir);
      rest.unshift(path.basename(dir));
      if (parent === dir) break;
      dir = parent;
      try {
        real = path.join(realpathSync.native(dir), ...rest);
        break;
      } catch {
        // keep walking up
      }
    }
  }
  return process.platform === "win32" ? real.toLowerCase() : real;
}

/** Two paths name the same file or folder (canonicalPath). */
export function samePath(a: string, b: string): boolean {
  return canonicalPath(a) === canonicalPath(b);
}

/**
 * Whether the module at `moduleUrl` (import.meta.url, or a file path) is the script node was started with (`argv1`,
 * process.argv[1]): the two resolved to real paths and compared exactly. tsx also runs `tsx scripts/trade-report` without
 * the extension, so argv[1] plus the module's own extension counts too. Under Vitest argv[1] is Vitest's, never a report.
 */
export function isMainModule(moduleUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  const self = moduleUrl.startsWith("file:") ? fileURLToPath(moduleUrl) : moduleUrl;
  const candidates = path.extname(argv1) ? [argv1] : [argv1, `${argv1}${path.extname(self)}`];
  return candidates.some((c) => samePath(c, self));
}

// ---------------------------------------------------------------------------------------------
// Command lines

/** The value after `flag` (`--team 3`), or undefined when the flag is absent or has no value. */
export function flagValue(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  const v = i >= 0 ? argv[i + 1] : undefined;
  return v !== undefined && !v.startsWith("--") ? v : undefined;
}

/** A path relative to `root`, with forward slashes (for the report's words; never a secret). */
export function relativePath(root: string, p: string): string {
  return path.relative(root, p).split(path.sep).join("/");
}

/** A path for a header: relative to `root` with forward slashes, or just its file name when it lies outside `root`. */
export function displayPath(root: string, p: string): string {
  const rel = relativePath(root, p);
  return rel.startsWith("..") || path.isAbsolute(rel) ? path.basename(p) : rel;
}

/** "npm run trade:report -- --dump data-local/x --team 3": the script and the arguments it ran with (empty ones left out). */
export function commandText(script: string, args: readonly (string | null | undefined | false)[]): string {
  const parts = args.filter((a): a is string => typeof a === "string" && a.length > 0);
  return parts.length ? `npm run ${script} -- ${parts.join(" ")}` : `npm run ${script}`;
}

/**
 * An option npm kept for itself when the "--" was left out or a shell dropped it (see the header): npm_config_<name>
 * ("true" for a bare flag, the value for --name=value, "" or "false" for --no-name). Undefined when npm didn't see it.
 */
export function npmFlag(env: Env, name: string): string | undefined {
  return env[`npm_config_${name.replace(/-/g, "_")}`];
}

// ---------------------------------------------------------------------------------------------
// Saved dumps (the reports' default data)

/** The dumps' folder names: parker-league (Checkpoint 4) and parker-league-<label> (data-local/dump-final.ts). */
export const DUMP_NAME = /^parker-league(-[A-Za-z0-9_.-]+)?$/;
/** What a dump folder holds (league-report loadDump reads them). */
export const DUMP_FILES = ["snapshot.json", "inputs.json", "meta.json"] as const;

export interface DumpInfo {
  /** The dump folder (absolute). */
  dir: string;
  /** meta.json's `now`: when the dump was made (the engine's "now" for it). */
  now: Date;
}

/** A dump folder's meta.json time, or null when it isn't a complete dump (DUMP_FILES) or the time isn't valid. */
export function dumpTime(dir: string): Date | null {
  if (!DUMP_FILES.every((f) => existsSync(path.join(dir, f)))) return null;
  try {
    const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8")) as { now?: unknown };
    const now = new Date(typeof meta.now === "string" ? meta.now : Number.NaN);
    return Number.isNaN(now.getTime()) ? null : now;
  } catch {
    return null;
  }
}

/** The complete dumps in `<root>/data-local` (DUMP_NAME folders with DUMP_FILES and a valid meta.json time), by name. */
export function listDumps(root: string): DumpInfo[] {
  const base = path.join(root, "data-local");
  let names: string[];
  try {
    names = readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() && DUMP_NAME.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  const out: DumpInfo[] = [];
  for (const name of names) {
    const dir = path.join(base, name);
    const now = dumpTime(dir);
    if (now) out.push({ dir, now });
  }
  return out;
}

/** The newest dump by its meta.json time; ties go to the later folder name (pure). */
export function newestDump(dumps: readonly DumpInfo[]): DumpInfo | null {
  let best: DumpInfo | null = null;
  for (const d of dumps) {
    if (!best || d.now.getTime() > best.now.getTime() || (d.now.getTime() === best.now.getTime() && path.basename(d.dir) > path.basename(best.dir))) best = d;
  }
  return best;
}

/** A report's command line (reportArgs). */
export interface ReportArgs {
  /** The saved dump it reads (an absolute folder), or null with --live (the network). */
  dump: string | null;
  /** The dump was picked as the newest (no folder named). */
  newest: boolean;
  /** --team <id>: my team, when the data doesn't say. */
  team: string | undefined;
  /** --cookies / --no-cookies as given (they matter only with --live: the .env.local ESPN cookies). */
  cookies: "on" | "off" | null;
  /** --out <file>: write the report there (relative to the project root) instead of its committed reports/ file, e.g. a check run. */
  out?: string;
}

/**
 * A report's command line (see the header): --live, or the dump (--dump <dir> or its alias --offline <dir>, a relative
 * folder from `root`; without a folder, or with neither flag, the newest dump: `dumps`, default listDumps(root)), and
 * --team, --cookies, --no-cookies. An error says what to do: --live with --dump, no dump at all, a folder that isn't one.
 */
export function reportArgs(argv: readonly string[], root: string, opts: { env?: Env; dumps?: () => readonly DumpInfo[] } = {}): ReportArgs | { error: string } {
  const env = opts.env ?? process.env;
  const live = wantsLive(argv, env);
  const dumpFlag = argv.includes("--dump") ? "--dump" : argv.includes("--offline") ? "--offline" : null;
  const team = flagValue(argv, "--team");
  const cookies = argv.includes("--no-cookies") ? "off" : argv.includes("--cookies") ? "on" : null;
  const outArg = flagValue(argv, "--out");
  const out = outArg !== undefined ? { out: path.resolve(root, outArg) } : {};
  if (argv.includes("--out") && outArg === undefined) return { error: "--out needs a file, for example --out .cache/league-report.md." };
  if (live && dumpFlag) return { error: `${LIVE_FLAG} and ${dumpFlag} don't go together: ${LIVE_FLAG} fetches your league, ${dumpFlag} reads a saved dump. Pick one.` };
  if (live) return { dump: null, newest: false, team, cookies, ...out };
  const named = dumpFlag ? flagValue(argv, dumpFlag) : undefined;
  if (named !== undefined) {
    const dir = path.resolve(root, named);
    if (!dumpTime(dir)) return { error: `${displayPath(root, dir)} isn't a saved dump: it needs ${DUMP_FILES.join(", ")} with a valid \`now\` in meta.json.` };
    return { dump: dir, newest: false, team, cookies, ...out };
  }
  const newest = newestDump((opts.dumps ?? (() => listDumps(root)))());
  if (!newest) return { error: `No saved dump of your league in data-local/ (a parker-league-* folder with ${DUMP_FILES.join(", ")}). Pass --dump <folder>, or ${LIVE_FLAG} to fetch the league.` };
  return { dump: newest.dir, newest: true, team, cookies, ...out };
}

/** The command line a report's header prints (the dump always named, relative to `root`), so it can be run again on the same data. */
export function reportCommandText(script: string, args: ReportArgs, root: string): string {
  return commandText(script, [
    args.dump ? `--dump ${displayPath(root, args.dump)}` : LIVE_FLAG,
    args.team ? `--team ${args.team}` : null,
    args.dump === null && args.cookies === "on" ? "--cookies" : null,
    args.dump === null && args.cookies === "off" ? "--no-cookies" : null,
  ]);
}

/** The console line a report prints before it starts: where its data comes from. */
export function reportSourceLine(args: ReportArgs, root: string): string {
  if (!args.dump) return "Live: fetching your league (the network is on: --live).";
  const which = args.newest ? "the newest saved dump" : "the saved dump";
  return `Offline: ${which}, ${displayPath(root, args.dump)} (no network; --live fetches your league instead, --dump <folder> reads another dump).`;
}
