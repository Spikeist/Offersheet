/**
 * State shared between the sections of probe-shared.ts, plus evidence and fixture helpers.
 * Sections run in order (week plan → FC → IDMAP/XWALK → NFL → PROJ-S → STATS-S → PROJ-E); later
 * sections reuse what earlier ones loaded instead of fetching it again.
 */
import type { Evidence } from "../checklist";
import type { FcEntry, FcFormat } from "../fantasycalc";
import type { HttpResult } from "../http";
import type { ProbeContext } from "../probe";
import type { SleeperPlayer } from "../sleeper-players";
import type { CsvRow, EspnMapConflict } from "./idmap";
import type { EspnProTeam, NflGame } from "./nfl";
import type { EspnPoolPlayer, SleeperStatRow } from "./projections";
import type { NflState, WeekPlan } from "./weeks";

export interface FcResult {
  name: string;
  format: FcFormat;
  data: FcEntry[] | null;
  res?: HttpResult;
  error?: string;
}

export interface FcPlayerRecord {
  id: number;
  name: string;
  position: string;
  sleeperId?: string | null;
  espnId?: string | null;
  mflId?: string | null;
  fleaflickerId?: string | null;
  maybeTeam?: string | null;
  [k: string]: unknown;
}

export type EspnMapSource = "DynastyProcess" | "FantasyCalc" | "Sleeper DB";

export interface SharedState {
  /** Season/week from Sleeper /state/nfl (or the fallback), before the schedule is loaded. */
  nflState: NflState | null;
  nflStateSource: string;
  /** Final week plan (needs the schedule's last regular-season week); null when no week is known. */
  plan: WeekPlan | null;
  fc: FcResult[];
  fcPlayers: FcPlayerRecord[] | null;
  dpRows: CsvRow[] | null;
  sleeperDb: Record<string, SleeperPlayer> | null;
  /** Bytes of the Sleeper players DB response (§2.3 says ~5 MB). */
  sleeperDbBytes: number | null;
  /** DynastyProcess fleaflicker_id coverage among current players, when below 90%. */
  dpFleaflickerGap?: { have: number; of: number };
  nflGames: NflGame[];
  /** nflverse team code → bye week(s). */
  nflByes: Map<string, number[]> | null;
  /** ESPN proTeamId → nflverse team code, derived by joining games on ESPN's event id. */
  espnTeamToNflverse: Map<number, string>;
  /** ESPN abbrev → nflverse code where they differ (from the same game join). */
  espnCodeDiffs: Record<string, string>;
  /** Team codes seen per source: code → Sleeper player ids carrying it (empty for team-level sources). */
  teamCodes: Record<string, Map<string, Set<string>>>;
  /** Sleeper projections per week (all positions fetched for that week). */
  sleeperProj: Map<number, SleeperStatRow[]>;
  espnPool: EspnPoolPlayer[] | null;
  /** ESPN player id → Sleeper player id, with the source that supplied it. */
  espnToSleeper: Map<string, { sleeperId: string; source: EspnMapSource }>;
  /** ESPN ids that several sources (or rows) map to different Sleeper ids. */
  espnMapConflicts: EspnMapConflict[];
  /** ESPN proTeamId → Sleeper DEF player_id (joined on the team nickname). */
  espnDefToSleeper: Map<number, string>;
  /** ESPN's 32 NFL teams (from proTeamSchedules_wl). */
  espnTeams: EspnProTeam[];
}

export function newState(): SharedState {
  return {
    nflState: null,
    nflStateSource: "",
    plan: null,
    fc: [],
    fcPlayers: null,
    dpRows: null,
    sleeperDb: null,
    sleeperDbBytes: null,
    nflGames: [],
    nflByes: null,
    espnTeamToNflverse: new Map(),
    espnCodeDiffs: {},
    teamCodes: {},
    sleeperProj: new Map(),
    espnPool: null,
    espnToSleeper: new Map(),
    espnMapConflicts: [],
    espnDefToSleeper: new Map(),
    espnTeams: [],
  };
}

/** Evidence for a response: scrubbed URL, HTTP status, JSON path and sample. */
export function ev(p: ProbeContext, res: HttpResult | undefined, path?: string, sample?: unknown, note?: string): Evidence {
  return { url: res ? p.safeUrl(res.url) : undefined, status: res?.status, path, sample, note };
}

/** Evidence without a request (derived values, docs). */
export function note(path: string | undefined, sample: unknown, text?: string, url?: string): Evidence {
  return { path, sample, note: text, url };
}

/** "live" or "cached <UTC day>" for evidence notes. */
export function freshness(res: HttpResult | undefined, cacheLabel: string): string {
  if (!res) return "not fetched";
  return res.fromCache ? `from ${cacheLabel} cache (fetched ${res.cachedAt ? new Date(res.cachedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "earlier"})` : "live";
}

/** Labels of sanitized fixtures saved (or attempted) in this run, for the stale-fixture prune. */
export const savedLabels = new Set<string>();

/**
 * Save a sanitized fixture. Public data should never trip the leak check, but a coincidental match
 * with a .env.local value (e.g. a numeric ID) would; report that instead of crashing the probe.
 */
export async function saveFixture(p: ProbeContext, label: string, data: unknown, res?: HttpResult, ext?: string): Promise<string | null> {
  savedLabels.add(label);
  try {
    return await p.saveSanitized(label, data, res, undefined, ext);
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    p.cl.issue(`Sanitized fixture "${label}" not saved (${name}); the raw copy is in fixtures/raw/shared/. Review before re-running.`);
    return null;
  }
}

export async function saveRawSafe(p: ProbeContext, key: string, body: unknown, res?: HttpResult, ext?: string): Promise<void> {
  try {
    await p.saveRaw(key, body, res, ext);
  } catch (err) {
    p.cl.issue(`Raw fixture "${key}" not saved: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Codes that are not NFL teams: free agents and blanks. */
const NOT_A_TEAM = new Set(["", "FA", "NA", "NULL", "UNK"]);

/** Record team codes for a source, each with the Sleeper player ids that carry it (when known). */
export function addTeamCodes(state: SharedState, source: string, entries: Iterable<{ code: string | null | undefined; sleeperId?: string | null }>): void {
  const map = (state.teamCodes[source] ??= new Map());
  for (const e of entries) {
    const code = String(e.code ?? "").trim().toUpperCase();
    if (NOT_A_TEAM.has(code)) continue;
    const set = map.get(code) ?? new Set<string>();
    if (e.sleeperId) set.add(String(e.sleeperId));
    map.set(code, set);
  }
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
