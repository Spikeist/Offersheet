/**
 * Minimized fixtures of strangers' test leagues (CLAUDE.md §0.6; planner reply to Checkpoint 0,
 * answer 2). Full sanitized copies stay in git-ignored data-local/fixtures-sanitized/; tests read
 * only minimized copies committed in fixtures/sanitized/min/<platform>/:
 *   - just the fields the tests read
 *   - a subset of each roster
 *   - shifted timestamps (a secret whole-weeks offset, stored only in data-local/): this hides the
 *     calendar dates, not weekdays, times of day or the gaps between events; minimizers that keep
 *     activity times should synthesize them instead (scripts/minimize/sleeper.ts does)
 *
 * Minimizer scripts read the full copies with readLocalFixture(), trim, call shiftTimestamps(),
 * then saveMinimizedFixture(), which refuses to write anything that still leaks.
 */
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sha256, writeFileAtomic } from "./cache";
import { ROOT } from "./env";
import { LOCAL_SANITIZED_DIR, LeakError } from "./fixtures";
import { loadSecretsIntoScrubber, scrubEverything, secrets } from "./redact";
import { Redactor, collapsePath, type ApplyOptions, type Entry } from "./sanitize";

export const MIN_DIR = path.join(ROOT, "fixtures", "sanitized", "min");
const SHIFT_FILE = path.join(ROOT, "data-local", "min-fixture-shifts.json");
const DAY_MS = 86_400_000;

/** Read a full sanitized stranger fixture by its label from data-local/fixtures-sanitized/<platform>/. */
export function readLocalFixture<T = unknown>(platform: string, label: string): T {
  const file = path.join(LOCAL_SANITIZED_DIR, platform, `${sha256(label)}.json`);
  if (!existsSync(file)) throw new Error(`no local fixture for ${platform} label "${label}" (run the Phase 0 probe first)`);
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

/** Labels available locally for a platform (from its data-local index). */
export function localFixtureLabels(platform: string): string[] {
  const index = path.join(LOCAL_SANITIZED_DIR, platform, "index.json");
  if (!existsSync(index)) return [];
  return Object.values(JSON.parse(readFileSync(index, "utf8")) as Record<string, { label: string }>).map((e) => e.label);
}

/**
 * The secret timestamp shift for a platform's minimized fixtures: a whole number of weeks back
 * (3–10), so weekdays and week boundaries keep their shape. Created once, git-ignored.
 */
export function timestampShiftMs(platform: string): number {
  let shifts: Record<string, number> = {};
  if (existsSync(SHIFT_FILE)) shifts = JSON.parse(readFileSync(SHIFT_FILE, "utf8")) as Record<string, number>;
  if (shifts[platform] === undefined) {
    shifts[platform] = -7 * randomInt(3, 11) * DAY_MS;
    mkdirSync(path.dirname(SHIFT_FILE), { recursive: true });
    writeFileSync(SHIFT_FILE, JSON.stringify(shifts, null, 2)); // synchronous: every run must reuse the same shift
  }
  return shifts[platform];
}

const TIME_KEY = /(time|date|created|updated|timestamp|expir|last_modified|lastmodified|epoch|_at$|At$|^start|^end)/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Shift every timestamp in a JSON value by offsetMs: epoch-millisecond numbers (2001–2033) and ISO
 * date-time strings, but only under timestamp-like keys, so IDs and stats are never touched.
 */
export function shiftTimestamps<T>(value: T, offsetMs: number): T {
  const walk = (v: unknown, key: string | undefined): unknown => {
    const timeKey = key !== undefined && TIME_KEY.test(key);
    if (typeof v === "number") return timeKey && v > 1e12 && v < 2e12 ? v + offsetMs : v;
    if (typeof v === "string") {
      if (timeKey && /^\d{13}$/.test(v)) return String(Number(v) + offsetMs);
      if (timeKey && ISO.test(v)) return new Date(Date.parse(v) + offsetMs).toISOString();
      return v;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk(value, undefined) as T;
}

/** A Redactor loaded with a platform's raw→placeholder map (git-ignored), for leak checks. */
export async function redactorFromMap(platform: string): Promise<Redactor> {
  const r = new Redactor(platform);
  const file = path.join(ROOT, "fixtures", "raw", platform, "redaction-map.json");
  if (!existsSync(file)) return r;
  const entries = JSON.parse(await readFile(file, "utf8")) as Entry[];
  for (const e of entries) r.register(e.raw, e.category, e.placeholder, { token: e.token });
  return r;
}

async function updateIndex(dir: string, file: string, label: string, note: string | undefined): Promise<void> {
  const indexPath = path.join(dir, "index.json");
  let index: Record<string, { label: string; note?: string }> = {};
  try {
    index = JSON.parse(await readFile(indexPath, "utf8")) as typeof index;
  } catch {
    // new folder
  }
  index[file] = note ? { label, note } : { label };
  const sorted = Object.fromEntries(Object.entries(index).sort(([, a], [, b]) => a.label.localeCompare(b.label)));
  await writeFileAtomic(indexPath, JSON.stringify(sorted, null, 2) + "\n");
}

/**
 * Save a minimized fixture to fixtures/sanitized/min/<platform>/ (committed). Refuses (LeakError) if
 * the label or body contains a .env.local value or any value in the platform's redaction map.
 * `group` is a subfolder such as "test-league" or "oracle".
 */
export async function saveMinimizedFixture(platform: string, group: string, label: string, body: unknown, opts: { note?: string; protect?: ApplyOptions["protect"] } = {}): Promise<string> {
  loadSecretsIntoScrubber();
  const serialized = JSON.stringify(body, null, 1) + "\n";
  if (secrets.leaks(label) || secrets.leaks(serialized)) throw new LeakError(`minimized fixture "${scrubEverything(label)}" contains a .env.local value; not saved`);
  const redactor = await redactorFromMap(platform);
  const hits = redactor.findLeaks(body, { protect: opts.protect }).filter((h) => h.kind !== "word");
  if (hits.length) throw new LeakError(`minimized fixture "${label}" still has ${hits.length} registered value(s): ${[...new Set(hits.map((h) => `${h.category} @ ${collapsePath(h.path)}`))].slice(0, 10).join("; ")}; not saved`);
  if (redactor.scrubText(label) !== label) throw new LeakError(`minimized fixture label "${label}" contains a registered value; not saved`);
  const dir = path.join(MIN_DIR, platform, group);
  const file = `${sha256(`${group}/${label}`)}.json`;
  await writeFileAtomic(path.join(dir, file), serialized);
  await updateIndex(dir, file, label, opts.note);
  return path.relative(ROOT, path.join(dir, file)).replace(/\\/g, "/");
}

/** Read a committed minimized fixture (used by tests through their own loaders too). */
export function readMinimizedFixture<T = unknown>(platform: string, group: string, label: string): T {
  return JSON.parse(readFileSync(path.join(MIN_DIR, platform, group, `${sha256(`${group}/${label}`)}.json`), "utf8")) as T;
}
