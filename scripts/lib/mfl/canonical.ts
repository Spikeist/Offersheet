/**
 * Canonical order for MFL JSON (review F19). MFL serializes object keys in a different order on every
 * request and sometimes reorders arrays (e.g. the rules' position groups), so placeholders numbered
 * in encounter order and the committed fixtures changed run to run. canonical() sorts object keys
 * and sorts arrays of records by a stable key: id, positions, event+range or week. Arrays whose order
 * means something are left alone: standings (rank order) and the standings column list ("shows the
 * proper order of the standings columns", api_info). Transactions keep MFL's newest-first order.
 */
import { isRecord, text } from "./json";

/** Dotted paths (array indices dropped) whose array order carries meaning. */
export const KEEP_ORDER: ReadonlySet<string> = new Set(["leagueStandings.franchise", "leagueStandings.column_names.column"]);

/** Sort keys tried in order; the first whose primary field every element has wins. */
const SORT_KEYS: ReadonlyArray<readonly string[]> = [["id"], ["positions"], ["event", "range"], ["week"]];

const NUMERIC = /^-?\d+(\.\d+)?$/;

function compareText(a: string, b: string): number {
  if (NUMERIC.test(a) && NUMERIC.test(b)) {
    const d = Number(a) - Number(b);
    if (d) return d;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortArray(items: unknown[], path: string): unknown[] {
  if (KEEP_ORDER.has(path) || items.length < 2 || !items.every(isRecord)) return items;
  const records = items as Array<Record<string, unknown>>;
  for (const keys of SORT_KEYS) {
    const primary = keys[0] as string;
    if (!records.every((r) => text(r[primary]) !== undefined)) continue;
    // Ties fall back to the canonical JSON text, so equal keys can't keep MFL's random order.
    return [...records].sort((a, b) => {
      for (const k of keys) {
        const d = compareText(text(a[k]) ?? "", text(b[k]) ?? "");
        if (d) return d;
      }
      return compareText(JSON.stringify(a), JSON.stringify(b));
    });
  }
  return items;
}

/** Deep copy with object keys sorted and id-keyed arrays sorted (see the module comment). */
export function canonical(value: unknown, path = ""): unknown {
  if (Array.isArray(value)) return sortArray(value.map((x) => canonical(x, path)), path);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) out[k] = canonical(value[k], path ? `${path}.${k}` : k);
    return out;
  }
  return value;
}
