/**
 * Run every live probe one after another (never in parallel — be polite to the APIs), then rebuild
 * the matrix in reports/data-access.md.
 *
 *   npm run probe:all -- --live
 *   npm run probe:all -- --live --only=espn,sleeper
 *   npm run probe:all -- --matrix-only     (no network: rebuilds the matrix from the saved probe outputs)
 *   npm run probe:all -- --live --allow-crawl     (passed on to every probe; only after asking Parker)
 *
 * The probes need --live (planner reply to Checkpoint 4c, A5: scripts touch the network only when asked;
 * scripts/lib/runMode.ts), which is passed on to each; without it, only --matrix-only runs.
 *
 * CLAUDE.md §0.6: without --allow-crawl (or ALLOW_STRANGER_CRAWL=1) no probe crawls or discovers
 * strangers' leagues: each refreshes at most its one pinned test league and reads any other
 * stranger's league from the HTTP cache only.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/env";
import { updateDataAccessMatrix } from "./lib/matrix";
import { crawlAllowed } from "./lib/probe";
import { LIVE_FLAG, isMainModule, requireLive, setNetworkMode } from "./lib/runMode";

// Order matters: probe:sleeper reads the outputs of probe:shared and probe:sleeper-codes.
const ALL = ["shared", "espn", "sleeper-codes", "sleeper", "fleaflicker", "mfl", "yahoo", "fantrax"];

async function main() {
  const matrixOnly = process.argv.includes("--matrix-only");
  // The matrix alone reads saved outputs (no network); the probes need --live.
  if (matrixOnly) setNetworkMode(false);
  else requireLive({ script: "probe:all", what: "runs every live probe (--matrix-only rebuilds the matrix from saved outputs without the network)" });
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length).split(",") : ALL;
  const results: Array<{ name: string; code: number | null; seconds: number }> = [];
  const passOn = [LIVE_FLAG, ...(crawlAllowed() ? ["--allow-crawl"] : [])];
  console.log(crawlAllowed() ? "crawl gate: --allow-crawl (strangers' leagues may be crawled)" : "crawl gate: closed (no --allow-crawl): pinned test leagues only; other strangers' leagues from the cache");

  if (!matrixOnly) {
    for (const name of only) {
      const file = path.join(ROOT, "scripts", `probe-${name}.ts`);
      if (!existsSync(file)) {
        console.log(`\n--- probe-${name}.ts not found; skipped`);
        results.push({ name, code: null, seconds: 0 });
        continue;
      }
      const t0 = Date.now();
      const run = spawnSync(process.execPath, ["--import", "tsx", file, ...passOn], { cwd: ROOT, stdio: "inherit" });
      results.push({ name, code: run.status, seconds: (Date.now() - t0) / 1000 });
    }
  }

  await updateDataAccessMatrix();
  console.log("\n=== probe:all");
  for (const r of results) console.log(`  ${r.code === 0 ? "ran " : r.code === null ? "skip" : "FAIL"}  ${r.name.padEnd(12)} ${r.seconds.toFixed(1)}s${r.code && r.code !== 0 ? `  (exit ${r.code})` : ""}`);
  console.log("  matrix: reports/data-access.md");
  if (results.some((r) => r.code !== 0 && r.code !== null)) process.exitCode = 1;
}

// Run only as a script (an exact path: scripts/lib/runMode.ts isMainModule; a scratch file that imports it starts nothing).
if (isMainModule(import.meta.url)) void main();
