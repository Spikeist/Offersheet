/**
 * Run every live probe one after another (never in parallel — be polite to the APIs), then rebuild
 * the matrix in reports/data-access.md.
 *
 *   npm run probe:all
 *   npm run probe:all -- --only=espn,sleeper
 *   npm run probe:all -- --matrix-only
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/env";
import { updateDataAccessMatrix } from "./lib/matrix";

const ALL = ["shared", "espn", "sleeper", "fleaflicker", "mfl", "yahoo", "fantrax"];

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length).split(",") : ALL;
  const results: Array<{ name: string; code: number | null; seconds: number }> = [];

  if (!process.argv.includes("--matrix-only")) {
    for (const name of only) {
      const file = path.join(ROOT, "scripts", `probe-${name}.ts`);
      if (!existsSync(file)) {
        console.log(`\n--- probe-${name}.ts not found; skipped`);
        results.push({ name, code: null, seconds: 0 });
        continue;
      }
      const t0 = Date.now();
      const run = spawnSync(process.execPath, ["--import", "tsx", file], { cwd: ROOT, stdio: "inherit" });
      results.push({ name, code: run.status, seconds: (Date.now() - t0) / 1000 });
    }
  }

  await updateDataAccessMatrix();
  console.log("\n=== probe:all");
  for (const r of results) console.log(`  ${r.code === 0 ? "ran " : r.code === null ? "skip" : "FAIL"}  ${r.name.padEnd(12)} ${r.seconds.toFixed(1)}s${r.code && r.code !== 0 ? `  (exit ${r.code})` : ""}`);
  console.log("  matrix: reports/data-access.md");
  if (results.some((r) => r.code !== 0 && r.code !== null)) process.exitCode = 1;
}

void main();
