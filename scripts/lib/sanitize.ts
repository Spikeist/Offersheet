/**
 * Fixture sanitizer (CLAUDE.md §0.6): replace leaguemates' identities with stable placeholders.
 *
 * Usage per platform run:
 *   const r = new Redactor("espn");
 *   r.register(team.name, "team-name", `Team ${team.id}`);     // known sensitive values first…
 *   r.sweep(raw, (v, key) => SWID_RE.test(v) ? "swid" : null);   // …then pattern sweeps
 *   const clean = r.apply(raw, { protect: isPlayerPath });       // deep replace (values AND keys)
 *   r.findLeaks(clean, { protect: isPlayerPath });                // verify; returns category+path only
 *   await r.saveMap();                                            // raw→placeholder map, git-ignored
 *
 * Rules:
 * - Exact matches are always replaced. "Token" entries are also replaced inside longer strings
 *   (URLs, free text). IDs are tokens; names only when ≥ 8 chars (short names like "Zorblax" would
 *   otherwise mangle player names such as "Zorblax Quintavious").
 * - On protected paths (e.g. player objects) only ID-like categories are replaced, never names.
 * - Purely numeric values match whole numbers only.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./cache";
import { ROOT } from "./env";

export type Category =
  | "league-id"
  | "league-name"
  | "team-name"
  | "team-abbrev"
  | "owner-name"
  | "real-name"
  | "user-id"
  | "username"
  | "swid"
  | "email"
  | "avatar"
  | "draft-id"
  | "other-id"
  | "free-text";

const ID_CATEGORIES: ReadonlySet<Category> = new Set(["league-id", "user-id", "username", "swid", "email", "draft-id", "other-id", "avatar"]);

export interface Entry {
  raw: string;
  placeholder: string;
  category: Category;
  /** Also replace inside longer strings. */
  token: boolean;
  numeric: boolean;
}

export type JsonPath = ReadonlyArray<string | number>;

export interface ApplyOptions {
  /** Paths where only ID-like categories are replaced (names are left alone), e.g. player objects. */
  protect?: (path: JsonPath) => boolean;
}

export interface LeakHit {
  category: Category;
  path: string;
  /** "exact" = whole value/key still sensitive (a real miss); "word" = a short name found inside text (review). */
  kind: "exact" | "token" | "word";
}

export const SWID_RE = /^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$/;

/** Placeholder SWIDs produced by defaultPlaceholder("swid"): never register these as real values. */
export const SWID_PLACEHOLDER_RE = /^\{00000000-0000-4000-8000-[0-9A-Fa-f]{12}\}$/;

export class Redactor {
  private byRaw = new Map<string, Entry>();
  private seq = new Map<Category, number>();
  private tokens: Entry[] = [];
  private placeholders = new Set<string>();
  private sortedForText: Entry[] | null = null;

  constructor(readonly platform: string) {}

  /**
   * Register a sensitive value; returns its placeholder (the existing one if already registered).
   * `placeholder` may be a string or a function of a per-category sequence number (1, 2, …).
   */
  register(raw: unknown, category: Category, placeholder?: string | ((n: number) => string), opts: { token?: boolean } = {}): string | undefined {
    if (raw === null || raw === undefined || typeof raw === "boolean" || typeof raw === "object") return undefined;
    const value = String(raw);
    if (value.trim() === "") return undefined;
    // Short numbers (team ids 1-12, slot counts…) are everywhere: never treat them as IDs. A short
    // numeric *name* (a team abbreviation "123") is still replaced, but only as an exact string.
    const shortNumber = /^\d+$/.test(value) && value.length < 4;
    if (shortNumber && ID_CATEGORIES.has(category)) return undefined;
    const existing = this.byRaw.get(value);
    if (existing) return existing.placeholder;
    // Sweeping already-sanitized data (e.g. a manifest) must not remap placeholders.
    if (this.placeholders.has(value) || SWID_PLACEHOLDER_RE.test(value)) return value;
    const n = (this.seq.get(category) ?? 0) + 1;
    this.seq.set(category, n);
    const ph = typeof placeholder === "function" ? placeholder(n) : (placeholder ?? defaultPlaceholder(category, value, n));
    const numeric = /^\d+$/.test(value) && !shortNumber;
    const token = shortNumber ? false : (opts.token ?? (ID_CATEGORIES.has(category) ? value.length >= 4 : value.length >= 8));
    const entry: Entry = { raw: value, placeholder: ph, category, token, numeric };
    this.byRaw.set(value, entry);
    // SWIDs show up in several spellings (braces stripped, lower case, URL-encoded).
    if (category === "swid") {
      const inner = value.replace(/^\{|\}$/g, "");
      const phInner = ph.replace(/^\{|\}$/g, "");
      for (const [v, p] of [
        [value.toLowerCase(), ph.toLowerCase()],
        [value.toUpperCase(), ph.toUpperCase()],
        [inner, phInner],
        [inner.toLowerCase(), phInner.toLowerCase()],
        [inner.toUpperCase(), phInner.toUpperCase()],
        [encodeURIComponent(value), encodeURIComponent(ph)],
      ] as const) {
        if (!this.byRaw.has(v)) {
          const e: Entry = { raw: v, placeholder: p, category, token: true, numeric: false };
          this.byRaw.set(v, e);
          this.tokens.push(e);
          this.placeholders.add(p);
        }
      }
    }
    if (token) this.tokens.push(entry);
    this.tokens.sort((a, b) => b.raw.length - a.raw.length);
    this.placeholders.add(ph);
    this.sortedForText = null;
    return ph;
  }

