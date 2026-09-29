/**
 * Fixture storage (CLAUDE.md §0.6, §17 Phase 0 step 5).
 *
 * - fixtures/raw/<platform>/        git-ignored, exact API responses (may contain names, IDs, SWIDs).
 * - fixtures/sanitized/<platform>/  committed, placeholders only. Used by adapter tests (no network).
 *
 * Filenames are sha256 hashes. For sanitized fixtures the hash is taken over the SANITIZED label:
 * league IDs are short numbers, so a hash of a real ID could be reversed by brute force.
 * Each folder has an index.json mapping file → label / URL template / status.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sha256, writeFileAtomic } from "./cache";
import { ROOT } from "./env";
import { scrubEverything, secrets, loadSecretsIntoScrubber } from "./redact";
import { collapsePath, type ApplyOptions, type Redactor } from "./sanitize";

export const RAW_DIR = path.join(ROOT, "fixtures", "raw");
export const SANITIZED_DIR = path.join(ROOT, "fixtures", "sanitized");

interface IndexEntry {
  label: string;
  url?: string;
  status?: number;
  contentType?: string;
  note?: string;
  captured: string; // YYYY-MM-DD (day only, keeps diffs quiet)
}

export interface FixtureMeta {
  url?: string;
  status?: number;
  contentType?: string;
  note?: string;
}

function extFor(body: unknown, explicit?: string): string {
  if (explicit) return explicit;
  return typeof body === "string" ? ".txt" : ".json";
}

async function updateIndex(dir: string, file: string, entry: IndexEntry): Promise<void> {
  const indexPath = path.join(dir, "index.json");
  let index: Record<string, IndexEntry> = {};
  try {
    index = JSON.parse(await readFile(indexPath, "utf8")) as Record<string, IndexEntry>;
  } catch {
    // new folder
  }
  index[file] = entry;
  const sorted = Object.fromEntries(Object.entries(index).sort(([, a], [, b]) => a.label.localeCompare(b.label)));
  await writeFileAtomic(indexPath, JSON.stringify(sorted, null, 2) + "\n");
}

const today = () => new Date().toISOString().slice(0, 10);

/** Save an exact response under fixtures/raw/<platform>/ (git-ignored). Returns the repo-relative path. */
export async function saveRawFixture(platform: string, key: string, body: unknown, meta: FixtureMeta = {}, ext?: string): Promise<string> {
  const dir = path.join(RAW_DIR, platform);
  const file = sha256(key) + extFor(body, ext);
  await writeFileAtomic(path.join(dir, file), typeof body === "string" ? body : JSON.stringify(body));
  await updateIndex(dir, file, {
    label: scrubEverything(key),
    url: meta.url && scrubEverything(meta.url),
    status: meta.status,
    contentType: meta.contentType,
    note: meta.note,
    captured: today(),
  });
  return path.relative(ROOT, path.join(dir, file)).replace(/\\/g, "/");
}

export class LeakError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeakError";
  }
}

/**
 * Save a sanitized copy under fixtures/sanitized/<platform>/. Refuses (throws LeakError) if the
 * label, URL template or body still contains a .env.local secret/ID, or — when a redactor is given —
 * any registered leaguemate value. "word" hits (short names inside text) are printed as warnings.
 */
export async function saveSanitizedFixture(
  platform: string,
  label: string,
  body: unknown,
  meta: FixtureMeta = {},
  check?: { redactor: Redactor; opts?: ApplyOptions },
  ext?: string,
): Promise<string> {
  loadSecretsIntoScrubber();
  const serialized = typeof body === "string" ? body : JSON.stringify(body, null, 2) + "\n";
  for (const [what, text] of [
    ["label", label],
    ["url", meta.url ?? ""],
    ["note", meta.note ?? ""],
    ["body", serialized],
  ] as const) {
    if (secrets.leaks(text)) throw new LeakError(`Sanitized fixture "${scrubEverything(label)}" still contains a .env.local value in its ${what}; not saved.`);
  }
  if (check) {
    const hits = check.redactor.findLeaks(typeof body === "string" ? { text: body } : body, check.opts);
    const hard = hits.filter((h) => h.kind !== "word");
    const soft = hits.filter((h) => h.kind === "word");
    const group = (hs: typeof hits) => [...new Set(hs.map((h) => `${h.category} @ ${collapsePath(h.path)}`))].slice(0, 20).join("; ");
    if (hard.length) throw new LeakError(`Sanitized fixture "${check.redactor.scrubText(scrubEverything(label))}" still has ${hard.length} registered value(s): ${group(hard)}; not saved.`);
    if (soft.length) console.warn(`  ⚠️ review: ${soft.length} short name(s) found inside text in "${check.redactor.scrubText(label)}": ${group(soft)}`);
    for (const [what, text] of [
      ["label", label],
      ["url", meta.url ?? ""],
    ] as const) {
      if (check.redactor.scrubText(text) !== text) throw new LeakError(`Sanitized fixture ${what} still contains a registered value; not saved.`);
    }
  }
  const dir = path.join(SANITIZED_DIR, platform);
  const file = sha256(label) + extFor(body, ext);
  await writeFileAtomic(path.join(dir, file), serialized);
  await updateIndex(dir, file, { label, url: meta.url, status: meta.status, contentType: meta.contentType, note: meta.note, captured: today() });
  return path.relative(ROOT, path.join(dir, file)).replace(/\\/g, "/");
}
