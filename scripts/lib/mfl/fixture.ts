/**
 * Shaping of MFL sanitized fixtures (CLAUDE.md §0.6) on top of the Redactor. A stranger's test
 * league is saved to git-ignored data-local/fixtures-sanitized/mfl (only minimized copies are
 * committed); league-independent public exports stay in fixtures/sanitized/mfl (scripts/lib/fixtures.ts).
 * - trimLeagueHistory: league.history lists every season the league has existed; the founding year
 *   helps re-identify a stranger's public league, so only the current season is kept.
 * - synthesizeSearchSample: a leagueSearch sample built from the live KEY NAMES and homeURL format
 *   only (placeholder IDs 90001+, placeholder host); nothing from the real hits.
 * - pruneSanitized: delete sanitized fixtures this run no longer writes (and their index entries),
 *   so a relabelled or dropped fixture leaves no orphan behind.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../cache";
import { FIXTURE_FILE, assertPrunable } from "../shared/fixture-folders";
import { LEAGUE_HOST_PLACEHOLDER } from "./identities";
import { asArray, at, isRecord, text } from "./json";

export const SEARCH_SAMPLE_FIRST_ID = 90001;

/** Copy of a TYPE=league body with league.history cut down to `year`. */
export function trimLeagueHistory(leagueJson: unknown, year: number): { json: unknown; dropped: number } {
  const copy = structuredClone(leagueJson);
  const league = at(copy, "league");
  const history = at(league, "history");
  if (!isRecord(league) || !isRecord(history)) return { json: copy, dropped: 0 };
  const all = asArray(history.league as unknown[]);
  const keep = all.filter((h) => text(at(h, "year")) === String(year));
  history.league = keep;
  return { json: copy, dropped: all.length - keep.length };
}

/** Scheme prefix of homeURL values ("https//" on 2026-09-29: the colon is missing). */
export function homeUrlPrefixes(searchJson: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of asArray(at(searchJson, "leagues.league") as unknown[])) {
    const m = /^([a-z]+:?\/\/)/i.exec(text(at(l, "homeURL")) ?? "");
    const k = m?.[1] ?? "(none)";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/**
 * A 3-hit leagueSearch body with the live response's key set and homeURL scheme prefix, but only
 * placeholder values: ids 90001–90003 (outside the league placeholder range), names "Search result N",
 * host www00.myfantasyleague.com. No count, term or real value is copied.
 */
export function synthesizeSearchSample(searchJson: unknown, year: number): unknown {
  const first = asArray(at(searchJson, "leagues.league") as unknown[])[0];
  const keys = isRecord(first) ? Object.keys(first).sort() : ["homeURL", "id", "name", "year"];
  const prefixes = Object.entries(homeUrlPrefixes(searchJson)).sort((a, b) => b[1] - a[1]);
  const prefix = prefixes[0]?.[0] && prefixes[0][0] !== "(none)" ? prefixes[0][0] : "https://";
  const league = [0, 1, 2].map((i) => {
    const id = String(SEARCH_SAMPLE_FIRST_ID + i);
    const values: Record<string, string> = { id, name: `Search result ${i + 1}`, homeURL: `${prefix}${LEAGUE_HOST_PLACEHOLDER}/${year}/home/${id}`, year: String(year) };
    return Object.fromEntries(keys.map((k) => [k, values[k] ?? "[placeholder]"]));
  });
  return {
    encoding: text(at(searchJson, "encoding")) ?? "utf-8",
    leagues: { league },
    note: `synthesized: key names and the homeURL scheme prefix (${JSON.stringify(prefix)}) copied from the live response; every value is a placeholder`,
    version: text(at(searchJson, "version")) ?? "1.0",
  };
}

interface IndexEntry {
  label: string;
  [key: string]: unknown;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Remove fixtures in `dir` that this run did not write (`keep` = repo-relative or bare file names of
 * files saved to THIS folder), drop their index entries, and check every remaining entry's file
 * name = sha256(label) + ext. Returns the labels removed (placeholder-only) and any name mismatches.
 * Only index-listed files and unlisted files named like a fixture (sha256 + ext) are deleted — never
 * subfolders or other files — and a missing folder is left alone. The probe calls this once for
 * fixtures/sanitized/mfl and once for the git-ignored data-local/fixtures-sanitized/mfl.
 */
export async function pruneSanitized(dir: string, keep: Iterable<string>): Promise<{ removed: string[]; mismatched: string[] }> {
  const keepNames = new Set([...keep].map((f) => path.basename(f)));
  assertPrunable(dir);
  let names: string[];
  try {
    names = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return { removed: [], mismatched: [] }; // no folder: nothing written there yet
  }
  const indexPath = path.join(dir, "index.json");
  let index: Record<string, IndexEntry> = {};
  try {
    index = JSON.parse(await readFile(indexPath, "utf8")) as Record<string, IndexEntry>;
  } catch {
    // no index yet
  }
  const removed: string[] = [];
  for (const name of names) {
    if (name === "index.json" || keepNames.has(name)) continue;
    if (!(name in index) && !FIXTURE_FILE.test(name)) continue; // not a fixture of this probe
    await rm(path.join(dir, name), { force: true });
    removed.push(index[name]?.label ?? name);
    delete index[name];
  }
  for (const name of Object.keys(index)) {
    if (!keepNames.has(name)) {
      removed.push(index[name]?.label ?? name);
      delete index[name];
    }
  }
  const mismatched = Object.entries(index)
    .filter(([name, e]) => name !== `${sha256(e.label)}${path.extname(name)}`)
    .map(([, e]) => e.label);
  const sorted = Object.fromEntries(Object.entries(index).sort(([, a], [, b]) => a.label.localeCompare(b.label)));
  await writeFileAtomic(indexPath, JSON.stringify(sorted, null, 2) + "\n");
  return { removed: [...new Set(removed)], mismatched };
}