  placeholderOf(raw: unknown): string | undefined {
    return raw === null || raw === undefined ? undefined : this.byRaw.get(String(raw))?.placeholder;
  }

  entries(): readonly Entry[] {
    return [...this.byRaw.values()];
  }

  /**
   * Walk `json` and register every string value (or key) for which `classify` returns a category.
   * Useful for IDs that appear in unknown places (e.g. SWIDs anywhere in an ESPN response).
   */
  sweep(json: unknown, classify: (value: string, key: string | number | undefined, path: JsonPath) => Category | null, placeholder?: (n: number, value: string) => string): void {
    const visit = (v: unknown, key: string | number | undefined, p: JsonPath) => {
      if (typeof v === "string" || typeof v === "number") {
        const s = String(v);
        const cat = classify(s, key, p);
        if (cat) this.register(s, cat, placeholder ? (n) => placeholder(n, s) : undefined);
        return;
      }
      if (Array.isArray(v)) v.forEach((x, i) => visit(x, i, [...p, i]));
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          const cat = classify(k, undefined, [...p, k]);
          if (cat) this.register(k, cat, placeholder ? (n) => placeholder(n, k) : undefined);
          visit(x, k, [...p, k]);
        }
    };
    visit(json, undefined, []);
  }

  /** Deep copy of `json` with every registered value replaced (in values and object keys). */
  apply<T>(json: T, opts: ApplyOptions = {}): T {
    const walk = (v: unknown, p: JsonPath): unknown => {
      const idsOnly = opts.protect?.(p) ?? false;
      if (typeof v === "string") return this.replaceString(v, idsOnly);
      if (typeof v === "number") {
        const e = this.byRaw.get(String(v));
        // Placeholders beyond 2^53 would be rounded as numbers, so keep those as strings.
        if (e && e.numeric && (!idsOnly || ID_CATEGORIES.has(e.category))) return /^\d{1,15}$/.test(e.placeholder) ? Number(e.placeholder) : e.placeholder;
        return v;
      }
      if (Array.isArray(v)) return v.map((x, i) => walk(x, [...p, i]));
      if (v && typeof v === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) out[this.replaceString(k, idsOnly)] = walk(x, [...p, k]);
        return out;
      }
      return v;
    };
    return walk(json, []) as T;
  }

  private replaceString(s: string, idsOnly: boolean): string {
    const exact = this.byRaw.get(s);
    if (exact && (!idsOnly || ID_CATEGORIES.has(exact.category))) return exact.placeholder;
    let out = s;
    for (const e of this.tokens) {
      if (idsOnly && !ID_CATEGORIES.has(e.category)) continue;
      if (!out.includes(e.raw)) continue;
      out = e.numeric ? out.replace(new RegExp(`(?<!\\d)${e.raw}(?!\\d)`, "g"), e.placeholder) : out.split(e.raw).join(e.placeholder);
    }
    return out;
  }

  /**
   * Scrub free text (console lines, report text, labels, URLs). More aggressive than apply():
   * every registered value of 3+ chars is replaced where it appears as a whole word.
   */
  scrubText(text: string): string {
    let out = text;
    // Short numbers ("100" as a team abbrev) are replaced in fixture fields, never in free text,
    // where they would turn "100.0%" into "T5.0%".
    this.sortedForText ??= [...this.byRaw.values()].filter((e) => e.raw.length >= 3 && !/^\d{1,3}$/.test(e.raw)).sort((a, b) => b.raw.length - a.raw.length);
    for (const e of this.sortedForText) {
      if (!out.includes(e.raw)) continue;
      out = e.numeric ? out.replace(new RegExp(`(?<!\\d)${e.raw}(?!\\d)`, "g"), e.placeholder) : out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(e.raw)}(?![\\p{L}\\p{N}])`, "gu"), e.placeholder);
    }
    return out;
  }

  /**
   * Verify a sanitized value: report where registered values still appear. Returns category + path
   * only (never the value). "word" hits are short names found inside unprotected text: review them.
   */
  findLeaks(json: unknown, opts: ApplyOptions = {}): LeakHit[] {
    const hits: LeakHit[] = [];
    const words = [...this.byRaw.values()].filter((e) => !e.token && !e.numeric && e.raw.length >= 3 && !/^\d+$/.test(e.raw));
    const check = (s: string, p: JsonPath, idsOnly: boolean) => {
      const where = formatPath(p);
      const exact = this.byRaw.get(s);
      if (exact && exact.placeholder !== s && (!idsOnly || ID_CATEGORIES.has(exact.category))) {
        hits.push({ category: exact.category, path: where, kind: "exact" });
        return;
      }
      for (const e of this.tokens) {
        if (idsOnly && !ID_CATEGORIES.has(e.category)) continue;
        if (e.numeric ? new RegExp(`(?<!\\d)${e.raw}(?!\\d)`).test(s) : s.includes(e.raw)) hits.push({ category: e.category, path: where, kind: "token" });
      }
      if (idsOnly) return;
      for (const e of words) {
        if (s !== e.raw && s.includes(e.raw) && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(e.raw)}(?![\\p{L}\\p{N}])`, "u").test(s)) hits.push({ category: e.category, path: where, kind: "word" });
      }
    };
    const walk = (v: unknown, p: JsonPath) => {
      const idsOnly = opts.protect?.(p) ?? false;
      if (typeof v === "string") check(v, p, idsOnly);
      else if (typeof v === "number") {
        const e = this.byRaw.get(String(v));
        if (e?.numeric && String(v) !== e.placeholder && (!idsOnly || ID_CATEGORIES.has(e.category))) hits.push({ category: e.category, path: formatPath(p), kind: "exact" });
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...p, i]));
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          check(k, [...p, k], idsOnly);
          walk(x, [...p, k]);
        }
    };
    walk(json, []);
    return hits;
  }

  /** Merge this run's raw→placeholder map into fixtures/raw/<platform>/redaction-map.json (git-ignored). */
  async saveMap(): Promise<void> {
    const file = path.join(ROOT, "fixtures", "raw", this.platform, "redaction-map.json");
    let existing: Entry[] = [];
    try {
      existing = JSON.parse(await readFile(file, "utf8")) as Entry[];
    } catch {
      // first run
    }
    const merged = new Map<string, Entry>();
    for (const e of [...existing, ...this.byRaw.values()]) merged.set(`${e.category}\u0000${e.raw}`, e);
    await writeFileAtomic(file, JSON.stringify([...merged.values()], null, 1));
  }
}

