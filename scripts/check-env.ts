/**
 * Report which .env.local variables are set — "set" / "blank" only, plus harmless shape checks.
 * Never prints a value.   npm run check-env
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ENV_VARS, ROOT, UNUSED_STORE_ENV_VARS, env } from "./lib/env";
import { isMainModule } from "./lib/runMode";

function main(): void {
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) {
    console.log(".env.local: missing (copy .env.example to .env.local and fill in what you have)");
    return;
  }

  // Parse the file ourselves only to detect formatting problems (quotes, duplicates, '$' that the
  // Next.js loader would expand). Values stay in memory.
  const raw = new Map<string, { value: string; quoted: boolean; duplicate: boolean }>();
  let malformed = 0;
  for (const line of readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(t);
    if (!m || !m[1]) {
      malformed++;
      continue;
    }
    let v = (m[2] ?? "").trim();
    const quoted = v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.endsWith(v[0]);
    v = quoted ? v.slice(1, -1) : v.replace(/\s+#.*$/, "");
    raw.set(m[1], { value: v, quoted, duplicate: raw.has(m[1]) });
  }

  for (const name of ENV_VARS) {
    const r = raw.get(name);
    const loaded = env(name);
    const notes: string[] = [];
    if (r?.duplicate) notes.push("DUPLICATE KEY");
    if (loaded) {
      if (name === "ESPN_SWID") notes.push(/^\{[0-9A-Fa-f-]{36}\}$/.test(loaded) ? "shape {GUID} ok" : "shape is NOT {GUID} — include the curly braces");
      if (name === "ESPN_SEASON") notes.push(/^\d{4}$/.test(loaded) ? `season ${loaded}` : "not a 4-digit year");
      if (/_LEAGUE_ID$/.test(name) && name !== "FANTRAX_LEAGUE_ID") notes.push(/^\d+$/.test(loaded) ? "numeric" : "NOT numeric");
      if (name === "SESSION_SECRET") notes.push(loaded.length >= 32 ? "32+ chars" : "TOO SHORT (needs 32+ chars)");
      if (name === "READONLY_STORE_URL") {
        notes.push(
          /rediss?:\/\//i.test(loaded)
            ? "a redis:// connection string, which carries the store's full password: DELETE IT and type KV_REST_API_URL's value"
            : /^https:\/\//i.test(loaded)
              ? "https ok"
              : "NOT an https:// address",
        );
      }
      if (name === "READONLY_STORE_TOKEN" && /:\/\//.test(loaded)) {
        notes.push(
          /rediss?:\/\//i.test(loaded)
            ? "a redis:// connection string, which carries the store's full password: DELETE IT and type KV_REST_API_READ_ONLY_TOKEN's value"
            : "an address, not a token: type KV_REST_API_READ_ONLY_TOKEN's value",
        );
      }
      if (UNUSED_STORE_ENV_VARS.includes(name)) notes.push("nothing local reads it: DELETE IT (the store scripts read READONLY_STORE_URL and READONLY_STORE_TOKEN)");
    }
    if (r && r.value !== (process.env[name] ?? "").trim() && r.value.trim() !== "") notes.push("WARNING: value changes when loaded (a '$' may be expanded)");
    console.log(`${name.padEnd(22)} ${loaded ? "set" : "blank"}${notes.length ? `  (${notes.join(", ")})` : ""}`);
  }
  const extra = [...raw.keys()].filter((k) => !(ENV_VARS as readonly string[]).includes(k));
  console.log(`other keys: ${extra.length ? extra.join(", ") : "none"}; malformed lines: ${malformed}`);
  // Vercel's system variables (what `vercel env pull` writes): with VERCEL set, `npm run dev` and the stable copy take
  // themselves for a deployment and use the shared store (src/server/redis.ts: Vercel only).
  const vercel = extra.filter((k) => /^VERCEL/.test(k));
  if (vercel.length) {
    console.log(`WARNING: ${vercel.join(", ")} in .env.local: DELETE ${vercel.length === 1 ? "IT" : "THEM"}. They make npm run dev and the stable copy act as a deployment and use the shared store.`);
  }
}

// Only when run as a script (npm run …), never when imported: a scratch file importing this must not run it.
if (isMainModule(import.meta.url)) main();
