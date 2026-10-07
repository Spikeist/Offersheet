/**
 * Leak check before every commit: scans every file git would commit (tracked + untracked, not
 * ignored) for .env.local secrets/IDs and for identities recorded by the sanitizers and crawlers.
 * Prints file paths, categories and counts — never values.
 *
 *   npm run check:leaks                exit 1 on any "hard" hit
 *   npm run check:leaks -- --verbose   also list every soft hit per file
 *   … -- --files <list>                scan exactly the files named in <list> (one project-relative path a line) instead
 *                                      of git's: npm run preview:deploy scans the exact upload with it (final review SEC-8)
 *   … -- --files <list> --base <dir>   the same, each file read from <dir> instead of this folder: npm run prod:deploy
 *                                      scans its clean copy of the tag with it (Checkpoint 7c). The needles still come
 *                                      from the folder the check runs in (its .env.local, maps and watch lists), so it
 *                                      must run in the main folder, never in the copy.
 *
 * A --files scan with no .env.local value to look for is refused (exit 1): it would pass whatever the files hold, which
 * is exactly what running it from the wrong folder looks like. In a --files scan a listed file that can't be read is a
 * hard failure too (it wasn't scanned, so it can't be vouched for).
 *
 * Sources of identities (all git-ignored):
 *   fixtures/raw/**\/redaction-map.json   raw → placeholder maps written by each probe's Redactor
 *   fixtures/raw/**\/watchlist.json,       [{ value, category }] written by crawlers/discovery for
 *   data-local/**\/watchlist.json          strangers' leagues that are never sanitized into fixtures
 *
 * Severity:
 *   hard  secrets and IDs; distinctive names (8+ chars, or containing a space/digit); a leaguemate's
 *         full real name ("First Last" / "Last, First", paired from the ESPN map); any real-name
 *         word in reports/** or scripts/**.
 *   soft  single short words that may be ordinary words (a first name, "Chiefs"), listed for review.
 * A soft word inside a public NFL player's name ("Zorblax" in a made-up player "Zorblax Quintavious") is not counted; that
 * needs the cached Sleeper players DB (run any probe once). Names that ARE public NFL names or
 * team/college words ("Cowboys", "Justin Jefferson") identify nobody and are skipped.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ROOT, SENSITIVE_ENV_VARS, env } from "./lib/env";
import { countOutsidePlayerNames, inPlayerName, loadPublicNames, normName, wordRegExp, type PublicNames } from "./lib/public-names";
import type { Entry } from "./lib/sanitize";

type Severity = "hard" | "soft";
interface Needle {
  value: string;
  category: string;
  severity: Severity;
  mode: "plain" | "digits" | "word";
  /** Real-name words become hard in these repo areas (reports, code). */
  hardIn?: RegExp;
}

const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz)$/i;
const NAME_CATEGORIES = new Set(["team-name", "owner-name", "real-name", "league-name", "team-abbrev", "free-text", "username"]);
const ID_CATEGORIES = new Set(["league-id", "user-id", "swid", "email", "draft-id", "other-id", "avatar"]);
/** Short free text / abbreviations ("Boom", "KC") identify nobody and match everywhere. */
const MIN_WEAK_LENGTH = 5;
const WEAK_CATEGORIES = new Set(["team-abbrev", "free-text"]);
/** Windows device names: `> NUL` in Git Bash creates a real file that can hold redirected output. */
const RESERVED_NAMES = /^(nul|con|prn|aux|com[1-9]|lpt[1-9])(\..*)?$/i;
const REPORTS_OR_CODE = /^(reports|scripts|src)\//;
const verbose = process.argv.includes("--verbose");

// ---------------------------------------------------------------------------------------------
// Needles

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

function findFiles(dir: string, fileName: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p, { throwIfNoEntry: false });
    if (st?.isDirectory()) out.push(...findFiles(p, fileName));
    else if (name === fileName) out.push(p);
  }
  return out;
}

