/**
 * What `npm run check:browser` found, and how it's printed.
 *
 * - CheckReport collects one line per check (ok, FAIL or skip, with up to a few details) and the numbers worth keeping
 *   (timings, counts) per step; failed() decides the exit code (1 when any check failed).
 * - Cleaning (CLAUDE.md §0.5–0.6): nothing printed or written may carry a leaguemate's name or the league id. The
 *   imported league's team names become "Team <id>", owner names (each co-owner too) "Owner <id>" and the league's name
 *   "<league name>" (placeholderPairs), in one pass over the text (replaceNames):
 *   - any case, and whatever the whitespace between a name's words (the page's text is whitespace-collapsed: a double
 *     or non-breaking space in a name still matches), also URL-encoded ("%20", "+", "%26"…);
 *   - longest first, and overlapping names become one span with both placeholders, so no piece of a name is left;
 *   - a name strictly inside a public NFL player's name is left alone ("Drake" in "Drake London": replacing it there
 *     would print "Owner 3 London" and give the owner's name away), but a name that holds a player's name, or equals
 *     one, is replaced whole ("Tess Calloway Fan Club");
 *   - a name inside a placeholder is left alone, so cleaning twice changes nothing ("Tea" in "Team 3").
 *   The same rules (nameRules) clean the page itself before a screenshot (inPage.ts sanitizeCall).
 * - Structured values are cleaned string by string before they're serialized (cleanValue): a name with a quote or a
 *   backslash is escaped by JSON.stringify and would no longer match. Texts are cut only after cleaning (cutText).
 * - leftoverChecker (leftoverNames for one call) is the independent check, written apart from replaceNames on purpose
 *   (normalized text and plain string search, not the same regular expressions): it counts the names (and the league
 *   id, as a whole number) still in cleaned text outside a longer player's name or a placeholder. The entry point runs
 *   it on every line before printing it and on every string before writing the results file, and withholds what fails
 *   (withholdLeftovers): a name is never printed, even when cleaning missed it. The league id itself is cleaned by
 *   scripts/lib/redact.ts (an .env.local value), and in the page by an extra rule (nameRules' `extra`).
 */
export type CheckStatus = "ok" | "FAIL" | "skip";

export interface CheckLine {
  step: string;
  status: CheckStatus;
  text: string;
  details: string[];
}

/** At most this many details are printed under a line (the results file keeps them all). */
export const DETAILS_SHOWN = 8;

export class CheckReport {
  readonly lines: CheckLine[] = [];
  readonly numbers: Record<string, Record<string, unknown>> = {};
  /** Called with each new line (the entry point prints it at once). */
  onLine: ((line: CheckLine) => void) | null = null;

  add(step: string, status: CheckStatus, text: string, details: readonly string[] = []): void {
    const line: CheckLine = { step, status, text, details: [...details] };
    this.lines.push(line);
    this.onLine?.(line);
  }

  ok(step: string, text: string, details: readonly string[] = []): void {
    this.add(step, "ok", text, details);
  }

  fail(step: string, text: string, details: readonly string[] = []): void {
    this.add(step, "FAIL", text, details);
  }

  skip(step: string, text: string): void {
    this.add(step, "skip", text);
  }

  /** One check: ok with `okText`, else FAIL with `failText` and its details. */
  check(step: string, passed: boolean, okText: string, failText: string, details: readonly string[] = []): boolean {
    if (passed) this.ok(step, okText);
    else this.fail(step, failText, details);
    return passed;
  }

  /** A number worth keeping (printed in the summary, and in the results file). */
  note(step: string, key: string, value: unknown): void {
    (this.numbers[step] ??= {})[key] = value;
  }

  count(status: CheckStatus): number {
    return this.lines.filter((l) => l.status === status).length;
  }

  failed(): boolean {
    return this.count("FAIL") > 0;
  }
}

/** A line as printed: "  ok    text", "  FAIL  text", "  skip  text", then its first details, indented. */
export function formatLine(line: CheckLine, shown = DETAILS_SHOWN): string[] {
  const out = [`  ${line.status.padEnd(4)}  ${line.text}`];
  for (const d of line.details.slice(0, shown)) out.push(`          - ${d}`);
  if (line.details.length > shown) out.push(`          - and ${line.details.length - shown} more`);
  return out;
}

