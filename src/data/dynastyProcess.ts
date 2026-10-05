/**
 * DynastyProcess player ID crosswalk, db_playerids.csv (CLAUDE.md §2.9; refreshed daily). Phase 0
 * (IDMAP): 12508 rows × 35 columns, "NA" for blanks, MFL-style team codes (GBP, JAC, KCC, …),
 * kickers spelled "PK", no team-defense rows, and a few duplicate ids (6 sleeper_id values, 13
 * espn_id values on two rows each) that the crosswalk resolves.
 */
import { parse } from "csv-parse/sync";
import { LeagueImportError, type HttpClient, type HttpResponse } from "@/adapters/types";
import { TTL } from "@/server/cache";
import { normalizeId } from "./ids";
import { reducedKey, reducerId, type BodyReducer } from "./reduce";
import { checkedResponse, getPublicSource, tooFewRows } from "./source";
import { cleanTeamCode } from "./teamCodes";

export const DYNASTYPROCESS_IDS_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";

/** Columns the crosswalk reads; the file must have all of them. */
export const DYNASTYPROCESS_COLUMNS = ["sleeper_id", "espn_id", "yahoo_id", "mfl_id", "fleaflicker_id", "sportradar_id", "gsis_id", "name", "position", "team"] as const;

/** Row floor (review HTTP-1): the file had 12,509 rows on 2026-09-29; fewer than this is a broken or partial file. */
export const DYNASTYPROCESS_MIN_ROWS = 10_000;

/** The file is 2.6 MB from GitHub's CDN; one retry. */
export const DYNASTYPROCESS_TIMEOUT_MS = 30_000;

export interface DynastyRow {
  sleeperId: string | null;
  espnId: string | null;
  yahooId: string | null;
  mflId: string | null;
  fleaflickerId: string | null;
  sportradarId: string | null;
  gsisId: string | null;
  name: string;
  /** DynastyProcess position (QB, RB, WR, TE, PK, PN, DE, …), null when blank. */
  position: string | null;
  /** Team code as DynastyProcess writes it (MFL style), null for free agents and blanks. */
  team: string | null;
}

const WHAT = "DynastyProcess player IDs";

function cell(v: string | undefined): string | null {
  const t = v?.trim();
  return t && t !== "NA" ? t : null;
}

/** Parse and validate the CSV (pure). A missing column → BAD_RESPONSE naming it. */
export function parseDynastyProcessCsv(text: string): DynastyRow[] {
  let records: Record<string, string>[];
  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      columns: (header: string[]) => {
        const names = header.map((h) => h.trim());
        const missing = DYNASTYPROCESS_COLUMNS.find((c) => !names.includes(c));
        if (missing) throw new LeagueImportError("BAD_RESPONSE", `${WHAT}: the CSV has no "${missing}" column`, { path: `header.${missing}` });
        return names;
      },
    }) as Record<string, string>[];
  } catch (err) {
    if (err instanceof LeagueImportError) throw err;
    const line = (err as { lines?: number }).lines;
    throw new LeagueImportError("BAD_RESPONSE", `${WHAT}: the CSV could not be parsed${line ? ` (line ${line})` : ""}`, { path: line ? `line ${line}` : "(root)" });
  }
  if (!records.length) throw new LeagueImportError("BAD_RESPONSE", `${WHAT}: the CSV has no rows`, { path: "(root)" });
  return records.map((r) => ({
    sleeperId: normalizeId("sleeper", r.sleeper_id),
    espnId: normalizeId("espn", r.espn_id),
    yahooId: normalizeId("yahoo", r.yahoo_id),
    mflId: normalizeId("mfl", r.mfl_id),
    fleaflickerId: normalizeId("fleaflicker", r.fleaflicker_id),
    sportradarId: normalizeId("sportradar", r.sportradar_id),
    gsisId: normalizeId("gsis", r.gsis_id),
    name: cell(r.name) ?? "",
    position: cell(r.position),
    team: cleanTeamCode(cell(r.team)),
  }));
}

