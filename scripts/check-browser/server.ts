/**
 * The production server for `npm run check:browser`: it checks that a production build exists (`npm run build` makes
 * .next/BUILD_ID), says when the source changed after that build, finds a free local port and runs `next start` there
 * (through node and Next's own bin file, so Windows needs no shell), waits until it answers, and stops it with
 * everything it started. The process goes to the caller as soon as it exists (onSpawn: a Ctrl+C while it starts still
 * stops it, and it runs in its own process group outside Windows, where the terminal's Ctrl+C wouldn't reach it), and
 * a start that fails stops it before throwing. Its output is kept in memory, never printed except as the last lines
 * of a failed start.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import net from "node:net";
import path from "node:path";
import { exited, killTree } from "./chrome";

/** What `npm run build` leaves behind: its build id file, and when it was written. */
export function productionBuild(root: string): { builtAt: number } | null {
  const file = path.join(root, ".next", "BUILD_ID");
  try {
    return existsSync(file) ? { builtAt: statSync(file).mtimeMs } : null;
  } catch {
    return null;
  }
}

/** The newest modification time of any file under `dir` (0 when there are none). */
export function newestChange(dir: string): number {
  let newest = 0;
  const walk = (d: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        try {
          newest = Math.max(newest, statSync(p).mtimeMs);
        } catch {
          // gone meanwhile
        }
      }
    }
  };
  walk(dir);
  return newest;
}

/** A local port nothing listens on right now (the OS picks it). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("No free port was found."))));
    });
  });
}

export interface RunningServer {
  /** http://127.0.0.1:<port> */
  origin: string;
  process: ChildProcess;
  /** The server's last output lines (never printed unless it fails to start). */
  tail(): string[];
  /** Lines the app logged as errors while it ran ("[offer-sheet] …": by error name only, never secrets). */
  appErrors(): string[];
}

const KEEP_LINES = 200;

/**
 * Runs `next start` on 127.0.0.1:<port> in `root` and waits (up to `timeoutMs`) until it answers. `onSpawn` gets the
 * process at once; a start that fails (it exits, or doesn't answer in time) stops it before throwing.
 */
export async function startNextServer(root: string, port: number, opts: { timeoutMs?: number; onSpawn?: (child: ChildProcess) => void } = {}): Promise<RunningServer> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const bin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(bin)) throw new Error("Next.js isn't installed here (node_modules/next is missing): run npm install first.");
  const child = spawn(process.execPath, [bin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    // Its own process group elsewhere, so stopping it ends whatever it started (Windows: taskkill /T).
    detached: process.platform !== "win32",
  });
  opts.onSpawn?.(child);
  const lines: string[] = [];
  const errors: string[] = [];
  const take = (d: Buffer) => {
    for (const line of d.toString("utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      lines.push(line);
      if (lines.length > KEEP_LINES) lines.shift();
      if (/\[offer-sheet\]/.test(line) && errors.length < 50) errors.push(line.trim());
    }
  };
  child.stdout?.on("data", take);
  child.stderr?.on("data", take);
  const origin = `http://127.0.0.1:${port}`;
  const server: RunningServer = { origin, process: child, tail: () => [...lines], appErrors: () => [...errors] };

  const started = Date.now();
  try {
    for (;;) {
      if (child.exitCode !== null || child.signalCode !== null) throw new StartError("The production server exited before it answered.", lines);
      try {
        const res = await fetch(`${origin}/`, { signal: AbortSignal.timeout(5_000) });
        await res.arrayBuffer().catch(() => undefined);
        if (res.status < 500) return server;
      } catch {
        // not listening yet
      }
      if (Date.now() - started > timeoutMs) throw new StartError(`The production server didn't answer within ${Math.round(timeoutMs / 1000)} seconds.`, lines);
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (err) {
    await stopServer(server);
    throw err;
  }
}

/** A start that failed, with the server's last output lines (the caller prints them through the scrubber). */
export class StartError extends Error {
  constructor(
    message: string,
    readonly tail: string[],
  ) {
    super(message);
    this.name = "StartError";
  }
}

/** Stops the server and everything it started. */
export async function stopServer(server: RunningServer): Promise<void> {
  const child = server.process;
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    if (await exited(child, 5_000)) return;
  }
  killTree(child, process.platform !== "win32");
  await exited(child, 5_000);
}
