/**
 * DynastyProcess player ID crosswalk (db_playerids.csv) and cross-source ID joins (CLAUDE.md §2.9).
 * Pure functions: parsing, per-column coverage, duplicates and agreement between sources.
 */
import { parse } from "csv-parse/sync";
import { isBlankId } from "./util";

export type CsvRow = Record<string, string>;

export function parseCsv(text: string): CsvRow[] {
  return parse(text, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }) as CsvRow[];
}

/** Columns CLAUDE.md §2.9 relies on. */
export const DP_REQUIRED_COLUMNS = [
  "mfl_id",
  "sportradar_id",
  "fantasypros_id",
  "gsis_id",
  "sleeper_id",
  "espn_id",
  "yahoo_id",
  "fleaflicker_id",
  "cbs_id",
  "ktc_id",
  "name",
  "merge_name",
  "position",
  "team",
  "birthdate",
] as const;

export function idColumns(columns: string[]): string[] {
  return columns.filter((c) => c.endsWith("_id"));
}

export interface ColumnStats {
  column: string;
  nonEmpty: number;
  /** Distinct values that appear on more than one row. */
  duplicateValues: number;
  /** Rows involved in those duplicates. */
  duplicateRows: number;
}

export function columnStats(rows: CsvRow[], column: string): ColumnStats {
  const seen = new Map<string, number>();
  let nonEmpty = 0;
  for (const r of rows) {
    const v = r[column];
    if (isBlankId(v)) continue;
    nonEmpty++;
    const k = String(v).trim();
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dups = [...seen.values()].filter((n) => n > 1);
  return { column, nonEmpty, duplicateValues: dups.length, duplicateRows: dups.reduce((a, b) => a + b, 0) };
}

/** Rows grouped by a column value (blank values skipped); first row wins in the returned index. */
export function indexBy(rows: CsvRow[], column: string): Map<string, CsvRow> {
  const out = new Map<string, CsvRow>();
  for (const r of rows) {
    const v = r[column];
    if (isBlankId(v)) continue;
    const k = String(v).trim();
    if (!out.has(k)) out.set(k, r);
  }
  return out;
}

export function duplicateSamples(rows: CsvRow[], column: string, max = 5): Array<{ value: string; names: string[] }> {
  const groups = new Map<string, string[]>();
  for (const r of rows) {
    const v = r[column];
    if (isBlankId(v)) continue;
    const k = String(v).trim();
    groups.set(k, [...(groups.get(k) ?? []), `${r.name ?? "?"} (${r.position ?? "?"})`]);
  }
  return [...groups.entries()]
    .filter(([, names]) => names.length > 1)
    .slice(0, max)
    .map(([value, names]) => ({ value, names }));
}

export interface Agreement {
  /** Pairs where both sides have a value. */
  compared: number;
  agree: number;
  disagree: number;
  onlyLeft: number;
  onlyRight: number;
  neither: number;
  samples: Array<{ key: string; left: string; right: string; name?: string }>;
}

/**
 * Compare an ID between two sources joined on a shared key (e.g. espn_id from FantasyCalc vs
 * DynastyProcess for the same sleeper_id). Values are compared as trimmed strings.
 */
export function agreement<T>(items: T[], left: (x: T) => unknown, right: (x: T) => unknown, key: (x: T) => string, name?: (x: T) => string, maxSamples = 5): Agreement {
  const out: Agreement = { compared: 0, agree: 0, disagree: 0, onlyLeft: 0, onlyRight: 0, neither: 0, samples: [] };
  for (const x of items) {
    const l = left(x);
    const r = right(x);
    const lb = isBlankId(l);
    const rb = isBlankId(r);
    if (lb && rb) out.neither++;
    else if (lb) out.onlyRight++;
    else if (rb) out.onlyLeft++;
    else {
      out.compared++;
      if (String(l).trim() === String(r).trim()) out.agree++;
      else {
        out.disagree++;
        if (out.samples.length < maxSamples) out.samples.push({ key: key(x), left: String(l), right: String(r), name: name?.(x) });
      }
    }
  }
  return out;
}

/** Lowercase letters only, for "same name" comparisons between sources. */
function nameKey(s: string | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z]/g, "");
}

/** Rows grouped by a column value (blank values skipped), keeping every row. */
export function groupBy(rows: CsvRow[], column: string): Map<string, CsvRow[]> {
  const out = new Map<string, CsvRow[]>();
  for (const r of rows) {
    const v = r[column];
    if (isBlankId(v)) continue;
    const k = String(v).trim();
    out.set(k, [...(out.get(k) ?? []), r]);
  }
  return out;
}

export type DisagreementClass =
  | "Sleeper DB swapped ids with another player"
  | "Sleeper DB differs: DynastyProcess gives this player FantasyCalc's id (same birthdate)"
  | "FantasyCalc has a namesake's id (different birthdate)"
  | "FantasyCalc has another player's id"
  | "FantasyCalc id unknown to DynastyProcess, which gives this player the Sleeper DB's id"
  | "unresolved";

export interface EspnDisagreement {
  sleeperId: string;
  name: string;
  fcEspnId: string;
  sleeperEspnId: string;
  cls: DisagreementClass;
  /** Which source is wrong, per DynastyProcess and the birthdates. */
  wrong: "Sleeper DB" | "FantasyCalc" | "unknown";
  detail?: string;
}

const yearOf = (d: string | undefined) => (d && d !== "NA" ? d.slice(0, 4) : "?");

/**
 * Classify FantasyCalc-vs-Sleeper-DB espn_id disagreements. Both ids are looked up in DynastyProcess
 * (by espn_id), and the owner's birthdate is compared with the Sleeper DB player's: the id whose
 * DynastyProcess owner was born on the same day belongs to this player. Also detects two Sleeper
 * players whose espn_ids are swapped.
 */