export function formatPath(p: JsonPath): string {
  return p.map((k) => (typeof k === "number" ? `[${k}]` : `.${k}`)).join("").replace(/^\./, "") || "(root)";
}

/** Collapse array indices: teams[3].owners[0] → teams[].owners[] (for grouping leak reports). */
export function collapsePath(p: string): string {
  return p.replace(/\[\d+\]/g, "[]");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sameLengthDigits(prefix: string, n: number, length: number): string {
  const tail = String(n);
  const len = Math.max(length, prefix.length + tail.length);
  return prefix + "0".repeat(len - prefix.length - tail.length) + tail;
}

export function defaultPlaceholder(category: Category, raw: string, n: number): string {
  const digits = /^\d+$/.test(raw) ? raw.length : 0;
  switch (category) {
    case "league-id":
      return digits ? sameLengthDigits("1", n, digits) : `league-${n}`;
    case "user-id":
      return digits ? sameLengthDigits("2", n, digits) : `user-${n}`;
    case "draft-id":
      return digits ? sameLengthDigits("3", n, digits) : `draft-${n}`;
    case "other-id":
      return digits ? sameLengthDigits("4", n, digits) : `id-${n}`;
    case "swid":
      return `{00000000-0000-4000-8000-${n.toString(16).toUpperCase().padStart(12, "0")}}`;
    case "league-name":
      return `League ${n}`;
    case "team-name":
      return `Team ${n}`;
    case "team-abbrev":
      return `T${n}`;
    case "owner-name":
      return `Owner ${n}`;
    case "real-name":
      return `Name ${n}`;
    case "username":
      return `user${n}`;
    case "email":
      return `owner${n}@example.invalid`;
    case "avatar":
      return /^https?:/i.test(raw) ? `https://example.invalid/avatar/${n}.png` : `avatar${n}`;
    case "free-text":
      return `[text ${n}]`;
  }
}
