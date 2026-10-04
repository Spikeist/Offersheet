/**
 * Generate SESSION_SECRET and write it straight into .env.local without printing it.
 *   npm run gen:secret             (keeps an existing non-blank value)
 *   npm run gen:secret -- --force  (replaces it; existing sessions become invalid)
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/env";
import { isMainModule } from "./lib/runMode";

function main(): void {
  const file = path.join(ROOT, ".env.local");
  const force = process.argv.includes("--force");
  const secret = randomBytes(32).toString("base64url"); // 43 chars; iron-session needs 32+

  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const lines = text.length ? text.split(/\r?\n/) : [];
  const idx = lines.findIndex((l) => /^\s*(export\s+)?SESSION_SECRET\s*=/.test(l));

  if (idx >= 0) {
    const current = (lines[idx] ?? "").replace(/^\s*(export\s+)?SESSION_SECRET\s*=/, "").trim().replace(/^["']|["']$/g, "");
    if (current && !force) {
      console.log("SESSION_SECRET is already set in .env.local; left unchanged (use --force to replace).");
      return;
    }
    lines[idx] = `SESSION_SECRET=${secret}`;
  } else {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.splice(lines.length ? lines.length - 1 : 0, 0, `SESSION_SECRET=${secret}`);
  }

  const out = lines.join(eol);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, out.endsWith(eol) ? out : out + eol, "utf8");
  renameSync(tmp, file);
  console.log("SESSION_SECRET generated and written to .env.local (value not shown).");
}

// Only when run as a script (npm run …), never when imported: a scratch file importing this must not touch .env.local.
if (isMainModule(import.meta.url)) main();
