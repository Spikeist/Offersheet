/**
 * Leak check before every commit: scans every file git would commit (tracked + untracked, not
 * ignored) for .env.local secrets/IDs and for leaguemates' identities recorded by the sanitizers
 * (fixtures/raw/**\/redaction-map.json). Prints file paths, categories and counts — never values.
 *
 *   npm run check:leaks        exit 1 on any "hard" hit; "soft" hits (short single-word names that
 *                               may be ordinary words) are listed for review.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ROOT, SENSITIVE_ENV_VARS, env } from "./lib/env";
import type { Entry } from "./lib/sanitize";

interface Needle {
  value: string;
  category: string;
  severity: "hard" | "soft";
  mode: "plain" | "digits" | "word";
}

const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz)$/i;
const NAME_CATEGORIES = new Set(["team-name", "owner-name", "real-name", "league-name", "team-abbrev", "free-text"]);

function needlesFromEnv(): Needle[] {
  const out: Needle[] = [];
  for (const name of SENSITIVE_ENV_VARS) {
    const v = env(name);
    if (!v || v.length < 3) continue;
    const variants = new Set([v, encodeURIComponent(v)]);
    try {
      variants.add(decodeURIComponent(v));
    } catch {
      // not %-encoded
    }
    const inner = /^\{(.+)\}$/.exec(v)?.[1];
    if (inner) {
      variants.add(inner);
      variants.add(inner.toLowerCase());
      variants.add(inner.toUpperCase());
    }
    for (const x of variants) {
      const isUsername = name.endsWith("USERNAME");
      out.push({
        value: x,
        category: `env:${name}`,
        severity: isUsername && x.length < 5 ? "soft" : "hard",
        mode: /^\d+$/.test(x) ? "digits" : isUsername ? "word" : "plain",
      });
    }
  }
  return out;
}

function findMaps(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...findMaps(p));
    else if (name === "redaction-map.json") out.push(p);
  }
  return out;
}

function needlesFromMaps(): Needle[] {
  const out: Needle[] = [];
  for (const file of findMaps(path.join(ROOT, "fixtures", "raw"))) {
    const platform = path.relative(path.join(ROOT, "fixtures", "raw"), path.dirname(file)).replace(/\\/g, "/");
    let entries: Entry[] = [];
    try {
      entries = JSON.parse(readFileSync(file, "utf8")) as Entry[];
    } catch {
      console.warn(`could not read ${path.relative(ROOT, file)}`);
      continue;
    }
    for (const e of entries) {
      if (!e.raw || e.raw.length < 3 || e.raw === e.placeholder) continue;
      const isName = NAME_CATEGORIES.has(e.category);
      const numeric = /^\d+$/.test(e.raw);
      if (numeric && e.raw.length < 4) continue;
      // Single short words (e.g. a team called "Chiefs") may be ordinary words: review, don't fail.
      const distinctive = !isName || e.raw.length >= 8 || /[\s\d]/.test(e.raw);
      out.push({
        value: e.raw,
        category: `${platform}:${e.category}`,
        severity: e.category === "real-name" ? "soft" : distinctive ? "hard" : "soft",
        mode: numeric ? "digits" : isName ? "word" : "plain",
      });
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function count(text: string, n: Needle): number {
  if (!text.includes(n.value)) return 0;
  if (n.mode === "plain") return text.split(n.value).length - 1;
  const re = n.mode === "digits" ? new RegExp(`(?<!\\d)${n.value}(?!\\d)`, "g") : new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(n.value)}(?![\\p{L}\\p{N}])`, "gu");
  return text.match(re)?.length ?? 0;
}

const SWID_LIKE = /\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}/g;
const PLACEHOLDER_SWID = /^\{00000000-0000-4000-8000-[0-9A-Fa-f]{12}\}$/;

const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((f) => !BINARY.test(f) && existsSync(path.join(ROOT, f)));

const needles = [...needlesFromEnv(), ...needlesFromMaps()];
const hits = new Map<string, Map<string, { n: number; severity: "hard" | "soft" }>>();
const note = (file: string, category: string, n: number, severity: "hard" | "soft") => {
  const perFile = hits.get(file) ?? new Map<string, { n: number; severity: "hard" | "soft" }>();
  const prev = perFile.get(category);
  perFile.set(category, { n: (prev?.n ?? 0) + n, severity: prev?.severity === "hard" ? "hard" : severity });
  hits.set(file, perFile);
};

for (const f of files) {
  const full = path.join(ROOT, f);
  if (statSync(full).size > 64 * 1024 * 1024) continue;
  const text = readFileSync(full, "utf8");
  for (const n of needles) {
    const c = count(text, n);
    if (c) note(f, n.category, c, n.severity);
  }
  const swids = (text.match(SWID_LIKE) ?? []).filter((s) => !PLACEHOLDER_SWID.test(s));
  if (swids.length) note(f, "pattern:unplaceholdered-{GUID}", swids.length, f.startsWith("fixtures/") || f.startsWith("reports/") ? "hard" : "soft");
}

let hard = 0;
let soft = 0;
for (const [file, cats] of [...hits].sort(([a], [b]) => a.localeCompare(b))) {
  for (const [cat, { n, severity }] of cats) {
    if (severity === "hard") hard += n;
    else soft += n;
    console.log(`${severity === "hard" ? "❌" : "⚠️"} ${file}: ${cat} ×${n}`);
  }
}
console.log(`\nscanned ${files.length} files against ${needles.length} values (${findMaps(path.join(ROOT, "fixtures", "raw")).length} redaction map(s)): ${hard} hard, ${soft} soft hit(s)`);
if (hard) {
  console.log("Hard hits must be fixed before committing.");
  process.exit(1);
}
