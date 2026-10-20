/**
 * Checkpoint 7h, section 6 (planner reply to Checkpoint 7g): the draft assistant's data check, Phase 0's way. The draft
 * assistant is Phase 8 ("don't build it yet"); this probe asks which free sources, whose terms allow our use, give
 * - average draft position (ADP), by scoring format and league size,
 * - preseason season-long projections (Sleeper's and ESPN's season projections),
 * - live draft picks (Sleeper's draft endpoints, ESPN's draft data; Yahoo's draft results from its docs only),
 * and prints ✅ / ⚠️ / ❌ for each check with its JSON path, HTTP status and a sample (CLAUDE.md §0.12: ✅ only when data
 * verifies a claim; inferred, derived or small-sample results are ⚠️; a gap with a working workaround is ⚠️, not ❌;
 * ➖/⏸ = not applicable or not testable now, with the reason).
 *
 *   npm run probe:draft -- --live
 *   npm run probe:draft -- --live --sleeper-draft <draftId>
 *
 * Sources (the lead's list for Checkpoint 7h; nothing else is asked):
 * - Sleeper: the PINNED public test league (its ID is read from the git-ignored fixtures/raw/sleeper/fallback-league.json
 *   and never printed or written; refreshing it is not a crawl, CLAUDE.md §0.6): its drafts list, its draft, the picks and
 *   the draft's traded picks; no other league. The ADP fields (adp_*) of Sleeper's projection rows and its season
 *   projections endpoint (both undocumented).
 *   `--sleeper-draft <draftId>`: a draft of Parker's own (a Sleeper mock draft, for example) read while it runs: the draft
 *   and its picks, then the picks again 20 s later, so a live run shows whether picks appear as they are made. Never a
 *   stranger's draft. The ID is registered with the redactor, so it never reaches the output.
 * - ESPN: the public test league named in CLAUDE.md §2.2 (view=mDraftDetail with mSettings: the picks, the order and the
 *   draft's settings), and the league-independent player pool (leaguedefaults/3, view=kona_player_info with espn-api's
 *   player-pool filter, scripts/lib/shared/fetch.ts espnPoolFilter): ownership.averageDraftPosition, draftRanksByRankType
 *   and the season projections (statSourceId 1, statSplitTypeId 0). This season, last season and next season.
 * - Fantasy Football Calculator's ADP API, MFL's `adp` and `aav` exports (and api_info, its docs), and DynastyProcess's
 *   data repository (the two files that could hold ranks: values.csv and db_fpecr_latest.csv).
 * - Yahoo, FantasyPros and Underdog: their documents and terms only, read for reports/draft-data.md (no request here).
 *
 * Politeness (CLAUDE.md §0.9): one request at a time per host through the probes' client (scripts/lib/http.ts): Sleeper
 * ≥ 120 ms apart, ESPN 600 ms, MFL 1.2 s with no retries (MFL's own rules: scripts/lib/mfl/client.ts), Fantasy Football
 * Calculator FFC_GAP_MS ("Please do not call this API too frequently."), back-off on 429 / 5xx; every answer is cached
 * (league data 10 minutes, projections 6 hours, ADP lists ADP_TTL_MS: FFC's "The data only updates once per day.", docs
 * 7 days), so a second run within those times sends nothing. The player ID crosswalk comes from the app's own loader,
 * HTTP client and cache (src/data/load.ts on .cache/app), so a crosswalk the app built within a day costs no request.
 * ⚠️ Ours: the probes' client, not the app's, for the sources themselves: the app caches Sleeper's projections in reduced
 * forms that drop the ADP fields (src/data/reduce.ts), and nothing else here is a body the app reads.
 *
 * Writes reports/probe-output/draft.md and draft.json (the checklist), and draft.samples.md (each source's first rows:
 * public NFL players only). Placeholders only: no league id, draft id, user id, team, owner or league name.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ESPN_DEFAULT_POSITIONS, ESPN_PRO_TEAMS } from "@/adapters/espn/constants";
import type { PlayerIdCrosswalk } from "@/data/crosswalk";
import { refuseIfNetworkOff } from "@/server/http";
import { pinnedLeagueId } from "./check-sleeper-cors";
import { DAY, TTL, writeFileAtomic } from "./lib/cache";
import type { Evidence } from "./lib/checklist";
import { ROOT } from "./lib/env";
import { setHostGap, type HttpResult } from "./lib/http";
import { MFL_DOCS, MflClient, type MflCall } from "./lib/mfl/client";
import { docHas, htmlToText, typeBlock } from "./lib/mfl/docs";
import { asArray, isRecord, num, text } from "./lib/mfl/json";
import { runProbe, type ProbeContext } from "./lib/probe";
import { scrubEverything } from "./lib/redact";
import { flagValue, isMainModule } from "./lib/runMode";
import { SWID_RE } from "./lib/sanitize";
import { ESPN_BASE, espnLeagueDefaultsUrl, espnPoolFilter, fetchEspnLeagueDefaults, fetchSleeperProjections, fetchSleeperState, fetchText, sleeperProjectionsUrl, SLEEPER_STATE_URL } from "./lib/shared/fetch";
import { asRows, espnPlayers, findEntry, rowPosition, type EspnPoolPlayer, type SleeperStatRow } from "./lib/shared/projections";
import { median, round } from "./lib/shared/util";
import { endpoints, fetchJson } from "./lib/sleeper/api";
import { DraftPickSchema, DraftSchema, PickSchema, type SleeperDraft, type SleeperDraftPick } from "./lib/sleeper/types";

// ---------------------------------------------------------------------------------------------
// Constants

/** The positions the season projections and ADP lists are read for (offense, kickers and team defenses). */
export const SEASON_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
/** The positions the match rates and the agreement are measured on (Phase 0's item M: QB/RB/WR/TE). */
export const SKILL_POSITIONS: ReadonlySet<string> = new Set(["QB", "RB", "WR", "TE"]);
/** Sleeper's "no ADP": every adp_* key of a player nobody drafts in that format reads 999. */
export const SLEEPER_ADP_NONE = 999;
/** The ESPN public test league CLAUDE.md §2.2 names (probe-espn.ts PUBLIC_LEAGUE_ID; reports say "the public test league"). */
const ESPN_PUBLIC_LEAGUE_ID = "899513";
/** ESPN player pool page size (Phase 0's probe:shared read 500 the same way). */
const ESPN_POOL_LIMIT = 500;
const FFC_HOST = "fantasyfootballcalculator.com";
export const FFC_API = `https://${FFC_HOST}/api/v1/adp`;
export const FFC_DOCS_URL = "https://help.fantasyfootballcalculator.com/article/42-adp-rest-api";
/** Fantasy Football Calculator's formats (its site's ADP pages: /adp, /adp/ppr, /adp/half-ppr, /adp/2qb, /adp/dynasty, /adp/rookie). */
export const FFC_FORMATS = ["standard", "ppr", "half-ppr", "2qb", "dynasty", "rookie"] as const;
export const FFC_TEAM_SIZES = [8, 10, 12, 14] as const;
/** Fantasy Football Calculator: "Please do not call this API too frequently." Two seconds apart, one at a time. */
const FFC_GAP_MS = 2000;
/** ADP lists are cached a day (FFC: "The data only updates once per day."; MFL's lists are drafts' averages). */
const ADP_TTL_MS = DAY;
const DP_VALUES_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv";
const DP_ECR_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_fpecr_latest.csv";
/** A made-up origin for Sleeper (can ANY other site read it?), the app's own for ESPN (it allows a list of origins). */
const CORS_ORIGIN_ANY = "https://offersheet.example";
const CORS_ORIGIN_APP = "https://offersheet.vercel.app";
/** How many of each list's first players the match rates and the agreement read. */
const TOP_N = 200;
const AGREEMENT_TOP = 150;
/** Rows per list in draft.samples.md. */
const SAMPLE_ROWS = 12;
/** --sleeper-draft: the picks are read again this long after the first read. */
const LIVE_RECHECK_MS = 20_000;
/** The committed Sleeper fixture of 2026-09-30 (probe:shared): the season projections' first 40 QBs, ADP included. */
const SLEEPER_SEASON_FIXTURE_LABEL = /^sleeper\/projections\/\d{4}\?position=QB \(season/;

// ---------------------------------------------------------------------------------------------
// Pure helpers (tested in probe-draft.test.ts)

/** A Sleeper ADP value that names a real pick position: a positive number below SLEEPER_ADP_NONE. */
export function realSleeperAdp(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < SLEEPER_ADP_NONE;
}

/** A player's Sleeper ADP in 1QB PPR leagues (adp_ppr) and in superflex ones (adp_2qb): a real value, or null. */
export interface SleeperAdpPair {
  ppr: number | null;
  twoQb: number | null;
}

/** Each player's 1QB and superflex ADP from Sleeper's season rows (the review of Checkpoint 7h: MFL's lists mix the two). */
export function sleeperAdpPairs(rows: readonly SleeperStatRow[]): Map<string, SleeperAdpPair> {
  const out = new Map<string, SleeperAdpPair>();
  for (const r of rows) {
    const ppr = r.stats?.adp_ppr;
    const twoQb = r.stats?.adp_2qb;
    const pair = { ppr: realSleeperAdp(ppr) ? ppr : null, twoQb: realSleeperAdp(twoQb) ? twoQb : null };
    if (pair.ppr !== null || pair.twoQb !== null) out.set(r.player_id, pair);
  }
  return out;
}

/** One QB of an ADP list against Sleeper's 1QB and superflex ADP: which one his pick sits closer to. */
export interface QbLean {
  name: string;
  adp: number;
  ppr: number;
  twoQb: number;
  closerTo2qb: boolean;
}

/**
 * The first `top` QBs of an ADP list (by its own ADP; ⚠️ positions from the crosswalk) that Sleeper rates in both formats, each
 * with the format his pick sits closer to: a list whose QBs mostly sit closer to Sleeper's superflex ADP mixes superflex
 * leagues in (the review of Checkpoint 7h: MFL's adp export has no QB-count filter).
 */
export function qbLeans(entries: readonly AdpEntry[], sleeper: ReadonlyMap<string, SleeperAdpPair>, top = 12): QbLean[] {
  const out: QbLean[] = [];
  for (const e of [...entries].filter((x) => x.pos === "QB").sort((a, b) => a.adp - b.adp)) {
    if (out.length >= top) break;
    const pair = e.canonical ? sleeper.get(e.canonical) : undefined;
    if (!pair || pair.ppr === null || pair.twoQb === null) continue;
    out.push({ name: e.name, adp: e.adp, ppr: pair.ppr, twoQb: pair.twoQb, closerTo2qb: Math.abs(e.adp - pair.twoQb) < Math.abs(e.adp - pair.ppr) });
  }
  return out;
}

export interface AdpKeyCount {
  key: string;
  /** Rows carrying the key at all. */
  rows: number;
  /** Rows whose value is a real ADP (realSleeperAdp). */
  real: number;
  /** The smallest real value (the first pick in that format), null when none. */
  best: number | null;
}

/** Every adp_* key on the rows (pos_adp_* left out: positional ranks of the same lists), by key name. */
export function sleeperAdpKeyCounts(rows: readonly SleeperStatRow[]): AdpKeyCount[] {
  const byKey = new Map<string, AdpKeyCount>();
  for (const r of rows)
    for (const [k, v] of Object.entries(r.stats ?? {})) {
      if (!k.startsWith("adp_")) continue;
      const c = byKey.get(k) ?? { key: k, rows: 0, real: 0, best: null };
      c.rows++;
      if (realSleeperAdp(v)) {
        c.real++;
        c.best = c.best === null ? v : Math.min(c.best, v);
      }
      byKey.set(k, c);
    }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Average ranks, 1-based, ties sharing the mean of their places. */
export function averageRanks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const mean = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!.i] = mean;
    i = j + 1;
  }
  return ranks;
}

