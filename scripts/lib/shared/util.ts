/** Small pure helpers for the shared-data probe (no I/O). */

export function countBy<T>(items: Iterable<T>, key: (x: T) => string | number | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of items) {
    const k = String(key(x) ?? "(none)");
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Sort a count map by descending count (then key) for stable, readable output. */
export function sortCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).sort(([ka, a], [kb, b]) => b - a || ka.localeCompare(kb)));
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export function round(x: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/** A number with a typographic minus ("−2"), matching the report prose. */
export function signed(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : String(n);
}

export function pct(n: number, d: number, digits = 1): string {
  return d ? `${round((100 * n) / d, digits)}%` : "n/a";
}

/**
 * Blank ID in any of the sources: null/undefined/empty, the "NA" that R-written CSVs use, or the
 * "UNK" FantasyCalc puts in mflId when it has none.
 */
export function isBlankId(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  return s === "" || s === "NA" || s === "UNK" || s === "null" || s === "undefined";
}

/** UTC calendar day of an epoch-ms timestamp. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function unique<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

/** Minimal RFC 4180 CSV writer (quotes fields containing a comma, quote or newline). */
export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

/** Numeric-aware sort for keys like week numbers. */
export function sortNumericKeys<V>(obj: Record<string, V>): Record<string, V> {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => Number(a) - Number(b) || a.localeCompare(b)));
}