/** The closing lines: how many checks passed, failed and were skipped, and what the exit code means. */
export function summaryLines(report: CheckReport): string[] {
  const ok = report.count("ok");
  const failed = report.count("FAIL");
  const skipped = report.count("skip");
  const head = `${ok} passed, ${failed} failed, ${skipped} skipped.`;
  if (!failed) return [head, "All checks passed."];
  const steps = [...new Set(report.lines.filter((l) => l.status === "FAIL").map((l) => l.step))];
  return [head, `Failed in: ${steps.join(", ")}.`];
}

// ---------------------------------------------------------------------------------------------
// The league's names and their placeholders

/** The names of an imported league (its stored snapshot), as the cleaning needs them. */
export interface LeagueNames {
  leagueName?: string | undefined;
  teams: ReadonlyArray<{ id: string; name?: string | undefined; ownerName?: string | undefined }>;
  /** Public NFL player names: a league's name strictly inside one is left alone (see the header). */
  players: readonly string[];
}

/** Names shorter than this are left alone (too ambiguous; the .env.local scrubber's own floor). */
export const MIN_NAME_LENGTH = 3;

/** Placeholders of the league's names and id ("Team 3" and "Owner 3" come from the teams). */
export const LEAGUE_NAME_PLACEHOLDER = "<league name>";
export const LEAGUE_ID_PLACEHOLDER = "<league id>";
/** scripts/lib/redact.ts's placeholder for an .env.local value: "[REDACTED:ESPN_LEAGUE_ID]". */
const REDACTED_SOURCE = String.raw`\[REDACTED:[A-Z0-9_]+\]`;

/** Owner names as one string per person: Sleeper joins co-owners with " & ". */
export function ownerNames(ownerName: string | undefined): string[] {
  if (!ownerName?.trim()) return [];
  const parts = ownerName.split(" & ").map((p) => p.trim());
  return [...new Set([ownerName.trim(), ...parts])].filter((p) => p.length > 0);
}

/** Every name and its placeholder (pure; longest names first). */
export function placeholderPairs(names: LeagueNames): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const t of names.teams) {
    if (t.name?.trim()) pairs.push([t.name.trim(), `Team ${t.id}`]);
    for (const owner of ownerNames(t.ownerName)) pairs.push([owner, `Owner ${t.id}`]);
  }
  if (names.leagueName?.trim()) pairs.push([names.leagueName.trim(), LEAGUE_NAME_PLACEHOLDER]);
  return pairs.sort((a, b) => b[0].length - a[0].length);
}

// ---------------------------------------------------------------------------------------------
// Cleaning (replaceNames) and its rules, shared with the page's screenshots (inPage.ts sanitizeCall)

/** A name to replace: a pattern (case-insensitive, Unicode) and its placeholder. */
export interface NameRule {
  source: string;
  to: string;
}

/** A phrase a name inside is left alone in: a public player's name (strict: only a shorter name) or a placeholder. */
export interface KeptPhrase {
  source: string;
  strict: boolean;
}

/** The cleaning rules as plain data (the page gets them as JSON). */
export interface NameRules {
  rules: NameRule[];
  keep: KeptPhrase[];
}

/** Between a name's words: any whitespace (the page collapses it), or its URL-encoded forms. */
const WORD_GAP = String.raw`(?:\s|%20|\+)+`;

/** A pattern matching `s` literally (valid with the u flag: only syntax characters are escaped). */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** A phrase's pattern: its words with any gap between them; a number only as a whole number (pure). */
function phrasePattern(words: readonly string[]): string {
  const plain = words.map(escapeRegExp).join(WORD_GAP);
  return words.length === 1 && /^\d+$/.test(words[0] as string) ? String.raw`(?<!\d)${plain}(?!\d)` : plain;
}

/** encodeURIComponent, or the text itself when it can't be encoded (a lone surrogate). */
function encoded(text: string): string {
  try {
    return encodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The phrase's patterns: as written, and URL-encoded when that differs ("A & B" → "A%20%26%20B"). */
function phrasePatterns(phrase: string): string[] {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const encodedWords = words.map(encoded);
  const patterns = [phrasePattern(words)];
  if (encodedWords.some((e, i) => e !== words[i])) patterns.push(phrasePattern(encodedWords));
  return patterns;
}

/** A text as leftoverNames and nameRules compare it: lower case, every gap between words one space (pure). */
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/(?:\s|%20|\+)+/g, " ");
}