/** Spearman's rank correlation (Pearson on average ranks); null with fewer than 3 pairs or no spread. */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rx = averageRanks(xs);
  const ry = averageRanks(ys);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx);
  const my = mean(ry);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < rx.length; i++) {
    const dx = rx[i]! - mx;
    const dy = ry[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

/** One player of an ADP list, in the list's own order. */
export interface AdpEntry {
  /** The source's own player id. */
  sourceId: string;
  /** Sleeper id (the app's canonical id), when the crosswalk maps him. */
  canonical?: string;
  name: string;
  pos: string;
  team: string | null;
  adp: number;
}

export interface Agreement {
  a: string;
  b: string;
  /** Players in both lists' first `top` (by each list's own ADP) with a canonical id. */
  common: number;
  rho: number | null;
  /** Median |ADP_a − ADP_b| over the common players, in picks. */
  medianGap: number | null;
}

/** How two ADP lists agree on the players both put in their first `top`, matched by canonical id. */
export function agreementOf(a: { label: string; entries: readonly AdpEntry[] }, b: { label: string; entries: readonly AdpEntry[] }, top: number): Agreement {
  const firstOf = (list: readonly AdpEntry[]) => {
    const out = new Map<string, number>();
    for (const e of [...list].sort((x, y) => x.adp - y.adp).slice(0, top)) if (e.canonical && !out.has(e.canonical)) out.set(e.canonical, e.adp);
    return out;
  };
  const ma = firstOf(a.entries);
  const mb = firstOf(b.entries);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [id, v] of ma) {
    const w = mb.get(id);
    if (w === undefined) continue;
    xs.push(v);
    ys.push(w);
  }
  const gaps = xs.map((x, i) => Math.abs(x - ys[i]!));
  return { a: a.label, b: b.label, common: xs.length, rho: spearman(xs, ys), medianGap: median(gaps) };
}

/** A Fantasy Football Calculator player row (its JSON as served; zod keeps unknown fields). */
const FfcPlayerSchema = z.looseObject({
  player_id: z.union([z.number(), z.string()]).transform(String),
  name: z.string(),
  position: z.string(),
  team: z.string().nullable().optional(),
  adp: z.number(),
  adp_formatted: z.string().nullable().optional(),
  times_drafted: z.number().nullable().optional(),
  high: z.number().nullable().optional(),
  low: z.number().nullable().optional(),
  stdev: z.number().nullable().optional(),
  bye: z.number().nullable().optional(),
});
export type FfcPlayer = z.infer<typeof FfcPlayerSchema>;
const FfcSchema = z.looseObject({
  status: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  players: z.array(FfcPlayerSchema),
});
export type FfcList = z.infer<typeof FfcSchema>;

/** A Fantasy Football Calculator list, or null when the body isn't one (an error answer, or a changed shape). */
export function parseFfc(json: unknown): FfcList | null {
  const r = FfcSchema.safeParse(json);
  return r.success ? r.data : null;
}

/** Fantasy Football Calculator's position names in Sleeper's ("PK" is a kicker). */
export function ffcPosition(pos: string): string {
  const p = pos.trim().toUpperCase();
  return p === "PK" ? "K" : p === "DST" || p === "D/ST" ? "DEF" : p;
}

export interface MflAdpRow {
  id: string;
  averagePick: number;
  minPick: number | null;
  maxPick: number | null;
  draftsSelectedIn: number | null;
  rank: number | null;
  /** Every field MFL sent for the player (the report lists their names). */
  fields: string[];
}

export interface MflAdp {
  players: MflAdpRow[];
  totalDrafts: number | null;
  totalPicks: number | null;
  /** When MFL last updated the list (epoch seconds as MFL sends them, converted to ms), null when absent. */
  updatedMs: number | null;
  /** The list's own top-level fields (the report lists them). */
  fields: string[];
}

/** MFL's TYPE=adp body ({adp: {player: [...], totalDrafts, timestamp}}); null when it isn't one (MFL's errors are HTTP 200). */
export function parseMflAdp(json: unknown): MflAdp | null {
  const adp = isRecord(json) ? json.adp : undefined;
  if (!isRecord(adp)) return null;
  const players: MflAdpRow[] = [];
  for (const p of asArray(adp.player as unknown)) {
    if (!isRecord(p)) continue;
    const id = text(p.id);
    const avg = num(p.averagePick);
    if (!id || avg === undefined) continue;
    players.push({ id, averagePick: avg, minPick: num(p.minPick) ?? null, maxPick: num(p.maxPick) ?? null, draftsSelectedIn: num(p.draftsSelectedIn) ?? null, rank: num(p.rank) ?? null, fields: Object.keys(p).sort() });
  }
  const ts = num(adp.timestamp);
  return {
    players,
    totalDrafts: num(adp.totalDrafts) ?? null,
    totalPicks: num(adp.totalPicks) ?? null,
    updatedMs: ts === undefined ? null : ts < 1e11 ? ts * 1000 : ts,
    fields: Object.keys(adp).sort(),
  };
}

export interface MflAavRow {
  id: string;
  averageValue: number;
  fields: string[];
}

/** MFL's TYPE=aav body ({aav: {player: [{id, averageValue, ...}]}}); null when it isn't one. */
export function parseMflAav(json: unknown): { players: MflAavRow[]; fields: string[] } | null {
  const aav = isRecord(json) ? json.aav : undefined;
  if (!isRecord(aav)) return null;
  const players: MflAavRow[] = [];
  for (const p of asArray(aav.player as unknown)) {
    if (!isRecord(p)) continue;
    const id = text(p.id);
    const v = num(p.averageValue);
    if (!id || v === undefined) continue;
    players.push({ id, averageValue: v, fields: Object.keys(p).sort() });
  }
  return { players, fields: Object.keys(aav).sort() };
}

/** The ESPN ownership block (only the fields read here; ESPN sends more). */
export interface EspnOwnership {
  averageDraftPosition?: number;
  auctionValueAverage?: number;
  percentOwned?: number;
  date?: number;
  leagueType?: number;
  [k: string]: unknown;
}

export interface EspnDraftRank {
  rank?: number;
  auctionValue?: number;
  rankType?: string;
  published?: boolean;
  [k: string]: unknown;
}

/** An ESPN pool player's ownership block and draft ranks (typed loosely: the pool's own type leaves them open). */
export function espnDraftFields(p: EspnPoolPlayer): { ownership: EspnOwnership | null; ranks: Record<string, EspnDraftRank> } {
  const pl = p.player as (EspnPoolPlayer["player"] & { draftRanksByRankType?: unknown }) | undefined;
  const own = pl?.ownership;
  const ranks = pl?.draftRanksByRankType;
  return { ownership: own && typeof own === "object" ? (own as EspnOwnership) : null, ranks: ranks && typeof ranks === "object" ? (ranks as Record<string, EspnDraftRank>) : {} };
}

/** A Sleeper season-projection row's player name ("First Last"; a team defense's row names the team). */
export function sleeperName(r: SleeperStatRow): string {
  const pl = r.player as { first_name?: unknown; last_name?: unknown } | null | undefined;
  const first = typeof pl?.first_name === "string" ? pl.first_name : "";
  const last = typeof pl?.last_name === "string" ? pl.last_name : "";
  return `${first} ${last}`.trim() || r.player_id;
}

export interface SpanRow {
  id: string;
  name: string;
  season: number;
  /** Σ pts_ppr over the weeks from the current one through week 18. */
  rest: number;
  /** Σ pts_ppr over the weeks after the current one. */
  after: number;
  /** Σ pts_ppr over weeks 1–18 (past weeks as Sleeper serves them now). */
  all: number;
}

/**
 * For each player with a season projection, the season row's pts_ppr beside the sums of his weekly pts_ppr: from the
 * current week, after it, and over every week. `weeks` maps a week to its rows.
 */
export function spanRows(seasonRows: readonly SleeperStatRow[], weeks: ReadonlyMap<number, readonly SleeperStatRow[]>, currentWeek: number, minSeasonPts: number): SpanRow[] {
  const sums = new Map<string, { rest: number; after: number; all: number }>();
  for (const [w, rows] of weeks)
    for (const r of rows) {
      const v = r.stats?.pts_ppr;
      if (typeof v !== "number") continue;
      const s = sums.get(r.player_id) ?? { rest: 0, after: 0, all: 0 };
      s.all += v;
      if (w >= currentWeek) s.rest += v;
      if (w > currentWeek) s.after += v;
      sums.set(r.player_id, s);
    }
  const out: SpanRow[] = [];
  for (const r of seasonRows) {
    const season = r.stats?.pts_ppr;
    const s = sums.get(r.player_id);
    if (typeof season !== "number" || season < minSeasonPts || !s) continue;
    out.push({ id: r.player_id, name: sleeperName(r), season, ...s });
  }
  return out;
}

/** A markdown table (cells escaped for pipes). */
export function mdTable(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string[] {
  const cell = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "—" : String(v).replace(/\|/g, "\\|"));
  return [`| ${headers.join(" | ")} |`, `|${headers.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)];
}

/** "2026-10-19 07:42 UTC" for an epoch-ms time, "—" when unknown. */
export function utcStamp(ms: number | null | undefined): string {
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";
}

const fmt = (n: number | null | undefined, digits = 1) => (typeof n === "number" && Number.isFinite(n) ? String(round(n, digits)) : "—");
const share = (n: number, d: number) => (d ? `${n}/${d} (${round((100 * n) / d, 1)}%)` : `${n}/0`);

// ---------------------------------------------------------------------------------------------
// The run

interface Sample {
  title: string;
  note?: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
}

interface State {
  season: number;
  week: number;
  xw: PlayerIdCrosswalk | null;
  /** ADP lists for the agreement check, by label; only lists of the same season are compared. */
  lists: Array<{ label: string; season: number; entries: AdpEntry[] }>;
  /** Sleeper's season rows against the committed fixture of 2026-09-30 (ADP.sleeper.updates), read by the span check. */
  frozen?: { compared: number; adpSame: number; ptsSame: number; captured: string };
  samples: Sample[];
  /** What the run read, for the report's header (placeholders only). */
  leagues: Array<{ label: string; access: string; source: string; notes?: string }>;
  /** This season's season-projection rows (the span check reads them). */
  seasonRows?: SleeperStatRow[];
  /** Each season's Sleeper 1QB and superflex ADP by Sleeper id (ADP.mfl.qb reads them). */
  sleeperAdp: Map<number, Map<string, SleeperAdpPair>>;
}

/** Evidence for a scripts/lib/http.ts result (URL as given: always a placeholder-only template here). */
function ev(res: HttpResult | undefined, url: string, pathText: string, sample: unknown, note?: string): Evidence {
  return { url, status: res?.status, path: pathText, sample, note: [res?.fromCache ? `from cache (fetched ${utcStamp(res.cachedAt)})` : undefined, note].filter(Boolean).join("; ") || undefined };
}

/** A player's name, position and team from the crosswalk's Sleeper record, for a Sleeper id. */
function sleeperFacts(s: State, id: string | undefined): { name: string; pos: string; team: string | null } | undefined {
  if (!id) return undefined;
  const lite = s.xw?.sleeperPlayer(id);
  return lite ? { name: lite.name, pos: lite.position ?? "?", team: lite.team } : undefined;
}

/** The app's player ID crosswalk (src/data/load.ts) on the app's HTTP client and file cache (.cache/app). */
async function crosswalkSection(p: ProbeContext, s: State): Promise<void> {
  try {
    const [{ FileCache }, { createHttpClient }, { loadPlayerIdResolver }] = await Promise.all([import("@/server/cache"), import("@/server/http"), import("@/data/load")]);
    const http = createHttpClient({ cache: new FileCache(path.join(ROOT, ".cache", "app"), { sweepEveryMs: null }) });
    s.xw = await p.timed("crosswalk", () => loadPlayerIdResolver({ http }));
    const st = s.xw.status().filter((x) => x.key !== "fantasyCalc");
    const all = st.every((x) => x.available);
    p.cl.add(
      "XWALK",
      "XWALK.sources",
      "Player ID crosswalk (the app's own, src/data/load.ts)",
      all ? "ok" : "warn",
      st.map((x) => `${x.name}: ${x.available ? `${x.rows} rows, fetched ${x.fetchedAt ?? "?"}${x.fromCache ? " (the app's cache)" : ""}` : "unavailable"}${x.note ? ` (${x.note})` : ""}`).join("; "),
      { note: "ESPN and MFL ids map through it (canonical), Fantasy Football Calculator's names through matchByName (exact name, position and NFL team; one active player only)" },
    );
  } catch (err) {
    s.xw = null;
    p.cl.fail("XWALK", "XWALK.sources", "Player ID crosswalk (the app's own)", `couldn't be built: ${err instanceof Error ? err.message : String(err)}; the match rates below are skipped`);
  }
}

// ---------------------------------------------------------------------------------------------
// Sleeper

async function sleeperSection(p: ProbeContext, s: State, ownDraftId: string | undefined): Promise<void> {
  const stateRes = await fetchSleeperState();
  const st = isRecord(stateRes.json) ? stateRes.json : {};
  const season = Number(st.season);
  const week = Number(st.week);
  if (!stateRes.ok || !Number.isInteger(season) || !Number.isInteger(week)) {
    p.cl.fail("SETUP", "SETUP.calendar", "NFL calendar (Sleeper /state/nfl)", `unreadable (HTTP ${stateRes.status}): the season can't be known, so Sleeper's checks stop here`, ev(stateRes, SLEEPER_STATE_URL, "season, week", null));
    return;
  }
  s.season = season;
  s.week = week;
  p.cl.ok("SETUP", "SETUP.calendar", "NFL calendar (Sleeper /state/nfl)", `season ${season}, week ${week} (${String(st.season_type ?? "?")}); every season below comes from here, never a constant`, ev(stateRes, SLEEPER_STATE_URL, "season, week, season_type", { season, week, season_type: st.season_type }));

  await sleeperSeasonProjections(p, s);
  await sleeperSpan(p, s);
  await sleeperOtherSeasons(p, s);
  await sleeperPinnedDraft(p, s);
  await sleeperOwnDraft(p, ownDraftId);
}

/** This season's season projections: the ADP keys, the projections, and how fresh both are. */
async function sleeperSeasonProjections(p: ProbeContext, s: State): Promise<void> {
  const url = sleeperProjectionsUrl(s.season, null, [...SEASON_POSITIONS], { multi: true });
  const res = await p.timed("sleeper", () => fetchSleeperProjections(s.season, null, [...SEASON_POSITIONS], true));
  const rows = asRows(res.json) ?? [];
  if (!res.ok || !rows.length) {
    p.cl.fail("ADP", "ADP.sleeper.keys", "Sleeper ADP (adp_* on the season projections)", `no rows (HTTP ${res.status})`, ev(res, url, "[]", null));
    p.cl.fail("PROJ", "PROJ.sleeper.season", "Sleeper season projections", `no rows (HTTP ${res.status})`, ev(res, url, "[]", null));
    return;
  }
  await p.saveRaw(`sleeper/projections/${s.season}/season`, res.json, res);
  const ids = new Set(rows.map((r) => r.player_id));
  const byPos = countByPosition(rows);

  // ---- ADP keys: formats (the key names) and how many rows carry a real value in each
  const counts = sleeperAdpKeyCounts(rows);
  s.sleeperAdp.set(s.season, sleeperAdpPairs(rows));
  const real = counts.filter((c) => c.real > 0);
  const none = counts.filter((c) => c.real === 0);
  const sizeKeys = counts.filter((c) => /(^|_)(8|10|12|14|16)(_|$)/.test(c.key.slice(4)));
  p.cl.add(
    "ADP",
    "ADP.sleeper.keys",
    "Sleeper ADP formats (adp_* on the season projections)",
    "warn",
    `${counts.length} adp_* keys on ${rows.length} season rows (${ids.size} players: ${countSummary(byPos)}); a real value (below ${SLEEPER_ADP_NONE}, Sleeper's "none") on: ${real.map((c) => `${c.key} ${c.real} (first ${c.best})`).join(", ") || "none"}${none.length ? `; ${SLEEPER_ADP_NONE} on every row: ${none.map((c) => c.key).join(", ")}` : ""}. Formats by key name (⚠️ the meaning is read from the names: std, half_ppr, ppr, 2qb = superflex, dynasty_*, rookie, idp); ${sizeKeys.length ? `league-size keys: ${sizeKeys.map((c) => c.key).join(", ")}` : "no league-size variant: one list per format"}; no spread (no high, low or deviation per player)`,
    ev(res, url, "[].stats.adp_*", Object.fromEntries(counts.map((c) => [c.key, c.real]))),
  );

  // ---- the first players by adp_ppr (and the same players' other formats)
  const byPpr = rows.filter((r) => realSleeperAdp(r.stats?.adp_ppr)).sort((a, b) => (a.stats!.adp_ppr ?? 0) - (b.stats!.adp_ppr ?? 0));
  const pprByPos = countByPosition(byPpr);
  const formatKeys = ["adp_ppr", "adp_half_ppr", "adp_std", "adp_2qb", "adp_dynasty_2qb", "adp_idp"].filter((k) => counts.some((c) => c.key === k));
  s.samples.push({
    title: `Sleeper: season projections' adp_ppr, ${s.season} (undocumented endpoint)`,
    note: `${sleeperProjectionsUrl(s.season, null, [...SEASON_POSITIONS], { multi: true })}; ${SLEEPER_ADP_NONE} means none in that format; pts_ppr is Sleeper's own PPR total of the season projection`,
    headers: ["#", "Player", "Pos", "Team", ...formatKeys, "pts_ppr"],
    rows: byPpr.slice(0, SAMPLE_ROWS).map((r, i) => [i + 1, sleeperName(r), rowPosition(r), r.team ?? "FA", ...formatKeys.map((k) => fmt(r.stats?.[k], 1)), fmt(r.stats?.pts_ppr, 1)]),
  });
  p.cl.add(
    "ADP",
    "ADP.sleeper.sample",
    "Sleeper adp_ppr: the players it covers",
    byPpr.length >= 200 ? "ok" : "warn",
    `${byPpr.length} players with a real adp_ppr (${countSummary(pprByPos)}; the last at ${fmt(byPpr.at(-1)?.stats?.adp_ppr)}): far deeper than a draft's ${15 * 12} picks; first 5: ${byPpr.slice(0, 5).map((r) => `${sleeperName(r)} ${fmt(r.stats?.adp_ppr)}`).join(", ")} (more in draft.samples.md)`,
    ev(res, url, "[].stats.adp_ppr (smallest first)", byPpr.slice(0, 3).map((r) => ({ player: sleeperName(r), adp_ppr: r.stats?.adp_ppr }))),
  );
  s.lists.push({
    label: `Sleeper adp_ppr ${s.season}`,
    season: s.season,
    entries: byPpr.map((r) => ({ sourceId: r.player_id, canonical: r.player_id, name: sleeperName(r), pos: rowPosition(r), team: r.team ?? null, adp: r.stats!.adp_ppr! })),
  });

  // ---- did the ADP and the projection move since the committed fixture of 2026-09-30 (the season rows' first 40 QBs)?
  const fixture = committedSleeperSeasonFixture();
  if (fixture) {
    const now = new Map(rows.map((r) => [r.player_id, r]));
    let compared = 0;
    let adpSame = 0;
    let ptsSame = 0;
    for (const old of fixture.rows) {
      const cur = now.get(old.player_id);
      const a = old.stats?.adp_ppr;
      const b = cur?.stats?.adp_ppr;
      if (!cur || typeof a !== "number" || typeof b !== "number") continue;
      compared++;
      if (a === b) adpSame++;
      if (old.stats?.pts_ppr === cur.stats?.pts_ppr) ptsSame++;
    }
    s.frozen = { compared, adpSame, ptsSame, captured: fixture.captured };
    p.cl.add(
      "ADP",
      "ADP.sleeper.updates",
      "Sleeper's season rows in season: what still moves",
      "warn",
      compared
        ? `of the ${compared} QBs in the committed fixture of ${fixture.captured} (probe:shared, the season rows' first 40), adp_ppr is the same today on ${adpSame} and pts_ppr on ${ptsSame}: ${adpSame < compared ? "the ADP still moves in season (drafts go on: best ball, late and mock drafts, ⚠️ our reading)" : "the ADP hasn't moved"}, ${ptsSame === compared ? "while the season projection hasn't moved at all" : "and the projection moves too"} (⚠️ one position, 3 weeks)`
        : `no QB of the committed fixture of ${fixture.captured} is in today's rows`,
      { path: "[].stats.adp_ppr, [].stats.pts_ppr", sample: { compared, adpSame, ptsSame }, note: `fixtures/sanitized/shared (label "${fixture.label}")` },
    );
  }

  // ---- the projections themselves
  const projected = rows.filter(hasProjectedStats);
  const withPts = rows.filter((r) => typeof r.stats?.pts_ppr === "number");
  const gpByPos = new Map<string, Set<number>>();
  for (const r of rows) {
    const g = r.stats?.gp;
    if (typeof g !== "number") continue;
    const set = gpByPos.get(rowPosition(r)) ?? new Set<number>();
    set.add(g);
    gpByPos.set(rowPosition(r), set);
  }
  const companies = [...new Set(rows.map((r) => String(r.company ?? "?")))];
  const modified = rows.map((r) => r.last_modified).filter((v): v is number => typeof v === "number");
  const stampSpanS = modified.length ? Math.round((Math.max(...modified) - Math.min(...modified)) / 1000) : null;
  const byPts = [...withPts].sort((a, b) => (b.stats!.pts_ppr ?? 0) - (a.stats!.pts_ppr ?? 0));
  const statKeys = new Set<string>();
  for (const r of projected) for (const k of Object.keys(r.stats ?? {})) if (!/^(adp_|pos_adp_)/.test(k)) statKeys.add(k);
  p.cl.add(
    "PROJ",
    "PROJ.sleeper.season",
    "Sleeper season projections (undocumented endpoint)",
    projected.length >= 300 ? "ok" : "warn",
    `${projected.length} of ${rows.length} rows carry projected stats (${countSummary(countByPosition(projected))}; ${statKeys.size} stat keys: scoreable with any league's rules, CLAUDE.md §5), pts_ppr on ${withPts.length}; the other rows are ADP only; company ${companies.join(", ")} (Sleeper's projections come from that provider); gp ${[...gpByPos].map(([k, v]) => `${k} ${[...v].sort((a, b) => a - b).join("/")}`).join(", ")}; every row's last_modified within ${stampSpanS ?? "?"} s of ${utcStamp(modified.length ? Math.max(...modified) : null)} (rewritten as one batch: ⚠️ read as the daily ADP update, since the projection itself doesn't move, ADP.sleeper.updates); first by pts_ppr: ${byPts.slice(0, 3).map((r) => `${sleeperName(r)} ${fmt(r.stats?.pts_ppr)}`).join(", ")}`,
    ev(res, url, "[].stats, [].company, [].last_modified", { company: companies, stats: [...statKeys].slice(0, 12) }),
  );
  s.samples.push({
    title: `Sleeper: season projections, the first ${SAMPLE_ROWS} by pts_ppr (${s.season})`,
    note: "the season row as served in October; see PROJ.sleeper.span for what it holds",
    headers: ["#", "Player", "Pos", "Team", "pts_ppr", "pts_half_ppr", "pts_std", "gp"],
    rows: byPts.slice(0, SAMPLE_ROWS).map((r, i) => [i + 1, sleeperName(r), rowPosition(r), r.team ?? "FA", fmt(r.stats?.pts_ppr), fmt(r.stats?.pts_half_ppr), fmt(r.stats?.pts_std), fmt(r.stats?.gp, 0)]),
  });
  s.seasonRows = rows;
}

/** Rows carrying projected stats (not just ADP, ranks, Sleeper's own points or games). */
export function hasProjectedStats(r: SleeperStatRow): boolean {
  return Object.keys(r.stats ?? {}).some((k) => !/^(adp_|pos_adp_|pos_rank_|rank_|pts_|gp$|gms_active$)/.test(k));
}

/** Rows by position (a row's own position, rowPosition), largest first. */
export function countByPosition(rows: readonly SleeperStatRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[rowPosition(r)] = (out[rowPosition(r)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a, x], [b, y]) => y - x || a.localeCompare(b)));
}

