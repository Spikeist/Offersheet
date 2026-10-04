/**
 * Finding and running Chrome for `npm run check:browser`.
 *
 * findChrome: CHROME_PATH when it's set (it must exist: a typo is reported, not passed over), else the standard
 * install places of Google Chrome, then Chromium and Microsoft Edge (both speak the same DevTools protocol):
 * - Windows: Program Files, Program Files (x86) and the user's LocalAppData;
 * - macOS: /Applications and ~/Applications;
 * - Linux and others: google-chrome, google-chrome-stable, chromium, chromium-browser and microsoft-edge on the PATH,
 *   then /snap/bin/chromium.
 * chromeCandidates is pure (platform and environment passed in), so the search is tested without a browser.
 *
 * launchChrome starts it headless (or visible with --show) with a throwaway profile, DevTools on a free port (Chrome
 * picks it: --remote-debugging-port=0, read back from its "DevTools listening on" line), no first-run screens,
 * extensions, sync or background downloads. It hands the process to the caller as soon as it exists (onSpawn), so a
 * Ctrl+C while Chrome starts still stops it, and kills it itself when the start fails (no DevTools line in time).
 * stopChrome closes it and, if it lingers, kills its whole process tree.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

type Env = Readonly<Record<string, string | undefined>>;

/** An environment variable, case-insensitively (Windows names vary in case: ProgramFiles, PROGRAMFILES). */
function envVar(env: Env, name: string): string | undefined {
  if (env[name]) return env[name];
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

const LINUX_NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];

/** Where Chrome (then Chromium, then Edge) usually lives on `platform`, in the order to try (pure). */
export function chromeCandidates(platform: NodeJS.Platform, env: Env): string[] {
  if (platform === "win32") {
    const join = path.win32.join;
    const roots = [envVar(env, "ProgramFiles") ?? "C:\\Program Files", envVar(env, "ProgramFiles(x86)") ?? "C:\\Program Files (x86)", envVar(env, "LOCALAPPDATA")].filter(
      (r): r is string => !!r,
    );
    const chrome = roots.map((r) => join(r, "Google", "Chrome", "Application", "chrome.exe"));
    const chromium = roots.map((r) => join(r, "Chromium", "Application", "chrome.exe"));
    const edge = roots.map((r) => join(r, "Microsoft", "Edge", "Application", "msedge.exe"));
    return [...new Set([...chrome, ...chromium, ...edge])];
  }
  if (platform === "darwin") {
    const home = envVar(env, "HOME");
    const apps = ["/Applications", ...(home ? [path.posix.join(home, "Applications")] : [])];
    const bundles = [
      ["Google Chrome.app", "Google Chrome"],
      ["Chromium.app", "Chromium"],
      ["Microsoft Edge.app", "Microsoft Edge"],
    ] as const;
    return bundles.flatMap(([app, exe]) => apps.map((dir) => path.posix.join(dir, app, "Contents", "MacOS", exe)));
  }
  const dirs = (envVar(env, "PATH") ?? "/usr/local/bin:/usr/bin:/bin").split(":").filter(Boolean);
  return [...new Set([...LINUX_NAMES.flatMap((name) => dirs.map((d) => path.posix.join(d, name))), "/snap/bin/chromium"])];
}

function isFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * The browser to run: CHROME_PATH (an error when it names no file), else the first standard place that exists; an
 * error saying where it looked when none does.
 */
export function findChrome(opts: { platform?: NodeJS.Platform; env?: Env; exists?: (p: string) => boolean } = {}): { path: string } | { error: string } {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const exists = opts.exists ?? isFile;
  const custom = envVar(env, "CHROME_PATH")?.trim();
  if (custom) return exists(custom) ? { path: custom } : { error: "CHROME_PATH is set, but no file is there. Point it at chrome.exe (or Chrome's executable on your system), or clear it." };
  const hit = chromeCandidates(platform, env).find((p) => exists(p));
  if (hit) return { path: hit };
  return { error: "Chrome wasn't found in its usual places. Install Google Chrome, or set CHROME_PATH to its executable." };
}

/** Chrome's flags (pure): headless unless `show`, DevTools on a port it picks, the profile folder, nothing extra. */
export function chromeArgs(profileDir: string, show: boolean): string[] {
  return [
    ...(show ? ["--window-size=430,932"] : ["--headless=new"]),
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--mute-audio",
    "about:blank",
  ];
}

/** The browser's DevTools WebSocket URL in its stderr (pure), or null. */
export function devtoolsUrl(stderr: string): string | null {
  return /DevTools listening on (ws:\/\/\S+)/.exec(stderr)?.[1] ?? null;
}

export interface RunningChrome {
  process: ChildProcess;
  /** The browser's DevTools WebSocket URL. */
  wsUrl: string;
}

/**
 * Starts the browser and waits for its DevTools URL. `onSpawn` gets the process at once (the caller's cleanup can reach
 * it from then on); a start that fails kills it before rejecting (waitForDevtools).
 */
export async function launchChrome(executable: string, opts: { profileDir: string; show: boolean; timeoutMs?: number; onSpawn?: (child: ChildProcess) => void }): Promise<RunningChrome> {
  const child = spawn(executable, chromeArgs(opts.profileDir, opts.show), { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  opts.onSpawn?.(child);
  return { process: child, wsUrl: await waitForDevtools(child, opts.timeoutMs ?? 30_000) };
}

/**
 * Waits for a starting browser's DevTools URL on its stderr (piped). When it doesn't come (`timeoutMs`), or the
 * process can't start or exits first, the process tree is killed before the promise rejects: a browser that never
 * became ready is never left running.
 */
export async function waitForDevtools(child: ChildProcess, timeoutMs: number): Promise<string> {
  try {
    const wsUrl = await new Promise<string>((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error(`Chrome started but didn't open DevTools within ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs);
      const fail = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };
      const onData = (d: Buffer) => {
        buf += d.toString("utf8");
        const url = devtoolsUrl(buf);
        if (url) {
          clearTimeout(timer);
          child.stderr?.off("data", onData);
          resolve(url);
        }
      };
      child.stderr?.on("data", onData);
      child.once("error", (err) => fail(new Error(`Chrome couldn't be started (${err.name}).`)));
      child.once("exit", (code) => fail(new Error(`Chrome exited before it was ready (exit code ${code ?? "none"}).`)));
    });
    // Keep draining stderr, so a chatty browser never blocks on a full pipe.
    child.stderr?.resume();
    return wsUrl;
  } catch (err) {
    // No pid: it never started (nothing to stop).
    if (child.pid !== undefined) {
      killTree(child);
      await exited(child, 5_000);
    }
    throw err;
  }
}

/** Resolves once the process has exited, or after `ms` (false then). */
export function exited(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/**
 * Kills a process and everything it started: taskkill /T on Windows (a parent's death doesn't end its children there),
 * the process group elsewhere when it leads one (spawned detached), else the process itself.
 */
export function killTree(child: ChildProcess, group = false): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else if (group) process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    // already gone
  }
}

/** Closes the browser: the caller's polite close first (Browser.close), then its tree is killed if it's still there. */
export async function stopChrome(chrome: RunningChrome, politeClose?: () => Promise<unknown>): Promise<void> {
  if (politeClose) await politeClose().catch(() => {});
  if (!(await exited(chrome.process, 5_000))) {
    killTree(chrome.process);
    await exited(chrome.process, 5_000);
  }
}