/**
 * The cleaning rules (pure): the league's names (3 characters or more), and `extra` pairs (the league id → "<league
 * id>", for the page), longest first; kept: every placeholder, and the public player names that hold a name.
 */
export function nameRules(names: LeagueNames | null, extra: ReadonlyArray<readonly [string, string]> = []): NameRules {
  const pairs = [...(names ? placeholderPairs(names) : []), ...extra.map(([from, to]) => [from.trim(), to] as [string, string])]
    .filter(([from]) => from.length >= MIN_NAME_LENGTH)
    .sort((a, b) => b[0].length - a[0].length);
  const rules = pairs.flatMap(([from, to]) => phrasePatterns(from).map((source) => ({ source, to })));
  const placeholders = [...new Set([...pairs.map(([, to]) => to), LEAGUE_NAME_PLACEHOLDER, LEAGUE_ID_PLACEHOLDER])];
  const keep: KeptPhrase[] = [...placeholders.map((p) => ({ source: escapeRegExp(p), strict: false })), { source: REDACTED_SOURCE, strict: false }];
  // Only the players whose names hold one of the names can protect anything: the rest are left out (fewer patterns).
  const lowered = pairs.map(([from]) => normalizeText(from));
  for (const player of new Set((names?.players ?? []).map((p) => p.trim()))) {
    const n = normalizeText(player);
    if (n.length < MIN_NAME_LENGTH || !lowered.some((name) => n.includes(name))) continue;
    for (const source of phrasePatterns(player)) keep.push({ source, strict: true });
  }
  return { rules, keep };
}

/** The rules with their patterns compiled. */
export interface CompiledNameRules {
  rules: Array<{ re: RegExp; to: string }>;
  keep: Array<{ re: RegExp; strict: boolean }>;
}

export function compileNameRules(r: NameRules): CompiledNameRules {
  return {
    rules: r.rules.map((x) => ({ re: new RegExp(x.source, "giu"), to: x.to })),
    keep: r.keep.map((x) => ({ re: new RegExp(x.source, "giu"), strict: x.strict })),
  };
}

interface Found {
  start: number;
  end: number;
  to: string;
  /** The rule's place (the first rule wins a tie). */
  rank: number;
}

/**
 * Replaces the league's names in `text` with their placeholders, in one pass (pure; the header's rules). inPage.ts
 * NAME_REPLACER is the same function for the page; a test runs both on the same texts.
 */
export function replaceNames(text: string, c: CompiledNameRules): string {
  if (!text || !c.rules.length) return text;
  const found: Found[] = [];
  c.rules.forEach(({ re, to }, rank) => {
    for (const m of text.matchAll(re)) if (m[0]) found.push({ start: m.index, end: m.index + m[0].length, to, rank });
  });
  if (!found.length) return text;
  const kept: Array<{ start: number; end: number; strict: boolean }> = [];
  for (const { re, strict } of c.keep) for (const m of text.matchAll(re)) if (m[0]) kept.push({ start: m.index, end: m.index + m[0].length, strict });
  const spans = found
    .filter((f) => !kept.some((k) => k.start <= f.start && f.end <= k.end && (!k.strict || k.end - k.start > f.end - f.start)))
    .sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || a.rank - b.rank);
  let out = "";
  let at = 0;
  let i = 0;
  while (i < spans.length) {
    const first = spans[i] as Found;
    const group: Found[] = [first];
    let end = first.end;
    for (i++; i < spans.length && (spans[i] as Found).start < end; i++) {
      const next = spans[i] as Found;
      end = Math.max(end, next.end);
      group.push(next);
    }
    // One name covering the whole span gives the placeholder; names that only overlap give all of theirs.
    const whole = group.filter((g) => g.start === first.start && g.end === end).sort((a, b) => a.rank - b.rank)[0];
    out += text.slice(at, first.start) + (whole ? whole.to : [...new Set(group.map((g) => g.to))].join(" / "));
    at = end;
  }
  return out + text.slice(at);
}

/** A text scrubber for the league's names (the header's rules), for the console and the results file. */
export function leagueNamesScrubber(names: LeagueNames): { scrubText(text: string): string } {
  const compiled = compileNameRules(nameRules(names));
  return { scrubText: (text: string) => replaceNames(text, compiled) };
}

// ---------------------------------------------------------------------------------------------
// The independent check