const countSummary = (c: Record<string, number>) => Object.entries(c).map(([k, v]) => `${k} ${v}`).join(", ");

/** The committed Sleeper season fixture (probe:shared, 2026-09-30), found by its label in the folder's index. */
function committedSleeperSeasonFixture(): { rows: SleeperStatRow[]; captured: string; label: string } | null {
  const dir = path.join(ROOT, "fixtures", "sanitized", "shared");
  try {
    const index = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")) as Record<string, { label?: string; captured?: string }>;
    const hit = Object.entries(index).find(([, e]) => SLEEPER_SEASON_FIXTURE_LABEL.test(e.label ?? ""));
    if (!hit) return null;
    const rows = asRows(JSON.parse(readFileSync(path.join(dir, hit[0]), "utf8")));
    return rows ? { rows, captured: hit[1].captured ?? "?", label: hit[1].label ?? "?" } : null;
  } catch {
    return null;
  }
}

/**
 * What the in-season season row holds: its pts_ppr beside the sums of the same players' weekly pts_ppr (one position,
 * SPAN_POSITION, every week 1–18: 18 requests of a few hundred KB each, cached 6 hours like any projections), read with
 * ADP.sleeper.updates (whether the season row moved since the committed fixture).
 */
const SPAN_POSITION = "QB";
async function sleeperSpan(p: ProbeContext, s: State): Promise<void> {
  const seasonRows = (s.seasonRows ?? []).filter((r) => rowPosition(r) === SPAN_POSITION);
  if (!seasonRows.length) return;
  const weeks = new Map<number, SleeperStatRow[]>();
  const failed: number[] = [];
  for (let w = 1; w <= 18; w++) {
    const res = await p.timed("sleeper", () => fetchSleeperProjections(s.season, w, [SPAN_POSITION]));
    const rows = asRows(res.json);
    if (!res.ok || !rows) failed.push(w);
    else weeks.set(w, rows);
  }
  const span = spanRows(seasonRows, weeks, s.week, 100);
  const ratio = (f: (r: SpanRow) => number) => median(span.filter((r) => f(r) > 0).map((r) => r.season / f(r)));
  const rRest = ratio((r) => r.rest);
  const rAfter = ratio((r) => r.after);
  const rAll = ratio((r) => r.all);
  const near = (x: number | null) => x !== null && Math.abs(x - 1) <= 0.03;
  const frozen = s.frozen && s.frozen.compared > 0 && s.frozen.ptsSame === s.frozen.compared;
  const verdict = near(rAll)
    ? "a full-season total of the weekly rows (weeks 1–18, past weeks as Sleeper serves them now)"
    : near(rRest)
      ? `a rest-of-season total from week ${s.week}`
      : near(rAfter)
        ? `a rest-of-season total after week ${s.week}`
        : frozen
          ? `none of the three sums, and the season row hasn't moved since ${s.frozen!.captured} (ADP.sleeper.updates): a fixed season total, ⚠️ read as the preseason projection, kept all season (gp 18: a full season)`
          : "none of the three sums (it isn't a sum of the weekly rows)";
  const sample = span.slice(0, 3).map((r) => ({ player: r.name, season: round(r.season, 1), weeks1to18: round(r.all, 1), fromWeek: round(r.rest, 1), afterWeek: round(r.after, 1) }));
  p.cl.add(
    "PROJ",
    "PROJ.sleeper.span",
    "Sleeper season row in season: what it holds",
    "warn",
    `${span.length} ${SPAN_POSITION}s with a season pts_ppr of 100+; median season ÷ Σ weekly pts_ppr: weeks 1–18 ${fmt(rAll, 3)}, weeks ${s.week}–18 ${fmt(rRest, 3)}, weeks ${s.week + 1}–18 ${fmt(rAfter, 3)} → ${verdict} (⚠️ derived, one position)${failed.length ? `; weeks not read: ${failed.join(", ")}` : ""}. For a draft (before week 1) the season row is the season-long projection either way`,
    { url: sleeperProjectionsUrl(s.season, 1, [SPAN_POSITION]).replace(`/${s.season}/1?`, `/${s.season}/{week}?`), path: "season [].stats.pts_ppr vs Σ_week [].stats.pts_ppr", sample },
  );
}

/** Last season's and next season's season rows: kept after the season? published before it? */
async function sleeperOtherSeasons(p: ProbeContext, s: State): Promise<void> {
  for (const season of [s.season - 1, s.season + 1]) {
    const url = sleeperProjectionsUrl(season, null, [...SEASON_POSITIONS], { multi: true });
    const res = await p.timed("sleeper", () => fetchSleeperProjections(season, null, [...SEASON_POSITIONS], true));
    const rows = asRows(res.json) ?? [];
    const counts = sleeperAdpKeyCounts(rows);
    const projected = rows.filter(hasProjectedStats);
    const realKeys = counts.filter((c) => c.real > 0);
    if (season > s.season) {
      const ready = projected.length > 0 || realKeys.length > 0;
      p.cl.add(
        "PROJ",
        "PROJ.sleeper.next",
        `Sleeper season projections for ${season} (next season)`,
        ready ? "ok" : "warn",
        ready
          ? `${rows.length} rows, ${projected.length} with projected stats, real ADP in ${realKeys.map((c) => `${c.key} ${c.real}`).join(", ") || "no format"}`
          : `HTTP ${res.status}: ${rows.length} rows (every player, company ${[...new Set(rows.map((r) => String(r.company ?? "?")))].join(", ")}), none with a projected stat or an ADP yet: next season's numbers aren't published in October; when they start isn't knowable now (⚠️ to watch from spring: the mock-draft testing Phase 8 plans for winter and spring needs them)`,
        ev(res, url, "[].stats", { rows: rows.length, projected: projected.length, adpKeys: realKeys.length }),
      );
      continue;
    }
    s.sleeperAdp.set(season, sleeperAdpPairs(rows));
    const withPts = rows.filter((r) => typeof r.stats?.pts_ppr === "number").sort((a, b) => (b.stats!.pts_ppr ?? 0) - (a.stats!.pts_ppr ?? 0));
    const modified = rows.map((r) => r.last_modified).filter((v): v is number => typeof v === "number");
    p.cl.add(
      "PROJ",
      "PROJ.sleeper.previous",
      `Sleeper season projections for ${season} (last season)`,
      rows.length ? "warn" : "fail",
      rows.length
        ? `${rows.length} rows still served, ${projected.length} with projected stats (first by pts_ppr: ${withPts.slice(0, 3).map((r) => `${sleeperName(r)} ${fmt(r.stats?.pts_ppr)}`).join(", ")}); every row last rewritten ${utcStamp(modified.length ? Math.max(...modified) : null)} (the season's end); real ADP in ${realKeys.map((c) => `${c.key} ${c.real}`).join(", ") || "no format"}. ⚠️ If last season's rows were kept the way this season's are (a fixed projection, PROJ.sleeper.span), these are ${season}'s preseason projections beside its last ADP: what a backtest of a draft strategy needs, with ${season}'s stats (unverified: no preseason copy was kept to compare)`
        : `HTTP ${res.status}, no rows: last season's projections aren't kept`,
      ev(res, url, "[].stats.pts_ppr, [].stats.adp_*, [].last_modified", { rows: rows.length, projected: projected.length, adpKeys: realKeys.length }),
    );
    const byPpr = rows.filter((r) => realSleeperAdp(r.stats?.adp_ppr)).sort((a, b) => a.stats!.adp_ppr! - b.stats!.adp_ppr!);
    if (byPpr.length)
      s.lists.push({
        label: `Sleeper adp_ppr ${season}`,
        season,
        entries: byPpr.map((r) => ({ sourceId: r.player_id, canonical: r.player_id, name: sleeperName(r), pos: rowPosition(r), team: r.team ?? null, adp: r.stats!.adp_ppr! })),
      });
  }
}