function sourceLabel(file: string): string {
  const rel = path.relative(ROOT, path.dirname(file)).replace(/\\/g, "/");
  return rel.replace(/^fixtures\/raw\//, "").replace(/^data-local\//, "local:");
}

/** A name that is itself public (an NFL player, team or college) identifies nobody. */
function isPublicName(value: string, names: PublicNames | null): boolean {
  if (!names) return false;
  const n = normName(value);
  return names.players.has(n) || names.publicWords.has(n);
}

function needleFor(value: string, category: string, source: string, names: PublicNames | null, counters: { skippedPublic: number }): Needle | null {
  if (!value || value.length < 3) return null;
  const numeric = /^\d+$/.test(value);
  if (numeric && value.length < 4) return null;
  if (WEAK_CATEGORIES.has(category) && value.length < MIN_WEAK_LENGTH) return null;
  const isName = NAME_CATEGORIES.has(category);
  if (isName && isPublicName(value, names)) {
    counters.skippedPublic++;
    return null;
  }
  const distinctive = !isName || ID_CATEGORIES.has(category) || value.length >= 8 || /[\s\d]/.test(value);
  const realName = category === "real-name";
  return {
    value,
    category: `${source}:${category}`,
    severity: realName ? "soft" : distinctive ? "hard" : "soft",
    mode: numeric ? "digits" : isName ? "word" : "plain",
    hardIn: realName ? REPORTS_OR_CODE : undefined,
  };
}

function needlesFromMaps(maps: string[], names: PublicNames | null, counters: { skippedPublic: number }): Needle[] {
  const out: Needle[] = [];
  for (const file of maps) {
    const source = sourceLabel(file);
    let entries: Entry[] = [];
    try {
      entries = JSON.parse(readFileSync(file, "utf8")) as Entry[];
    } catch {
      console.warn(`could not read ${path.relative(ROOT, file)}`);
      continue;
    }
    const firsts = new Map<string, string>();
    const lasts = new Map<string, string>();
    for (const e of entries) {
      if (!e.raw || e.raw === e.placeholder) continue;
      const n = needleFor(e.raw, e.category, source, names, counters);
      if (n) out.push(n);
      // ESPN members: placeholders "First N" / "Last N" pair up into a full real name.
      const f = /^First (\d+)$/.exec(e.placeholder)?.[1];
      const l = /^Last (\d+)$/.exec(e.placeholder)?.[1];
      if (e.category === "real-name" && f) firsts.set(f, e.raw);
      if (e.category === "real-name" && l) lasts.set(l, e.raw);
    }
    for (const [k, first] of firsts) {
      const last = lasts.get(k);
      if (!last) continue;
      for (const full of [`${first} ${last}`, `${last}, ${first}`, `${last} ${first}`]) {
        if (isPublicName(full, names)) continue;
        out.push({ value: full, category: `${source}:full-real-name`, severity: "hard", mode: "word" });
      }
    }
  }
  return out;
}

function needlesFromWatchlists(files: string[], names: PublicNames | null, counters: { skippedPublic: number }): Needle[] {
  const out: Needle[] = [];
  for (const file of files) {
    const source = sourceLabel(file);
    let entries: Array<{ value?: unknown; category?: unknown }> = [];
    try {
      entries = JSON.parse(readFileSync(file, "utf8")) as typeof entries;
    } catch {
      console.warn(`could not read ${path.relative(ROOT, file)}`);
      continue;
    }
    for (const e of entries) {
      if (typeof e.value !== "string" || typeof e.category !== "string") continue;
      const n = needleFor(e.value, e.category, `watch:${source}`, names, counters);
      if (!n) continue;
      // Strangers' single-word names ("Open", "Gridiron") are ordinary words far more often than
      // identities: report them for review, never block a commit on them.
      if (NAME_CATEGORIES.has(e.category) && /^[\p{L}'’-]+$/u.test(e.value)) n.severity = "soft";
      out.push(n);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Matching

function occurrences(text: string, n: Needle): number[] {
  if (!text.includes(n.value)) return [];
  const re =
    n.mode === "plain"
      ? new RegExp(n.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
      : n.mode === "digits"
        ? new RegExp(`(?<!\\d)${n.value}(?!\\d)`, "g")
        : wordRegExp(n.value, "gu");
  return [...text.matchAll(re)].map((m) => m.index ?? 0);
}

const SWID_LIKE = /\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}/g;
const PLACEHOLDER_SWID = /^\{00000000-0000-4000-8000-[0-9A-Fa-f]{12}\}$/;

function reservedNameFiles(dir: string, root: string = ROOT): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === ".next") continue;
    const p = path.join(dir, name);
    if (RESERVED_NAMES.test(name)) out.push(path.relative(root, p).replace(/\\/g, "/"));
    else if (statSync(p, { throwIfNoEntry: false })?.isDirectory()) out.push(...reservedNameFiles(p, root));
  }
  return out;
}

async function main() {
  const names = await loadPublicNames();
  const counters = { skippedPublic: 0 };
  const maps = findFiles(path.join(ROOT, "fixtures", "raw"), "redaction-map.json");
  const watchlists = [...findFiles(path.join(ROOT, "fixtures", "raw"), "watchlist.json"), ...findFiles(path.join(ROOT, "data-local"), "watchlist.json")];
  const envNeedles = needlesFromEnv();
  const needles = [...envNeedles, ...needlesFromMaps(maps, names, counters), ...needlesFromWatchlists(watchlists, names, counters)];

  // --files <list>: exactly the files the list names (preview:deploy's upload, prod:deploy's copy); else every file git
  // would commit. --base <dir>: where the listed files are read from (default: this folder).
  const at = process.argv.indexOf("--files");
  const baseAt = process.argv.indexOf("--base");
  let base = ROOT;
  if (baseAt >= 0) {
    const dir = process.argv[baseAt + 1];
    if (at < 0) {
      console.log("❌ --base needs --files: it says where the listed files are read from.");
      process.exit(1);
    }
    if (!dir || dir.startsWith("--") || !statSync(path.resolve(ROOT, dir), { throwIfNoEntry: false })?.isDirectory()) {
      console.log("❌ --base: the folder couldn't be read.");
      process.exit(1);
    }
    base = path.resolve(ROOT, dir);
  }
  let listed: string[] | null = null;
  if (at >= 0) {
    // A scan for nothing proves nothing (the header): no .env.local here, or nothing in it, means the wrong folder.
    if (!envNeedles.length) {
      console.log("❌ nothing to look for: this folder's .env.local has none of the values the check looks for. Run it from the main project folder, where .env.local is.");
      process.exit(1);
    }
    try {
      listed = readFileSync(path.resolve(ROOT, process.argv[at + 1] ?? ""), "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim().replace(/\\/g, "/"))
        .filter(Boolean);
    } catch {
      console.log("❌ --files: the list couldn't be read.");
      process.exit(1);
    }
  }
  const files = (listed ?? execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" }).split("\0"))
    .filter(Boolean)
    .filter((f) => !BINARY.test(f));
  /** --files: listed files that couldn't be read (a hard failure there: see the header). */
  const unread: string[] = [];

  const hits = new Map<string, Map<string, { n: number; severity: Severity }>>();
  const note = (file: string, category: string, n: number, severity: Severity) => {
    const perFile = hits.get(file) ?? new Map<string, { n: number; severity: Severity }>();
    const prev = perFile.get(category);
    perFile.set(category, { n: (prev?.n ?? 0) + n, severity: prev?.severity === "hard" ? "hard" : severity });
    hits.set(file, perFile);
  };

  let scanned = 0;
  let discounted = 0;
  for (const f of files) {
    let text: string;
    try {
      // A listed path stays inside the base folder (no absolute path, no ".." step).
      if (listed && (path.isAbsolute(f) || f.split("/").includes(".."))) throw new Error("outside");
      const full = path.join(base, f);
      if (statSync(full).size > 64 * 1024 * 1024) {
        if (listed) unread.push(f);
        continue;
      }
      text = readFileSync(full, "utf8");
    } catch {
      if (listed) unread.push(f);
      continue; // git's list: deleted between listing and reading
    }
    scanned++;
    let parsed: unknown;
    let parsedOk: boolean | undefined;
    const json = () => {
      if (parsedOk === undefined) {
        try {
          parsed = JSON.parse(text);
          parsedOk = true;
        } catch {
          parsedOk = false;
        }
      }
      return parsedOk;
    };
    for (const n of needles) {
      const at = occurrences(text, n);
      if (!at.length) continue;
      let count = at.length;
      // Word needles that could be part of a public player's name: count only other occurrences.
      if (n.mode === "word" && names && n.category.indexOf("full-real-name") < 0) {
        const outside = f.endsWith(".json") && json() ? countOutsidePlayerNames(parsed, n.value, names) : at.filter((i) => !inPlayerName(text, i, n.value, names)).length;
        discounted += Math.max(0, count - outside);
        count = Math.min(count, outside);
      }
      if (!count) continue;
      const severity: Severity = n.severity === "soft" && n.hardIn?.test(f) ? "hard" : n.severity;
      note(f, n.category, count, severity);
    }
    const swids = (text.match(SWID_LIKE) ?? []).filter((s) => !PLACEHOLDER_SWID.test(s));
    if (swids.length) note(f, "pattern:unplaceholdered-{GUID}", swids.length, f.startsWith("fixtures/") || f.startsWith("reports/") ? "hard" : "soft");
  }

  let hard = 0;
  let soft = 0;
  const softByCategory = new Map<string, { n: number; files: number }>();
  for (const [file, cats] of [...hits].sort(([a], [b]) => a.localeCompare(b))) {
    for (const [cat, { n, severity }] of cats) {
      if (severity === "hard") {
        hard += n;
        console.log(`❌ ${file}: ${cat} ×${n}`);
      } else {
        soft += n;
        const s = softByCategory.get(cat) ?? { n: 0, files: 0 };
        softByCategory.set(cat, { n: s.n + n, files: s.files + 1 });
        if (verbose || file.startsWith("reports/")) console.log(`⚠️ ${file}: ${cat} ×${n}`);
      }
    }
  }
  for (const [cat, s] of softByCategory) console.log(`⚠️ soft ${cat}: ×${s.n} in ${s.files} file(s)${verbose ? "" : " (--verbose lists them)"}`);

  for (const f of unread) console.log(`❌ ${f}: listed but couldn't be read, so it wasn't scanned`);

  const reserved = [...reservedNameFiles(ROOT), ...(base !== ROOT ? reservedNameFiles(base, base) : [])];
  for (const r of reserved) console.log(`❌ reserved device-name file (likely a '> NUL' redirect; delete it): ${r}`);

  console.log(
    `\nscanned ${scanned} files${base !== ROOT ? " (read from the --base folder)" : ""} against ${needles.length} values (${envNeedles.length} from .env.local, ${maps.length} redaction map(s), ${watchlists.length} watch list(s); ${counters.skippedPublic} public NFL/team/college names skipped): ` +
      `${hard} hard, ${soft} soft hit(s)` +
      (names ? `; ${discounted} hit(s) inside NFL player names discounted` : "; Sleeper players DB not cached, so soft hits are not discounted"),
  );
  if (hard || reserved.length || unread.length) {
    console.log("Hard hits must be fixed before committing.");
    process.exit(1);
  }
}

void main();
