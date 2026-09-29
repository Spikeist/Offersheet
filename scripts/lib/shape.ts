/**
 * Safe structure viewer for RAW responses: prints JSON paths, types and counts — never string values.
 * Use it to find where names/IDs live before writing a sanitizer, then read the sanitized copy.
 *
 *   npx tsx scripts/lib/shape.ts fixtures/raw/espn/<hash>.json [maxDepth]
 *
 * Numbers and booleans are summarised as min/max ranges (they are not identities), strings only as
 * "N distinct, len a–b" plus a format hint (guid / digits / url / text).
 */
import { readFileSync } from "node:fs";
import { installConsoleScrubber } from "./redact";
import { formatPath, type JsonPath } from "./sanitize";

interface Stat {
  types: Set<string>;
  count: number;
  strings: Set<string>;
  minLen: number;
  maxLen: number;
  numMin: number;
  numMax: number;
  hints: Set<string>;
}

export function describeShape(json: unknown, maxDepth = 12): Map<string, Stat> {
  const stats = new Map<string, Stat>();
  const visit = (v: unknown, p: JsonPath, depth: number) => {
    const key = formatPath(p.map((k) => (typeof k === "number" ? "[]" : k))).replace(/\.\[\]/g, "[]").replace(/\[\]\[\]/g, "[][]");
    let s = stats.get(key);
    if (!s) {
      s = { types: new Set(), count: 0, strings: new Set(), minLen: Infinity, maxLen: 0, numMin: Infinity, numMax: -Infinity, hints: new Set() };
      stats.set(key, s);
    }
    s.count++;
    const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
    s.types.add(t);
    if (typeof v === "string") {
      s.strings.add(v);
      s.minLen = Math.min(s.minLen, v.length);
      s.maxLen = Math.max(s.maxLen, v.length);
      s.hints.add(/^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(v) ? "guid" : /^\d+$/.test(v) ? "digits" : /^https?:/.test(v) ? "url" : /@/.test(v) ? "has-@" : "text");
    } else if (typeof v === "number") {
      s.numMin = Math.min(s.numMin, v);
      s.numMax = Math.max(s.numMax, v);
    }
    if (depth >= maxDepth) return;
    if (Array.isArray(v)) v.forEach((x) => visit(x, [...p, 0], depth + 1));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) visit(x, [...p, /^\d+$/.test(k) ? "{n}" : k], depth + 1);
  };
  visit(json, [], 0);
  return stats;
}

export function formatShape(stats: Map<string, Stat>): string {
  const lines: string[] = [];
  for (const [p, s] of stats) {
    let detail = "";
    if (s.types.has("string")) detail += ` strings: ${s.strings.size} distinct, len ${s.minLen}–${s.maxLen}, ${[...s.hints].join("/")}`;
    if (s.types.has("number")) detail += ` numbers: ${s.numMin}…${s.numMax}`;
    lines.push(`${p}  <${[...s.types].join("|")}> ×${s.count}${detail}`);
  }
  return lines.join("\n");
}

const isMain = process.argv[1] && /shape\.ts$/.test(process.argv[1]);
if (isMain) {
  installConsoleScrubber(); // numeric ranges could otherwise show a private league ID
  const file = process.argv[2];
  if (!file) {
    console.error("usage: npx tsx scripts/lib/shape.ts <file.json> [maxDepth]");
    process.exit(1);
  }
  const json = JSON.parse(readFileSync(file, "utf8")) as unknown;
  console.log(formatShape(describeShape(json, Number(process.argv[3] ?? 12))));
}