/** The pinned public test league's drafts: settings, order, picks, the draft's traded picks; and CORS on the two draft endpoints. */
async function sleeperPinnedDraft(p: ProbeContext, s: State): Promise<void> {
  const pinned = pinnedLeagueId(path.join(ROOT, "fixtures", "raw", "sleeper", "fallback-league.json"));
  if (!pinned) {
    for (const [item, key, title] of [
      ["SETUP", "SETUP.sleeper.draft", "Sleeper draft settings and order"],
      ["LIVE", "LIVE.sleeper.picks", "Sleeper draft picks"],
    ] as const)
      p.cl.na(item, key, title, "untested: no pinned public test league (fixtures/raw/sleeper/fallback-league.json, git-ignored; run probe:sleeper -- --live once)");
    return;
  }
  p.redactor.register(pinned, "league-id", "{leagueId}");
  s.leagues.push({ label: "Sleeper: the pinned public test league (Phase 0's)", access: "no login", source: "its drafts list, its draft, the picks and the draft's traded picks" });

  const leagueF = await fetchJson<unknown>(p, endpoints.league(pinned));
  const league = isRecord(leagueF.data) ? leagueF.data : {};
  if (typeof league.name === "string") p.redactor.register(league.name, "league-name", "League 1");
  for (const k of ["previous_league_id", "draft_id"] as const) if (typeof league[k] === "string") p.redactor.register(league[k], k === "draft_id" ? "draft-id" : "league-id", k === "draft_id" ? "{draftId}" : "{previousLeagueId}");
  const leagueSettings = isRecord(league.settings) ? league.settings : {};

  const draftsF = await fetchJson<unknown>(p, endpoints.drafts(pinned));
  const drafts: SleeperDraft[] = [];
  for (const d of Array.isArray(draftsF.data) ? draftsF.data : []) {
    const r = DraftSchema.safeParse(d);
    if (r.success) drafts.push(r.data);
  }
  drafts.forEach((d, i) => registerSleeperDraft(p, d, i === 0 ? "{draftId}" : `{draftId${i + 1}}`));
  if (!drafts.length) {
    p.cl.add("SETUP", "SETUP.sleeper.draft", "Sleeper draft settings and order", draftsF.ok ? "warn" : "fail", draftsF.ok ? "the league lists no draft" : `drafts list failed: ${draftsF.error}`, ev(draftsF.res, draftsF.template, "[]", 0));
    return;
  }
  const latest = drafts[0]!;
  const draftF = await fetchJson<unknown>(p, endpoints.draft(latest.draft_id));
  const parsed = DraftSchema.safeParse(draftF.data);
  const draft = parsed.success ? parsed.data : null;
  if (draft) registerSleeperDraft(p, draft, "{draftId}");
  const picksF = await fetchJson<unknown>(p, endpoints.draftPicks(latest.draft_id));
  const picks: SleeperDraftPick[] = [];
  for (const x of Array.isArray(picksF.data) ? picksF.data : []) {
    const r = DraftPickSchema.safeParse(x);
    if (r.success) picks.push(r.data);
  }
  for (const pk of picks) if (pk.picked_by) p.redactor.register(pk.picked_by, "user-id", (n) => `user-${n}`);
  const tradedF = await fetchJson<unknown>(p, endpoints.draftTradedPicks(latest.draft_id));
  const traded = (Array.isArray(tradedF.data) ? tradedF.data : []).filter((x) => PickSchema.safeParse(x).success);
  await p.saveRaw("sleeper/pinned-league/drafts", draftsF.data, draftsF.res);
  await p.saveRaw("sleeper/pinned-league/draft", draftF.data, draftF.res);
  await p.saveRaw("sleeper/pinned-league/draft/picks", picksF.data, picksF.res);

  // ---- the draft's settings and order (what Phase 8's setup reads from an imported Sleeper league)
  const ds = isRecord(draft?.settings) ? draft.settings : {};
  const slots = Object.fromEntries(Object.entries(ds).filter(([k]) => k.startsWith("slots_")));
  const order = draft?.draft_order ?? null;
  const slotToRoster = draft?.slot_to_roster_id ?? null;
  const md = isRecord(draft?.metadata) ? draft.metadata : {};
  const types = [...new Set(drafts.map((d) => `${d.season} ${d.type} ${d.status}`))];
  p.cl.add(
    "SETUP",
    "SETUP.sleeper.draft",
    "Sleeper draft settings and order (GET /v1/draft/{draftId})",
    draft ? "ok" : "fail",
    draft
      ? `${drafts.length} draft(s) listed (${types.join("; ")}); the latest: type ${draft.type} (the docs' example "snake"; snake, linear and auction are Sleeper's draft types, ⚠️ from the docs and this one draft), status ${draft.status}, ${String(ds.teams ?? "?")} teams, ${String(ds.rounds ?? "?")} rounds, reversal_round ${String(ds.reversal_round ?? "absent")} (3rd-round reversal), pick_timer ${String(ds.pick_timer ?? "?")} s, player_type ${String(ds.player_type ?? "?")}, scoring_type ${String(md.scoring_type ?? "?")}; draft_order maps ${order ? Object.keys(order).length : 0} users to their slots and slot_to_roster_id ${slotToRoster ? Object.keys(slotToRoster).length : 0} slots to rosters (the docs: draft_order is null before the order is set), so a user's draft position is draft_order[user_id]; the league's own settings.draft_rounds ${String(leagueSettings.draft_rounds ?? "?")}; slots_*: ${JSON.stringify(slots)}`
      : `the draft couldn't be read: ${draftF.error ?? "unexpected shape"}`,
    ev(draftF.res, draftF.template, "type, status, settings.{teams,rounds,reversal_round,pick_timer,slots_*}, draft_order, slot_to_roster_id, metadata.scoring_type, start_time, last_picked", { type: draft?.type, status: draft?.status, settings: { teams: ds.teams, rounds: ds.rounds, reversal_round: ds.reversal_round, pick_timer: ds.pick_timer }, draftOrderEntries: order ? Object.keys(order).length : null, slotToRoster }),
    ev(draftsF.res, draftsF.template, "[].{season,type,status}", types),
  );

  // ---- the picks
  const sortedPicks = [...picks].sort((a, b) => a.pick_no - b.pick_no);
  const metaKeys = [...new Set(sortedPicks.flatMap((pk) => Object.keys(pk.metadata ?? {})))].sort();
  const inOrder = sortedPicks.every((pk, i) => pk.pick_no === i + 1);
  const name = (pk: SleeperDraftPick) => {
    const m = pk.metadata ?? {};
    return `${typeof m.first_name === "string" ? m.first_name : ""} ${typeof m.last_name === "string" ? m.last_name : ""}`.trim() || pk.player_id;
  };
  p.cl.add(
    "LIVE",
    "LIVE.sleeper.picks",
    "Sleeper draft picks (GET /v1/draft/{draftId}/picks)",
    picks.length ? "ok" : "fail",
    picks.length
      ? `${picks.length} picks, pick_no 1–${sortedPicks.at(-1)?.pick_no}${inOrder ? " with none missing" : " with gaps"}; each with round, draft_slot, roster_id, picked_by (a user), player_id, is_keeper and metadata {${metaKeys.join(", ")}}: who took whom, in order, without a players DB (a complete draft; picks during a live draft: LIVE.sleeper.live)`
      : `no picks read: ${picksF.error ?? "empty"}`,
    ev(picksF.res, picksF.template, "[].{pick_no,round,draft_slot,roster_id,picked_by,player_id,is_keeper,metadata}", sortedPicks.slice(0, 3).map((pk) => ({ pick_no: pk.pick_no, round: pk.round, draft_slot: pk.draft_slot, player: name(pk), position: pk.metadata?.position, team: pk.metadata?.team }))),
  );
  s.samples.push({
    title: `Sleeper draft picks: the pinned test league's ${latest.season} draft (${draft?.type ?? latest.type}, ${String(ds.rounds ?? "?")} rounds), the first 6`,
    note: "GET https://api.sleeper.app/v1/draft/{draftId}/picks; the league's own draft, a dynasty league's rookie draft",
    headers: ["Pick", "Round", "Slot", "Player", "Pos", "Team"],
    rows: sortedPicks.slice(0, 6).map((pk) => [pk.pick_no, pk.round, pk.draft_slot ?? null, name(pk), String(pk.metadata?.position ?? "?"), String(pk.metadata?.team ?? "?")]),
  });
  p.cl.add(
    "LIVE",
    "LIVE.sleeper.tradedPicks",
    "Sleeper draft traded picks (GET /v1/draft/{draftId}/traded_picks)",
    tradedF.ok ? "ok" : "fail",
    tradedF.ok ? `${traded.length} row(s) {season, round, roster_id (the original team), previous_owner_id, owner_id}: which slot belongs to whom when picks were traded` : `failed: ${tradedF.error}`,
    ev(tradedF.res, tradedF.template, "[].{season,round,roster_id,previous_owner_id,owner_id}", traded.slice(0, 2)),
  );

  // ---- CORS: could each user's browser poll a live draft itself (CLAUDE.md §2.3, "Browser fetching")?
  const cors: Array<{ label: string; shown: string; status: number | null; allowOrigin: string | null; allowed: boolean; error?: string }> = [];
  for (const [label, url, shown] of [
    ["draft", endpoints.draft(latest.draft_id).url, endpoints.draft(latest.draft_id).template],
    ["picks", endpoints.draftPicks(latest.draft_id).url, endpoints.draftPicks(latest.draft_id).template],
  ] as const)
    cors.push({ label, shown, ...(await corsCheck(url, CORS_ORIGIN_ANY)) });
  const allowed = cors.every((c) => c.allowed);
  p.cl.add(
    "LIVE",
    "LIVE.sleeper.cors",
    "Sleeper draft endpoints from a browser (CORS)",
    allowed ? "ok" : "fail",
    `${cors.map((c) => `${c.label}: HTTP ${c.status ?? "—"}, Access-Control-Allow-Origin ${c.allowOrigin ?? "(none)"}`).join("; ")} for Origin ${CORS_ORIGIN_ANY} (a made-up site)${allowed ? ": a page on any site can read them, so each user's own browser can poll a live draft (its requests count against the user's IP, not the server's)" : ""}`,
    ...cors.map((c) => ({ url: c.shown, status: c.status ?? undefined, path: "response header Access-Control-Allow-Origin", sample: c.allowOrigin ?? null })),
  );
  p.cl.add(
    "LIVE",
    "LIVE.sleeper.userDrafts",
    "A user's drafts (GET /v1/user/{user_id}/drafts/nfl/{season})",
    "na",
    "untested: documented (docs.sleeper.com: \"Get All Drafts for User\"), but calling it needs a user id, and every user the pinned league has is a stranger (CLAUDE.md §0.6). With Parker's own username (SLEEPER_USERNAME → /v1/user/{username} → user_id) it would list his drafts, the way Phase 8 finds the draft to follow; whether mock drafts are listed there is unknown",
  );
}

/** Register a Sleeper draft's identities (its id, league, creators, users in the order, name and description). */
function registerSleeperDraft(p: ProbeContext, d: SleeperDraft, placeholder: string): void {
  p.redactor.register(d.draft_id, "draft-id", placeholder);
  if (d.league_id) p.redactor.register(d.league_id, "league-id", "{leagueId}");
  for (const c of d.creators ?? []) p.redactor.register(c, "user-id", (n) => `user-${n}`);
  for (const u of Object.keys(d.draft_order ?? {})) p.redactor.register(u, "user-id", (n) => `user-${n}`);
  const md = isRecord(d.metadata) ? d.metadata : {};
  if (typeof md.name === "string") p.redactor.register(md.name, "league-name", "League 1");
  if (typeof md.description === "string" && md.description.trim()) p.redactor.register(md.description, "free-text", "(description)", { token: md.description.length >= 20 });
  const lastMessage = (d as Record<string, unknown>).last_message_id;
  if (typeof lastMessage === "string" && /^\d{15,20}$/.test(lastMessage)) p.redactor.register(lastMessage, "other-id");
}

/** --sleeper-draft: Parker's own draft (a mock draft, say) read while it runs: the picks twice, LIVE_RECHECK_MS apart. */
async function sleeperOwnDraft(p: ProbeContext, ownDraftId: string | undefined): Promise<void> {
  if (!ownDraftId) {
    p.cl.na(
      "LIVE",
      "LIVE.sleeper.live",
      "Sleeper picks during a live draft",
      "untested: no draft is running in October that the probe may read (the pinned league's is complete; strangers' drafts are off limits, CLAUDE.md §0.6). To check: start a Sleeper mock draft and run npm run probe:draft -- --live --sleeper-draft <its draft id> while it runs (⚠️ until then: picks are expected to appear as they're made, read from the endpoint's design, not seen)",
    );
    return;
  }
  if (!/^\d{5,25}$/.test(ownDraftId)) {
    p.cl.fail("LIVE", "LIVE.sleeper.live", "Sleeper picks during a live draft", "--sleeper-draft takes a Sleeper draft id (digits only); nothing was fetched");
    return;
  }
  p.redactor.register(ownDraftId, "draft-id", "{yourDraftId}");
  const draftUrl = endpoints.draft(ownDraftId);
  const picksUrl = endpoints.draftPicks(ownDraftId);
  // No cache: a live draft changes from one request to the next.
  const read = async () => {
    const d = await p.request(draftUrl.url, { label: "Sleeper /draft/{yourDraftId}", timeoutMs: 30_000 });
    const k = await p.request(picksUrl.url, { label: "Sleeper /draft/{yourDraftId}/picks", timeoutMs: 30_000 });
    const draft = DraftSchema.safeParse(d.json);
    if (draft.success) registerSleeperDraft(p, draft.data, "{yourDraftId}");
    const picks = Array.isArray(k.json) ? k.json.filter((x) => DraftPickSchema.safeParse(x).success) : [];
    for (const x of picks) if (isRecord(x) && typeof x.picked_by === "string") p.redactor.register(x.picked_by, "user-id", (n) => `user-${n}`);
    const rec = isRecord(d.json) ? d.json : {};
    return { status: draft.success ? draft.data.status : `HTTP ${d.status}`, type: draft.success ? draft.data.type : "?", picks: picks.length, lastPicked: typeof rec.last_picked === "number" ? rec.last_picked : null, d, k };
  };
  const first = await read();
  if (first.status !== "drafting") {
    p.cl.add("LIVE", "LIVE.sleeper.live", "Sleeper picks during a live draft", "warn", `your draft reads status ${first.status} (${first.type}), ${first.picks} pick(s): not running now, so nothing could be seen live (run it again while the draft is on the clock)`, ev(first.d, draftUrl.template, "status, last_picked", { status: first.status, picks: first.picks }));
    return;
  }
  await new Promise((r) => setTimeout(r, LIVE_RECHECK_MS));
  const second = await read();
  const grew = second.picks > first.picks;
  p.cl.add(
    "LIVE",
    "LIVE.sleeper.live",
    "Sleeper picks during a live draft",
    grew ? "ok" : "warn",
    `your ${first.type} draft, status ${first.status}: ${first.picks} pick(s), then ${second.picks} ${LIVE_RECHECK_MS / 1000} s later (last_picked ${utcStamp(first.lastPicked)} → ${utcStamp(second.lastPicked)})${grew ? ": picks appear as they're made, so polling the endpoint follows a live draft" : ": no new pick in that time (a slow pick timer, or a paused draft)"}`,
    ev(second.k, picksUrl.template, "[] (length)", { first: first.picks, second: second.picks }),
  );
}