/** Does an occurrence of one of `phrases` (normalized) cover [start, end) of `text` (strict: and is longer)? */
function covered(text: string, start: number, end: number, phrases: readonly string[], strict: boolean): boolean {
  for (const p of phrases) {
    if (strict ? p.length <= end - start : p.length < end - start) continue;
    for (let j = text.indexOf(p, Math.max(0, end - p.length)); j !== -1 && j <= start; j = text.indexOf(p, j + 1)) if (j + p.length >= end) return true;
  }
  return false;
}

/** Spans of scripts/lib/redact.ts placeholders in a normalized text. */
function redactedSpans(text: string): Array<[number, number]> {
  return [...text.matchAll(/\[redacted:[a-z0-9_]+\]/g)].map((m) => [m.index, m.index + m[0].length]);
}

/** Whether a normalized name occurs in a normalized text outside a player's name and a placeholder. */
function occursLoose(text: string, name: string, players: readonly string[], placeholders: readonly string[]): boolean {
  const numeric = /^\d+$/.test(name);
  let redacted: Array<[number, number]> | null = null;
  for (let i = text.indexOf(name); i !== -1; i = text.indexOf(name, i + 1)) {
    const end = i + name.length;
    if (numeric && (/\d/.test(text[i - 1] ?? "") || /\d/.test(text[end] ?? ""))) continue;
    if (covered(text, i, end, placeholders, false) || covered(text, i, end, players, true)) continue;
    redacted ??= redactedSpans(text);
    if (redacted.some(([s, e]) => s <= i && end <= e)) continue;
    return true;
  }
  return false;
}

/** Counts the names left in cleaned texts (leftoverChecker). */
export type LeftoverCheck = (texts: string | readonly string[]) => number;

/**
 * The independent check, prepared once for a league (pure): how many of the league's names (and `extra` values: the
 * league id) still appear in cleaned texts, any case and any gap between words, as written or URL-encoded, outside a
 * longer public player name and a placeholder (written apart from replaceNames on purpose: the header). 0 is the proof
 * that nothing printed or written carries a name. The names themselves are never printed.
 */
export function leftoverChecker(names: LeagueNames | null, extra: readonly string[] = []): LeftoverCheck {
  const pairs = names ? placeholderPairs(names) : [];
  const placeholders = [...new Set([...pairs.map(([, to]) => to), LEAGUE_NAME_PLACEHOLDER, LEAGUE_ID_PLACEHOLDER])].map(normalizeText);
  const players = [...new Set((names?.players ?? []).map((p) => normalizeText(p.trim())))].filter((p) => p.length >= MIN_NAME_LENGTH);
  const targets = [...pairs.map(([from]) => from), ...extra.map((x) => x.trim())]
    .filter((name) => name.length >= MIN_NAME_LENGTH)
    .map((name) => [...new Set([normalizeText(name), normalizeText(encoded(name))])]);
  return (texts) => {
    const list = (typeof texts === "string" ? [texts] : texts).map(normalizeText);
    return targets.filter((forms) => list.some((t) => forms.some((f) => occursLoose(t, f, players, placeholders)))).length;
  };
}

/** leftoverChecker for one call. */
export function leftoverNames(texts: string | readonly string[], names: LeagueNames | null, extra: readonly string[] = []): number {
  return leftoverChecker(names, extra)(texts);
}

// ---------------------------------------------------------------------------------------------
// Structured output

/** A text cut to `max` characters with "…" (cut only after cleaning: a cut name no longer matches its rule). */
export function cutText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** `value` with `clean` applied to every string in it, object keys included (pure; before JSON.stringify: the header). */
export function cleanValue<T>(value: T, clean: (text: string) => string): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return clean(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [clean(k), walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** What a withheld text is replaced by (printed and written in its place). */
export const WITHHELD = "(withheld: it still held a league name after cleaning)";

/**
 * `value` with every string (and key) that still holds a name (leftoverChecker) replaced by WITHHELD, and how many were
 * (pure). The entry point writes the results file from it: a name the cleaning missed never reaches the file.
 */
export function withholdLeftovers<T>(value: T, leftovers: LeftoverCheck): { value: T; withheld: number } {
  let withheld = 0;
  const check = (s: string): string => {
    if (leftovers(s) === 0) return s;
    withheld++;
    return WITHHELD;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return check(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x], i) => [check(k) === WITHHELD ? `${WITHHELD} ${i + 1}` : k, walk(x)]));
    return v;
  };
  return { value: walk(value) as T, withheld };
}