/** A CSV value as written back: quoted (inner quotes doubled) only when it holds a quote, a comma or a line break. */
function csvValue(v: string | undefined): string {
  const s = v ?? "";
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The fetch-time reducer of the ID map (planner reply to Checkpoint 4c, Part B, B1; src/data/reduce.ts): the CSV keeps the
 * DYNASTYPROCESS_COLUMNS (10 of its 35: what parseDynastyProcessCsv reads), every record in order, each value as
 * csv-parse read it with parseDynastyProcessCsv's own options (a cell a short row lacks is written empty, which every
 * reader takes as blank, like "NA"), so parseDynastyProcessCsv reads the same rows from either; a third of the bytes
 * and of its parse time. A text it can't read, or without those columns, stays as it is (the check's error, word for
 * word). Consumers: checkDynastyCsv (and its row floor), the crosswalk. The id's fingerprint follows DYNASTYPROCESS_COLUMNS
 * (src/data/reduce.ts reducerId); its version names the code.
 */
export const DYNASTYPROCESS_REDUCER: BodyReducer = {
  id: reducerId("dynastyprocess", 1, [DYNASTYPROCESS_COLUMNS]),
  reduce(text: string): string {
    let records: Record<string, string | undefined>[];
    try {
      records = parse(text, {
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        columns: (header: string[]) => {
          const names = header.map((h) => h.trim());
          if (DYNASTYPROCESS_COLUMNS.some((c) => !names.includes(c))) throw new Error("not the ID map");
          return names;
        },
      }) as Record<string, string | undefined>[];
    } catch {
      return text;
    }
    if (!records.length) return text;
    const lines = [DYNASTYPROCESS_COLUMNS.join(",")];
    for (const r of records) lines.push(DYNASTYPROCESS_COLUMNS.map((c) => csvValue(r[c])).join(","));
    return `${lines.join("\n")}\n`;
  },
};

/** The ID map's cache key: its URL's, plus the reducer's suffix (src/data/reduce.ts reducedKey). */
export const DYNASTYPROCESS_CACHE_KEY = reducedKey(`dynastyprocess:${DYNASTYPROCESS_IDS_URL}`, DYNASTYPROCESS_REDUCER);

function checkDynastyCsv(res: HttpResponse): DynastyRow[] {
  checkedResponse(res, WHAT);
  const rows = parseDynastyProcessCsv(res.text);
  if (rows.length < DYNASTYPROCESS_MIN_ROWS) throw tooFewRows(WHAT, rows.length, `at least ${DYNASTYPROCESS_MIN_ROWS.toLocaleString("en-US")}`);
  return rows;
}

export interface DynastyProcessLoad {
  rows: DynastyRow[];
  fromCache: boolean;
  /** A saved copy stood in because the file couldn't be refreshed (fetchedAt is when that copy was fetched). */
  stale: boolean;
  fetchedAt?: number;
}

/** Fetch and check the CSV: only a complete file is cached (24 h), and a saved copy stands in for up to 7 days when GitHub fails. */
export async function fetchDynastyProcessIds(http: HttpClient): Promise<DynastyProcessLoad> {
  const got = await getPublicSource(
    http,
    DYNASTYPROCESS_IDS_URL,
    { key: DYNASTYPROCESS_CACHE_KEY, ttlMs: TTL.idMap, timeoutMs: DYNASTYPROCESS_TIMEOUT_MS, maxRetries: 1, transformText: DYNASTYPROCESS_REDUCER.reduce },
    checkDynastyCsv,
  );
  if ("error" in got) throw got.error;
  const { res } = got;
  return { rows: got.value, fromCache: res.fromCache, stale: res.stale === true, ...(res.fetchedAt !== undefined ? { fetchedAt: res.fetchedAt } : {}) };
}