/** One plain GET with an Origin header (a "simple request": no preflight), read for Access-Control-Allow-Origin. */
async function corsCheck(url: string, origin: string): Promise<{ status: number | null; allowOrigin: string | null; allowed: boolean; error?: string }> {
  refuseIfNetworkOff(new URL(url).host); // the offline guard (scripts/lib/runMode.ts): never without --live
  await new Promise((r) => setTimeout(r, 1000)); // after the probes' own requests to the host: a second apart, at least
  try {
    const res = await fetch(url, { headers: { Origin: origin, Accept: "application/json", "User-Agent": "fantasy-trade-finder/0.1 (personal, non-commercial, read-only; CORS check)" }, signal: AbortSignal.timeout(30_000) });
    await res.text();
    const allowOrigin = res.headers.get("access-control-allow-origin");
    const allowed = !!allowOrigin && (allowOrigin.trim() === "*" || allowOrigin.split(",").some((o) => o.trim() === origin));
    return { status: res.status, allowOrigin, allowed };
  } catch (err) {
    return { status: null, allowOrigin: null, allowed: false, error: scrubEverything(err instanceof Error ? err.message : String(err)) };
  }
}

// ---------------------------------------------------------------------------------------------
// ESPN

interface EspnPick {
  overallPickNumber?: number;
  roundId?: number;
  roundPickNumber?: number;
  teamId?: number;
  playerId?: number;
  keeper?: boolean;
  bidAmount?: number;
  autoDraftTypeId?: number;
  nominatingTeamId?: number;
  [k: string]: unknown;
}

/**
 * A pick the crosswalk can't name: ESPN's team units have negative ids, -16000 − proTeamId a D/ST and (⚠️ read from the
 * id range and its lineup slot, 1 = TQB) -15000 − proTeamId a team QB.
 */
export function espnUnnamed(id: number | undefined): string {
  if (id === undefined) return "ESPN player ?";
  if (id < 0) {
    const unit = -id >= 16000 ? "D/ST" : -id >= 15000 ? "team QB" : null;
    const team = unit ? ESPN_PRO_TEAMS[(-id) % 1000] : undefined;
    if (unit && team) return `${team} ${unit} (ESPN id ${id})`;
  }
  return `ESPN player ${id}`;
}

async function espnSection(p: ProbeContext, s: State): Promise<void> {
  // The public test league is named in CLAUDE.md (§2.2), so it isn't registered with the redactor (the leak check would flag the spec); its URLs are shown as templates, as probe-espn.ts does.
  s.leagues.push({ label: "ESPN: the public test league named in CLAUDE.md §2.2", access: "no login (the league is viewable to the public)", source: "view=mDraftDetail with mSettings" });
  const season = s.season;
  const leagueUrl = `${ESPN_BASE}/seasons/${season}/segments/0/leagues/${ESPN_PUBLIC_LEAGUE_ID}?view=mDraftDetail&view=mSettings`;
  const leagueTemplate = `${ESPN_BASE}/seasons/${season}/segments/0/leagues/{publicLeagueId}?view=mDraftDetail&view=mSettings`;
  const res = await p.timed("espn", () => p.request(leagueUrl, { cache: p.leagueCache(leagueUrl), label: "ESPN public test league mDraftDetail+mSettings", timeoutMs: 60_000 }));
  const body = isRecord(res.json) ? res.json : {};
  p.redactor.sweep(body, (v) => (SWID_RE.test(v) ? "swid" : null));
  const settings = isRecord(body.settings) ? body.settings : {};
  if (typeof settings.name === "string") p.redactor.register(settings.name, "league-name", "League 2");
  await p.saveRaw(`espn/public-league/${season}/mDraftDetail`, res.json, res);
  const ds = isRecord(settings.draftSettings) ? settings.draftSettings : {};
  const dd = isRecord(body.draftDetail) ? body.draftDetail : {};
  const picks = (Array.isArray(dd.picks) ? dd.picks : []).filter(isRecord) as EspnPick[];
  const pickOrder = Array.isArray(ds.pickOrder) ? ds.pickOrder : [];
  p.cl.add(
    "SETUP",
    "SETUP.espn.draft",
    "ESPN draft settings (settings.draftSettings, view mSettings)",
    res.ok && Object.keys(ds).length ? "ok" : "fail",
    res.ok && Object.keys(ds).length
      ? `type ${String(ds.type ?? "?")} (snake or auction; ⚠️ the values seen in this league and Parker's), pickOrder of ${pickOrder.length} team ids (the draft order), orderType ${String(ds.orderType ?? "?")}, date ${utcStamp(num(ds.date))}, timePerSelection ${String(ds.timePerSelection ?? "?")} s, keeperCount ${String(ds.keeperCount ?? "?")}, auctionBudget ${String(ds.auctionBudget ?? "?")}: an imported ESPN league gives its draft's type, order and date (a team's position = its place in pickOrder)`
      : `unreadable (HTTP ${res.status})`,
    ev(res, leagueTemplate, "settings.draftSettings.{type,pickOrder,orderType,date,timePerSelection,keeperCount,auctionBudget}", { ...Object.fromEntries(Object.entries(ds).filter(([k]) => k !== "pickOrder")), pickOrder: `${pickOrder.length} team ids` }),
  );
  const pickKeys = [...new Set(picks.flatMap((x) => Object.keys(x)))].filter((k) => k !== "memberId").sort();
  const sorted = [...picks].sort((a, b) => (a.overallPickNumber ?? 0) - (b.overallPickNumber ?? 0));
  const named = (pk: EspnPick) => {
    const canonical = pk.playerId === undefined ? undefined : s.xw?.canonical("espn", String(pk.playerId));
    const f = sleeperFacts(s, canonical);
    return f ? `${f.name}` : espnUnnamed(pk.playerId);
  };
  p.cl.add(
    "LIVE",
    "LIVE.espn.picks",
    "ESPN draft picks (draftDetail, view mDraftDetail)",
    picks.length ? "ok" : res.ok ? "warn" : "fail",
    picks.length
      ? `draftDetail.drafted ${String(dd.drafted)}, inProgress ${String(dd.inProgress)}, completeDate ${utcStamp(num(dd.completeDate))}; ${picks.length} picks with {${pickKeys.join(", ")}} (and memberId, a SWID, left out here): overall and round pick, the team, the ESPN player id (names through the crosswalk), keeper and auction fields. A complete draft; picks during a live ESPN draft: LIVE.espn.live`
      : `no picks (HTTP ${res.status})`,
    ev(res, leagueTemplate, "draftDetail.{drafted,inProgress,completeDate,picks[]}", sorted.slice(0, 3).map((pk) => ({ overallPickNumber: pk.overallPickNumber, roundId: pk.roundId, teamId: pk.teamId, player: named(pk) }))),
  );
  s.samples.push({
    title: `ESPN draft picks: the public test league's ${season} draft (${String(ds.type ?? "?")}), the first 6`,
    note: "view=mDraftDetail; teams by ESPN team id, players named through the crosswalk",
    headers: ["Pick", "Round", "Round pick", "Team id", "Player", "Pos", "Keeper"],
    rows: sorted.slice(0, 6).map((pk) => {
      const f = sleeperFacts(s, pk.playerId === undefined ? undefined : s.xw?.canonical("espn", String(pk.playerId)));
      return [pk.overallPickNumber ?? null, pk.roundId ?? null, pk.roundPickNumber ?? null, pk.teamId ?? null, f?.name ?? espnUnnamed(pk.playerId), f?.pos ?? "?", pk.keeper ? "yes" : "no"];
    }),
  });
  const cors = await corsCheck(leagueUrl, CORS_ORIGIN_APP);
  p.cl.add(
    "LIVE",
    "LIVE.espn.cors",
    "ESPN draft view from a browser (CORS)",
    cors.allowed ? "ok" : "warn",
    `HTTP ${cors.status ?? "—"}, Access-Control-Allow-Origin ${cors.allowOrigin ?? "(none)"} for Origin ${CORS_ORIGIN_APP}${cors.allowed ? ": the app's own site can read a public league's draft from the user's browser (private leagues need the cookies, so the server, CLAUDE.md §3)" : ""}${cors.error ? ` (${cors.error})` : ""}`,
    { url: leagueTemplate, status: cors.status ?? undefined, path: "response header Access-Control-Allow-Origin", sample: cors.allowOrigin },
  );
  p.cl.na(
    "LIVE",
    "LIVE.espn.live",
    "ESPN picks during a live draft",
    "untested: ESPN's drafts run in August and none is running now that the probe may read; ESPN's own draft room uses its own live connection, so whether view=mDraftDetail lists picks while draftDetail.inProgress is true (and how fast) is ⚠️ unknown until a real or mock draft can be watched. Manual entry covers ESPN until then",
  );

  await espnPool(p, s);
}