export function classifyEspnDisagreements(
  items: Array<{ sleeperId: string; name: string; fcEspnId: string; sleeperEspnId: string }>,
  dpByEspn: Map<string, CsvRow[]>,
  sleeperOf: (sleeperId: string) => { espnId?: string; birthDate?: string } | undefined,
): EspnDisagreement[] {
  return items.map((d): EspnDisagreement => {
    const born = sleeperOf(d.sleeperId)?.birthDate?.slice(0, 10);
    const owners1 = dpByEspn.get(d.fcEspnId) ?? [];
    const owners2 = dpByEspn.get(d.sleeperEspnId) ?? [];
    const swap = owners2.find((o) => !isBlankId(o.sleeper_id) && o.sleeper_id !== d.sleeperId && sleeperOf(String(o.sleeper_id))?.espnId === d.fcEspnId);
    if (swap) return { ...d, cls: "Sleeper DB swapped ids with another player", wrong: "Sleeper DB", detail: `with ${swap.name ?? "?"}` };
    if (!born) return { ...d, cls: "unresolved", wrong: "unknown", detail: "no Sleeper birth_date to compare" };
    const sameDay = (o: CsvRow) => !!o.birthdate && o.birthdate !== "NA" && o.birthdate.slice(0, 10) === born;
    const self1 = owners1.filter(sameDay);
    if (self1.length && owners1.length === 1) return { ...d, cls: "Sleeper DB differs: DynastyProcess gives this player FantasyCalc's id (same birthdate)", wrong: "Sleeper DB" };
    if (self1.length) return { ...d, cls: "unresolved", wrong: "unknown", detail: `DynastyProcess has FantasyCalc's id on ${owners1.length} rows` };
    const other = owners1[0];
    if (other) {
      const also = other.sleeper_id === d.sleeperId ? "; DynastyProcess links this Sleeper id to that player too" : "";
      const who = `${other.name ?? "?"} (${other.position ?? "?"}, b. ${yearOf(other.birthdate)} vs ${yearOf(born)})${also}`;
      return nameKey(other.name) === nameKey(d.name) ? { ...d, cls: "FantasyCalc has a namesake's id (different birthdate)", wrong: "FantasyCalc", detail: who } : { ...d, cls: "FantasyCalc has another player's id", wrong: "FantasyCalc", detail: who };
    }
    if (owners2.some(sameDay)) return { ...d, cls: "FantasyCalc id unknown to DynastyProcess, which gives this player the Sleeper DB's id", wrong: "FantasyCalc" };
    return { ...d, cls: "unresolved", wrong: "unknown", detail: "DynastyProcess knows neither id" };
  });
}

export interface EspnMapCandidate {
  espnId: string;
  sleeperId: string;
  source: string;
}

export interface EspnMapConflict {
  espnId: string;
  /** Distinct Sleeper ids offered, in source order, with their sources. */
  options: Array<{ sleeperId: string; sources: string[] }>;
  /** "within DynastyProcess", "DynastyProcess vs Sleeper DB", … */
  pair: string;
  within: boolean;
  chosen: string;
  resolvedBy: "active player" | "source order";
}

/**
 * ESPN id → Sleeper id from several sources (candidates in priority order). When sources or rows
 * disagree, prefer the Sleeper id that is an active player (the DynastyProcess-duplicates decision),
 * then the first source.
 */
export function buildEspnMap(candidates: EspnMapCandidate[], isActive: (sleeperId: string) => boolean): { map: Map<string, { sleeperId: string; source: string }>; conflicts: EspnMapConflict[] } {
  const groups = new Map<string, EspnMapCandidate[]>();
  for (const c of candidates) {
    if (isBlankId(c.espnId) || isBlankId(c.sleeperId)) continue;
    const k = String(c.espnId).trim();
    groups.set(k, [...(groups.get(k) ?? []), { ...c, espnId: k, sleeperId: String(c.sleeperId).trim() }]);
  }
  const map = new Map<string, { sleeperId: string; source: string }>();
  const conflicts: EspnMapConflict[] = [];
  for (const [espnId, list] of groups) {
    const options: EspnMapConflict["options"] = [];
    for (const c of list) {
      const o = options.find((x) => x.sleeperId === c.sleeperId);
      if (o) o.sources.push(c.source);
      else options.push({ sleeperId: c.sleeperId, sources: [c.source] });
    }
    const first = list[0] as EspnMapCandidate;
    if (options.length === 1) {
      map.set(espnId, { sleeperId: first.sleeperId, source: first.source });
      continue;
    }
    const active = options.filter((o) => isActive(o.sleeperId));
    const pick = active.length === 1 ? (active[0] as (typeof options)[number]) : (options[0] as (typeof options)[number]);
    const allSources = [...new Set(list.map((c) => c.source))];
    // A source that itself offers two different Sleeper ids for one ESPN id has an internal duplicate.
    const withinSources = allSources.filter((s) => new Set(list.filter((c) => c.source === s).map((c) => c.sleeperId)).size > 1);
    const within = withinSources.length > 0;
    conflicts.push({
      espnId,
      options,
      pair: within ? `within ${withinSources.join(" and ")}` : allSources.join(" vs "),
      within,
      chosen: pick.sleeperId,
      resolvedBy: active.length === 1 ? "active player" : "source order",
    });
    map.set(espnId, { sleeperId: pick.sleeperId, source: list.find((c) => c.sleeperId === pick.sleeperId)?.source ?? first.source });
  }
  return { map, conflicts };
}