/** The league-independent player pool: ADP, ESPN's draft ranks and season projections, this season, last season and next. */
async function espnPool(p: ProbeContext, s: State): Promise<void> {
  const filter = espnPoolFilter(ESPN_POOL_LIMIT);
  for (const season of [s.season, s.season - 1, s.season + 1]) {
    const period = season === s.season ? s.week : 1;
    const url = espnLeagueDefaultsUrl(season, period);
    const res = await p.timed("espn", () => fetchEspnLeagueDefaults(season, period, filter));
    const players = espnPlayers(res.json) ?? [];
    const which = season === s.season ? "current" : season < s.season ? "previous" : "next";
    if (which === "next") {
      p.cl.add(
        "ADP",
        "ADP.espn.next",
        `ESPN player pool for ${season} (next season)`,
        players.length ? "ok" : "warn",
        players.length ? `${players.length} players already` : `HTTP ${res.status}${isRecord(res.json) && Array.isArray(res.json.details) ? ` ${JSON.stringify((res.json.details[0] as Record<string, unknown> | undefined)?.type ?? "")}` : ""}: next season isn't open yet; when ESPN opens it (and its ADP and projections) isn't knowable now (⚠️ to watch from spring)`,
        ev(res, url, "players[]", players.length, `X-Fantasy-Filter: espn-api's player-pool filter, limit ${ESPN_POOL_LIMIT}`),
      );
      continue;
    }
    if (!players.length) {
      p.cl.add("ADP", `ADP.espn.${which}`, `ESPN player pool for ${season}`, "fail", `no players (HTTP ${res.status})`, ev(res, url, "players[]", null));
      continue;
    }
    await p.saveRaw(`espn/leaguedefaults/${season}/${period}/pool-${ESPN_POOL_LIMIT}`, res.json, res);
    const rows = players.map((pl) => {
      const { ownership, ranks } = espnDraftFields(pl);
      const id = pl.player?.id;
      const pos = ESPN_DEFAULT_POSITIONS[pl.player?.defaultPositionId ?? -1] ?? "?";
      const team = ESPN_PRO_TEAMS[pl.player?.proTeamId ?? -1] ?? null;
      const seasonProj = findEntry(pl, 1, 0, season, 0);
      return { pl, id, name: pl.player?.fullName ?? String(id), pos: pos === "D/ST" ? "DEF" : pos, team: team === "None" ? null : team, ownership, ranks, seasonProj };
    });
    const adp = rows.filter((r) => typeof r.ownership?.averageDraftPosition === "number" && r.ownership.averageDraftPosition > 0);
    const adpValues = adp.map((r) => r.ownership!.averageDraftPosition!);
    const maxAdp = adpValues.length ? Math.max(...adpValues) : null;
    const atMax = adpValues.filter((v) => v === maxAdp).length;
    const rankTypes = new Map<string, number>();
    for (const r of rows) for (const k of Object.keys(r.ranks)) rankTypes.set(k, (rankTypes.get(k) ?? 0) + 1);
    const ownDates = rows.map((r) => r.ownership?.date).filter((v): v is number => typeof v === "number");
    const leagueTypes = [...new Set(rows.map((r) => r.ownership?.leagueType).filter((v) => v !== undefined))];
    const withProj = rows.filter((r) => r.seasonProj && typeof r.seasonProj.appliedTotal === "number" && Object.keys(r.seasonProj.stats ?? {}).length);
    const byAdp = [...adp].sort((a, b) => a.ownership!.averageDraftPosition! - b.ownership!.averageDraftPosition!);
    if (which === "current") {
      p.cl.add(
        "ADP",
        "ADP.espn.current",
        `ESPN ADP (ownership.averageDraftPosition), ${season}`,
        "warn",
        `${adp.length} of ${rows.length} pool players carry an ADP above 0 (from ${fmt(Math.min(...adpValues))} to ${fmt(maxAdp)}; ${atMax} at that top value${atMax > 1 ? ", ⚠️ read as a placeholder for players hardly drafted" : ""}), with auctionValueAverage; ownership.leagueType ${leagueTypes.join(", ") || "absent"}: ONE ADP per player across ESPN's drafts, no format or league-size variant (⚠️ none seen among the fields). ESPN's own pre-draft ranks, by format: draftRanksByRankType ${[...rankTypes].map(([k, v]) => `${k} ${v}`).join(", ")} (rank and auctionValue per format: rankings, not ADP). ownership.date ${utcStamp(Math.min(...ownDates))} – ${utcStamp(Math.max(...ownDates))} (the block is refreshed daily; whether the ADP itself still moves isn't told)`,
        ev(res, url, "players[].player.ownership.{averageDraftPosition,auctionValueAverage,date,leagueType}, players[].player.draftRanksByRankType", byAdp.slice(0, 3).map((r) => ({ player: r.name, averageDraftPosition: r.ownership?.averageDraftPosition, auctionValueAverage: r.ownership?.auctionValueAverage, ranks: Object.fromEntries(Object.entries(r.ranks).map(([k, v]) => [k, v.rank])) })), `X-Fantasy-Filter: espn-api's player-pool filter (FREEAGENT, WAIVERS, ONTEAM; sorted by percent owned), limit ${ESPN_POOL_LIMIT}`),
      );
      const projTop = [...withProj].sort((a, b) => (b.seasonProj!.appliedTotal ?? 0) - (a.seasonProj!.appliedTotal ?? 0));
      p.cl.add(
        "PROJ",
        "PROJ.espn.season",
        `ESPN season projections (statSourceId 1, statSplitTypeId 0), ${season}`,
        withProj.length >= 300 ? "ok" : "warn",
        `${withProj.length} of ${rows.length} pool players carry one, with ESPN stat ids (scoreable with a league's rules through src/adapters/espn/scoringMap.ts) and appliedTotal (ESPN's default scoring on leaguedefaults: Phase 0, PROJ-E). In season it's the rest-of-season total (Phase 0: projected split 0 = the sum of weeks 4–18 on 452/452 players), so before week 1 it's the full season (⚠️ inferred: no preseason copy has been seen); first by appliedTotal: ${projTop.slice(0, 3).map((r) => `${r.name} ${fmt(r.seasonProj?.appliedTotal)}`).join(", ")}`,
        ev(res, url, `players[].player.stats[statSourceId=1, statSplitTypeId=0, seasonId=${season}].{appliedTotal,stats}`, projTop.slice(0, 3).map((r) => ({ player: r.name, appliedTotal: round(r.seasonProj?.appliedTotal ?? 0, 1), statIds: Object.keys(r.seasonProj?.stats ?? {}).length }))),
      );
      s.samples.push({
        title: `ESPN: ownership.averageDraftPosition, ${season} (the league-independent pool)`,
        note: `${espnLeagueDefaultsUrl(season, period)} with espn-api's player-pool filter; "Rank PPR" and "Rank STD" are ESPN's own pre-draft ranks (draftRanksByRankType); "Season" is ESPN's season projection (appliedTotal, ESPN's default scoring; rest of season in season)`,
        headers: ["#", "Player", "Pos", "Team", "ADP", "Avg $", "Rank PPR", "Rank STD", "Season"],
        rows: byAdp.slice(0, SAMPLE_ROWS).map((r, i) => [i + 1, r.name, r.pos, r.team, fmt(r.ownership?.averageDraftPosition), fmt(r.ownership?.auctionValueAverage), r.ranks.PPR?.rank ?? null, r.ranks.STANDARD?.rank ?? null, fmt(r.seasonProj?.appliedTotal)]),
      });
      const entries: AdpEntry[] = byAdp.map((r) => ({ sourceId: String(r.id), canonical: r.id === undefined ? undefined : s.xw?.canonical("espn", String(r.id)), name: r.name, pos: r.pos, team: r.team, adp: r.ownership!.averageDraftPosition! }));
      s.lists.push({ label: `ESPN ADP ${season}`, season, entries });
      matchRate(p, s, "XWALK.espn", "ESPN ADP → Sleeper ids (crosswalk, by ESPN id)", entries.filter((e) => SKILL_POSITIONS.has(e.pos)));
    } else {
      // Last season: still served? with its ADP and season projections?
      const proj = rows.filter((r) => r.seasonProj);
      const projTotal = proj.filter((r) => typeof r.seasonProj?.appliedTotal === "number" && (r.seasonProj.appliedTotal ?? 0) !== 0);
      const weeklySums = projTotal.slice(0, 50).map((r) => {
        const weekly = (r.pl.player?.stats ?? []).filter((x) => x.statSourceId === 1 && x.statSplitTypeId === 1 && x.seasonId === season).reduce((sum, x) => sum + (x.appliedTotal ?? 0), 0);
        return { name: r.name, split0: r.seasonProj?.appliedTotal ?? 0, weekly };
      });
      const equalWeekly = weeklySums.filter((w) => Math.abs(w.split0 - w.weekly) <= 0.05).length;
      const weeklyLines = projTotal.slice(0, 50).map((r) => (r.pl.player?.stats ?? []).filter((x) => x.statSourceId === 1 && x.statSplitTypeId === 1 && x.seasonId === season).length);
      const distinctAdp = new Set(adpValues).size;
      const placeholder = adp.length > 0 && distinctAdp === 1;
      p.cl.add(
        "ADP",
        "ADP.espn.previous",
        `ESPN player pool for ${season} (last season)`,
        "warn",
        `still served: ${rows.length} players; ADP above 0 on ${adp.length}, ${distinctAdp} distinct value(s) (first: ${byAdp.slice(0, 3).map((r) => `${r.name} ${fmt(r.ownership?.averageDraftPosition)}`).join(", ") || "none"})${placeholder ? `: every player reads the same ${fmt(maxAdp)}, so ESPN doesn't keep last season's ADP (a placeholder, the value a hardly drafted player reads this season, ADP.espn.current; ⚠️ not ❌: Sleeper, Fantasy Football Calculator and MFL keep theirs, ADP.sleeper / ADP.ffc.formats / ADP.mfl.previous)` : ""}; season projections (split 0) on ${proj.length}, a non-zero total on ${projTotal.length}${weeklySums.length ? `; of the first ${weeklySums.length} of those, ${equalWeekly} equal the sum of their ${season} weekly projections (a median of ${fmt(median(weeklyLines), 0)} weekly lines a player in this view): the season line isn't the weeks' sum as served now` : ""} (⚠️ what last season's season projections are, preseason or last update, can't be told; a backtest wants the preseason ones)`,
        ev(res, url, "players[].player.ownership.averageDraftPosition, players[].player.stats[statSourceId=1, statSplitTypeId=0]", { players: rows.length, adp: adp.length, seasonProj: proj.length }),
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Fantasy Football Calculator

function ffcUrl(format: string, teams: number, year: number, position?: string): string {
  const q = new URLSearchParams({ teams: String(teams), year: String(year) });
  if (position) q.set("position", position);
  return `${FFC_API}/${format}?${q.toString()}`;
}

async function ffcGet(p: ProbeContext, url: string, label: string): Promise<{ res: HttpResult | undefined; list: FfcList | null; error?: string }> {
  try {
    const res = await p.timed("ffc", () => p.request(url, { cache: { key: `ffc:${url}`, ttlMs: ADP_TTL_MS, namespace: "draft-ffc" }, cacheIf: (r) => r.status === 200 && parseFfc(r.json) !== null, label, timeoutMs: 60_000 }));
    return { res, list: parseFfc(res.json), error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { res: undefined, list: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** "standard 249 players, 8470 drafts 2025-08-25 – 2025-09-01" (or why there's no list). */
function ffcLine(format: string, got: { list: FfcList | null; error?: string }): string {
  const meta = got.list?.meta ?? {};
  return got.list ? `${format} ${got.list.players.length} players, ${String(meta.total_drafts ?? "?")} drafts ${String(meta.start_date ?? "?")} – ${String(meta.end_date ?? "?")}` : `${format} ✗ (${got.error ?? "not an ADP list"})`;
}

/**
 * Fantasy Football Calculator: the API serves a recent window of drafts (meta.start_date – end_date), so in October this
 * season's lists hold the few drafts of the last weeks; last season's lists are its final week before the season (the
 * draft-season shape), so the formats, the league sizes, the spread and the position filter are checked on those.
 */
async function ffcSection(p: ProbeContext, s: State): Promise<void> {
  setHostGap(FFC_HOST, FFC_GAP_MS);
  const year = s.season;
  const last = year - 1;

  // ---- this season, now: the window in October
  const now = new Map<string, { list: FfcList | null; error?: string; res?: HttpResult }>();
  for (const format of FFC_FORMATS) {
    const got = await ffcGet(p, ffcUrl(format, 12, year), `FFC ADP ${format} 12 teams ${year}`);
    now.set(format, got);
  }
  const nowPpr = now.get("ppr")?.list ?? null;
  p.cl.add(
    "ADP",
    "ADP.ffc.window",
    `Fantasy Football Calculator ADP for ${year}, read in season`,
    "warn",
    `${FFC_FORMATS.map((f) => ffcLine(f, now.get(f) ?? { list: null })).join("; ")}: each list holds the drafts of a recent window (meta.start_date – end_date, a week or so: ⚠️ read from the dates), so in October it's a few dozen mock drafts and short lists; in the draft season the same window holds thousands (${last}'s last week: ADP.ffc.formats)`,
    ev(now.get("ppr")?.res, `${FFC_API}/{format}?teams=12&year=${year}`, "meta.{total_drafts,start_date,end_date}, players[]", nowPpr ? nowPpr.meta : null),
  );

  // ---- last season's final lists: every format at 12 teams
  const prev = new Map<string, { list: FfcList | null; error?: string; res?: HttpResult }>();
  for (const format of FFC_FORMATS) {
    const got = await ffcGet(p, ffcUrl(format, 12, last), `FFC ADP ${format} 12 teams ${last}`);
    prev.set(format, got);
    if (got.list) await p.saveRaw(`ffc/${format}/12/${last}`, got.res?.json, got.res);
  }
  const ok = [...prev.values()].filter((g) => g.list && g.list.players.length > 0).length;
  const ppr = prev.get("ppr")?.list ?? null;
  const metaKeys = Object.keys(ppr?.meta ?? {}).sort();
  const fields = [...new Set((ppr?.players ?? []).flatMap((x) => Object.keys(x)))].sort();
  p.cl.add(
    "ADP",
    "ADP.ffc.formats",
    `Fantasy Football Calculator ADP by format (12 teams, ${last}'s final lists)`,
    ok === FFC_FORMATS.length ? "ok" : ok ? "warn" : "fail",
    `${ok}/${FFC_FORMATS.length} formats answer with players: ${FFC_FORMATS.map((f) => ffcLine(f, prev.get(f) ?? { list: null })).join("; ")}. meta {${metaKeys.join(", ")}}; each player {${fields.join(", ")}} (Fantasy Football Calculator's own player_id: names and teams, no id the crosswalk knows)`,
    ev(prev.get("ppr")?.res, `${FFC_API}/{format}?teams=12&year=${last}`, "meta, players[]", ppr ? { meta: ppr.meta, first: ppr.players[0] } : null),
  );

  // ---- league sizes (PPR), last season
  const sizes: string[] = [];
  const lists = new Map<number, FfcList>();
  for (const teams of FFC_TEAM_SIZES) {
    const list = teams === 12 ? ppr : (await ffcGet(p, ffcUrl("ppr", teams, last), `FFC ADP ppr ${teams} teams ${last}`)).list;
    if (!list) {
      sizes.push(`${teams} ✗`);
      continue;
    }
    lists.set(teams, list);
    sizes.push(`${teams} teams: ${list.players.length} players, ${String(list.meta?.total_drafts ?? "?")} drafts (meta.teams ${String(list.meta?.teams ?? "?")})`);
  }
  const twelve = lists.get(12);
  const diffs = [...lists].filter(([t]) => t !== 12).map(([t, l]) => {
    const a = agreementOf({ label: "12", entries: ffcEntries(twelve?.players ?? []) }, { label: String(t), entries: ffcEntries(l.players) }, 150);
    return `${t} vs 12: Spearman ${fmt(a.rho, 3)} over ${a.common} players, median gap ${fmt(a.medianGap, 1)} picks`;
  });
  const drafts = [...lists.values()].map((l) => String(l.meta?.total_drafts ?? "?"));
  const distinctDrafts = new Set(drafts).size;
  p.cl.add(
    "ADP",
    "ADP.ffc.teams",
    `Fantasy Football Calculator ADP by league size (PPR, ${last})`,
    lists.size === FFC_TEAM_SIZES.length && distinctDrafts === lists.size ? "ok" : lists.size ? "warn" : "fail",
    `${sizes.join("; ")}; ${diffs.join("; ")}${distinctDrafts === lists.size ? ": each size has its own drafts, so a list per league size (✅ by the draft counts)" : ": the teams parameter doesn't change the list (the same drafts in the same order for every size; the first run, on this season's October window, saw the same: meta.teams echoed 8, 10, 12 and 14 over one list of 109 drafts), so in practice one list per format whatever the league size (⚠️ the help article names a teams parameter but not its values; Fantasy Football Calculator's site may still split by size)"}`,
    { url: `${FFC_API}/ppr?teams={8|10|12|14}&year=${last}`, path: "meta.teams, meta.total_drafts, players[].adp", sample: sizes },
  );

  // ---- the spread behind each ADP (what "the chance he lasts to my pick" needs)
  const pl = ppr?.players ?? [];
  const withSpread = pl.filter((x) => typeof x.stdev === "number" && typeof x.high === "number" && typeof x.low === "number");
  p.cl.add(
    "ADP",
    "ADP.ffc.spread",
    "Fantasy Football Calculator: each ADP's spread (stdev, high, low, times_drafted)",
    pl.length && withSpread.length === pl.length ? "ok" : withSpread.length ? "warn" : "fail",
    `${withSpread.length}/${pl.length} players (PPR, 12 teams, ${last}) carry stdev, high and low; e.g. ${pl.slice(0, 2).map((x) => `${x.name} ${x.adp} ± ${x.stdev} (picks ${x.high}–${x.low}, drafted ${x.times_drafted ?? "?"} times)`).join("; ")}; at pick 50: ${pl.filter((x) => x.adp >= 48 && x.adp <= 52).slice(0, 2).map((x) => `${x.name} ${x.adp} ± ${x.stdev} (${x.high}–${x.low})`).join("; ")}: enough for a pick distribution per player (the chance he's still there at a later pick; ⚠️ a normal around the ADP is our reading, not the source's)`,
    ev(prev.get("ppr")?.res, ffcUrl("ppr", 12, last), "players[].{adp,stdev,high,low,times_drafted}", pl.slice(0, 2).map((x) => ({ name: x.name, adp: x.adp, stdev: x.stdev, high: x.high, low: x.low, times_drafted: x.times_drafted }))),
  );
  s.samples.push({
    title: `Fantasy Football Calculator: PPR, 12 teams, ${last} (the final week before the season)`,
    note: `${ffcUrl("ppr", 12, last)}; ${String(ppr?.meta?.total_drafts ?? "?")} drafts from ${String(ppr?.meta?.start_date ?? "?")} to ${String(ppr?.meta?.end_date ?? "?")}; "High" and "Low" are the earliest and latest picks seen. Teams are as of then`,
    headers: ["#", "Player", "Pos", "Team", "ADP", "Stdev", "High", "Low", "Times drafted", "Bye"],
    rows: pl.slice(0, SAMPLE_ROWS).map((x, i) => [i + 1, x.name, ffcPosition(x.position), x.team ?? null, x.adp, x.stdev ?? null, x.high ?? null, x.low ?? null, x.times_drafted ?? null, x.bye ?? null]),
  });
  if (nowPpr)
    s.samples.push({
      title: `Fantasy Football Calculator: PPR, 12 teams, ${year}, read in October (the recent window)`,
      note: `${ffcUrl("ppr", 12, year)}; ${String(nowPpr.meta?.total_drafts ?? "?")} drafts from ${String(nowPpr.meta?.start_date ?? "?")} to ${String(nowPpr.meta?.end_date ?? "?")}`,
      headers: ["#", "Player", "Pos", "Team", "ADP", "Stdev", "Times drafted"],
      rows: nowPpr.players.slice(0, 6).map((x, i) => [i + 1, x.name, ffcPosition(x.position), x.team ?? null, x.adp, x.stdev ?? null, x.times_drafted ?? null]),
    });

  // ---- the position filter (documented)
  const rb = await ffcGet(p, ffcUrl("ppr", 12, last, "RB"), `FFC ADP ppr 12 teams ${last} position RB`);
  const rbPositions = [...new Set((rb.list?.players ?? []).map((x) => ffcPosition(x.position)))];
  p.cl.add(
    "ADP",
    "ADP.ffc.position",
    "Fantasy Football Calculator: the documented position parameter",
    rb.list ? (rbPositions.length === 1 && rbPositions[0] === "RB" ? "ok" : "warn") : "fail",
    rb.list ? `position=RB → ${rb.list.players.length} players, positions ${rbPositions.join(", ")}${rbPositions.length === 1 && rbPositions[0] === "RB" ? " (it filters)" : " (it doesn't filter: filter players[].position)"}` : `no list (${rb.error ?? "?"})`,
    ev(rb.res, ffcUrl("ppr", 12, last, "RB"), "players[].position", rbPositions),
  );

  // ---- player names → Sleeper ids (no id the crosswalk knows): this season's list has today's teams
  const toEntries = (list: FfcList | null): AdpEntry[] =>
    (list?.players ?? []).map((x) => {
      const pos = ffcPosition(x.position);
      const team = x.team && x.team !== "FA" ? x.team : null;
      const canonical = pos === "DEF" ? (team ? s.xw?.defenseId(team) : undefined) : s.xw?.matchByName?.({ name: x.name, position: pos, team });
      return { sourceId: x.player_id, canonical, name: x.name, pos, team, adp: x.adp };
    });
  const nowEntries = toEntries(nowPpr);
  const prevEntries = toEntries(ppr);
  if (nowEntries.length) s.lists.push({ label: `FFC PPR 12 ${year}`, season: year, entries: nowEntries });
  if (prevEntries.length) s.lists.push({ label: `FFC PPR 12 ${last}`, season: last, entries: prevEntries });
  matchRate(p, s, "XWALK.ffc", `Fantasy Football Calculator ${year} → Sleeper ids (by name, position and today's NFL team)`, nowEntries.filter((e) => SKILL_POSITIONS.has(e.pos)));
  matchRate(p, s, "XWALK.ffc.previous", `Fantasy Football Calculator ${last} → Sleeper ids (by name, position and ${last}'s team: players who moved since don't match)`, prevEntries.filter((e) => SKILL_POSITIONS.has(e.pos)), false, "warn");

  // ---- the docs and terms still say what reports/draft-data.md quotes (a drift check; the quotes come from there)
  const docs = await p.timed("ffc", () => fetchText(FFC_DOCS_URL, "docs", TTL.docs, "FFC ADP REST API help article"));
  const docText = htmlToText(docs.text);
  const phrases = ["Use of the ADP REST API is free for personal and commercial use.", "Fantasy Football Calculator requests that you provide attribution back to us in the form of a link or mention of some kind.", "Please do not call this API too frequently.", "The data only updates once per day."];
  const found = phrases.filter((ph) => docHas(docText, ph));
  p.cl.add(
    "DOCS",
    "DOCS.ffc",
    "Fantasy Football Calculator's ADP API page: terms",
    found.length === phrases.length ? "ok" : docs.ok ? "warn" : "fail",
    `${found.length}/${phrases.length} sentences found verbatim${found.length < phrases.length ? `; missing: ${phrases.filter((ph) => !found.includes(ph)).map((ph) => `"${ph}"`).join(", ")}` : ""}: free for personal and commercial use, attribution asked for (a link or a mention), not too often, data updated once a day`,
    ev(docs, FFC_DOCS_URL, "page text", found.map((ph) => ph.slice(0, 60))),
  );
}

/** A Fantasy Football Calculator list as AdpEntry rows keyed by its own ids (for comparing its lists with each other). */
function ffcEntries(players: readonly FfcPlayer[]): AdpEntry[] {
  return players.map((x) => ({ sourceId: x.player_id, canonical: x.player_id, name: x.name, pos: ffcPosition(x.position), team: x.team ?? null, adp: x.adp }));
}

// ---------------------------------------------------------------------------------------------
// MFL

interface MflVariant {
  key: string;
  title: string;
  params: Record<string, string | number>;
}

/**
 * This season's lists. api_info: PERIOD "returns draft data for just drafts that started after the specified period. Valid
 * values are ALL, RECENT, DRAFT, JUNE, JULY, AUG1, AUG15, START, MID, PLAYOFF." The default (no PERIOD) is read here too:
 * in October it holds next to no drafts (the first run's 0 players from 1 draft), so the others ask PERIOD=ALL.
 */
const MFL_VARIANTS: readonly MflVariant[] = [
  { key: "default", title: "no filter, no PERIOD (MFL's default window)", params: {} },
  { key: "all", title: "every league and draft since June (PERIOD=ALL)", params: { PERIOD: "ALL" } },
  { key: "12-ppr-redraft", title: "12 teams, PPR, redraft, real drafts (PERIOD=ALL)", params: { PERIOD: "ALL", FCOUNT: 12, IS_PPR: 1, IS_KEEPER: "N", IS_MOCK: 0 } },
  { key: "10-std-redraft", title: "10 teams, non-PPR, redraft, real drafts (PERIOD=ALL)", params: { PERIOD: "ALL", FCOUNT: 10, IS_PPR: 0, IS_KEEPER: "N", IS_MOCK: 0 } },
  { key: "mock", title: "mock drafts only (PERIOD=ALL)", params: { PERIOD: "ALL", IS_MOCK: 1 } },
];

/** Last season's lists (api_info: PERIOD "is not valid for previous seasons"): the whole season's drafts. */
const MFL_PREVIOUS_VARIANTS: readonly MflVariant[] = [
  { key: "12-ppr-redraft", title: "12 teams, PPR, redraft, real drafts", params: { FCOUNT: 12, IS_PPR: 1, IS_KEEPER: "N", IS_MOCK: 0 } },
  // The review of Checkpoint 7h: the league size alone (against 12-ppr-redraft), then the scoring alone (against 10-std-redraft).
  { key: "10-ppr-redraft", title: "10 teams, PPR, redraft, real drafts", params: { FCOUNT: 10, IS_PPR: 1, IS_KEEPER: "N", IS_MOCK: 0 } },
  { key: "10-std-redraft", title: "10 teams, non-PPR, redraft, real drafts", params: { FCOUNT: 10, IS_PPR: 0, IS_KEEPER: "N", IS_MOCK: 0 } },
];

interface MflGot {
  call: MflCall | null;
  adp: MflAdp | null;
  error?: string;
}

async function mflVariants(p: ProbeContext, mfl: MflClient, variants: readonly MflVariant[]): Promise<Map<string, MflGot>> {
  const got = new Map<string, MflGot>();
  for (const v of variants) {
    try {
      const call = await p.timed("mfl", () => mfl.export("adp", v.params, { ttlMs: ADP_TTL_MS, namespace: "draft-mfl", label: `MFL adp ${mfl.year} ${v.key}` }));
      got.set(v.key, { call, adp: call.error ? null : parseMflAdp(call.rawJson), error: call.error ?? (call.res.ok ? undefined : `HTTP ${call.res.status}`) });
      if (!call.error) await p.saveRaw(`mfl/adp/${mfl.year}/${v.key}`, call.rawJson, call.res);
    } catch (err) {
      got.set(v.key, { call: null, adp: null, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return got;
}

function mflDescribe(v: MflVariant, g: MflGot | undefined): string {
  return g?.adp ? `${v.title}: ${g.adp.players.length} players from ${g.adp.totalDrafts ?? "?"} drafts` : `${v.title}: ✗ (${g?.error ?? "not an ADP list"})`;
}

function mflEvidence(year: number, variants: readonly MflVariant[], got: Map<string, MflGot>): Evidence[] {
  return variants.map((v) => {
    const g = got.get(v.key);
    return { url: g?.call?.template ?? `https://api.myfantasyleague.com/${year}/export?TYPE=adp`, status: g?.call?.res.status, path: "adp.{totalDrafts,timestamp,player[]}", sample: g?.adp ? { players: g.adp.players.length, totalDrafts: g.adp.totalDrafts, first: g.adp.players[0] ? { id: g.adp.players[0].id, averagePick: g.adp.players[0].averagePick } : null } : null };
  });
}

/** MFL's team units (team defenses and the like): four-digit ids starting with 0 (⚠️ read from the ids seen, 0501–0532 and 0716). */
export function isMflTeamUnit(id: string): boolean {
  return /^0\d{3}$/.test(id);
}

function mflEntries(s: State, adp: MflAdp): AdpEntry[] {
  return adp.players.map((x) => {
    const canonical = s.xw?.canonical("mfl", x.id);
    const f = sleeperFacts(s, canonical);
    return { sourceId: x.id, canonical, name: f?.name ?? `MFL player ${x.id}`, pos: f?.pos ?? "?", team: f?.team ?? null, adp: x.averagePick };
  });
}

async function mflSection(p: ProbeContext, s: State): Promise<void> {
  const mfl = new MflClient(s.season);
  const last = s.season - 1;
  const mflPrev = new MflClient(last);

  // ---- this season: the default window, then PERIOD=ALL with the filters
  const got = await mflVariants(p, mfl, MFL_VARIANTS);
  const answered = MFL_VARIANTS.filter((v) => v.key !== "default" && got.get(v.key)?.adp?.players.length).length;
  const ref = (got.get("12-ppr-redraft")?.adp ?? got.get("all")?.adp ?? got.get("default")?.adp) || null;
  const fields = [...new Set(ref?.players.flatMap((x) => x.fields) ?? [])].sort();
  p.cl.add(
    "ADP",
    "ADP.mfl.export",
    `MFL ADP export (TYPE=adp), ${s.season}`,
    answered === MFL_VARIANTS.length - 1 ? "ok" : answered ? "warn" : "fail",
    `${MFL_VARIANTS.map((v) => mflDescribe(v, got.get(v.key))).join("; ")}. The list {${(ref?.fields ?? []).join(", ")}}, each player {${fields.join(", ") || "none"}} (an MFL player id; names and Sleeper ids through the crosswalk); updated ${utcStamp(ref?.updatedMs ?? null)}. Filters (api_info): FCOUNT 8/10/12/14/16 teams, IS_PPR, IS_KEEPER (N redraft, K keeper, R rookie), IS_MOCK, PERIOD (ALL, RECENT, DRAFT, JUNE, JULY, AUG1, AUG15, START, MID, PLAYOFF; "not valid for previous seasons"), CUTOFF, DETAILS`,
    ...mflEvidence(s.season, MFL_VARIANTS, got),
  );

  // MFL's rule ("check for the 429 status and if you get it, cool things down a bit"): a 429 on either season's client stops
  // the other too (each keeps its own flag: the review of Checkpoint 7h).
  const coolDown = (): void => {
    if (mfl.throttled || mflPrev.throttled) mfl.throttled = mflPrev.throttled = true;
  };
  coolDown();

  // ---- last season: the draft season's shape, and whether each filter alone splits the list
  const prev = await mflVariants(p, mflPrev, MFL_PREVIOUS_VARIANTS);
  coolDown();
  const a = prev.get("12-ppr-redraft")?.adp ?? null;
  const c = prev.get("10-ppr-redraft")?.adp ?? null;
  const b = prev.get("10-std-redraft")?.adp ?? null;
  p.cl.add(
    "ADP",
    "ADP.mfl.previous",
    `MFL ADP export for ${last} (last season, the whole season's drafts)`,
    a?.players.length && b?.players.length && c?.players.length ? "ok" : a?.players.length || b?.players.length || c?.players.length ? "warn" : "fail",
    `${MFL_PREVIOUS_VARIANTS.map((v) => mflDescribe(v, prev.get(v.key))).join("; ")}; updated ${utcStamp(a?.updatedMs ?? b?.updatedMs ?? null)}: past seasons stay available (a backtest of a draft strategy can use them)`,
    ...mflEvidence(last, MFL_PREVIOUS_VARIANTS, prev),
  );
  // One filter changed at a time (the review of Checkpoint 7h: the first run compared 12-team PPR with 10-team non-PPR, both at
  // once, so the league size's effect couldn't be told from the scoring's).
  const pair = (key: string, label: string, x: MflAdp | null, xLabel: string, y: MflAdp | null, yLabel: string, alone: string): void => {
    if (!x?.players.length || !y?.players.length) {
      p.cl.warn("ADP", key, label, `${xLabel} or ${yLabel} didn't answer: not compared (api_info documents ${alone})`);
      return;
    }
    const ag = agreementOf({ label: xLabel, entries: mflEntries(s, x) }, { label: yLabel, entries: mflEntries(s, y) }, 150);
    const firstX = x.players.slice(0, 30).map((q) => q.id).join(",");
    const firstY = y.players.slice(0, 30).map((q) => q.id).join(",");
    const differ = firstX !== firstY && x.totalDrafts !== y.totalDrafts;
    p.cl.add(
      "ADP",
      key,
      label,
      differ ? "ok" : "warn",
      `${xLabel}: ${x.totalDrafts ?? "?"} drafts; ${yLabel}: ${y.totalDrafts ?? "?"} drafts (only ${alone} changed); their first 30 players ${firstX === firstY ? "are the same in the same order" : "differ"}; over the first 150, Spearman ${fmt(ag.rho, 3)} on ${ag.common} players, median gap ${fmt(ag.medianGap, 1)} picks${differ ? `: ${alone} splits the list` : `: ⚠️ ${alone} doesn't visibly split the list`}`,
      { path: "adp.totalDrafts, adp.player[].id", sample: { [xLabel]: x.totalDrafts, [yLabel]: y.totalDrafts, rho: ag.rho === null ? null : round(ag.rho, 3) } },
    );
  };
  pair("ADP.mfl.size", `MFL ADP by league size (FCOUNT alone, ${last})`, a, "12-team PPR redraft", c, "10-team PPR redraft", "the league size (FCOUNT)");
  pair("ADP.mfl.ppr", `MFL ADP by scoring (IS_PPR alone, ${last})`, c, "10-team PPR redraft", b, "10-team non-PPR redraft", "the scoring (IS_PPR)");
  p.cl.add(
    "ADP",
    "ADP.mfl.keeper",
    "MFL ADP for keeper and rookie drafts (IS_KEEPER)",
    "warn",
    "api_info documents IS_KEEPER N (redraft), K (keeper) and R (rookie); only N was asked for (⚠️ documented, not checked with data)",
  );

  // ---- this season's 12-team PPR list (if MFL has one now), and last season's, for the samples, match rates and agreement
  const now = got.get("12-ppr-redraft")?.adp;
  for (const [season, list] of [[s.season, now], [last, a]] as const) {
    if (!list?.players.length) continue;
    const entries = mflEntries(s, list);
    s.lists.push({ label: `MFL 12 PPR redraft ${season}`, season, entries });
    s.samples.push({
      title: `MFL: 12 teams, PPR, redraft, real drafts (${season})`,
      note: `https://api.myfantasyleague.com/${season}/export?TYPE=adp${season === s.season ? "&PERIOD=ALL" : ""}&FCOUNT=12&IS_PPR=1&IS_KEEPER=N&IS_MOCK=0&JSON=1; ${list.totalDrafts ?? "?"} drafts; names through the crosswalk (today's teams)`,
      headers: ["#", "Player", "Pos", "Team", "Avg pick", "Min", "Max", "Drafts"],
      rows: entries.slice(0, SAMPLE_ROWS).map((e, i) => [i + 1, e.name, e.pos, e.team, list.players[i]?.averagePick ?? null, list.players[i]?.minPick ?? null, list.players[i]?.maxPick ?? null, list.players[i]?.draftsSelectedIn ?? null]),
    });
    // The crosswalk's own position (an MFL id carries none): every position but MFL's team units, which the crosswalk's
    // id maps don't list (the app maps team defenses by NFL team code).
    const top = [...entries].sort((x, y) => x.adp - y.adp).slice(0, TOP_N);
    const units = top.filter((e) => isMflTeamUnit(e.sourceId));
    matchRate(p, s, season === s.season ? "XWALK.mfl" : "XWALK.mfl.previous", `MFL ADP ${season} → Sleeper ids (crosswalk, by MFL id; ${units.length} MFL team units among the first ${top.length} left out: ids ${units.map((e) => e.sourceId).sort().join(", ") || "none"}, ⚠️ read as team defenses from MFL's id range, which need MFL's players export for their NFL team)`, top.filter((e) => !isMflTeamUnit(e.sourceId)), true, "warn");
  }

  // ---- 1QB or superflex: api_info's adp export has no QB-count filter (the review of Checkpoint 7h)
  const leans = ([[s.season, now], [last, a]] as const).flatMap(([season, list]) => {
    const sleeper = s.sleeperAdp.get(season);
    return list?.players.length && sleeper ? [{ season, leans: qbLeans(mflEntries(s, list), sleeper) }] : [];
  });
  if (leans.length) {
    const lean = (x: QbLean) => `${x.name} ${fmt(x.adp, 1)} (1QB ${fmt(x.ppr, 1)}, superflex ${fmt(x.twoQb, 1)})`;
    p.cl.add(
      "ADP",
      "ADP.mfl.qb",
      "MFL ADP: 1QB or superflex leagues (no QB-count filter)",
      "warn",
      `api_info's adp export filters by PERIOD, FCOUNT, IS_PPR, IS_KEEPER, IS_MOCK, CUTOFF and DETAILS: none by QB count, so a list mixes 1QB and superflex leagues. Of the first QBs on its 12-team PPR redraft list, ${leans.map((l) => `${l.season}: ${l.leans.filter((x) => x.closerTo2qb).length} of ${l.leans.length} sit closer to Sleeper's superflex ADP (adp_2qb) than to its 1QB ADP (adp_ppr), the first ${l.leans.slice(0, 2).map(lean).join(" and ")}`).join("; ")}. ⚠️ Not a 1QB list: its QBs go far earlier than in 1QB leagues`,
      { path: "adp.player[] (QBs, positions from the crosswalk) against Sleeper's stats.adp_ppr and stats.adp_2qb", sample: leans.map((l) => ({ season: l.season, compared: l.leans.length, closerTo2qb: l.leans.filter((x) => x.closerTo2qb).length })) },
    );
  }

  // ---- auction values
  coolDown();
  try {
    const call = await p.timed("mfl", () => mfl.export("aav", {}, { ttlMs: ADP_TTL_MS, namespace: "draft-mfl", label: "MFL aav" }));
    const aav = call.error ? null : parseMflAav(call.rawJson);
    p.cl.add(
      "ADP",
      "ADP.mfl.aav",
      "MFL average auction values (TYPE=aav)",
      aav?.players.length ? "ok" : "warn",
      aav?.players.length ? `${aav.players.length} players {${[...new Set(aav.players.flatMap((x) => x.fields))].sort().join(", ")}}, list {${aav.fields.join(", ")}} (api_info: relative to an auction with $1,000 in all; for auction drafts, which come later)` : `no list (${call.error ?? `HTTP ${call.res.status}`})`,
      { url: call.template, status: call.res.status, path: "aav.player[].{id,averageValue}", sample: aav?.players.slice(0, 2) ?? null },
    );
  } catch (err) {
    p.cl.fail("ADP", "ADP.mfl.aav", "MFL average auction values (TYPE=aav)", err instanceof Error ? err.message : String(err));
  }

  // ---- api_info: the adp export's documentation, and the rules
  try {
    const ref = htmlToText((await mfl.page(MFL_DOCS.reference)).text);
    const block = typeBlock(ref, "adp", true) ?? "";
    const params = ["PERIOD", "FCOUNT", "IS_PPR", "IS_KEEPER", "IS_MOCK", "CUTOFF", "DETAILS"].filter((x) => block.includes(x));
    const general = htmlToText((await mfl.page(MFL_DOCS.general)).text);
    const rules = ["Harvesting league and/or user data", "Wait one second between making requests", "If a request fails, don't retry", "Accessing the API via Javascript from web pages outside the myfantasyleague.com domain"].filter((ph) => docHas(general, ph));
    p.cl.add(
      "DOCS",
      "DOCS.mfl",
      "MFL api_info: the adp export and the API's rules",
      params.length === 7 && rules.length === 4 ? "ok" : "warn",
      `TYPE=adp documents ${params.length}/7 parameters (${params.join(", ")}); the rules page still lists ${rules.length}/4 of the lines reports/draft-data.md quotes (no harvesting of league or user data, a second between requests, no retries, no browser JavaScript from other sites: so MFL's ADP is read on the server, once a day)`,
      { url: MFL_DOCS.reference, path: "Request Reference: adp", sample: block.slice(0, 160) },
      { url: MFL_DOCS.general, path: "General Rules and Terms of Service", sample: rules },
    );
  } catch (err) {
    p.cl.warn("DOCS", "DOCS.mfl", "MFL api_info: the adp export and the API's rules", `couldn't be read: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// DynastyProcess

/** A CSV's header and its rows' count, and the distinct values of a few columns (the files are a few MB at most). */
export function csvSummary(textBody: string, columns: readonly string[]): { header: string[]; rows: number; values: Record<string, string[]> } {
  const lines = textBody.split(/\r?\n/).filter((l) => l.trim());
  const split = (l: string) => l.split(",").map((c) => c.replace(/^"|"$/g, ""));
  const header = split(lines[0] ?? "");
  const values: Record<string, string[]> = {};
  for (const c of columns) {
    const i = header.indexOf(c);
    if (i < 0) continue;
    const seen = new Set<string>();
    for (const l of lines.slice(1)) {
      const v = split(l)[i];
      if (v !== undefined && seen.size < 40) seen.add(v);
    }
    values[c] = [...seen].sort();
  }
  return { header, rows: Math.max(0, lines.length - 1), values };
}

async function dynastyProcessSection(p: ProbeContext): Promise<void> {
  const values = await p.timed("dynastyprocess", () => fetchText(DP_VALUES_URL, "draft-dp", ADP_TTL_MS, "DynastyProcess values.csv"));
  const vs = csvSummary(values.text, ["scrape_date"]);
  const ecr = await p.timed("dynastyprocess", () => fetchText(DP_ECR_URL, "draft-dp", ADP_TTL_MS, "DynastyProcess db_fpecr_latest.csv"));
  const es = csvSummary(ecr.text, ["fp_page", "page_type", "ecr_type", "scrape_date"]);
  const adpColumns = [...vs.header, ...es.header].filter((c) => /adp/i.test(c));
  p.cl.add(
    "ADP",
    "ADP.dynastyprocess",
    "DynastyProcess data (GPL-3.0): values and FantasyPros' consensus ranks",
    "warn",
    `values.csv (HTTP ${values.status}): ${vs.rows} rows {${vs.header.join(", ")}}, scrape_date ${(vs.values.scrape_date ?? []).join(", ") || "?"}: dynasty and redraft values with expert ranks (ecr_*), no ADP. db_fpecr_latest.csv (HTTP ${ecr.status}): ${es.rows} rows {${es.header.join(", ")}}; ecr_type ${(es.values.ecr_type ?? []).join(", ") || "?"}, page_type ${(es.values.page_type ?? []).join(", ") || "?"}: FantasyPros' expert consensus rankings, re-published weekly${adpColumns.length ? `; ADP-like columns: ${adpColumns.join(", ")}` : "; no ADP column"}. ⚠️ Not a source for us: expert ranks are not ADP, and FantasyPros' own terms (reports/draft-data.md) don't let others reuse its data, whatever the repository's license`,
    { url: DP_VALUES_URL, status: values.status, path: "CSV header", sample: vs.header.slice(0, 12) },
    { url: DP_ECR_URL, status: ecr.status, path: "CSV header; fp_page, ecr_type", sample: { header: es.header.slice(0, 14), fp_page: (es.values.fp_page ?? []).slice(0, 8) } },
  );
}

// ---------------------------------------------------------------------------------------------
// Match rates, agreement, docs-only sources, samples

/** The share of a list's first TOP_N players with a Sleeper id. `allPositions`: an MFL list, whose positions come from the crosswalk. */
function matchRate(p: ProbeContext, s: State, key: string, title: string, entries: readonly AdpEntry[], allPositions = false, lowLevel: "warn" | "fail" = "fail"): void {
  if (!s.xw) {
    p.cl.na("XWALK", key, title, "untested: no crosswalk (XWALK.sources)");
    return;
  }
  const top = [...entries].sort((a, b) => a.adp - b.adp).slice(0, TOP_N);
  const mapped = top.filter((e) => e.canonical);
  const misses = top.filter((e) => !e.canonical).slice(0, 8).map((e) => `${e.name} (${e.pos}${e.team ? `, ${e.team}` : ""}, ADP ${fmt(e.adp)})`);
  const rate = top.length ? mapped.length / top.length : 0;
  p.cl.add(
    "XWALK",
    key,
    title,
    !top.length ? "fail" : rate >= 0.98 ? "ok" : rate >= 0.9 ? "warn" : lowLevel,
    `${share(mapped.length, top.length)} of the first ${top.length} ${allPositions ? "players (every position)" : "QB/RB/WR/TE"} by ADP have a Sleeper id (target ≥ 98%, Phase 0's item M)${misses.length ? `; not mapped: ${misses.join(", ")}` : ""}`,
    { path: "sourceId → Sleeper id", sample: { mapped: mapped.length, of: top.length } },
  );
}

function agreementSection(p: ProbeContext, s: State): void {
  const lists = s.lists.filter((l) => l.entries.some((e) => e.canonical));
  const rows: Agreement[] = [];
  for (let i = 0; i < lists.length; i++) for (let j = i + 1; j < lists.length; j++) if (lists[i]!.season === lists[j]!.season) rows.push(agreementOf(lists[i]!, lists[j]!, AGREEMENT_TOP));
  if (!rows.length) return;
  p.cl.add(
    "ADP",
    "ADP.agreement",
    `How the ADP lists agree (the players in both lists' first ${AGREEMENT_TOP})`,
    "warn",
    rows.map((r) => `${r.a} vs ${r.b}: ${r.common} players, Spearman ${fmt(r.rho, 3)}, median gap ${fmt(r.medianGap, 1)} picks`).join("; ") + " (⚠️ derived: lists of the same season only; each list in its own format and league mix; Sleeper's and ESPN's lists aren't by league size)",
    { path: "each list's ADP by Sleeper id", sample: rows.map((r) => ({ pair: `${r.a} / ${r.b}`, common: r.common, rho: r.rho === null ? null : round(r.rho, 3) })) },
  );
  s.samples.push({
    title: `How the ADP lists agree (the players in both lists' first ${AGREEMENT_TOP}, by Sleeper id)`,
    headers: ["List A", "List B", "Players in both", "Spearman", "Median gap (picks)"],
    rows: rows.map((r) => [r.a, r.b, r.common, fmt(r.rho, 3), fmt(r.medianGap, 1)]),
  });
}

function docsOnlySection(p: ProbeContext): void {
  p.cl.na(
    "LIVE",
    "LIVE.yahoo.draftresults",
    "Yahoo draft results (docs only)",
    "untested: awaiting Yahoo approval (CLAUDE.md §2.4). Docs (sports.yahoo.com/developer/docs): /fantasy/v2/league/{league_key}/draftresults (\"Draft results for all teams in the league.\") and /team/{team_key}/draftresults (\"List of players drafted by the team.\"), each pick with pick, round, team_key, player_key and cost; the league's draft_status (postdraft in the docs' samples; the values before and during a draft aren't listed, ⚠️); the player's draft_analysis (average_pick, average_round, percent_drafted, average_cost) is Yahoo's own ADP. Whether draft results update during a live draft isn't documented",
  );
  p.cl.na("ADP", "ADP.fantasypros", "FantasyPros (terms only)", "not a source for us: its API's free key is for \"Non-production use\" with sample data, production keys come with a paid HOF subscription (\"Personal and non-commercial apps\") and redistribution with the commercial plan (\"Commercial license & redistribution rights\"); its terms: \"Except for a single copy made for personal use only, you may not copy, reproduce, … or distribute any documents or information from this site\" (reports/draft-data.md; no request sent)");
  p.cl.na("ADP", "ADP.underdog", "Underdog (terms only)", "not a source for us: no public API, and its terms forbid automated access (\"scrape, access, monitor, index, frame, link, or copy any content or information on the Services by accessing the Services in an automated way…\", reports/draft-data.md; no request sent)");
}

async function writeSamples(p: ProbeContext, s: State, forbidden: readonly string[]): Promise<void> {
  const lines = [
    "# Probe output: draft (samples)",
    "",
    `Generated by \`npm run probe:draft -- --live\` (${new Date().toISOString().slice(0, 10)} UTC; NFL season ${s.season}, week ${s.week}). The first rows of each list, public NFL players only. Placeholders only: no league id, draft id, user id, team, owner or league name. The checks behind these: \`draft.md\`; the sources and their terms: \`reports/draft-data.md\`.`,
    "",
  ];
  for (const t of s.samples) {
    lines.push(`## ${t.title}`, "");
    if (t.note) lines.push(t.note, "");
    lines.push(...mdTable(t.headers, t.rows), "");
  }
  const out = p.redactor.scrubText(scrubEverything(lines.join("\n")));
  for (const f of forbidden) if (f && out.includes(f)) throw new Error("draft.samples.md would hold a league or draft id; not written");
  await writeFileAtomic(path.join(ROOT, "reports", "probe-output", "draft.samples.md"), out);
}

async function main(p: ProbeContext): Promise<void> {
  const argv = process.argv.slice(2);
  const ownDraft = flagValue(argv, "--sleeper-draft");
  const s: State = { season: 0, week: 0, xw: null, lists: [], samples: [], leagues: [], sleeperAdp: new Map() };
  p.cl.meta.leagues = s.leagues;
  await crosswalkSection(p, s);
  await sleeperSection(p, s, ownDraft);
  if (!s.season) return; // no calendar, no season to ask the others for
  await espnSection(p, s);
  await ffcSection(p, s);
  await mflSection(p, s);
  await dynastyProcessSection(p);
  docsOnlySection(p);
  agreementSection(p, s);
  const pinned = pinnedLeagueId(path.join(ROOT, "fixtures", "raw", "sleeper", "fallback-league.json"));
  await writeSamples(p, s, [pinned ?? "", ownDraft ?? "", ...p.redactor.entries().filter((e) => e.category === "draft-id" || e.category === "league-id" || e.category === "user-id").map((e) => e.raw)]);
  p.cl.meta.samples = "reports/probe-output/draft.samples.md";
  p.cl.meta.season = s.season;
  p.cl.meta.week = s.week;
}

// Run only as a script (an exact path: scripts/lib/runMode.ts isMainModule); runProbe needs --live.
if (isMainModule(import.meta.url)) void runProbe("draft", main);
