/**
 * Phase 0 probe: ESPN fantasy football (CLAUDE.md §2.2, §2.10, §17 Data Checklist A–M).
 *
 *   npm run probe:espn
 *
 * Leagues: Parker's league (ESPN_LEAGUE_ID + ESPN_SEASON, cookies ESPN_S2 + ESPN_SWID) and the
 * public test league from §2.2 (no cookies; settings-level checks, plus its completed weeks as a
 * second scoring oracle). ID tables and X-Fantasy-Filter payloads come from cwendt94/espn-api (MIT).
 * Raw captures go to fixtures/raw/espn (git-ignored), sanitized copies to fixtures/sanitized/espn,
 * results to reports/probe-output/espn.{json,md}. Every claim in the report is computed from the
 * responses (or the upstream sources the probe fetched); inferred facts are ⚠️.
 */
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { TTL } from "./lib/cache";
import type { Evidence, Status } from "./lib/checklist";
import { FC_TEAM_SIZES, getFantasyCalc, matchRate, nearest, fantasyCalcUrl, type FcEntry, type FcFormat } from "./lib/fantasycalc";
import { LeakError, SANITIZED_DIR, type FixtureMeta } from "./lib/fixtures";
import type { HttpResult } from "./lib/http";
import { runProbe, type ProbeContext } from "./lib/probe";
import { SWID_RE, collapsePath, formatPath, type JsonPath } from "./lib/sanitize";
import { getSleeperPlayers, type SleeperPlayer } from "./lib/sleeper-players";
import { bucketOf, bucketOverlaps, classifyRule, fmtRange, groupOf, mergeGroups, parseEspnRange, sleeperBuckets, type CanonicalGroup, type CanonicalRule, type Range } from "./lib/espn/canonical";
import { ESPN_READS_BASE, cookieHeader, espnGet, hasCookies, leagueCall, query, type ClientDeps, type EspnAuth, type EspnCall, type EspnResult, type Params } from "./lib/espn/client";
import { ESPN_API_CONSTANT_PATH, ESPN_API_REPO, parseEspnConstants, positionFromEligibleSlots, slotIdForPosition, type EspnConstants } from "./lib/espn/constants";
import { FILTER_SOURCE_MARKERS, freeAgentFilter, playerCardFilter, playerPoolFilter, proPlayersFilter, recentActivityFilter, sourceHasMarker, transactionsFilter } from "./lib/espn/filters";
import { pruneFixtures } from "./lib/espn/fixtureIndex";
import { isPlayerPath, maskIdentityFields, maskOwnMember, protectAll, registerLeagueIdentities, replaceIdDeep, sweepIds, trimForFixture, TRIM_NOTE } from "./lib/espn/sanitize";
import {
  DraftResponseSchema,
  LeagueSchema,
  PlayerListResponseSchema,
  ProTeamSchedulesSchema,
  TransactionsResponseSchema,
  formatIssues,
  typeNameList,
  type League,
  type Player,
  type ProTeamSchedules,
  type RosterEntry,
  type ScoringItem,
  type StatEntry,
  type Transaction,
} from "./lib/espn/schema";
import { ORACLE_TOLERANCE, diffPerStat, recompute, round2 } from "./lib/espn/scoring";
import { dedupeById, idOverlap, involves } from "./lib/espn/transactions";
import { byeWeeksFromGames, futureSampleWeeks, weekOfInstant, weekWindows, type WeekWindow } from "./lib/espn/weeks";

/** CLAUDE.md §2.2: public league verified by the planner (settings readable without cookies). */
const PUBLIC_LEAGUE_ID = "899513";
/** Its fixture placeholder. Not registered in the redaction map: CLAUDE.md itself contains the id. */
const PUBLIC_LEAGUE_PLACEHOLDER = 100002;
const BENCH = 20;
const IR = 21;
const NON_STARTING = new Set([BENCH, IR]);
/** espn-api PLAYER_CARD_BATCH (utils/trade_fill.py). */
const CARD_BATCH = 40;
/** espn-api free_agents() default size; CLAUDE.md §6 wants the top 50 free agents per position. */
const FA_TOP = 50;
/**
 * Free agents are requested with espn-api's own pool page size (get_player_pool_ids page_size=500),
 * so each position's list is complete and can be re-ranked by projection (ESPN sorts by % owned).
 */
const FA_LIMIT = 500;
/** espn-api get_player_pool_ids() page size, used for the future-week projection pools. */
const POOL_PAGE = 500;
/** Public test league player pool for its scoring oracle (players rostered or not). */
const PUBLIC_POOL = 250;
/** Player cards requested without cookies (a small batch is enough to compare). */
const NO_COOKIE_CARDS = 5;
const FA_POSITIONS: Array<[string, string]> = [
  ["QB", "QB"],
  ["RB", "RB"],
  ["WR", "WR"],
  ["TE", "TE"],
  ["K", "K"],
  ["D/ST", "D/ST"],
];
/** mTransactions2 types we ask for (espn-api TRANSACTION_TYPES minus lineup/draft bookkeeping). */
const TX_TYPES = ["FREEAGENT", "WAIVER", "WAIVER_ERROR", "TRADE_ACCEPT", "TRADE_DECLINE", "TRADE_ERROR", "TRADE_PROPOSAL", "TRADE_UPHOLD", "TRADE_VETO"];
const FIVE_MB = 5 * 1024 * 1024;
/** DynastyProcess crosswalk (§2.9). Same URL, cache namespace and key as the shared probe: one download a day serves both. */
const DP_IDMAP_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";
/** ESPN injuryStatus values with a direct CLAUDE.md §4 PlayerInfo.injury value (names differ only for IR/SUSPENDED). */
const INJURY_TO_SPEC: Record<string, string> = { ACTIVE: "ACTIVE", QUESTIONABLE: "QUESTIONABLE", DOUBTFUL: "DOUBTFUL", OUT: "OUT", INJURY_RESERVE: "IR", SUSPENSION: "SUSPENDED" };
/** Upstream espn-api files the probe reads: tables and filters we copy, and behaviour we cite. */
const UPSTREAM_FILES = [ESPN_API_CONSTANT_PATH, "espn_api/football/league.py", "espn_api/requests/espn_requests.py", "espn_api/football/player.py", "espn_api/football/settings.py", "espn_api/base_settings.py"];
/** Where CLAUDE.md §0.5 says SWIDs appear in league responses (the fan-API URL path is the third place). */
const SPEC_SWID_PATHS = new Set(["teams[].owners[]", "members[].id"]);
/** Views Parker's league is read with (cookie requests), for the "untested without cookies" list. */
const COOKIE_VIEWS = ["mSettings", "mTeam", "mRoster", "mMatchup", "mStatus", "mTransactions2", "kona_league_communication", "mDraftDetail", "mMatchupScore", "mStandings", "kona_player_info", "kona_playercard"];

interface Got<T = unknown> extends EspnResult<T> {
  /** Set when the request threw (network failure after retries). */
  error?: string;
}

type DpRow = Record<string, string>;

interface Fetched {
  proSchedule?: Got;
  main?: Got;
  league?: League;
  leagueIssues: string[];
  noCookie: Array<{ view: string; r: Got }>;
  /** Scoring period used for the no-cookie mTransactions2 comparison. */
  noCookieTxWeek?: number;
  noCookieCardIds: number[];
  wrongSeason?: Got;
  pubWrongSeason?: Got;
  fan?: { status: number; ok: boolean; leagueListed: boolean | null; note: string };
  txDefault?: Got;
  txWeeks: Array<{ week: number; r: Got }>;
  /** scoringPeriodId=0 (tests whether 0 is its own period). */
  txAlias?: Got;
  /** The next scoring period (tests what a future period returns). */
  txAhead?: { week: number; r: Got };
  txUnfiltered?: { week: number; r: Got };
  comm: Got[];
  draft?: Got;
  matchupScore?: Got;
  standings?: Got;
  fa: Array<{ pos: string; slotId: number; r: Got }>;
  universe?: Got;
  rosterWeeks: Array<{ week: number; r: Got }>;
  future: Array<{ week: number; why: string; r: Got }>;
  cards: Got[];
  pub?: Got;
  pubLeague?: League;
  pubPool: Array<{ week: number; r: Got }>;
  pubIssues: string[];
  fc?: { data: FcEntry[]; format: FcFormat; status: number } | { error: string; format: FcFormat };
  sleeper?: Record<string, SleeperPlayer>;
  dp?: { rows: DpRow[]; status: number; fromCache: boolean } | { error: string };
}

interface OracleRun {
  key: string;
  title: string;
  scope: "league" | "public";
  week: number;
  players: Player[];
  result: OracleResult;
  ev: Evidence;
}

interface Ctx {
  p: ProbeContext;
  season: number;
  leagueId?: string;
  auth: EspnAuth;
  deps: ClientDeps;
  c?: EspnConstants;
  sha: string;
  shaDate: string;
  sources: Record<string, string>;
  windows: WeekWindow[];
  proTeams: ProTeamSchedules["settings"]["proTeams"];
  /** ESPN's enumerations (settings.typeNames of proTeamSchedules_wl). */
  typeNames?: Record<string, unknown>;
  /** ESPN's own statId → pointsOverrides key table (proTeamSchedules_wl settings). */
  statIdToOverridePosition?: Record<string, number>;
  fixtures: string[];
  /** Planned fixtures that couldn't be saved this run (stale fixtures are only pruned when 0). */
  fixtureProblems: number;
  /** Deferred checks (reported after A–M so the report reads in checklist order). */
  deferred: Array<{ status: Status; item: string; key: string; title: string; summary: string; ev: Evidence[] }>;
  myTeamId?: number;
  /** Owner label of Parker's member record (for masking his own name in fixtures). */
  ownLabel?: string;
  /** Empirical defaultPositionId → position (from the player universe and rosters). */
  posById: Record<number, string>;
  oracles: OracleRun[];
  /** Top free agents per position by current-week projection (H.top50), reused by J.future. */
  faTop: Map<string, Array<{ id: number; proTeamId: number }>>;
  /** C.canonical for Parker's league (feeds the scoring-map issue). */
  canonical?: CanonicalSummary;
  /** What the period-0 and next-period transaction requests showed (G.periodZero / G.periodAhead). */
  txFacts: { zeroAlias?: boolean; aheadRepeats?: boolean };
}

function defer(ctx: Ctx, status: Status, item: string, key: string, title: string, summary: string, ...ev: Evidence[]) {
  ctx.deferred.push({ status, item, key, title, summary, ev });
}

// ---------------------------------------------------------------- small helpers

const views = (...v: string[]): Params => v.map((x): [string, string] => ["view", x]);
const range = (a: number, b: number): number[] => (b < a ? [] : Array.from({ length: b - a + 1 }, (_, i) => a + i));
const iso = (ms: number) => new Date(ms).toISOString();
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");

function countBy<T>(xs: readonly T[], key: (x: T) => string | number | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) {
    const k = String(key(x));
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
const fmtCounts = (r: Record<string, number>) =>
  Object.entries(r)
    .map(([k, v]) => `${k}×${v}`)
    .join(", ");

/** "5, 7–9, 12" for a sorted list of integers. */
function fmtWeeks(ws: readonly number[]): string {
  const out: string[] = [];
  for (let i = 0; i < ws.length; ) {
    let j = i;
    while (j + 1 < ws.length && (ws[j + 1] as number) === (ws[j] as number) + 1) j++;
    out.push(i === j ? `${ws[i]}` : `${ws[i]}–${ws[j]}`);
    i = j + 1;
  }
  return out.join(", ");
}

function add(ctx: Ctx, status: Status, item: string, key: string, title: string, summary: string, ...ev: Evidence[]) {
  ctx.p.cl.add(item, key, title, status, summary, ...ev);
}

function findStat(pl: Pick<Player, "stats">, season: number, source: number, split: number, period: number): StatEntry | undefined {
  return pl.stats?.find((s) => s.seasonId === season && s.statSourceId === source && s.statSplitTypeId === split && s.scoringPeriodId === period);
}

function positionOf(ctx: Ctx, pl: Pick<Player, "eligibleSlots" | "fullName" | "defaultPositionId">): string {
  return (ctx.c && positionFromEligibleSlots(pl.eligibleSlots, ctx.c.slotNames, pl.fullName)) || `defaultPositionId ${pl.defaultPositionId}`;
}

function slotName(ctx: Ctx, id: number | string): string {
  return ctx.c?.slotNames[Number(id)] ?? `slot ${id}`;
}

function rosterEntries(L: Pick<League, "teams">): Array<{ teamId: number; e: RosterEntry }> {
  return L.teams.flatMap((t) => (t.roster?.entries ?? []).map((e) => ({ teamId: t.id, e })));
}

function byeMap(ctx: Ctx): Map<number, number> {
  return new Map(ctx.proTeams.map((t) => [t.id, t.byeWeek ?? 0]));
}

/** Does the fetched upstream file contain this snippet? undefined when the file wasn't fetched. */
function upstreamHas(ctx: Ctx, file: string, marker: string): boolean | undefined {
  const src = ctx.sources[file];
  return src === undefined ? undefined : sourceHasMarker(src, marker);
}

/** Cite an upstream fact only as far as the fetched source supports it. */
function cite(ctx: Ctx, file: string, markers: string[], text: string): string {
  const found = markers.map((m) => upstreamHas(ctx, file, m));
  if (found.some((x) => x === undefined)) return `${text} [${file} not fetched, so unverified]`;
  return found.every(Boolean) ? `${text} (${file}@${ctx.sha.slice(0, 7)})` : `${text} [NOT found in ${file}@${ctx.sha.slice(0, 7)}: check]`;
}

function failFetch(ctx: Ctx, item: string, key: string, title: string, r: Got | undefined, what = "request") {
  if (!r) return add(ctx, "fail", item, key, title, `${what} was not made (an earlier step failed)`);
  const detail = r.error ?? `${r.outcome.message} [${r.outcome.code}${r.outcome.detailTypes.length ? `; ESPN error type: ${r.outcome.detailTypes.join(", ")}` : ""}]`;
  add(ctx, "fail", item, key, title, detail, { url: r.call.template, status: r.res.status, note: r.res.isHtml ? "body is an HTML page" : undefined });
}

function fakeResult(call: EspnCall, message: string): Got {
  const res: HttpResult = { url: call.template, finalUrl: call.template, status: 0, ok: false, contentType: "", isHtml: false, text: "", json: undefined, headers: {}, elapsedMs: 0, fromCache: false, attempts: 0 };
  return { call, res, outcome: { ok: false, code: "unexpected-status", message, detailTypes: [], detailMessages: [] }, data: undefined, withCookies: hasCookies(call.auth), error: `request failed: ${message}` };
}

/** One ESPN GET: polite (library), cached per §2.10, raw capture saved. Never throws. */
async function get(ctx: Ctx, call: EspnCall, rawKey: string, season = ctx.season): Promise<Got> {
  let r: Got;
  try {
    r = await espnGet(ctx.deps, call, season);
  } catch (err) {
    return fakeResult(call, err instanceof Error ? err.message : String(err));
  }
  await ctx.p.saveRaw(`espn:${rawKey}`, r.res.json ?? r.res.text, r.res, r.res.json === undefined ? ".txt" : undefined);
  return r;
}

function leagueGet(ctx: Ctx, label: string, params: Params, opts: { auth?: EspnAuth; filter?: unknown; extend?: string; leagueId?: string; season?: number; ttlMs?: number } = {}) {
  const leagueId = opts.leagueId ?? (ctx.leagueId as string);
  const season = opts.season ?? ctx.season;
  const call = leagueCall({ label, season, leagueId, params, extend: opts.extend, filter: opts.filter, auth: opts.auth, ttlMs: opts.ttlMs, templateLeague: leagueId === PUBLIC_LEAGUE_ID ? "{publicLeagueId}" : "{leagueId}" });
  return get(ctx, call, `league:${leagueId}:${season}:${label}`, season);
}

interface Transform {
  fn: (x: unknown) => unknown;
  note: string;
}

const compose = (...ts: Transform[]): Transform => ({ fn: (x) => ts.reduce((v, t) => t.fn(v), x), note: ts.map((t) => t.note).join("; ") });

/** Save a sanitized fixture; a LeakError is recorded as ❌ instead of crashing the run. */
async function saveFixture(ctx: Ctx, label: string, raw: unknown, meta: FixtureMeta, opts: { protect?: (p: JsonPath) => boolean; trim?: boolean; transform?: Transform; sweep?: boolean } = {}): Promise<void> {
  const { p } = ctx;
  if (raw === undefined) {
    ctx.fixtureProblems++;
    return;
  }
  // Identity fields by path first (covers numeric names the Redactor never registers), then the Redactor.
  let body: unknown = maskIdentityFields(maskOwnMember(opts.trim === false ? raw : trimForFixture(raw), ctx.auth.swid, ctx.ownLabel));
  const notes = [meta.note, opts.trim === false ? undefined : TRIM_NOTE].filter(Boolean) as string[];
  if (opts.transform) {
    body = opts.transform.fn(body);
    notes.push(opts.transform.note);
  }
  const size = JSON.stringify(body, null, 2).length;
  if (size > FIVE_MB) {
    ctx.fixtureProblems++;
    defer(ctx, "warn", "FIX", `FIX.${label}`, "Sanitized fixture", `not saved: ${(size / 1e6).toFixed(1)} MB is over the 5 MB limit`);
    return;
  }
  if (opts.sweep !== false) sweepIds(p.redactor, body);
  try {
    await p.saveSanitized(label, body, { ...meta, note: notes.join("; ") || undefined }, { protect: opts.protect ?? isPlayerPath });
    ctx.fixtures.push(label);
  } catch (err) {
    if (!(err instanceof LeakError)) throw err;
    ctx.fixtureProblems++;
    defer(ctx, "fail", "FIX", `FIX.${label}`, "Sanitized fixture", `not saved: ${err.message}`);
  }
}

function metaOf(r: Got | undefined, note?: string): FixtureMeta {
  return r ? { url: r.call.template, status: r.res.status, contentType: r.res.contentType, note } : { note };
}

function parseTx(r: Got | undefined): Transaction[] | undefined {
  if (!r?.outcome.ok) return undefined;
  const parsed = TransactionsResponseSchema.safeParse(r.data);
  return parsed.success ? (parsed.data.transactions ?? []) : undefined;
}

function parsePlayers(r: Got | undefined) {
  if (!r?.outcome.ok) return undefined;
  const parsed = PlayerListResponseSchema.safeParse(r.data);
  return parsed.success ? parsed.data.players : undefined;
}

// ---------------------------------------------------------------- fetch phase

async function loadEspnApiSources(ctx: Ctx): Promise<void> {
  const { p } = ctx;
  const commitUrl = `https://api.github.com/repos/${ESPN_API_REPO}/commits/master`;
  try {
    const r = await p.request(commitUrl, { headers: { Accept: "application/vnd.github+json" }, cache: { key: `github:${commitUrl}`, ttlMs: TTL.docs, namespace: "espn-docs" }, label: "GitHub espn-api latest commit" });
    const j = r.json as { sha?: unknown; commit?: { committer?: { date?: unknown } } } | undefined;
    if (r.ok && typeof j?.sha === "string") {
      ctx.sha = j.sha;
      ctx.shaDate = typeof j.commit?.committer?.date === "string" ? j.commit.committer.date : "";
      defer(ctx, "ok", "IDS", "IDS.commit", "espn-api source commit", `${ESPN_API_REPO}@${ctx.sha.slice(0, 7)} (committed ${ctx.shaDate || "?"}); every table, filter and upstream behaviour cited below comes from this commit (${UPSTREAM_FILES.length} files)`, { url: commitUrl, status: r.status, path: "sha", sample: ctx.sha });
    } else defer(ctx, "warn", "IDS", "IDS.commit", "espn-api source commit", `could not resolve the latest commit (HTTP ${r.status}); using branch "master" unpinned`, { url: commitUrl, status: r.status });
  } catch (err) {
    defer(ctx, "warn", "IDS", "IDS.commit", "espn-api source commit", `GitHub API unreachable (${err instanceof Error ? err.message : String(err)}); using "master"`, { url: commitUrl });
  }
  for (const file of UPSTREAM_FILES) {
    const url = `https://raw.githubusercontent.com/${ESPN_API_REPO}/${ctx.sha}/${file}`;
    try {
      const r = await p.request(url, { cache: { key: `github:${url}`, ttlMs: TTL.docs, namespace: "espn-docs" }, label: `espn-api ${file}` });
      if (r.ok && !r.isHtml) {
        ctx.sources[file] = r.text;
        await p.saveRaw(`espn-api:${ctx.sha}:${file}`, r.text, r, ".py");
      } else defer(ctx, "fail", "IDS", `IDS.source.${file}`, "espn-api source file", `HTTP ${r.status}`, { url, status: r.status });
    } catch (err) {
      defer(ctx, "fail", "IDS", `IDS.source.${file}`, "espn-api source file", err instanceof Error ? err.message : String(err), { url });
    }
  }
  const src = ctx.sources[ESPN_API_CONSTANT_PATH];
  if (src) ctx.c = parseEspnConstants(src);
}

/** Views requested again WITHOUT cookies, to see what a public league exposes to anyone with its ID. */
async function fetchNoCookie(ctx: Ctx, f: Fetched, L: League | undefined, current: number, finalPeriod: number): Promise<void> {
  const list: Array<{ view: string; params: Params; filter?: unknown; extend?: string }> = [{ view: "mSettings", params: views("mSettings") }];
  if (L) {
    f.noCookieTxWeek = Math.max(1, current - 1);
    f.noCookieCardIds = [...new Set(rosterEntries(L).map((x) => x.e.playerId))].sort((a, b) => a - b).slice(0, NO_COOKIE_CARDS);
    list.push(
      { view: "mRoster", params: views("mRoster") },
      { view: "mTransactions2", params: [...views("mTransactions2"), ["scoringPeriodId", f.noCookieTxWeek]], filter: transactionsFilter(TX_TYPES) },
      { view: "kona_player_info", params: [...views("kona_player_info"), ["scoringPeriodId", current]], filter: freeAgentFilter(FA_TOP, [0]) },
      { view: "mDraftDetail", params: views("mDraftDetail") },
      { view: "mStandings", params: views("mStandings") },
      { view: "mMatchupScore", params: views("mMatchupScore") },
      { view: "kona_league_communication", params: views("kona_league_communication"), extend: "/communication/", filter: recentActivityFilter(50, 0) },
      { view: "kona_playercard", params: views("kona_playercard"), filter: playerCardFilter(f.noCookieCardIds, finalPeriod, ctx.season) },
    );
  }
  for (const v of list) f.noCookie.push({ view: v.view, r: await leagueGet(ctx, `${v.view} (no cookies)`, v.params, { filter: v.filter, extend: v.extend }) });
}

async function fetchDynastyProcess(p: ProbeContext): Promise<Fetched["dp"]> {
  try {
    const r = await p.request(DP_IDMAP_URL, { cache: { key: `idmap:${DP_IDMAP_URL}`, ttlMs: TTL.idMap, namespace: "idmap" }, label: "DynastyProcess db_playerids.csv", timeoutMs: 180_000 });
    if (!r.ok || r.isHtml) return { error: `HTTP ${r.status}${r.isHtml ? " (HTML page)" : ""}` };
    return { rows: parseCsv(r.text, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }) as DpRow[], status: r.status, fromCache: r.fromCache };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchAll(ctx: Ctx): Promise<Fetched> {
  const { p, season } = ctx;
  const f: Fetched = { leagueIssues: [], noCookie: [], noCookieCardIds: [], txWeeks: [], comm: [], fa: [], rosterWeeks: [], future: [], cards: [], pubIssues: [], pubPool: [] };
  const cookieAuth = hasCookies(ctx.auth) ? ctx.auth : undefined;

  // NFL schedule and byes (public, 7-day cache); its settings also carry ESPN's enumerations.
  const schedUrl = `${ESPN_READS_BASE}/seasons/${season}${query(views("proTeamSchedules_wl"))}`;
  f.proSchedule = await get(ctx, { label: "proTeamSchedules_wl", url: schedUrl, template: schedUrl, ttlMs: TTL.nflSchedule }, `season:${season}:proTeamSchedules_wl`);
  const sched = f.proSchedule.data ? ProTeamSchedulesSchema.safeParse(f.proSchedule.data) : undefined;
  if (sched?.success) {
    ctx.proTeams = sched.data.settings.proTeams;
    ctx.windows = weekWindows(ctx.proTeams);
    ctx.typeNames = sched.data.settings.typeNames;
    ctx.statIdToOverridePosition = sched.data.settings.statIdToOverridePosition;
  }

  if (ctx.leagueId) {
    f.main = await leagueGet(ctx, "main", views("mSettings", "mTeam", "mRoster", "mMatchup", "mStatus"), { auth: cookieAuth });
    if (f.main.data) {
      const parsed = LeagueSchema.safeParse(f.main.data);
      if (parsed.success) f.league = parsed.data;
      else f.leagueIssues = formatIssues(parsed.error, 8);
    }
    // Error path: a season the league doesn't exist in yet.
    if (cookieAuth) f.wrongSeason = await leagueGet(ctx, "mSettings wrong season", views("mSettings"), { auth: cookieAuth, season: season + 1 });
  }
  const L = f.league;
  const current = L?.status.latestScoringPeriod ?? 4;
  const finalPeriod = L?.status.finalScoringPeriod ?? 17;
  if (ctx.leagueId) await fetchNoCookie(ctx, f, L, current, finalPeriod);

  if (ctx.leagueId && L) {
    // Fan API (optional league discovery for cookie users). The SWID sits in the URL path.
    if (cookieAuth) f.fan = await fetchFanApi(ctx, cookieAuth);

    // Transactions: default scope, then one request per scoring period 1…current with espn-api's
    // type filter (League.transactions() also fetches one period per call). Two edge probes:
    // period 0 (G.periodZero) and the next period (G.periodAhead).
    f.txDefault = await leagueGet(ctx, "mTransactions2 default", views("mTransactions2"), { auth: cookieAuth });
    const txGet = (week: number) => leagueGet(ctx, `mTransactions2 sp${week} filtered`, [...views("mTransactions2"), ["scoringPeriodId", week]], { auth: cookieAuth, filter: transactionsFilter(TX_TYPES) });
    for (const week of range(1, current)) f.txWeeks.push({ week, r: await txGet(week) });
    f.txAlias = await txGet(0);
    if (current + 1 <= finalPeriod) f.txAhead = { week: current + 1, r: await txGet(current + 1) };
    const unfilteredWeek = Math.max(1, current - 1);
    f.txUnfiltered = { week: unfilteredWeek, r: await leagueGet(ctx, `mTransactions2 sp${unfilteredWeek} unfiltered`, [...views("mTransactions2"), ["scoringPeriodId", unfilteredWeek]], { auth: cookieAuth }) };
    // Recent activity (espn-api recent_activity), up to 3 pages of 50.
    for (let page = 0; page < 3; page++) {
      const r = await leagueGet(ctx, `communication page ${page}`, views("kona_league_communication"), { auth: cookieAuth, extend: "/communication/", filter: recentActivityFilter(50, page * 50) });
      f.comm.push(r);
      const topics = (r.data as { topics?: unknown[] } | undefined)?.topics;
      if (!Array.isArray(topics) || topics.length < 50) break;
    }
    f.draft = await leagueGet(ctx, "mDraftDetail", views("mDraftDetail"), { auth: cookieAuth });
    f.matchupScore = await leagueGet(ctx, "mMatchupScore", views("mMatchupScore"), { auth: cookieAuth });
    f.standings = await leagueGet(ctx, "mStandings", views("mStandings"), { auth: cookieAuth });

    // Free agents: espn-api free_agents() filter, one call per position slot, sized to get the whole list.
    for (const [pos, slotLabel] of FA_POSITIONS) {
      const slotId = ctx.c?.slotIdsByName[slotLabel];
      if (slotId === undefined) continue;
      f.fa.push({ pos, slotId, r: await leagueGet(ctx, `kona_player_info FA ${pos} limit ${FA_LIMIT}`, [...views("kona_player_info"), ["scoringPeriodId", current]], { auth: cookieAuth, filter: freeAgentFilter(FA_LIMIT, [slotId]) }) });
    }
    // League-independent active player universe (espn-api get_pro_players), 24h cache.
    const uniUrl = `${ESPN_READS_BASE}/seasons/${season}/players${query(views("players_wl"))}`;
    f.universe = await get(ctx, { label: "players_wl", url: uniUrl, template: uniUrl, filter: proPlayersFilter(), ttlMs: TTL.sleeperPlayers }, `season:${season}:players_wl`);

    // Completed weeks (actual stats + league-scored points) for the oracle preview.
    for (const week of range(Math.max(1, current - 2), current - 1)) f.rosterWeeks.push({ week, r: await leagueGet(ctx, `mRoster sp${week}`, [...views("mRoster"), ["scoringPeriodId", week]], { auth: cookieAuth }) });

    // Future-week projections: espn-api get_player_pool_ids() page 1 (500 most-owned players), projection TTL (6 h).
    const shape = { latestScoringPeriod: L.status.latestScoringPeriod, finalScoringPeriod: L.status.finalScoringPeriod, matchupPeriodCount: L.settings.scheduleSettings.matchupPeriodCount, matchupPeriods: L.settings.scheduleSettings.matchupPeriods };
    for (const { week, why } of futureSampleWeeks(shape))
      f.future.push({ week, why, r: await leagueGet(ctx, `kona_player_info pool sp${week} page ${POOL_PAGE}`, [...views("kona_player_info"), ["scoringPeriodId", week]], { auth: cookieAuth, filter: playerPoolFilter(POOL_PAGE, 0), ttlMs: TTL.projections }) });

    // Player cards for every rostered player: all scoring periods, actual + projected (espn-api player_info()).
    const ids = [...new Set(rosterEntries(L).map((x) => x.e.playerId))].sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i += CARD_BATCH) {
      const batch = ids.slice(i, i + CARD_BATCH);
      f.cards.push(await leagueGet(ctx, `kona_playercard batch ${i / CARD_BATCH + 1}`, views("kona_playercard"), { auth: cookieAuth, filter: playerCardFilter(batch, finalPeriod, season) }));
    }
  }

  // Public test league (no cookies).
  f.pub = await leagueGet(ctx, "public main", views("mSettings", "mTeam", "mRoster", "mStatus"), { leagueId: PUBLIC_LEAGUE_ID });
  if (f.pub.data) {
    const parsed = LeagueSchema.safeParse(f.pub.data);
    if (parsed.success) f.pubLeague = parsed.data;
    else f.pubIssues = formatIssues(parsed.error, 8);
  }
  f.pubWrongSeason = await leagueGet(ctx, "public mSettings wrong season", views("mSettings"), { leagueId: PUBLIC_LEAGUE_ID, season: season + 1 });
  // Completed weeks' league-scored actuals for the top of its player pool (rostered or not).
  if (f.pubLeague)
    for (const week of range(1, f.pubLeague.status.latestScoringPeriod - 1)) f.pubPool.push({ week, r: await leagueGet(ctx, `public kona_player_info pool sp${week}`, [...views("kona_player_info"), ["scoringPeriodId", week]], { leagueId: PUBLIC_LEAGUE_ID, filter: playerPoolFilter(PUBLIC_POOL, 0) }) });

  // Market values (shared 24h cache + single-flight), the Sleeper players DB and the DynastyProcess crosswalk (cross-checks).
  if (L) {
    const format = fcFormatFor(ctx, L);
    try {
      const { data, res } = await getFantasyCalc(format);
      f.fc = { data, format, status: res.status };
    } catch (err) {
      f.fc = { error: err instanceof Error ? err.message : String(err), format };
    }
    try {
      f.sleeper = (await getSleeperPlayers()).data;
    } catch (err) {
      p.cl.issue(`Sleeper players DB unavailable for the ESPN position cross-check: ${err instanceof Error ? err.message : String(err)}`);
    }
    f.dp = await fetchDynastyProcess(p);
  }
  return f;
}

async function fetchFanApi(ctx: Ctx, auth: Required<EspnAuth>): Promise<Fetched["fan"]> {
  const { p } = ctx;
  const url = `https://fan.api.espn.com/apis/v2/fans/${encodeURIComponent(auth.swid)}`;
  try {
    // Cache key carries only a credential hash; the SWID must never appear in keys, logs or reports.
    const r = await p.request(url, { cookie: cookieHeader(auth), cache: p.leagueCache("fan-api", [auth.s2, auth.swid]), label: "ESPN fan API", retries: 2 });
    await p.saveRaw("espn:fan-api:{SWID}", r.json ?? r.text, { status: r.status, contentType: r.contentType, url: "https://fan.api.espn.com/apis/v2/fans/{SWID}" });
    if (!r.ok || r.json === undefined) return { status: r.status, ok: false, leagueListed: null, note: r.isHtml ? "HTML page" : "no JSON" };
    const target = String(ctx.leagueId);
    let listed = false;
    const walk = (v: unknown) => {
      if (listed) return;
      if ((typeof v === "string" || typeof v === "number") && String(v) === target) listed = true;
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(r.json);
    const prefs = (r.json as { preferences?: unknown[] }).preferences;
    return { status: r.status, ok: true, leagueListed: listed, note: `preferences[]: ${Array.isArray(prefs) ? prefs.length : "absent"}` };
  } catch (err) {
    return { status: 0, ok: false, leagueListed: null, note: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------- derived league facts

function slotCounts(L: League): Array<{ id: number; count: number }> {
  return Object.entries(L.settings.rosterSettings.lineupSlotCounts)
    .map(([k, v]) => ({ id: Number(k), count: v }))
    .sort((a, b) => a.id - b.id);
}

function receptionPoints(L: League): number {
  const items = L.settings.scoringSettings.scoringItems;
  return [41, 53].reduce((s, id) => s + (items.find((i) => i.statId === id)?.points ?? 0), 0);
}

function leagueTypeOf(L: League): { type: "redraft" | "keeper" | "dynasty"; why: string; inferred: boolean } {
  const keepers = L.settings.draftSettings?.keeperCount ?? 0;
  const rosterMax = slotCounts(L)
    .filter((s) => s.id !== IR)
    .reduce((a, s) => a + s.count, 0);
  if (keepers <= 0) return { type: "redraft", why: `keeperCount=${keepers}`, inferred: false };
  if (keepers >= rosterMax) return { type: "dynasty", why: `keeperCount=${keepers} ≥ active roster size ${rosterMax} (every player can be kept)`, inferred: true };
  return { type: "keeper", why: `keeperCount=${keepers} < active roster size ${rosterMax}`, inferred: true };
}

function fcFormatFor(ctx: Ctx, L: League): FcFormat {
  const counts = slotCounts(L);
  const cnt = (label: string) => counts.find((s) => slotName(ctx, s.id) === label)?.count ?? 0;
  const numQbs: 1 | 2 = cnt("OP") > 0 || cnt("QB") >= 2 ? 2 : 1;
  return { isDynasty: leagueTypeOf(L).type === "dynasty", numQbs, numTeams: nearest(FC_TEAM_SIZES, L.settings.size), ppr: nearest([0, 0.5, 1] as const, receptionPoints(L)) };
}

/** Empirical defaultPositionId → position (espn-api derives position from eligibleSlots instead). */
type PositionedPlayer = Pick<Player, "eligibleSlots" | "fullName" | "defaultPositionId">;

function defaultPositionTable(ctx: Ctx, players: PositionedPlayer[]): Map<number, Record<string, number>> {
  const out = new Map<number, Record<string, number>>();
  for (const pl of players) {
    const t = out.get(pl.defaultPositionId) ?? {};
    const pos = positionOf(ctx, pl);
    t[pos] = (t[pos] ?? 0) + 1;
    out.set(pl.defaultPositionId, t);
  }
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}

/** Players from the active universe (players_wl) that carry what the position rule needs. */
function universePlayers(f: Fetched): PositionedPlayer[] {
  if (!Array.isArray(f.universe?.data)) return [];
  const out: PositionedPlayer[] = [];
  for (const x of f.universe.data as unknown[]) {
    const o = x as Partial<PositionedPlayer> | null;
    if (o && typeof o.defaultPositionId === "number" && Array.isArray(o.eligibleSlots) && typeof o.fullName === "string") out.push({ defaultPositionId: o.defaultPositionId, eligibleSlots: o.eligibleSlots, fullName: o.fullName });
  }
  return out;
}

/** Majority position per defaultPositionId over the universe and both leagues' rosters. */
function buildPosById(ctx: Ctx, f: Fetched): Record<number, string> {
  const players: PositionedPlayer[] = [...universePlayers(f)];
  for (const L of [f.league, f.pubLeague]) if (L) players.push(...rosterEntries(L).map((x) => x.e.playerPoolEntry.player));
  const out: Record<number, string> = {};
  for (const [id, t] of defaultPositionTable(ctx, players)) {
    const best = Object.entries(t).sort((a, b) => b[1] - a[1])[0];
    if (best) out[id] = best[0];
  }
  return out;
}

const posName = (ctx: Ctx, key: number | string) => ctx.posById[Number(key)] ?? "?";

// ---------------------------------------------------------------- scoring oracle (computed before the checks)

interface OracleResult {
  checked: number;
  /** Within tolerance when pointsOverrides are keyed by the player's defaultPositionId and replace the base points. */
  withinPos: number;
  /** Within tolerance when keyed by the lineup slot id of the player's position (the spec's reading). */
  withinSlot: number;
  /** Within tolerance when an override is ADDED to the base points (keyed by defaultPositionId). */
  withinAdd: number;
  /** Player-weeks where the position-id and slot-id readings give different totals. */
  keyCases: Array<{ key: string; pos: string; okPos: boolean; okSlot: boolean; example: string }>;
  /** Player-weeks where "replace" and "add" give different totals. */
  modeCases: Array<{ key: string; pos: string; okReplace: boolean; okAdd: boolean; example: string }>;
  noActual: number;
  mismatches: Array<{ name: string; pos: string; espn: number; ours: number; diffs: string }>;
  statPattern: Record<string, number>;
}

function runOracle(ctx: Ctx, players: Player[], items: ScoringItem[], week: number): OracleResult {
  const res: OracleResult = { checked: 0, withinPos: 0, withinSlot: 0, withinAdd: 0, keyCases: [], modeCases: [], noActual: 0, mismatches: [], statPattern: {} };
  const ok = (a: number, b: number) => Math.abs(a - b) <= ORACLE_TOLERANCE;
  for (const pl of players) {
    const actual = findStat(pl, ctx.season, 0, 1, week);
    if (!actual || actual.appliedTotal === undefined) {
      res.noActual++;
      continue;
    }
    const espn = actual.appliedTotal;
    const pos = positionOf(ctx, pl);
    const slot = ctx.c ? slotIdForPosition(pos, ctx.c) : undefined;
    const byPos = recompute(actual.stats ?? {}, items, pl.defaultPositionId);
    const bySlot = recompute(actual.stats ?? {}, items, slot);
    const byAdd = recompute(actual.stats ?? {}, items, pl.defaultPositionId, "add");
    const okPos = ok(byPos.total, espn);
    const okSlot = ok(bySlot.total, espn);
    const okAdd = ok(byAdd.total, espn);
    res.checked++;
    if (okPos) res.withinPos++;
    if (okSlot) res.withinSlot++;
    if (okAdd) res.withinAdd++;
    const who = `${pl.fullName} week ${week} (${pos}, defaultPositionId ${pl.defaultPositionId}, slot ${slot}): ESPN ${round2(espn)}`;
    if (!ok(byPos.total, bySlot.total)) res.keyCases.push({ key: `${pl.id}:${week}`, pos, okPos, okSlot, example: `${who}, by position id ${round2(byPos.total)}, by slot id ${round2(bySlot.total)}` });
    if (!ok(byPos.total, byAdd.total)) res.modeCases.push({ key: `${pl.id}:${week}`, pos, okReplace: okPos, okAdd, example: `${who}, replace ${round2(byPos.total)}, add ${round2(byAdd.total)}` });
    if (okPos) continue;
    const diffs = diffPerStat(byPos.perStat, actual.appliedStats);
    for (const d of diffs) {
      const label = `${d.statId}${ctx.c?.scoringFormat[d.statId] ? ` ${ctx.c.scoringFormat[d.statId]?.abbr}` : ""}`;
      res.statPattern[label] = (res.statPattern[label] ?? 0) + 1;
    }
    res.mismatches.push({ name: pl.fullName, pos, espn: round2(espn), ours: round2(byPos.total), diffs: diffs.map((d) => `${d.statId}: ours ${d.ours} vs ESPN ${d.espn}`).join(", ") || "no per-stat difference in appliedStats" });
  }
  return res;
}

function computeOracles(ctx: Ctx, f: Fetched): OracleRun[] {
  const runs: OracleRun[] = [];
  const L = f.league;
  if (L)
    for (const { week, r } of f.rosterWeeks) {
      const parsed = r.outcome.ok ? LeagueSchema.pick({ teams: true }).safeParse(r.data) : undefined;
      if (!parsed?.success) continue;
      const players = rosterEntries(parsed.data).map((x) => x.e.playerPoolEntry.player);
      runs.push({
        key: `K.oracle.week${week}`,
        title: `Scoring oracle preview, week ${week}`,
        scope: "league",
        week,
        players,
        result: runOracle(ctx, players, L.settings.scoringSettings.scoringItems, week),
        ev: { url: r.call.template, status: r.res.status, path: "Σ scoringItems.points (pointsOverrides[defaultPositionId] replaces them) × stats[statId] vs appliedTotal", note: "direct in ESPN stat ids; Phase 1 repeats this through the canonical (Sleeper) keys (C.canonical)" },
      });
    }
  const PL = f.pubLeague;
  if (PL) {
    const items = PL.settings.scoringSettings.scoringItems;
    const week = PL.status.latestScoringPeriod - 1;
    const players = rosterEntries(PL).map((x) => x.e.playerPoolEntry.player);
    runs.push({
      key: `K.public.oracle.week${week}`,
      title: `Scoring oracle preview, public test league week ${week}`,
      scope: "public",
      week,
      players,
      result: runOracle(ctx, players, items, week),
      ev: { url: f.pub?.call.template, path: `stats[statSourceId=0, statSplitTypeId=1, scoringPeriodId=${week}] in the default mRoster view`, note: `different scoring (${items.length} rules, position-specific rushing)` },
    });
    for (const { week: w, r } of f.pubPool) {
      const ps = parsePlayers(r);
      if (!ps) continue;
      const pls = ps.map((x) => x.player);
      runs.push({
        key: `K.public.poolOracle.week${w}`,
        title: `Scoring oracle preview, public test league player pool week ${w}`,
        scope: "public",
        week: w,
        players: pls,
        result: runOracle(ctx, pls, items, w),
        ev: { url: r.call.template, status: r.res.status, path: `players[].player.stats[statSourceId=0, statSplitTypeId=1, scoringPeriodId=${w}].appliedTotal (no appliedStats in this view)`, note: `top ${PUBLIC_POOL} players by % owned, rostered or not: ESPN league-scores every player; TEs' rushing yards test the override keys` },
      });
    }
  }
  return runs;
}

/** Evidence on the override key space and on replace-vs-add, across every oracle run (deduped by player-week). */
function overrideEvidence(ctx: Ctx) {
  const keyCases = new Map<string, OracleResult["keyCases"][number]>();
  const modeCases = new Map<string, OracleResult["modeCases"][number]>();
  for (const o of ctx.oracles) {
    for (const c of o.result.keyCases) keyCases.set(c.key, c);
    for (const c of o.result.modeCases) modeCases.set(c.key, c);
  }
  const k = [...keyCases.values()];
  const m = [...modeCases.values()];
  return {
    keyCases: k,
    keyPos: k.filter((c) => c.okPos).length,
    keySlot: k.filter((c) => c.okSlot).length,
    modeCases: m,
    modeReplace: m.filter((c) => c.okReplace).length,
    modeAdd: m.filter((c) => c.okAdd).length,
  };
}

// ---------------------------------------------------------------- checks

/** The unparsed settings object (zod strips keys our schema doesn't list, so key scans must use this). */
function rawSettingsOf(raw: unknown): Record<string, unknown> | undefined {
  const s = (raw as { settings?: unknown } | undefined)?.settings;
  return s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : undefined;
}

function checkA(ctx: Ctx, L: League, tag: "" | "public.", url: string, raw: unknown) {
  const who = tag ? " (public test league)" : "";
  const k = (s: string) => `A.${tag}${s}`;
  const s = L.settings;
  const sch = s.scheduleSettings;
  const st = L.status;
  const rawSettings = rawSettingsOf(raw);
  const rawSched = rawSettings?.scheduleSettings && typeof rawSettings.scheduleSettings === "object" ? (rawSettings.scheduleSettings as Record<string, unknown>) : {};
  const byeKeys = Object.keys(rawSched).filter((x) => /bye/i.test(x));

  add(ctx, L.seasonId === ctx.season ? "ok" : "warn", "A", k("season"), `Season${who}`, `seasonId ${L.seasonId}`, { url, path: "seasonId", sample: L.seasonId });
  add(ctx, "ok", "A", k("currentWeek"), `Current week${who}`, `status.currentMatchupPeriod ${st.currentMatchupPeriod}, status.latestScoringPeriod ${st.latestScoringPeriod} (NFL week), top-level scoringPeriodId ${L.scoringPeriodId ?? "?"}; season runs scoring periods ${st.firstScoringPeriod ?? "?"}–${st.finalScoringPeriod ?? "?"}`, {
    path: "status.currentMatchupPeriod / status.latestScoringPeriod / status.finalScoringPeriod",
    sample: { currentMatchupPeriod: st.currentMatchupPeriod, latestScoringPeriod: st.latestScoringPeriod, finalScoringPeriod: st.finalScoringPeriod },
  });
  add(ctx, s.size === L.teams.length ? "ok" : "warn", "A", k("numTeams"), `Number of teams${who}`, `settings.size ${s.size}; teams[] has ${L.teams.length}`, { path: "settings.size", sample: s.size });

  const mpc = sch.matchupPeriodCount;
  const periods = Object.entries(sch.matchupPeriods)
    .map(([mp, weeks]) => ({ mp: Number(mp), weeks }))
    .sort((a, b) => a.mp - b.mp);
  const regular = periods.filter((x) => x.mp <= mpc);
  const playoff = periods.filter((x) => x.mp > mpc);
  const regWeeks = regular.flatMap((x) => x.weeks);
  const multiWeek = regular.filter((x) => x.weeks.length !== 1);
  add(ctx, regular.length === mpc && !multiWeek.length ? "ok" : "warn", "A", k("regularSeason"), `Regular-season weeks${who}`, `matchupPeriodCount ${mpc}; matchupPeriods 1–${mpc} → NFL weeks ${regWeeks[0]}–${regWeeks[regWeeks.length - 1]}${multiWeek.length ? `; multi-week matchup periods: ${multiWeek.map((x) => `${x.mp}→[${x.weeks.join(",")}]`).join(" ")}` : " (one NFL week per matchup period)"}`, {
    path: "settings.scheduleSettings.matchupPeriodCount + matchupPeriods",
    sample: Object.fromEntries(periods.slice(0, 3).map((x) => [x.mp, x.weeks])),
  });

  const playoffWeeks = playoff.flatMap((x) => x.weeks);
  add(ctx, playoff.length ? "ok" : "warn", "A", k("playoffStart"), `Playoff start week${who}`, playoff.length ? `playoffs = matchup periods ${playoff.map((x) => x.mp).join(", ")} → NFL weeks [${playoffWeeks.join(", ")}]; starts NFL week ${playoffWeeks[0]}` : "no matchup periods beyond matchupPeriodCount", {
    path: `settings.scheduleSettings.matchupPeriods["${mpc + 1}"…]`,
    sample: Object.fromEntries(playoff.map((x) => [x.mp, x.weeks])),
  });
  add(ctx, "ok", "A", k("playoffTeams"), `Playoff teams${who}`, `playoffTeamCount ${sch.playoffTeamCount}; seeding tiebreak rule ${sch.playoffSeedingRule ?? "?"}; reseed ${sch.playoffReseed ?? "?"}`, { path: "settings.scheduleSettings.playoffTeamCount / playoffSeedingRule", sample: { playoffTeamCount: sch.playoffTeamCount, playoffSeedingRule: sch.playoffSeedingRule } });

  const rounds = playoff.length;
  const teams = sch.playoffTeamCount;
  const bracket = 2 ** Math.ceil(Math.log2(Math.max(1, teams)));
  const byes = bracket - teams;
  const consistent = Math.ceil(Math.log2(Math.max(1, teams))) === rounds;
  add(ctx, "warn", "A", k("playoffByes"), `Playoff byes${who}`, `derived, not a field (keys of settings.scheduleSettings matching /bye/: ${byeKeys.join(", ") || "none"} of ${Object.keys(rawSched).length}): ${teams} teams in ${rounds} round(s) → bracket of ${bracket} → ${byes} bye(s) for the top seed(s)${consistent ? "" : " (round count doesn't match log2(teams): check)"}`, {
    path: "settings.scheduleSettings.playoffTeamCount + number of playoff matchup periods",
    sample: { playoffTeamCount: teams, playoffRounds: rounds, byes },
    note: "byes = next power of two − playoff teams",
  });
  add(ctx, "ok", "A", k("playoffRoundLength"), `Playoff round length${who}`, `playoffMatchupPeriodLength ${sch.playoffMatchupPeriodLength ?? "?"}; variablePlayoffMatchupPeriodLength ${sch.variablePlayoffMatchupPeriodLength ?? "?"}; playoffMatchupPeriodLengthByRound ${JSON.stringify(sch.playoffMatchupPeriodLengthByRound ?? {})}; weeks per playoff period [${playoff.map((x) => x.weeks.length).join(", ")}]`, {
    path: "settings.scheduleSettings.playoffMatchupPeriodLength / variablePlayoffMatchupPeriodLength / playoffMatchupPeriodLengthByRound",
    sample: sch.playoffMatchupPeriodLength,
  });

  const dl = s.tradeSettings.deadlineDate;
  if (dl) {
    const wk = weekOfInstant(dl, ctx.windows);
    const days = Math.round((dl - Date.now()) / 86_400_000);
    add(ctx, wk.week !== null ? "ok" : "warn", "A", k("tradeDeadline"), `Trade deadline${who}`, `${iso(dl)} (${days} days from now); ${wk.week !== null ? `falls in NFL week ${wk.week} (${wk.phase === "before-kickoff" ? "before that week's first kickoff, so a trade made by the deadline can count from week " + wk.week + " on, review period permitting" : "during that week's games"})` : "NFL week unknown (pro schedule missing)"}`, {
      path: "settings.tradeSettings.deadlineDate (epoch ms)",
      sample: dl,
      note: "week = the NFL week whose window (after the previous week's last kickoff, up to its own last kickoff) contains the instant; windows from proTeamSchedules_wl",
    });
  } else add(ctx, "warn", "A", k("tradeDeadline"), `Trade deadline${who}`, "no settings.tradeSettings.deadlineDate (no deadline set?)", { path: "settings.tradeSettings.deadlineDate", sample: null });

  const t = s.tradeSettings;
  const teamActions = typeNameList(ctx.typeNames, "transactionTeamActionTypes");
  add(ctx, "warn", "A", k("tradeReview"), `Trade review / veto${who}`, `revisionHours ${t.revisionHours ?? "?"}, vetoVotesRequired ${t.vetoVotesRequired ?? "?"}, max ${t.max ?? "?"} (−1 = no limit?), allowOutOfUniverse ${t.allowOutOfUniverse ?? "?"}. Inferred, not verified: a ${t.revisionHours ?? "?"}-hour review period in which ${t.vetoVotesRequired ?? "?"} votes veto → ${(t.vetoVotesRequired ?? 0) > 0 ? "'league_vote'" : "'commissioner' or 'none'"}; ESPN's typeNames.transactionTeamActionTypes = [${teamActions.join(", ") || "?"}]`, {
    path: "settings.tradeSettings.revisionHours / vetoVotesRequired / max",
    sample: t,
    note: cite(ctx, "espn_api/base_settings.py", ['data["tradeSettings"]["vetoVotesRequired"]', '"revisionHours"'], "espn-api reads vetoVotesRequired and revisionHours but documents no meaning"),
  });

  const lt = leagueTypeOf(L);
  const ds = s.draftSettings;
  const subTypes = typeNameList(ctx.typeNames, "leagueSubTypes");
  const typeNote = subTypes.some((x) => /keeper|dynasty/i.test(x)) ? `typeNames.leagueSubTypes [${subTypes.join(", ")}] names keeper/dynasty: check` : `ESPN has no dynasty flag: typeNames.leagueSubTypes = [${subTypes.join(", ") || "?"}]`;
  add(ctx, lt.inferred ? "warn" : "ok", "A", k("leagueType"), `League type${who}`, `${lt.type} (${lt.why}${lt.inferred ? "; INFERRED" : "; keeperCount 0 settles it"}); keeperCountFuture ${ds?.keeperCountFuture ?? "?"}, leagueSubType ${ds?.leagueSubType ?? "?"}, draft type ${ds?.type ?? "?"}. ${typeNote}. Rule for other leagues, inferred and untested (no ESPN keeper or dynasty league probed): keeperCount ≥ active roster → dynasty, else keeper. Unexplained, not used: status.createdAsLeagueType ${st.createdAsLeagueType ?? "?"} / currentLeagueType ${st.currentLeagueType ?? "?"}`, {
    path: "settings.draftSettings.keeperCount / keeperCountFuture / leagueSubType",
    sample: { keeperCount: ds?.keeperCount, keeperCountFuture: ds?.keeperCountFuture, leagueSubType: ds?.leagueSubType },
  });

  const medianHits: string[] = [];
  const scan = (v: unknown, p: string) => {
    if (typeof v === "string" && /median|top_half|win_bonus/i.test(v)) medianHits.push(`${p}=${v}`);
    else if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${p}[${i}]`));
    else if (v && typeof v === "object")
      for (const [key, x] of Object.entries(v)) {
        if (/median|enhancement/i.test(key)) medianHits.push(`${p}.${key}`);
        scan(x, `${p}.${key}`);
      }
  };
  scan(rawSettings ?? s, "settings");
  const enh = s.scoringSettings.scoringEnhancementType;
  add(ctx, "ok", "A", k("medianGame"), `Median game${who}`, enh ? `scoringEnhancementType=${enh} → ${enh === "WIN_BONUS_TOP_HALF" ? "median game ON" : "off (only WIN_BONUS_TOP_HALF means a median game)"}` : `off: no scoringSettings.scoringEnhancementType and no median-like key/value anywhere in the raw settings (${Object.keys(rawSettings ?? {}).length} top-level keys)${medianHits.length ? ` (hits: ${medianHits.join(", ")})` : ""}`, {
    path: "settings.scoringSettings.scoringEnhancementType",
    sample: enh ?? null,
    note: cite(ctx, "espn_api/base_settings.py", ["median_scoring", '"WIN_BONUS_TOP_HALF"'], "espn-api: median_scoring = scoringEnhancementType == 'WIN_BONUS_TOP_HALF'"),
  });
  const h2h = (L.schedule ?? []).some((m) => m.home && m.away);
  add(ctx, s.scoringSettings.scoringType === "H2H_POINTS" ? "ok" : "warn", "A", k("pointsOnly"), `Points-only${who}`, `scoringType ${s.scoringSettings.scoringType ?? "?"}${h2h ? "; schedule has head-to-head pairs" : L.schedule ? "; no head-to-head pairs in schedule" : ""} → pointsOnly ${s.scoringSettings.scoringType === "H2H_POINTS" ? "false" : "unknown"}; matchupTieRule ${s.scoringSettings.matchupTieRule ?? "?"}; homeTeamBonus ${s.scoringSettings.homeTeamBonus ?? "?"}`, {
    path: "settings.scoringSettings.scoringType",
    sample: s.scoringSettings.scoringType,
  });
  const divs = sch.divisions ?? [];
  const teamDivs = countBy(L.teams, (x) => x.divisionId);
  add(ctx, "ok", "A", k("divisions"), `Divisions${who}`, `${divs.length} division(s) (sizes ${divs.map((d) => d.size ?? "?").join("/")}); teams[].divisionId: ${fmtCounts(teamDivs)}${divs.length <= 1 ? " → effectively no divisions" : ""}`, { path: "settings.scheduleSettings.divisions[] / teams[].divisionId", sample: divs.map((d) => ({ id: d.id, size: d.size })) });
  if (!tag) {
    const acq = s.acquisitionSettings;
    add(ctx, "ok", "A", k("faab"), "FAAB", acq?.isUsingAcquisitionBudget ? `FAAB on, budget ${acq.acquisitionBudget}` : `no FAAB (isUsingAcquisitionBudget false; acquisitionBudget ${acq?.acquisitionBudget ?? "?"} is ignored); acquisitionType ${acq?.acquisitionType ?? "?"}`, { path: "settings.acquisitionSettings.isUsingAcquisitionBudget / acquisitionBudget", sample: acq });
  }
}

function slotEligibility(ctx: Ctx, players: Player[]): Map<number, string[]> {
  const out = new Map<number, Set<string>>();
  for (const pl of players) {
    const pos = positionOf(ctx, pl);
    for (const slot of pl.eligibleSlots) {
      const set = out.get(slot) ?? new Set<string>();
      set.add(pos);
      out.set(slot, set);
    }
  }
  return new Map([...out].map(([k, v]) => [k, [...v].sort()]));
}

function checkB(ctx: Ctx, L: League, tag: "" | "public.", eligible: Map<number, string[]>, raw: unknown) {
  const who = tag ? " (public test league)" : "";
  const k = (s: string) => `B.${tag}${s}`;
  const rs = L.settings.rosterSettings;
  const counts = slotCounts(L);
  const unknown = counts.filter((s) => s.count > 0 && !ctx.c?.slotNames[s.id]);
  const starters = counts.filter((s) => s.count > 0 && !NON_STARTING.has(s.id));
  const describe = (s: { id: number; count: number }) => `${slotName(ctx, s.id)}(${s.id})×${s.count}${eligible.get(s.id) ? ` [${eligible.get(s.id)?.join("/")}]` : ""}`;
  add(ctx, unknown.length ? "fail" : "ok", "B", k("starters"), `Starting slots${who}`, `${starters.map(describe).join(", ")}; ${starters.reduce((a, s) => a + s.count, 0)} starters${unknown.length ? `; UNKNOWN slot ids with count > 0: ${unknown.map((s) => s.id).join(", ")}` : ""}`, {
    path: "settings.rosterSettings.lineupSlotCounts (slotId → count; names from espn-api POSITION_MAP)",
    sample: Object.fromEntries(counts.filter((s) => s.count > 0).map((s) => [s.id, s.count])),
    note: "[eligible positions] derived from rostered players' eligibleSlots",
  });
  const flexIds = counts.filter((s) => (slotName(ctx, s.id).includes("/") && s.id !== 16) || slotName(ctx, s.id) === "OP");
  add(ctx, "ok", "B", k("flex"), `FLEX / superflex slots${who}`, flexIds.map((s) => `${slotName(ctx, s.id)}(${s.id})=${s.count}`).join(", ") + ` → superflex/OP ${counts.find((s) => slotName(ctx, s.id) === "OP")?.count ? "YES" : "no"}`, { path: "settings.rosterSettings.lineupSlotCounts[3|5|7|23]", sample: Object.fromEntries(flexIds.map((s) => [s.id, s.count])) });
  const kd = counts.filter((s) => ["K", "D/ST", "P", "HC"].includes(slotName(ctx, s.id)));
  const idp = counts.filter((s) => s.id >= 8 && s.id <= 15);
  add(ctx, "ok", "B", k("kDstIdp"), `K, D/ST and IDP slots${who}`, `${kd.map((s) => `${slotName(ctx, s.id)}=${s.count}`).join(", ")}; IDP slots (8–15: ${idp.map((s) => slotName(ctx, s.id)).join("/")}) total ${idp.reduce((a, s) => a + s.count, 0)}`, { path: "settings.rosterSettings.lineupSlotCounts[8..17]", sample: Object.fromEntries([...kd, ...idp].map((s) => [s.id, s.count])) });
  const bench = counts.find((s) => s.id === BENCH)?.count ?? 0;
  const ir = counts.find((s) => s.id === IR)?.count ?? 0;
  const perTeam = L.teams.map((t) => {
    const e = t.roster?.entries ?? [];
    return { id: t.id, total: e.length, ir: e.filter((x) => x.lineupSlotId === IR).length, bench: e.filter((x) => x.lineupSlotId === BENCH).length };
  });
  const maxBench = Math.max(0, ...perTeam.map((x) => x.bench));
  const maxIr = Math.max(0, ...perTeam.map((x) => x.ir));
  add(ctx, rs.isBenchUnlimited ? "warn" : "ok", "B", k("benchIr"), `Bench and IR${who}`, `BE(20)=${bench}, IR(21)=${ir}; isBenchUnlimited ${rs.isBenchUnlimited ?? "?"}${rs.isBenchUnlimited ? " (meaning unclear next to a bench count; treat BE count as the limit)" : ""}; observed max per team: bench ${maxBench}, IR ${maxIr}`, {
    path: "settings.rosterSettings.lineupSlotCounts[20|21] / isBenchUnlimited",
    sample: { bench, ir, isBenchUnlimited: rs.isBenchUnlimited },
  });
  const rawRs = rawSettingsOf(raw)?.rosterSettings;
  const rsKeys = Object.keys(rawRs && typeof rawRs === "object" ? rawRs : rs);
  const taxiSlots = Object.entries(ctx.c?.slotNames ?? {}).filter(([, name]) => /taxi/i.test(name));
  add(ctx, "na", "B", k("taxi"), `Taxi squad${who}`, `no taxi squad on ESPN: no taxi-like key in the raw rosterSettings (${rsKeys.length} keys) and ${taxiSlots.length} taxi slots in espn-api POSITION_MAP (${Object.keys(ctx.c?.slotNames ?? {}).length} slot ids)`, { path: "settings.rosterSettings", sample: rsKeys.filter((x) => /taxi/i.test(x)) });
  const limits = Object.entries(rs.positionLimits ?? {}).map(([k2, v]) => ({ id: Number(k2), v }));
  add(ctx, "warn", "B", k("positionLimits"), `Position limits${who}`, `${limits
    .filter((l) => l.v !== -1)
    .map((l) => `${posName(ctx, l.id)}(${l.id})=${l.v}`)
    .join(", ")} (others −1). Read as max players per defaultPositionId (same key space as pointsOverrides; E.defaultPosition), −1 = no limit, 0 = not allowed: inferred, not documented`, { path: "settings.rosterSettings.positionLimits", sample: rs.positionLimits });
  const active = counts.filter((s) => s.id !== IR).reduce((a, s) => a + s.count, 0);
  const maxActive = Math.max(0, ...perTeam.map((x) => x.total - x.ir));
  add(ctx, maxActive <= active ? "ok" : "warn", "B", k("maxRosterSize"), `Max roster size${who}`, `active roster = Σ lineupSlotCounts except IR = ${active} (${starters.reduce((a, s) => a + s.count, 0)} starters + ${bench} bench), plus ${ir} IR; observed max active per team ${maxActive}, sizes ${perTeam.map((x) => x.total).join("/")}`, {
    path: "Σ settings.rosterSettings.lineupSlotCounts[slot ≠ 21]",
    sample: active,
  });
}

/** "53 REC=0.5 {TE(4):1}": override keys are shown as defaultPositionIds with their position (see K.overrideKeys). */
function scoringLine(ctx: Ctx, i: ScoringItem): string {
  const f = ctx.c?.scoringFormat[i.statId];
  const o = i.pointsOverrides && Object.keys(i.pointsOverrides).length ? ` {${Object.entries(i.pointsOverrides).map(([key, pts]) => `${posName(ctx, key)}(${key}):${pts}`).join(", ")}}` : "";
  return `${i.statId} ${f ? f.abbr : "UNNAMED"}=${i.points}${o}`;
}

/** pointsOverrides key for a position name (position ids, per K.overrideKeys). */
function keyForPosition(ctx: Ctx, pos: string): string | undefined {
  const hit = Object.entries(ctx.posById).find(([, p]) => p === pos);
  return hit?.[0];
}

function replaceVsAddText(ctx: Ctx): string {
  const e = overrideEvidence(ctx);
  return e.modeCases.length ? `on ${e.modeCases.length} player-weeks where "replace" and "add" give different totals, replace matched ESPN ${e.modeReplace} times and add ${e.modeAdd} times (positions ${fmtCounts(countBy(e.modeCases, (c) => c.pos))})` : "no player-week in this data tells replace and add apart";
}

function checkC(ctx: Ctx, L: League, tag: "" | "public.") {
  const who = tag ? " (public test league)" : "";
  const k = (s: string) => `C.${tag}${s}`;
  const items = [...L.settings.scoringSettings.scoringItems].sort((a, b) => a.statId - b.statId);
  const by = (ids: number[]) => items.filter((i) => ids.includes(i.statId));
  const group = (title: string, key: string, ids: number[], emptyText = "none") => {
    const hit = by(ids);
    add(ctx, "ok", "C", k(key), `${title}${who}`, hit.length ? hit.map((i) => scoringLine(ctx, i)).join("; ") : emptyText, { path: "settings.scoringSettings.scoringItems[].{statId,points,pointsOverrides}", sample: hit.slice(0, 4).map((i) => ({ statId: i.statId, points: i.points, pointsOverrides: i.pointsOverrides })) });
  };
  const unnamed = items.filter((i) => !ctx.c?.scoringFormat[i.statId]);
  add(ctx, unnamed.length ? "warn" : "ok", "C", k("items"), `Scoring rules${who}`, `${items.length} scoringItems; ${items.length - unnamed.length} have an espn-api SETTINGS_SCORING_FORMAT_MAP name${unnamed.length ? `; stat ids WITHOUT a name: ${unnamed.map((i) => `${i.statId}=${i.points}`).join(", ")}` : ", every statId has one"} (espn-api names only: the mapping to the canonical Sleeper keys is C.${tag}canonical); isReverseItem true on ${items.filter((i) => i.isReverseItem).length}. All rules (statId abbr=points {position(defaultPositionId):override}): ${items.map((i) => scoringLine(ctx, i)).join("; ")}`, {
    path: "settings.scoringSettings.scoringItems[]",
    sample: items.slice(0, 3).map((i) => ({ statId: i.statId, points: i.points, pointsOverrides: i.pointsOverrides, isReverseItem: i.isReverseItem })),
  });

  const rec = by([41, 53, 54, 55]);
  const teKey = keyForPosition(ctx, "TE") ?? "4";
  const teRec = rec.map((i) => i.pointsOverrides?.[teKey]).find((v) => v !== undefined);
  const posRec = rec.flatMap((i) => Object.entries(i.pointsOverrides ?? {}).map(([key, pts]) => `${posName(ctx, key)}(${key})=${pts}`));
  add(ctx, "ok", "C", k("receptions"), `Reception points${who}`, `${rec.map((i) => scoringLine(ctx, i)).join("; ") || "no reception scoring (standard)"} → ${receptionPoints(L)} per reception; position-specific: ${posRec.length ? posRec.join(", ") : "none"}; TE premium ${teRec !== undefined && teRec > receptionPoints(L) ? `YES (TE ${teRec})` : "no"}`, {
    path: `settings.scoringSettings.scoringItems[statId 41|53].points / pointsOverrides['${teKey}'] (TE's defaultPositionId)`,
    sample: rec.map((i) => ({ statId: i.statId, points: i.points, pointsOverrides: i.pointsOverrides })),
  });
  group("Passing", "passing", range(0, 22));
  group("Rushing", "rushing", range(23, 40));
  group("Receiving yards/TDs", "receiving", [42, 43, 44, 45, 46, ...range(47, 52), ...range(56, 61)]);
  group("Turnovers and fumbles", "turnovers", [20, ...range(64, 73)]);
  group("2-point conversions", "twoPoint", [19, 26, 44, 62]);
  group("First downs", "firstDowns", [211, 212, 213], "none (stat ids 211–213 absent)");
  group("Yardage / long-TD bonuses", "bonuses", [15, 16, 17, 18, 35, 36, 37, 38, 45, 46, 56, 57, ...range(175, 186)], "none");
  group("Kicking", "kicker", [...range(74, 88), ...range(198, 203), ...range(214, 234)]);
  group("D/ST", "dst", [...range(89, 105), ...range(114, 136), ...range(187, 197), ...range(204, 209)]);
  // IDP rules: overrides keyed by an IDP position id (DT/DE/LB/CB/S…), or tackle/pass-defensed stats scored for everyone.
  const idpKeys = new Set(Object.entries(ctx.posById).filter(([, p]) => ["DT", "DE", "LB", "DL", "CB", "S", "DB", "DP"].includes(p)).map(([key]) => key));
  const idp = items.filter((i) => Object.keys(i.pointsOverrides ?? {}).some((key) => idpKeys.has(key)) || ([107, 108, 109, 110, 111, 112, 113].includes(i.statId) && i.points !== 0));
  add(ctx, "ok", "C", k("idp"), `IDP scoring${who}`, idp.length ? idp.map((i) => scoringLine(ctx, i)).join("; ") : "none", { path: `scoringItems[statId 107–113, or overrides keyed by IDP position ids ${[...idpKeys].join("/")}]`, sample: idp.length });
  const overrides = items.filter((i) => i.pointsOverrides && Object.keys(i.pointsOverrides).length);
  const keysUsed = countBy(
    overrides.flatMap((i) => Object.keys(i.pointsOverrides ?? {})),
    (key) => `${posName(ctx, key)}(${key})`,
  );
  const ev = overrideEvidence(ctx);
  add(ctx, "ok", "C", k("overrides"), `Position-specific points${who}`, `${overrides.length} items have pointsOverrides, by key: ${fmtCounts(keysUsed) || "none"}. Keys are defaultPositionIds (position-id reading matched ${ev.keyPos}/${ev.keyCases.length} discriminating player-weeks, slot-id reading ${ev.keySlot}) and an override REPLACES the base points: ${replaceVsAddText(ctx)} (base 0 + D/ST override = a D/ST-only rule). Details: K.overrideKeys`, {
    path: "settings.scoringSettings.scoringItems[].pointsOverrides (defaultPositionId → points)",
    sample: overrides.slice(0, 3).map((i) => ({ statId: i.statId, points: i.points, pointsOverrides: i.pointsOverrides })),
  });
  const noStatName = items.filter((i) => ctx.c && !ctx.c.playerStats[i.statId]);
  if (noStatName.length) add(ctx, "ok", "C", k("statNames"), `Stat names${who}`, `scoring stat ids without a PLAYER_STATS_MAP name (named only in SETTINGS_SCORING_FORMAT_MAP): ${noStatName.map((i) => `${i.statId} ${ctx.c?.scoringFormat[i.statId]?.abbr ?? "?"}`).join(", ")}`, { path: "espn-api PLAYER_STATS_MAP", sample: noStatName.map((i) => i.statId) });
  const canon = checkCanonical(ctx, L, tag);
  if (!tag) ctx.canonical = canon;
}

interface CanonicalSummary {
  rules: CanonicalRule[];
  groups: Record<CanonicalGroup, CanonicalRule[]>;
  atRisk: number;
  dstLines: number;
  rawPresent: number;
  checkedPlayerWeeks: number;
  weeks: number[];
}

/** ESPN's points-allowed buckets (every "… points allowed" label with a range, deduped). */
function espnPointsAllowedBuckets(c: EspnConstants): Range[] {
  const seen = new Map<string, Range>();
  for (const f of Object.values(c.scoringFormat)) {
    if (!/points allowed$/i.test(f.label)) continue;
    const r = parseEspnRange(f.label);
    if (r) seen.set(fmtRange(r), r);
  }
  return [...seen.values()].sort((a, b) => a.lo - b.lo);
}

/**
 * C.canonical: how each ESPN rule maps to the canonical Sleeper keys (§5), and how many completed
 * D/ST lines landed where ESPN's and Sleeper's points-allowed buckets differ.
 */
function checkCanonical(ctx: Ctx, L: League, tag: "" | "public."): CanonicalSummary | undefined {
  const who = tag ? " (public test league)" : "";
  const key = `C.${tag}canonical`;
  const c = ctx.c;
  if (!c) {
    add(ctx, "fail", "C", key, `Canonical (Sleeper) keys${who}`, "espn-api constant.py not parsed, so rule labels are unknown");
    return undefined;
  }
  const items = L.settings.scoringSettings.scoringItems;
  const rules = [...items].sort((a, b) => a.statId - b.statId).map((i) => classifyRule(i.statId, c.scoringFormat[i.statId]?.abbr ?? `stat${i.statId}`, c.scoringFormat[i.statId]?.label ?? ""));
  const merges = mergeGroups(rules, items);
  const unequal = new Set(merges.filter((m) => !m.equalRates).flatMap((m) => m.statIds));
  const groups: Record<CanonicalGroup, CanonicalRule[]> = { oneToOne: [], severalKeys: [], derivedRule: [], noKey: [] };
  for (const r of rules) groups[groupOf(r.kind, unequal.has(r.statId))].push(r);
  const fmt = (r: CanonicalRule) => `${r.statId} ${r.abbr}${r.note ? ` (${r.note})` : ""}`;
  const split = groups.oneToOne.filter((r) => r.kind === "split");
  const missing = rules.flatMap((r) => r.missing.map((m) => `${r.statId}→${m}`));
  const overlaps = [...new Set(rules.map((r) => r.family).filter((x): x is string => !!x))].flatMap((fam) => bucketOverlaps(sleeperBuckets(fam)));

  // Completed weeks: D/ST lines whose raw points allowed falls where ESPN's and Sleeper's buckets differ.
  const runs = ctx.oracles.filter((o) => o.scope === (tag ? "public" : "league") && (tag ? o.key.startsWith("K.public.oracle") : true));
  const espnPA = espnPointsAllowedBuckets(c);
  const sleeperPA = sleeperBuckets("pts_allow");
  let dstLines = 0;
  let rawPresent = 0;
  let atRisk = 0;
  for (const run of runs)
    for (const pl of run.players) {
      if (positionOf(ctx, pl) !== "D/ST") continue;
      const line = findStat(pl, ctx.season, 0, 1, run.week);
      if (!line) continue;
      dstLines++;
      const raw = line.stats?.["120"];
      if (raw === undefined) continue;
      rawPresent++;
      const e = espnPA.find((r) => raw >= r.lo && (r.hi === null || raw <= r.hi));
      const s = bucketOf(raw, sleeperPA);
      if (!e || !s || e.lo !== s.lo || e.hi !== s.hi) atRisk++;
    }
  const checkedPlayerWeeks = runs.reduce((a, o) => a + o.result.checked, 0);
  const weeks = runs.map((o) => o.week);
  const usesPA = rules.some((r) => r.family === "pts_allow");
  const impact = usesPA && dstLines ? ` Completed week(s) ${weeks.join(" and ")}: ${atRisk} of ${dstLines} rostered D/ST lines had points allowed where ESPN's bucket (${espnPA.map(fmtRange).join(", ")}) differs from Sleeper's (${sleeperPA.map((b) => fmtRange(b)).join(", ")}): ${pct(atRisk, checkedPlayerWeeks)} of the ${checkedPlayerWeeks} player-weeks in the oracle. Raw points allowed (stat 120 ${c.scoringFormat[120]?.abbr ?? "?"} → Sleeper pts_allow) is on ${rawPresent}/${dstLines} of those lines, so a derived rule is computable.` : "";
  const mergeTxt = merges.length ? ` Shared Sleeper keys: ${merges.map((m) => `${m.key} ← ${m.statIds.join(", ")} (${m.equalRates ? "equal points, one rate works" : "DIFFERENT points: needs a derived rule"})`).join("; ")}.` : "";
  add(
    ctx,
    "warn",
    "C",
    key,
    `Canonical (Sleeper) keys${who}`,
    `${rules.length} rules. 1:1 Sleeper key: ${groups.oneToOne.length}${split.length ? ` (split by player/team defense: ${split.map((r) => `${r.statId} ${r.abbr}`).join(", ")})` : ""}. Exact via several Sleeper keys: ${groups.severalKeys.length}${groups.severalKeys.length ? ` — ${groups.severalKeys.map(fmt).join("; ")}` : ""}. Need a derived rule: ${groups.derivedRule.length}${groups.derivedRule.length ? ` — ${groups.derivedRule.map(fmt).join("; ")}` : ""}. No Sleeper key: ${groups.noKey.length}${groups.noKey.length ? ` — ${groups.noKey.map(fmt).join("; ")}` : ""}.${mergeTxt} Candidate keys Sleeper didn't return in Phase 0: ${missing.join(", ") || "none"}.${overlaps.length ? ` Sleeper bucket names that overlap (boundary unverified): ${overlaps.join("; ")}.` : ""}${impact} Ranges are computed from espn-api labels and Sleeper key names; the other candidates are judgement (scripts/lib/espn/canonical.ts) until the Phase 1 oracle recomputes ESPN's points through Sleeper keys.`,
    {
      path: "scoringItems[].statId → espn-api SETTINGS_SCORING_FORMAT_MAP label → Sleeper stat key",
      sample: Object.fromEntries(rules.slice(0, 6).map((r) => [r.statId, r.keys.join("+") || r.kind])),
      note: "Sleeper key reference: scoring_settings and stats keys seen by the Phase 0 Sleeper probe",
    },
  );
  return { rules, groups, atRisk, dstLines, rawPresent, checkedPlayerWeeks, weeks };
}

function checkD(ctx: Ctx, L: League, url: string) {
  const members = L.members ?? [];
  const owners = L.teams.map((t) => t.owners ?? []);
  const coOwned = L.teams.filter((t) => (t.owners?.length ?? 0) > 1);
  const ids = L.teams.map((t) => t.id).sort((a, b) => a - b);
  add(ctx, "ok", "D", "D.teams", "Teams", `${L.teams.length} teams, ids [${ids.join(", ")}]; every team has name ${L.teams.every((t) => t.name) ? "yes" : "NO"}, abbrev ${L.teams.every((t) => t.abbrev) ? "yes" : "NO"}, logo ${L.teams.filter((t) => t.logo).length}/${L.teams.length}`, {
    url,
    path: "teams[].id / name / abbrev / logo",
    sample: { id: L.teams[0]?.id, name: `Team ${L.teams[0]?.id}`, abbrev: `T${L.teams[0]?.id}` },
    note: "names/abbrevs sanitized to Team N / TN",
  });
  add(ctx, "ok", "D", "D.owners", "Owners", `${members.length} members (displayName ${members.filter((m) => m.displayName).length}, firstName ${members.filter((m) => m.firstName).length}, lastName ${members.filter((m) => m.lastName).length}); owners per team: ${fmtCounts(countBy(owners, (o) => o.length))}; co-owned teams: ${coOwned.length}; primaryOwner on ${L.teams.filter((t) => t.primaryOwner).length} teams; members without a team: ${members.filter((m) => !owners.some((o) => o.includes(m.id))).length}`, {
    path: "members[].id (SWID) / displayName / firstName / lastName; teams[].owners[] / primaryOwner",
    sample: { id: ctx.p.redactor.placeholderOf(members[0]?.id), displayName: ctx.p.redactor.placeholderOf(members[0]?.displayName) },
  });
  const swid = ctx.auth.swid;
  if (!swid) {
    add(ctx, "warn", "D", "D.myTeam", "Parker's team", "ESPN_SWID is blank, so the team can't be detected; the UI must ask which team is Parker's", { path: "teams[].owners[]" });
    return;
  }
  const norm = (x: string) => x.replace(/^\{|\}$/g, "").toUpperCase();
  const mine = L.teams.filter((t) => (t.owners ?? []).some((o) => norm(o) === norm(swid)));
  const primary = L.teams.filter((t) => t.primaryOwner && norm(t.primaryOwner) === norm(swid));
  const member = members.find((m) => norm(m.id) === norm(swid));
  ctx.myTeamId = mine[0]?.id;
  add(ctx, mine.length === 1 ? "ok" : "fail", "D", "D.myTeam", "Parker's team", mine.length === 1 ? `Team ${mine[0]?.id} (teams[].owners[] contains ESPN_SWID; primaryOwner match ${primary.length === 1 ? "yes" : "no"}; member record ${member ? "found" : "missing"})` : `${mine.length} teams list ESPN_SWID in owners[]: check that ESPN_SWID belongs to an account in this league`, {
    path: "teams[].owners[] == ESPN_SWID (case-insensitive, braces kept)",
    sample: { teamId: mine[0]?.id, owner: ctx.p.redactor.placeholderOf(swid) },
  });
}

function checkE(ctx: Ctx, L: League, f: Fetched, url: string) {
  const all = rosterEntries(L);
  const players = all.map((x) => x.e.playerPoolEntry.player);
  add(ctx, all.length ? "ok" : "fail", "E", "E.rosters", "Rosters", `${all.length} roster entries on ${L.teams.length} teams (sizes ${L.teams.map((t) => t.roster?.entries.length ?? 0).join("/")}); lineupSlotId: ${fmtCounts(countBy(all, (x) => slotName(ctx, x.e.lineupSlotId)))}`, {
    url,
    path: "teams[].roster.entries[].{playerId, lineupSlotId, playerPoolEntry.player}",
    sample: { playerId: all[0]?.e.playerId, lineupSlotId: all[0]?.e.lineupSlotId, fullName: players[0]?.fullName },
  });
  const irEntries = all.filter((x) => x.e.lineupSlotId === IR);
  add(ctx, "ok", "E", "E.ir", "IR detection", `${irEntries.length} players in lineup slot 21 (IR); their injuryStatus: ${fmtCounts(countBy(irEntries, (x) => x.e.playerPoolEntry.player.injuryStatus ?? "(none)"))}`, { path: "teams[].roster.entries[].lineupSlotId == 21", sample: irEntries.length });

  // defaultPositionId → position over the whole active universe (players_wl) plus both leagues' rosters.
  const uni = universePlayers(f);
  const table = defaultPositionTable(ctx, [...uni, ...players, ...(f.pubLeague ? rosterEntries(f.pubLeague).map((x) => x.e.playerPoolEntry.player) : [])]);
  const ambiguous = [...table].filter(([, t]) => Object.keys(t).length > 1);
  // Cross-checks: Sleeper players DB (espn_id is sparse there) and the DynastyProcess crosswalk.
  const norm = (p: string) => (p === "DEF" || p === "DST" ? "D/ST" : p === "PK" ? "K" : p);
  const crossCheck = (source: string, byEspn: Map<string, string>) => {
    let compared = 0;
    const differ: string[] = [];
    for (const pl of players) {
      const theirs = byEspn.get(String(pl.id));
      if (!theirs) continue;
      compared++;
      const ours = positionOf(ctx, pl);
      if (norm(theirs) !== ours) differ.push(`${pl.fullName} (ESPN ${ours}, ${source} ${theirs})`);
    }
    return { compared, differ, text: `${source} agrees on ${compared - differ.length}/${compared} rostered players matched by espn_id (${players.length - compared} not matched)${differ.length ? `; differ: ${differ.slice(0, 5).join("; ")}` : ""}` };
  };
  const results: Array<{ compared: number; differ: string[]; text: string }> = [];
  if (f.sleeper) {
    const byEspn = new Map<string, string>();
    for (const sp of Object.values(f.sleeper)) if (sp.espn_id !== null && sp.espn_id !== undefined && sp.position) byEspn.set(String(sp.espn_id), sp.position);
    results.push(crossCheck("the Sleeper players DB", byEspn));
  }
  if (f.dp && "rows" in f.dp) {
    const byEspn = new Map<string, string>();
    for (const r of f.dp.rows) {
      const id = (r.espn_id ?? "").trim();
      if (id && id !== "NA" && r.position) byEspn.set(id, r.position.trim());
    }
    results.push(crossCheck("the DynastyProcess crosswalk", byEspn));
  }
  const disagreements = results.reduce((a, r) => a + r.differ.length, 0);
  const crossText = results.length ? results.map((r) => r.text).join("; ") : "no cross-check source available";
  add(ctx, ambiguous.length || disagreements || !results.length ? "warn" : "ok", "E", "E.defaultPosition", "Position (defaultPositionId)", `${[...table].map(([id, t]) => `${id}→${Object.keys(t).join("|")} (${Object.values(t).reduce((a, b) => a + b, 0)})`).join(", ")} over ${uni.length} active players (players_wl) + rosters; position derived the espn-api way (player.py: first eligibleSlot that isn't 25 or a combo slot), since espn-api has no defaultPositionId table. Cross-checks: ${crossText}${f.dp && "error" in f.dp ? `; DynastyProcess crosswalk unavailable (${f.dp.error})` : ""}`, {
    path: "player.defaultPositionId vs eligibleSlots",
    sample: Object.fromEntries([...table].map(([id, t]) => [id, Object.keys(t)[0]])),
    note: "DynastyProcess spells kickers PK; Sleeper and DynastyProcess have no espn_id for team D/ST",
  });
  const known = ["QB", "RB", "WR", "TE", "K", "D/ST", "DT", "DE", "LB", "CB", "S"];
  const extra = [...table].filter(([, t]) => Object.keys(t).some((p) => !known.includes(p)));
  const pubTqb = f.pubLeague ? slotCounts(f.pubLeague).find((s) => slotName(ctx, s.id) === "TQB" && s.count > 0) : undefined;
  const pubQb = f.pubLeague ? (slotCounts(f.pubLeague).find((s) => slotName(ctx, s.id) === "QB")?.count ?? 0) : 0;
  if (extra.length)
    ctx.p.cl.issue(
      `ESPN positions outside the spec's Pos union exist: ${extra.map(([id, t]) => `${Object.keys(t).join("|")} (defaultPositionId ${id}, ${Object.values(t).reduce((a, b) => a + b, 0)} players)`).join(", ")}.${pubTqb ? ` The public test league starts a TQB ("team QB", slot ${pubTqb.id}) ×${pubTqb.count}${pubQb ? ` next to ${pubQb} QB slot(s)` : " and no QB slot"}.` : ""} Options: (a) map TQB to QB for scoring/lineups and keep K/DEF-style handling, (b) add TQB to Pos, (c) mark such leagues unsupported in the Import Report. Evidence: E.defaultPosition, B.public.starters.`,
    );

  // Injury return dates: only on player cards (kona_playercard), not in the default roster view.
  const cards = playersFromCards(f);
  const injured = cards.filter((pl) => pl.injuryStatus && pl.injuryStatus !== "ACTIVE");
  const withDetails = injured.filter((pl) => pl.injuryDetails?.expectedReturnDate?.length === 3);
  const inMain = players.filter((pl) => pl.injuryDetails).length;
  // Month base: QUESTIONABLE/DOUBTFUL players are expected back within days, i.e. in the current week.
  const currentWeek = L.status.latestScoringPeriod;
  const shortTerm = withDetails.filter((pl) => pl.injuryStatus === "QUESTIONABLE" || pl.injuryStatus === "DOUBTFUL");
  const backNow = (monthOffset: number) =>
    shortTerm.filter((pl) => {
      const [y, m, d] = pl.injuryDetails?.expectedReturnDate ?? [];
      return weekOfInstant(Date.UTC(y ?? 0, (m ?? 1) - monthOffset, d ?? 1, 17), ctx.windows).week === currentWeek;
    }).length;
  const oneBased = backNow(1);
  const zeroBased = backNow(0);
  const samples = withDetails.slice(0, 4).map((pl) => {
    const [y, m, d] = pl.injuryDetails?.expectedReturnDate ?? [];
    const ms = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, 17);
    const wk = weekOfInstant(ms, ctx.windows);
    return `${pl.fullName} ${pl.injuryStatus} → ${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} (NFL week ${wk.week ?? "?"})${pl.injuryDetails?.outForSeason ? " out for season" : ""}`;
  });
  add(ctx, cards.length ? (withDetails.length && oneBased >= zeroBased ? "ok" : "warn") : "fail", "E", "E.injuryReturn", "Injury return dates", cards.length ? `player.injuryDetails {expectedReturnDate [y, m, d], outForSeason, type}; month read as 1-based: then ${oneBased}/${shortTerm.length} QUESTIONABLE/DOUBTFUL players are back in the current week ${currentWeek}, vs ${zeroBased} if read as 0-based. On ${withDetails.length}/${injured.length} injured rostered players in kona_playercard, ${inMain} in the default roster view; outForSeason ${withDetails.filter((pl) => pl.injuryDetails?.outForSeason).length}. This can fill Section 6's injuryReturnWeek; e.g. ${samples.join("; ")}` : "player cards not fetched", {
    url: f.cards[0]?.call.template,
    path: "players[].player.injuryDetails.{expectedReturnDate, outForSeason, type}",
    sample: withDetails[0]?.injuryDetails ? { expectedReturnDate: withDetails[0].injuryDetails.expectedReturnDate, outForSeason: withDetails[0].injuryDetails.outForSeason } : null,
  });
  const unknownTeams = players.filter((pl) => !ctx.c?.proTeams[pl.proTeamId]);
  add(ctx, unknownTeams.length ? "warn" : "ok", "E", "E.nflTeam", "NFL team", `proTeamId → abbreviation via espn-api PRO_TEAM_MAP: ${players.length - unknownTeams.length}/${players.length} known${unknownTeams.length ? `; unknown ids ${[...new Set(unknownTeams.map((x) => x.proTeamId))].join(", ")}` : ""}; PRO_TEAM_MAP[0] = ${JSON.stringify(ctx.c?.proTeams[0] ?? null)} (players without a team)`, { path: "playerPoolEntry.player.proTeamId", sample: { proTeamId: players[0]?.proTeamId, abbrev: ctx.c?.proTeams[players[0]?.proTeamId ?? -1] } });
  const inj = countBy(players, (pl) => pl.injuryStatus ?? "(missing)");
  const missing = players.filter((pl) => !pl.injuryStatus);
  const enumerated = typeNameList(ctx.typeNames, "injuryStatusTypes");
  const seenNoSpec = Object.keys(inj).filter((v) => v !== "(missing)" && !INJURY_TO_SPEC[v]);
  const enumNoSpec = enumerated.filter((v) => !INJURY_TO_SPEC[v] && !(v in inj));
  add(ctx, "warn", "E", "E.injury", "Injury status", `player.injuryStatus on rostered players: ${fmtCounts(inj)}; missing on ${missing.length} (positions ${fmtCounts(countBy(missing, (pl) => positionOf(ctx, pl))) || "none"}); entry-level injuryStatus is always ${fmtCounts(countBy(all, (x) => x.e.injuryStatus ?? "(missing)"))} (use the player's). Direct §4 values: ${Object.entries(INJURY_TO_SPEC).map(([k, v]) => (k === v ? k : `${k}→${v}`)).join(", ")}; seen here without one: ${[...seenNoSpec, ...(missing.length ? ["(missing)"] : [])].join(", ") || "none"}; ESPN also enumerates (typeNames.injuryStatusTypes, ${enumerated.length} values): ${enumNoSpec.join(", ") || "none"}. Needs a mapping decision`, {
    path: "playerPoolEntry.player.injuryStatus / injured; settings.typeNames.injuryStatusTypes (proTeamSchedules_wl)",
    sample: inj,
  });
  if (seenNoSpec.length || missing.length)
    ctx.p.cl.issue(
      `CLAUDE.md §4 PlayerInfo.injury has no value for some ESPN statuses: seen on rostered players ${seenNoSpec.map((v) => `${v}×${inj[v]}`).join(", ") || "none"}${missing.length ? `, and injuryStatus is missing on ${missing.length} rostered players (${fmtCounts(countBy(missing, (pl) => positionOf(ctx, pl)))})` : ""}; ESPN enumerates ${enumNoSpec.length} more without a §4 value (${enumNoSpec.join(", ")}). Options: (a) map DAY_TO_DAY/PROBABLE → QUESTIONABLE and missing → ACTIVE (proposal in Decisions), (b) extend the §4 union. Evidence: E.injury.`,
    );
  const neg = players.filter((pl) => pl.id < 0);
  add(ctx, "ok", "E", "E.playerIds", "Platform player IDs", `ESPN player ids (numbers); team defenses use negative ids (${neg.length} rostered, e.g. ${neg[0]?.id} = ${neg[0]?.fullName}); ${players.filter((pl) => pl.eligibleSlots.includes(25)).length} rostered players carry slot 25 ("${slotName(ctx, 25)}") in eligibleSlots`, { path: "teams[].roster.entries[].playerId == playerPoolEntry.id == player.id", sample: all.slice(0, 2).map((x) => x.e.playerId) });
}

function checkF(ctx: Ctx, L: League, f: Fetched, url: string) {
  const sched = L.schedule ?? [];
  if (!sched.length) return add(ctx, "fail", "F", "F.coverage", "Remaining regular-season matchups", "schedule[] is empty or missing (mMatchup view)", { url, path: "schedule[]" });
  const mpc = L.settings.scheduleSettings.matchupPeriodCount;
  const byPeriod = new Map<number, typeof sched>();
  for (const m of sched) byPeriod.set(m.matchupPeriodId, [...(byPeriod.get(m.matchupPeriodId) ?? []), m]);
  const problems: string[] = [];
  const teamIds = new Set(L.teams.map((t) => t.id));
  for (const mp of range(1, mpc)) {
    const ms = byPeriod.get(mp) ?? [];
    const seen = ms.flatMap((m) => [m.home?.teamId, m.away?.teamId]).filter((x): x is number => x !== undefined);
    if (new Set(seen).size !== teamIds.size || seen.length !== teamIds.size) problems.push(`period ${mp}: ${seen.length} team slots for ${teamIds.size} teams`);
  }
  const current = L.status.currentMatchupPeriod;
  const future = sched.filter((m) => m.matchupPeriodId >= current && m.matchupPeriodId <= mpc);
  add(ctx, problems.length ? "warn" : "ok", "F", "F.coverage", "Remaining regular-season matchups", `${sched.length} matchups for periods ${Math.min(...sched.map((m) => m.matchupPeriodId))}–${Math.max(...sched.map((m) => m.matchupPeriodId))}; every regular-season period ${problems.length ? `NOT complete: ${problems.join("; ")}` : "has each team exactly once"}; ${future.length} matchups from the current period ${current} on, all with home and away teams: ${future.every((m) => m.home && m.away) ? "yes" : "NO"}`, {
    url,
    path: "schedule[].{matchupPeriodId, home.teamId, away.teamId, winner}",
    sample: sched[0] ? { matchupPeriodId: sched[0].matchupPeriodId, home: sched[0].home?.teamId, away: sched[0].away?.teamId, winner: sched[0].winner } : null,
  });
  const playoffs = sched.filter((m) => m.matchupPeriodId > mpc || m.playoffTierType);
  const tiers = typeNameList(ctx.typeNames, "playoffTierTypes");
  const lastPeriod = Math.max(...sched.map((m) => m.matchupPeriodId));
  add(ctx, playoffs.length ? "ok" : "warn", "F", "F.playoffs", "Playoff matchups", playoffs.length ? `${playoffs.length} playoff matchups; playoffTierType: ${fmtCounts(countBy(playoffs, (m) => m.playoffTierType ?? "(none)"))}` : `none yet: schedule[] stops at period ${lastPeriod} and ${sched.filter((m) => m.playoffTierType).length}/${sched.length} entries carry playoffTierType (ESPN enumerates ${tiers.join(", ") || "?"}; presumably filled in once seeds are set, unverified); the simulator must build the bracket from playoffTeamCount/seeding`, { path: "schedule[].playoffTierType", sample: fmtCounts(countBy(sched, (m) => m.playoffTierType ?? "(absent)")) });
  if (!playoffs.length)
    ctx.p.cl.issue(
      `CLAUDE.md §2.2 lists schedule[].playoffTierType; before the playoffs no schedule entry carries it (${sched.filter((m) => m.playoffTierType).length}/${sched.length}) and schedule[] has no playoff matchups (it stops at period ${lastPeriod}; playoffs are periods ${mpc + 1}+). ESPN's typeNames.playoffTierTypes = [${tiers.join(", ")}]. Options: (a) the simulator builds the bracket from playoffTeamCount and seeding (it has to anyway), (b) re-probe after period ${mpc} to see the bracket. Evidence: F.playoffs.`,
    );
  add(ctx, "ok", "F", "F.winners", "Matchup results", `winner values by period: ${[...byPeriod]
    .filter(([mp]) => mp <= Math.min(mpc, current + 1))
    .map(([mp, ms]) => `${mp}:${fmtCounts(countBy(ms, (m) => m.winner ?? "?"))}`)
    .join(" | ")}`, { path: "schedule[].winner (HOME/AWAY/TIE/UNDECIDED)", sample: sched[0]?.winner });

  // Records: recompute W-L-T and points from completed matchups.
  const rec = new Map<number, { w: number; l: number; t: number; pf: number; pa: number }>();
  for (const id of teamIds) rec.set(id, { w: 0, l: 0, t: 0, pf: 0, pa: 0 });
  for (const m of sched) {
    if (!m.home || !m.away || !m.winner || m.winner === "UNDECIDED" || m.matchupPeriodId > mpc) continue;
    const h = rec.get(m.home.teamId);
    const a = rec.get(m.away.teamId);
    if (!h || !a) continue;
    h.pf += m.home.totalPoints ?? 0;
    h.pa += m.away.totalPoints ?? 0;
    a.pf += m.away.totalPoints ?? 0;
    a.pa += m.home.totalPoints ?? 0;
    if (m.winner === "HOME") {
      h.w++;
      a.l++;
    } else if (m.winner === "AWAY") {
      a.w++;
      h.l++;
    } else if (m.winner === "TIE") {
      h.t++;
      a.t++;
    }
  }
  const mismatches = L.teams.filter((t) => {
    const o = t.record?.overall;
    const r = rec.get(t.id);
    return !o || !r || o.wins !== r.w || o.losses !== r.l || o.ties !== r.t || Math.abs(o.pointsFor - r.pf) > 0.01 || Math.abs(o.pointsAgainst - r.pa) > 0.01;
  });
  const t0 = L.teams[0];
  add(ctx, mismatches.length ? "warn" : "ok", "F", "F.records", "Records and points", `teams[].record.overall has W-L-T and pointsFor/Against for ${L.teams.filter((t) => t.record).length}/${L.teams.length} teams; recomputed from schedule winners/totalPoints: ${mismatches.length ? `${mismatches.length} teams differ (ids ${mismatches.map((t) => t.id).join(", ")})` : "all match"}`, {
    path: "teams[].record.overall.{wins,losses,ties,pointsFor,pointsAgainst}",
    sample: t0?.record?.overall ? { teamId: t0.id, ...t0.record.overall } : null,
  });
  const st = f.standings?.data as { teams?: Array<{ id?: number; currentSimulationResults?: { playoffPct?: number; divisionWinPct?: number; rank?: number } }> } | undefined;
  if (f.standings?.outcome.ok && Array.isArray(st?.teams)) {
    const sims = st.teams.filter((t) => t.currentSimulationResults?.playoffPct !== undefined);
    add(ctx, "ok", "F", "F.espnSimulation", "ESPN's own playoff odds (mStandings)", `teams[].currentSimulationResults.playoffPct on ${sims.length}/${st.teams.length} teams (range ${Math.min(...sims.map((t) => t.currentSimulationResults?.playoffPct ?? 0)).toFixed(3)}–${Math.max(...sims.map((t) => t.currentSimulationResults?.playoffPct ?? 0)).toFixed(3)}); useful as a Phase 3 sanity comparison`, {
      url: f.standings.call.template,
      status: f.standings.res.status,
      path: "teams[].currentSimulationResults.{playoffPct, divisionWinPct, rank, modeRecord}",
      sample: sims[0] ? { teamId: sims[0].id, playoffPct: sims[0].currentSimulationResults?.playoffPct } : null,
    });
  } else failFetch(ctx, "F", "F.espnSimulation", "ESPN's own playoff odds (mStandings)", f.standings);
  const ms = f.matchupScore?.data as { schedule?: Array<{ matchupPeriodId?: number; home?: Record<string, unknown> }> } | undefined;
  if (f.matchupScore?.outcome.ok && Array.isArray(ms?.schedule)) {
    const live = ms.schedule.filter((m) => m.home && "rosterForCurrentScoringPeriod" in m.home);
    add(ctx, "ok", "F", "F.mMatchupScore", "mMatchupScore view", `${ms.schedule.length} matchups; ${live.length} carry rosterForCurrentScoringPeriod (live lineups for period ${[...new Set(live.map((m) => m.matchupPeriodId))].join(",")})`, { url: f.matchupScore.call.template, status: f.matchupScore.res.status, path: "schedule[].home.rosterForCurrentScoringPeriod.entries[]", sample: live.length });
  } else failFetch(ctx, "F", "F.mMatchupScore", "mMatchupScore view", f.matchupScore);
}

function checkG(ctx: Ctx, L: League, f: Fetched) {
  const current = L.status.latestScoringPeriod;
  const my = ctx.myTeamId;
  const leaguePy = "espn_api/football/league.py";
  const upstreamOnePeriod = cite(ctx, leaguePy, ["if not scoring_period:", "scoring_period = self.scoringPeriodId", '"scoringPeriodId": scoring_period'], "espn-api's League.transactions() fetches one period per call and substitutes the current period for a missing or 0 period");
  const def = parseTx(f.txDefault);
  if (def) {
    const ahead = def.filter((t) => t.scoringPeriodId > current);
    add(ctx, "ok", "G", "G.defaultScope", "mTransactions2 scope", `without scoringPeriodId ESPN returns ${def.length} transactions, all from scoringPeriodId ${[...new Set(def.map((t) => t.scoringPeriodId))].join(",") || "(none)"} (current ${current})${ahead.length ? `; the ${ahead.length} rows ahead of the current period are ${fmtCounts(countBy(ahead, (t) => t.type))}` : ""} → the probe requests each scoring period 1…${current}. ${upstreamOnePeriod}`, {
      url: f.txDefault?.call.template,
      status: f.txDefault?.res.status,
      path: "transactions[].scoringPeriodId",
      sample: countBy(def, (t) => t.scoringPeriodId),
    });
  } else failFetch(ctx, "G", "G.defaultScope", "mTransactions2 scope", f.txDefault);

  const weeks = f.txWeeks.map((x) => ({ week: x.week, r: x.r, tx: parseTx(x.r) }));
  const failed = weeks.filter((x) => !x.tx);
  // Dedupe by id: the same row must never be counted twice across period requests.
  const { rows: rawRows, unique: allTx } = dedupeById(weeks.map((x) => x.tx ?? []));
  add(ctx, failed.length ? "fail" : "ok", "G", "G.perWeek", "Transactions per scoring period", `${weeks.map((x) => `sp${x.week}: ${x.tx ? x.tx.length : `HTTP ${x.r.res.status}`}`).join(", ")} → ${rawRows} rows, ${allTx.length} unique ids${rawRows !== allTx.length ? ` (${rawRows - allTx.length} rows came back from more than one period request: dedupe by id)` : " (no row came back twice)"}; X-Fantasy-Filter types ${TX_TYPES.length}; types ${fmtCounts(countBy(allTx, (t) => t.type))}; statuses ${fmtCounts(countBy(allTx, (t) => t.status))}; item types ${fmtCounts(countBy(allTx.flatMap((t) => t.items ?? []), (i) => i.type ?? "(null)"))}`, {
    url: weeks[0]?.r.call.template,
    status: weeks[0]?.r.res.status,
    path: "transactions[].{id,type,status,scoringPeriodId,proposedDate,processDate,items[].{playerId,type,fromTeamId,toTeamId}}",
    sample: allTx[0] ? { type: allTx[0].type, status: allTx[0].status, scoringPeriodId: allTx[0].scoringPeriodId, items: allTx[0].items?.slice(0, 2) } : null,
    note: 'filter {"transactions":{"filterType":{"value":[…]}}} from espn-api League.transactions()',
  });

  const cur = weeks.find((x) => x.week === current)?.tx;
  const alias = parseTx(f.txAlias);
  if (alias && cur) {
    const same = idOverlap(alias, cur).shared;
    const identical = same === alias.length && alias.length === cur.length;
    ctx.txFacts.zeroAlias = identical;
    add(ctx, identical ? "ok" : "warn", "G", "G.periodZero", "scoringPeriodId=0", `returned ${alias.length} rows (their scoringPeriodId: ${fmtCounts(countBy(alias, (t) => t.scoringPeriodId)) || "none"}); ${same}/${alias.length} ids are also in sp${current} (${cur.length} rows)${identical ? ` → 0 is an alias of the current period, not a preseason period: requesting 0…${current} would count sp${current}'s rows twice` : ": NOT a plain alias of the current period, check"}`, {
      url: f.txAlias?.call.template,
      status: f.txAlias?.res.status,
      path: "transactions[].{id, scoringPeriodId}",
      sample: { rows: alias.length, sameIdsAsCurrent: same },
    });
  } else if (f.txAlias) failFetch(ctx, "G", "G.periodZero", "scoringPeriodId=0", f.txAlias);
  const ahead = parseTx(f.txAhead?.r);
  if (ahead && f.txAhead) {
    const overlap = idOverlap(ahead, cur ?? []).shared;
    ctx.txFacts.aheadRepeats = ahead.length > 0 && overlap === ahead.length;
    add(ctx, "ok", "G", "G.periodAhead", `scoringPeriodId=${f.txAhead.week} (next week)`, `returned ${ahead.length} rows with the type filter (their scoringPeriodId: ${fmtCounts(countBy(ahead, (t) => t.scoringPeriodId)) || "none"}); ${overlap} of them also in sp${current}${ahead.length && overlap === ahead.length ? " → a future period repeats the current period's rows" : overlap ? "" : " → a future period does not repeat the current period's rows"}`, {
      url: f.txAhead.r.call.template,
      status: f.txAhead.r.res.status,
      path: "transactions[].{id, scoringPeriodId, type, status}",
      sample: { rows: ahead.length, overlapWithCurrent: overlap, types: countBy(ahead, (t) => `${t.type}/${t.status}`) },
    });
  } else if (f.txAhead) failFetch(ctx, "G", "G.periodAhead", `scoringPeriodId=${f.txAhead.week} (next week)`, f.txAhead.r);

  const unf = parseTx(f.txUnfiltered?.r);
  const filteredSame = weeks.find((x) => x.week === f.txUnfiltered?.week)?.tx;
  if (unf && filteredSame)
    add(ctx, "ok", "G", "G.filterEffect", "Unfiltered vs filtered", `sp${f.txUnfiltered?.week}: unfiltered ${unf.length} (${fmtCounts(countBy(unf, (t) => t.type))}) vs filtered ${filteredSame.length}; without a filter ESPN also returns lineup moves${unf.some((t) => t.type === "ROSTER") ? " (type ROSTER)" : ""}`, { url: f.txUnfiltered?.r.call.template, path: "transactions[].type", sample: countBy(unf, (t) => t.type) });
  else if (f.txUnfiltered) failFetch(ctx, "G", "G.filterEffect", "Unfiltered vs filtered", f.txUnfiltered.r);

  const dates = allTx.map((t) => t.processDate ?? t.proposedDate).filter((x): x is number => typeof x === "number");
  if (dates.length)
    add(ctx, "ok", "G", "G.dates", "Transaction dates", `processDate/proposedDate are epoch ms: ${iso(Math.min(...dates))} … ${iso(Math.max(...dates))}; processDate on ${allTx.filter((t) => t.processDate).length}/${allTx.length}`, { path: "transactions[].processDate / proposedDate", sample: dates[0] });

  const trades = allTx.filter((t) => t.type.startsWith("TRADE"));
  const counterTrades = L.teams.reduce((a, t) => a + (t.transactionCounter?.trades ?? 0), 0);
  const accepted = trades.filter((t) => t.type === "TRADE_ACCEPT" || t.type === "TRADE_UPHOLD");
  const proposals = trades.filter((t) => t.type === "TRADE_PROPOSAL");
  const withLegs = proposals.filter((t) => t.items?.some((i) => i.type === "TRADE"));
  const legSample = withLegs[0]?.items?.find((i) => i.type === "TRADE");
  const withActions = proposals.filter((t) => Object.keys(t.teamActions ?? {}).length > 0 || t.expirationDate !== undefined);
  const withActionsMine = withActions.filter((t) => involves(t, my));
  const others = trades.filter((t) => !involves(t, my));
  const pending = proposals.filter((t) => t.status === "PENDING");
  const stale = pending.filter((t) => t.expirationDate !== undefined && t.expirationDate < Date.now());
  const nc = f.noCookie.find((x) => x.view === "mTransactions2");
  const ncTrades = parseTx(nc?.r)?.filter((t) => t.type.startsWith("TRADE")).length;
  const ckTrades = weeks.find((x) => x.week === f.noCookieTxWeek)?.tx?.filter((t) => t.type.startsWith("TRADE")).length;
  add(
    ctx,
    "warn",
    "G",
    "G.trades",
    "Trades this season",
    `${accepted.length ? `${accepted.length} accepted/upheld trades` : `no completed trades yet (0 TRADE_ACCEPT/UPHOLD rows; Σ teams[].transactionCounter.trades = ${counterTrades}), so accepted-trade rows can't be verified live`}. Trade rows seen with the cookie holder's cookies: ${fmtCounts(countBy(trades, (t) => `${t.type}/${t.status}`)) || "none"}; ${withLegs.length}/${proposals.length} proposals list their legs (items[type=TRADE] playerId, fromTeamId → toTeamId); teamActions/expirationDate appear on ${withActions.length}/${proposals.length} proposals, ${withActionsMine.length === withActions.length ? "all" : withActionsMine.length} of them involving the cookie holder's team (Team ${my ?? "?"}); rows between other teams: ${fmtCounts(countBy(others, (t) => `${t.type}/${t.status}`)) || "none"}. PENDING proposals: ${pending.length}, ${stale.length} already past their expirationDate (PENDING can be stale: compare expirationDate with the current time). Without cookies sp${f.noCookieTxWeek ?? "?"} shows ${ncTrades ?? "?"} TRADE_* rows vs ${ckTrades ?? "?"} with cookies (AUTH.noCookies.mTransactions2). ${cite(ctx, leaguePy, ["TRADE_ACCEPT rows from mTransactions2 often have empty items except for", "the authenticated owner's deals"], "espn-api: TRADE_ACCEPT rows often lack items except for the authenticated owner's deals, and it refills them from player cards")}`,
    {
      path: "transactions[type=TRADE_*].{type,status,teamId,items[].{playerId,type,fromTeamId,toTeamId},teamActions,expirationDate,relatedTransactionId}",
      sample: legSample ? { type: "TRADE_PROPOSAL", leg: { playerId: legSample.playerId, fromTeamId: legSample.fromTeamId, toTeamId: legSample.toTeamId } } : { tradeRows: trades.length, counterTrades },
    },
  );
  if (!accepted.length)
    ctx.p.cl.issue(`No completed trades yet in Parker's league (0 TRADE_ACCEPT/UPHOLD rows in periods 1–${current}; Σ teams[].transactionCounter.trades = ${counterTrades}), so accepted-trade rows couldn't be checked live; proposals and declines were (G.trades). espn-api documents that accepted trades between OTHER teams can come back without items. Options: (a) re-probe after the first trade, (b) build the player-card refill up front.`);

  // Per-team adds/drops: executed FA/waiver moves vs ESPN's counters.
  const exec = allTx.filter((t) => t.status === "EXECUTED" && (t.type === "FREEAGENT" || t.type === "WAIVER"));
  const adds = countBy(
    exec.flatMap((t) => (t.items ?? []).filter((i) => i.type === "ADD")),
    (i) => i.toTeamId,
  );
  const drops = countBy(
    exec.flatMap((t) => (t.items ?? []).filter((i) => i.type === "DROP")),
    (i) => i.fromTeamId,
  );
  const diffs = L.teams.filter((t) => (adds[String(t.id)] ?? 0) !== (t.transactionCounter?.acquisitions ?? 0) || (drops[String(t.id)] ?? 0) !== (t.transactionCounter?.drops ?? 0));
  const addsAgree = L.teams.filter((t) => (adds[String(t.id)] ?? 0) === (t.transactionCounter?.acquisitions ?? 0)).length;
  const dropsAgree = L.teams.filter((t) => (drops[String(t.id)] ?? 0) === (t.transactionCounter?.drops ?? 0)).length;
  add(ctx, diffs.length ? "warn" : "ok", "G", "G.counts", "Add/drop/trade counts per team", `teams[].transactionCounter (adds/drops/trades): ${L.teams.map((t) => `T${t.id} ${t.transactionCounter?.acquisitions ?? "?"}/${t.transactionCounter?.drops ?? "?"}/${t.transactionCounter?.trades ?? "?"}`).join(", ")}; matchupAcquisitionTotals splits adds by matchup period. Counting executed FA+waiver rows (unique ids) instead: adds agree for ${addsAgree}/${L.teams.length} teams, drops for ${dropsAgree}/${L.teams.length}${diffs.length ? ` (differ: ${diffs.map((t) => `T${t.id} rows ${adds[String(t.id)] ?? 0}/${drops[String(t.id)] ?? 0} vs counter ${t.transactionCounter?.acquisitions}/${t.transactionCounter?.drops}`).join("; ")}); the activity feature should count dated rows, which also give the week` : ""}`, {
    path: "teams[].transactionCounter.{acquisitions,drops,trades,moveToIR,matchupAcquisitionTotals}",
    sample: L.teams[0]?.transactionCounter,
  });

  const topics = f.comm.flatMap((r) => (r.data as { topics?: Array<{ date?: number; messages?: Array<{ messageTypeId?: number }> }> } | undefined)?.topics ?? []);
  if (f.comm[0]?.outcome.ok) {
    const msgs = topics.flatMap((t) => t.messages ?? []);
    const tDates = topics.map((t) => t.date).filter((x): x is number => typeof x === "number");
    const tradedId = Object.entries(ctx.c?.activity ?? {}).find(([, v]) => v === "TRADED")?.[0];
    const nc = f.noCookie.find((x) => x.view === "kona_league_communication")?.r;
    const ncText = !nc ? "not requested without cookies" : nc.outcome.ok ? "also works without cookies" : `without cookies HTTP ${nc.res.status} (${nc.outcome.code})${L.settings.isPublic ? " although the league is public, so recent activity needs cookies; mTransactions2 works without them" : ""}`;
    add(ctx, "ok", "G", "G.recentActivity", "Recent activity (communication)", `${topics.length} topics in ${f.comm.length} page(s), ${msgs.length} messages; messageTypeId ${fmtCounts(countBy(msgs, (m) => `${m.messageTypeId}${ctx.c?.activity[m.messageTypeId ?? -1] ? ` ${ctx.c.activity[m.messageTypeId ?? -1]}` : ""}`))}${tDates.length ? `; ${iso(Math.min(...tDates))} … ${iso(Math.max(...tDates))}` : ""}. Alternative trade history: espn-api ACTIVITY_MAP ${tradedId ?? "?"} = TRADED. ${ncText} (AUTH.noCookies.kona_league_communication)`, {
      url: f.comm[0].call.template,
      status: f.comm[0].res.status,
      path: "topics[].{date, messages[].{messageTypeId, targetId, from, to, for}}",
      sample: msgs[0] ? { messageTypeId: msgs[0].messageTypeId } : null,
      note: "espn-api League.recent_activity() filter",
    });
  } else failFetch(ctx, "G", "G.recentActivity", "Recent activity (communication)", f.comm[0]);
}

function checkH(ctx: Ctx, L: League, f: Fetched) {
  const current = L.status.latestScoringPeriod;
  const byes = byeMap(ctx);
  const lines: string[] = [];
  const topLines: string[] = [];
  let allParsed = true;
  let allComplete = true;
  let allSorted = true;
  let withProj = 0;
  let total = 0;
  const proj = (pl: Player) => findStat(pl, ctx.season, 1, 1, current)?.appliedTotal;
  for (const { pos, slotId, r } of f.fa) {
    const ps = parsePlayers(r);
    if (!ps) {
      allParsed = false;
      lines.push(`${pos}: ${r.outcome.ok ? "unexpected shape" : `HTTP ${r.res.status}`}`);
      continue;
    }
    total += ps.length;
    const complete = ps.length < FA_LIMIT;
    if (!complete) allComplete = false;
    const owned = ps.map((x) => x.player.ownership?.percentOwned ?? 0);
    if (!owned.every((v, i) => i === 0 || v <= (owned[i - 1] ?? Infinity) + 1e-9)) allSorted = false;
    const wrongPos = ps.filter((x) => positionOf(ctx, x.player) !== pos);
    const withP = ps.filter((x) => proj(x.player) !== undefined);
    const noLine = ps.filter((x) => proj(x.player) === undefined);
    const noLineBye = noLine.filter((x) => byes.get(x.player.proTeamId) === current);
    const noLineNoTeam = noLine.filter((x) => x.player.proTeamId === 0);
    withProj += withP.length;
    const topOwned = new Set(ps.slice(0, FA_TOP).map((x) => x.id));
    const topProj = [...withP].sort((a, b) => (proj(b.player) ?? 0) - (proj(a.player) ?? 0)).slice(0, FA_TOP);
    ctx.faTop.set(
      pos,
      topProj.map((x) => ({ id: x.player.id, proTeamId: x.player.proTeamId })),
    );
    const rank = new Map(ps.map((x, i) => [x.id, i + 1]));
    const deepest = Math.max(0, ...topProj.map((x) => rank.get(x.id) ?? 0));
    lines.push(`${pos}(slot ${slotId}): ${ps.length}${complete ? " (all)" : ` (limit ${FA_LIMIT} reached)`} [${fmtCounts(countBy(ps, (x) => x.status))}]${wrongPos.length ? ` ${wrongPos.length} other-position` : ""}; onTeamId≠0: ${ps.filter((x) => (x.onTeamId ?? 0) !== 0).length}; week-${current} projection on ${withP.length} (no line: ${noLine.length}; of them on bye ${noLineBye.length}, without an NFL team (proTeamId 0) ${noLineNoTeam.length})`);
    topLines.push(`${pos} ${topProj.filter((x) => topOwned.has(x.id)).length}/${topProj.length} shared, projection top ${topProj.length} reaches %-owned rank ${deepest} of ${ps.length}`);
  }
  const r0 = f.fa[0]?.r;
  add(ctx, allParsed && f.fa.length === FA_POSITIONS.length ? "ok" : "fail", "H", "H.freeAgents", "Free agents by position", `${lines.join("; ")}; ${withProj}/${total} have a week-${current} projection (appliedTotal)`, {
    url: r0?.call.template,
    status: r0?.res.status,
    path: "players[].{id, status, onTeamId, player.ownership.percentOwned, player.stats[]}",
    note: `X-Fantasy-Filter from espn-api free_agents(): filterStatus FREEAGENT+WAIVERS, filterSlotIds [slot], sortPercOwned; limit ${FA_LIMIT} (espn-api's pool page size) instead of 50 so the list is complete`,
  });
  add(
    ctx,
    allParsed && allComplete && allSorted ? "ok" : "warn",
    "H",
    "H.top50",
    "Top 50 per position by projection",
    `top ${FA_TOP} by week-${current} projection (appliedTotal) vs the ${FA_TOP} most-owned (espn-api's order; percentOwned ${allSorted ? "verified non-increasing" : "NOT non-increasing: check the sort"}): ${topLines.join("; ")}. ${allComplete ? `Every list holds all free agents at its position, so the projection top ${FA_TOP} is exact for week ${current}` : "Some lists hit the limit, so lower-owned players are unseen"}; free agents without a week-${current} line (H.freeAgents gives the counts and how many have no NFL team) are left out here (Phase 1: rank players on bye by their next projected week, §6)`,
    { path: `players[] sorted by player.stats[statSourceId=1, statSplitTypeId=1, scoringPeriodId=${current}].appliedTotal`, sample: Object.fromEntries([...ctx.faTop].map(([pos, xs]) => [pos, xs.length])) },
  );
  const uni = f.universe;
  const list = Array.isArray(uni?.data) ? (uni?.data as Array<{ id?: number; defaultPositionId?: number; proTeamId?: number }>) : undefined;
  if (uni?.outcome.ok && list) {
    const rostered = new Set(rosterEntries(L).map((x) => x.e.playerId));
    const offense = list.filter((x) => x.defaultPositionId !== undefined && [1, 2, 3, 4, 5, 16].includes(x.defaultPositionId));
    add(ctx, "ok", "H", "H.derivable", "Free agents derivable", `players_wl (active) returns ${list.length} players (${offense.length} QB/RB/WR/TE/K/D/ST by defaultPositionId); minus ${rostered.size} rostered → ${offense.filter((x) => x.id !== undefined && !rostered.has(x.id)).length} candidates (waiver status not included; use kona_player_info for that)`, {
      url: uni.call.template,
      status: uni.res.status,
      path: "[].{id, fullName, defaultPositionId, proTeamId, eligibleSlots}",
      sample: list.length,
      note: 'espn-api get_pro_players(): X-Fantasy-Filter {"filterActive":{"value":true}}',
    });
  } else failFetch(ctx, "H", "H.derivable", "Free agents derivable", uni);
}

function checkI(ctx: Ctx, L: League, f: Fetched) {
  const ds = L.settings.draftSettings;
  const parsed = f.draft?.outcome.ok ? DraftResponseSchema.safeParse(f.draft.data) : undefined;
  const lt = leagueTypeOf(L);
  if (parsed?.success) {
    const dd = parsed.data.draftDetail;
    const picks = dd.picks ?? [];
    add(ctx, "ok", "I", "I.draftResults", "Draft results", `drafted ${dd.drafted}; ${picks.length} picks in ${new Set(picks.map((x) => x.roundId)).size} rounds; keeper picks ${picks.filter((x) => x.keeper).length}; draft type ${ds?.type ?? "?"}`, {
      url: f.draft?.call.template,
      status: f.draft?.res.status,
      path: "draftDetail.picks[].{overallPickNumber, roundId, roundPickNumber, teamId, playerId, keeper}",
      sample: picks[0] ? { overallPickNumber: picks[0].overallPickNumber, roundId: picks[0].roundId, teamId: picks[0].teamId, playerId: picks[0].playerId, keeper: picks[0].keeper } : null,
    });
  } else failFetch(ctx, "I", "I.draftResults", "Draft results", f.draft);
  const moveTypes = typeNameList(ctx.typeNames, "moveTypes");
  const pickMoves = moveTypes.filter((x) => /DRAFT_TRADE/.test(x));
  const ddKeys = f.draft?.data && typeof f.draft.data === "object" ? Object.keys((f.draft.data as { draftDetail?: object }).draftDetail ?? {}) : [];
  add(
    ctx,
    lt.type === "redraft" ? "na" : "warn",
    "I",
    "I.futurePicks",
    "Future draft-pick ownership",
    `${lt.type === "redraft" ? `not applicable to this league (redraft: ${lt.why})` : `${lt.type} league (inferred): future picks matter`}. ESPN pick trading is untested: no keeper or dynasty ESPN league was probed; ESPN's typeNames.moveTypes lists ${pickMoves.join(", ") || "no pick-trade move"} (of ${moveTypes.length}), so pick trades may exist there; this league's draftDetail keys [${ddKeys.join(", ")}] and settings.draftSettings.isTradingEnabled ${ds?.isTradingEnabled ?? "?"} show no pick-ownership data`,
    { path: "settings.draftSettings.{keeperCount,isTradingEnabled} / draftDetail / typeNames.moveTypes", sample: { keeperCount: ds?.keeperCount, isTradingEnabled: ds?.isTradingEnabled, pickMoves } },
  );
}

function playersFromCards(f: Fetched): Player[] {
  return f.cards.flatMap((r) => (parsePlayers(r) ?? []).map((x) => x.player));
}

function checkJ(ctx: Ctx, L: League, f: Fetched, url: string) {
  const season = ctx.season;
  const current = L.status.latestScoringPeriod;
  const final = L.status.finalScoringPeriod ?? 17;
  const players = rosterEntries(L).map((x) => x.e.playerPoolEntry.player);
  const cur = players.filter((pl) => findStat(pl, season, 1, 1, current));
  const curApplied = cur.filter((pl) => findStat(pl, season, 1, 1, current)?.appliedTotal !== undefined);
  const curStats = cur.filter((pl) => Object.keys(findStat(pl, season, 1, 1, current)?.stats ?? {}).length > 0);
  const sample = cur[0] ? findStat(cur[0], season, 1, 1, current) : undefined;
  add(ctx, curApplied.length === players.length ? "ok" : curApplied.length ? "warn" : "fail", "J", "J.currentWeek", "Current-week projections", `${curApplied.length}/${players.length} rostered players (${pct(curApplied.length, players.length)}) have a week-${current} projection (statSourceId 1, statSplitTypeId 1) with appliedTotal (league-scored); ${curStats.length} also carry stat-level projections`, {
    url,
    path: `playerPoolEntry.player.stats[seasonId=${season}, statSourceId=1, statSplitTypeId=1, scoringPeriodId=${current}].{appliedTotal, stats}`,
    sample: sample ? { id: sample.id, appliedTotal: sample.appliedTotal !== undefined ? round2(sample.appliedTotal) : undefined, statCount: Object.keys(sample.stats ?? {}).length } : null,
  });
  const prev = players.filter((pl) => findStat(pl, season, 1, 1, current - 1)?.appliedTotal !== undefined);
  add(ctx, prev.length ? "ok" : "warn", "J", "J.pastWeek", "Last week's projection (for the recency feature)", `${prev.length}/${players.length} rostered players still carry the week-${current - 1} projection in the default view`, { path: `stats[statSourceId=1, statSplitTypeId=1, scoringPeriodId=${current - 1}]`, sample: prev.length });
  const seasonProj = players.filter((pl) => findStat(pl, season, 1, 0, 0)?.appliedTotal !== undefined);
  add(ctx, "ok", "J", "J.season", "Season projection", `${seasonProj.length}/${players.length} have a season projection (statSourceId 1, statSplitTypeId 0, scoringPeriodId 0, id "10${season}")`, { path: "stats[statSourceId=1, statSplitTypeId=0]", sample: seasonProj[0] ? round2(findStat(seasonProj[0], season, 1, 0, 0)?.appliedTotal ?? 0) : null });

  // Future weeks: every rostered player and the top free agents per position, in a 500-player pool page.
  const byes = byeMap(ctx);
  const faPop = [...ctx.faTop.values()].flat();
  const sampled = f.future.map((x) => x.week);
  const notRequested = range(current + 1, final).filter((w) => !sampled.includes(w));
  for (const { week, why, r } of f.future) {
    const ps = parsePlayers(r);
    if (!ps) {
      failFetch(ctx, "J", `J.future.week${week}`, `Week ${week} projections`, r);
      continue;
    }
    const byId = new Map(ps.map((x) => [x.player.id, x.player]));
    const cover = (pop: Array<{ id: number; proTeamId: number }>) => {
      let covered = 0;
      let notInPage = 0;
      let noLine = 0;
      let noLineBye = 0;
      for (const x of pop) {
        const pl = byId.get(x.id);
        if (!pl) {
          notInPage++;
          continue;
        }
        if (findStat(pl, season, 1, 1, week)?.appliedTotal !== undefined) covered++;
        else {
          noLine++;
          if (byes.get(pl.proTeamId) === week) noLineBye++;
        }
      }
      return { total: pop.length, covered, notInPage, noLine, noLineBye, gaps: notInPage + noLine - noLineBye };
    };
    const rost = cover(players.map((pl) => ({ id: pl.id, proTeamId: pl.proTeamId })));
    const fa = cover(faPop);
    const gapText = (c: ReturnType<typeof cover>) => (c.covered === c.total ? "" : ` (not in the page: ${c.notInPage}; no week-${week} line: ${c.noLine}, of them on bye: ${c.noLineBye})`);
    const has = ps.filter((x) => findStat(x.player, season, 1, 1, week)?.appliedTotal !== undefined);
    add(
      ctx,
      rost.gaps === 0 && fa.gaps === 0 ? "ok" : "warn",
      "J",
      `J.future.week${week}`,
      `Week ${week} projections`,
      `${why}: page of ${ps.length} players (espn-api get_player_pool_ids() page 1, top ${POOL_PAGE} by % owned); rostered players with a week-${week} projection (appliedTotal): ${rost.covered}/${rost.total}${gapText(rost)}; top-${FA_TOP} free agents per position (by week-${current} projection, H.top50): ${fa.covered}/${fa.total}${gapText(fa)}; ${has.length}/${ps.length} in the page have one. Weeks not requested: ${fmtWeeks(notRequested) || "none"} (CLAUDE.md §6 uses ESPN's projection for the current week, or the next week that has one for players on bye or out; week shape comes from Sleeper)`,
      {
        url: r.call.template,
        status: r.res.status,
        path: `players[].player.stats[statSourceId=1, statSplitTypeId=1, scoringPeriodId=${week}].appliedTotal`,
        sample: has[0] ? { id: findStat(has[0].player, season, 1, 1, week)?.id, appliedTotal: round2(findStat(has[0].player, season, 1, 1, week)?.appliedTotal ?? 0) } : null,
        note: `filter: espn-api get_player_pool_ids() (FREEAGENT+WAIVERS+ONTEAM, limit ${POOL_PAGE}, offset 0); cached 6 h (§2.10 projections)`,
      },
    );
  }

  // Player cards (espn-api player_info filter): what do they carry?
  const cards = playersFromCards(f);
  if (cards.length) {
    const lines = cards.flatMap((pl) => pl.stats ?? []);
    const combos = countBy(lines, (s) => `${s.seasonId} ${s.statSourceId === 0 ? "actual" : "proj"} ${s.statSplitTypeId === 0 ? "season" : s.statSplitTypeId === 1 ? "week" : `split${s.statSplitTypeId}`}`);
    const weekProj = lines.filter((s) => s.statSourceId === 1 && s.statSplitTypeId === 1).length;
    const actWeeks = [...new Set(lines.filter((s) => s.seasonId === season && s.statSourceId === 0 && s.statSplitTypeId === 1).map((s) => s.scoringPeriodId))].sort((a, b) => a - b);
    const rawCards = f.cards.flatMap((r) => (r.data as { players?: Array<{ transactions?: unknown[] }> } | undefined)?.players ?? []);
    const withTx = rawCards.filter((x) => Array.isArray(x.transactions) && x.transactions.length > 0).length;
    add(ctx, "ok", "J", "J.playerCard", "Player cards (kona_playercard)", `${cards.length} rostered players: stat lines ${fmtCounts(combos)}. The card gives each player's recent game lines (this season's weeks ${actWeeks.join(",")} plus earlier seasons') and season totals, but ${weekProj ? `${weekProj}` : "no"} weekly projections, so weekly projections come from kona_player_info&scoringPeriodId=N (J.future.*). Cards also carry injuryDetails (E.injuryReturn) and a players[].transactions history on ${withTx}/${rawCards.length} cards`, {
      url: f.cards[0]?.call.template,
      status: f.cards[0]?.res.status,
      path: "players[].player.stats[] / players[].player.injuryDetails / players[].transactions[]",
      sample: combos,
      note: "filter: espn-api get_player_card() (filterIds + filterStatsForTopScoringPeriodIds, value = final scoring period)",
    });
  } else failFetch(ctx, "J", "J.playerCard", "Player cards (kona_playercard)", f.cards[0]);

  // statSplitTypeId 2: test simple readings against data we already have (no extra requests).
  const errs: Record<string, number[]> = { "season projection": [], "actual so far + weekly projection × games left": [], "weekly projection × games left": [] };
  for (const pl of players) {
    const s2 = findStat(pl, season, 1, 2, 0)?.appliedTotal;
    const seasonProjTotal = findStat(pl, season, 1, 0, 0)?.appliedTotal;
    const weekProj = findStat(pl, season, 1, 1, current)?.appliedTotal;
    if (s2 === undefined || seasonProjTotal === undefined || weekProj === undefined || s2 < 20) continue;
    const bye = byes.get(pl.proTeamId) ?? 0;
    const games = final - current + 1 - (bye >= current && bye <= final ? 1 : 0);
    const act = findStat(pl, season, 0, 0, 0)?.appliedTotal ?? 0;
    const rel = (x: number) => Math.abs(x - s2) / s2;
    errs["season projection"]?.push(rel(seasonProjTotal));
    errs["actual so far + weekly projection × games left"]?.push(rel(act + weekProj * games));
    errs["weekly projection × games left"]?.push(rel(weekProj * games));
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
  const split2 = players.filter((pl) => findStat(pl, season, 1, 2, 0));
  const readings = Object.entries(errs)
    .map(([k, v]) => `${k} ${(100 * median(v)).toFixed(0)}%`)
    .join(", ");
  const skipsSplit2 = upstreamHas(ctx, "espn_api/football/player.py", 'stats.get("statSplitTypeId") == 2');
  add(ctx, split2.length ? "warn" : "ok", "J", "J.split2", "Undocumented projection line (statSplitTypeId 2)", split2.length ? `not in CLAUDE.md §2.2 and not used: ${split2.length}/${players.length} rostered players have a statSourceId 1 / statSplitTypeId 2 line (id "12${season}")${skipsSplit2 ? ", which espn-api's player.py skips" : ""}. Its meaning is unknown and none of the obvious readings fits (median relative difference vs ${readings}, n=${errs["season projection"]?.length ?? 0})` : "no statSplitTypeId 2 lines on rostered players", {
    path: "stats[statSourceId=1, statSplitTypeId=2, scoringPeriodId=0].appliedTotal",
    sample: split2[0] ? round2(findStat(split2[0], season, 1, 2, 0)?.appliedTotal ?? 0) : null,
  });
  if (split2.length)
    ctx.p.cl.issue(`CLAUDE.md §2.2 lists statSplitTypeId 0 (season) and 1 (week) only; ESPN also returns statSplitTypeId 2 (statSourceId 1, id "12${season}") on ${split2.length}/${players.length} rostered players, meaning unknown (no simple reading fits: median relative difference vs ${readings})${skipsSplit2 ? "; espn-api's player.py skips these lines" : ""}. Options: (a) ignore statSplitTypeId 2 in the adapter (current plan), (b) investigate if a use appears. Evidence: J.split2.`);
}

function reportOracle(ctx: Ctx, run: OracleRun) {
  const o = run.result;
  const rate = o.checked ? o.withinPos / o.checked : 0;
  const mism = o.mismatches.length
    ? `; mismatches: ${o.mismatches
        .slice(0, 6)
        .map((m) => `${m.name} ${m.pos} ESPN ${m.espn} vs ours ${m.ours} [${m.diffs}]`)
        .join("; ")}; by stat: ${fmtCounts(o.statPattern)}`
    : "";
  add(ctx, rate >= 0.99 ? "ok" : "warn", "K", run.key, run.title, `${o.withinPos}/${o.checked} players within ${ORACLE_TOLERANCE} (${pct(o.withinPos, o.checked)}; target ≥ 99%) with pointsOverrides keyed by defaultPositionId and replacing the base points; keyed by lineup slot id (the spec's reading): ${o.withinSlot}/${o.checked}; overrides added instead of replacing: ${o.withinAdd}/${o.checked}; ${o.noActual} without an actual line (bye/inactive)${mism}`, run.ev);
}

/** Across every oracle run: which pointsOverrides key reading does ESPN use, and does an override replace or add? */
function reportOverrideKeys(ctx: Ctx) {
  const e = overrideEvidence(ctx);
  const posDiff = Object.entries(ctx.posById)
    .map(([id, pos]) => ({ id: Number(id), pos, slot: ctx.c ? slotIdForPosition(pos, ctx.c) : undefined }))
    .filter((x) => x.slot !== undefined && x.slot !== x.id);
  const testedPos = countBy(e.keyCases, (c) => c.pos);
  const tested = posDiff.filter((x) => testedPos[x.pos]);
  const inferred = posDiff.filter((x) => !testedPos[x.pos]);
  const sop = ctx.statIdToOverridePosition ?? {};
  const sopByKey = new Map<number, number[]>();
  for (const [stat, keyNum] of Object.entries(sop)) sopByKey.set(keyNum, [...(sopByKey.get(keyNum) ?? []), Number(stat)]);
  const sopText = sopByKey.size
    ? `ESPN's own settings.statIdToOverridePosition (proTeamSchedules_wl) keys ${[...sopByKey]
        .sort((a, b) => a[0] - b[0])
        .map(([keyNum, stats]) => `${keyNum} for ${stats.length} stats (${Math.min(...stats)}–${Math.max(...stats)}); ${keyNum} is ${posName(ctx, keyNum)} as a defaultPositionId${ctx.c ? ` and ${slotName(ctx, keyNum)} as a lineup slot (${posName(ctx, keyNum)}'s slot is ${slotIdForPosition(posName(ctx, keyNum), ctx.c) ?? "?"})` : ""}`)
        .join("; ")}`
    : "settings.statIdToOverridePosition not available";
  const keyOk = e.keyCases.length > 0 && e.keyPos === e.keyCases.length && e.keySlot === 0;
  const modeOk = e.modeCases.length > 0 && e.modeReplace === e.modeCases.length && e.modeAdd === 0;
  const examples = [...e.keyCases.slice(0, 2), ...e.modeCases.slice(0, 2)].map((c) => c.example);
  add(
    ctx,
    keyOk && modeOk ? "ok" : "warn",
    "K",
    "K.overrideKeys",
    "pointsOverrides key space and replace-vs-add",
    `Key space: on ${e.keyCases.length} distinct player-weeks where the two readings give different totals, keying by defaultPositionId matched ESPN ${e.keyPos} times and keying by lineup slot id ${e.keySlot} times (positions ${fmtCounts(testedPos) || "none"}). ${sopText}. Tested by a discriminating player-week: ${tested.map((x) => `${x.pos} (${x.id} vs slot ${x.slot})`).join(", ") || "none"}; inferred, untested (position id ≠ slot id but no discriminating player-week here): ${inferred.map((x) => `${x.pos} (${x.id} vs slot ${x.slot})`).join(", ") || "none"}. Replace vs add: ${replaceVsAddText(ctx)}. e.g. ${examples.join("; ")}`,
    { path: "settings.scoringSettings.scoringItems[].pointsOverrides keys vs player.defaultPositionId / lineup slot", sample: { keyCases: e.keyCases.length, positionIdRight: e.keyPos, slotIdRight: e.keySlot, modeCases: e.modeCases.length, replaceRight: e.modeReplace, addRight: e.modeAdd } },
  );
}

function checkK(ctx: Ctx, L: League, f: Fetched) {
  for (const { week, r } of f.rosterWeeks) {
    const parsed = r.outcome.ok ? LeagueSchema.pick({ teams: true }).safeParse(r.data) : undefined;
    if (!parsed?.success) {
      failFetch(ctx, "K", `K.week${week}`, `Week ${week} actuals`, r);
      continue;
    }
    const entries = rosterEntries(parsed.data);
    const players = entries.map((x) => x.e.playerPoolEntry.player);
    const withActual = players.filter((pl) => findStat(pl, ctx.season, 0, 1, week));
    const sample = withActual[0] ? findStat(withActual[0], ctx.season, 0, 1, week) : undefined;
    const projPast = players.filter((pl) => findStat(pl, ctx.season, 1, 1, week)?.appliedTotal !== undefined);
    const gameIds = new Set(ctx.proTeams.flatMap((t) => (t.proGamesByScoringPeriod?.[String(week)] ?? []).map((g) => g.id)).filter((x): x is number => x !== undefined).map(String));
    const lines = withActual.map((pl) => findStat(pl, ctx.season, 0, 1, week)).filter((x): x is StatEntry => !!x);
    const idIsGame = lines.filter((x) => (x.id ?? "").startsWith("01") && gameIds.has((x.id ?? "").slice(2))).length;
    const extIsGame = lines.filter((x) => x.externalId !== undefined && gameIds.has(x.externalId)).length;
    add(ctx, withActual.length ? "ok" : "fail", "K", `K.week${week}`, `Week ${week} actuals`, `mRoster&scoringPeriodId=${week}: ${entries.length} roster entries (rosters as of week ${week}); ${withActual.length} have an actual line (statSourceId 0, statSplitTypeId 1) with stats + appliedTotal + appliedStats; ${projPast.length} also keep their week-${week} projection`, {
      url: r.call.template,
      status: r.res.status,
      path: `teams[].roster.entries[].playerPoolEntry.player.stats[statSourceId=0, statSplitTypeId=1, scoringPeriodId=${week}]`,
      sample: sample ? { id: sample.id, appliedTotal: round2(sample.appliedTotal ?? 0), statCount: Object.keys(sample.stats ?? {}).length } : null,
      note: `actual line id = "01" (statSourceId 0, statSplitTypeId 1) + that week's NFL game id on ${idIsGame}/${lines.length} lines; externalId = the game id on ${extIsGame}/${lines.length} (game ids from proTeamSchedules_wl)`,
    });
    const run = ctx.oracles.find((o) => o.scope === "league" && o.week === week);
    if (run) reportOracle(ctx, run);
    // Team totals: Σ starters' appliedTotal vs the matchup score.
    const sched = L.schedule ?? [];
    let matched = 0;
    let compared = 0;
    const off: string[] = [];
    for (const t of parsed.data.teams) {
      const m = sched.find((x) => x.matchupPeriodId === week && (x.home?.teamId === t.id || x.away?.teamId === t.id));
      const side = m?.home?.teamId === t.id ? m.home : m?.away;
      if (!side || side.totalPoints === undefined) continue;
      const sum = (t.roster?.entries ?? []).filter((e) => !NON_STARTING.has(e.lineupSlotId)).reduce((a, e) => a + (findStat(e.playerPoolEntry.player, ctx.season, 0, 1, week)?.appliedTotal ?? 0), 0);
      compared++;
      if (Math.abs(sum - side.totalPoints) <= ORACLE_TOLERANCE) matched++;
      else off.push(`T${t.id} starters ${round2(sum)} vs matchup ${round2(side.totalPoints)}`);
    }
    add(ctx, compared && matched === compared ? "ok" : "warn", "K", `K.teamTotals.week${week}`, `Week ${week} team scores`, `Σ starters' appliedTotal (lineup slots other than BE/IR) equals the matchup totalPoints for ${matched}/${compared} teams${off.length ? `; differ: ${off.slice(0, 4).join("; ")}` : ""}`, { path: "schedule[].home|away.totalPoints vs Σ entries[lineupSlotId ∉ {20,21}] appliedTotal", sample: { matched, compared } });
  }
}

function checkL(ctx: Ctx, f: Fetched) {
  const r = f.proSchedule;
  if (!r?.outcome.ok || !ctx.proTeams.length) return failFetch(ctx, "L", "L.byeWeeks", "Bye weeks", r);
  const teams = ctx.proTeams.filter((t) => t.id !== 0);
  const withBye = teams.filter((t) => typeof t.byeWeek === "number" && t.byeWeek > 0);
  const lastWeek = Math.max(0, ...ctx.windows.map((w) => w.week));
  const mismatch = teams.filter((t) => {
    const gaps = byeWeeksFromGames(t.proGamesByScoringPeriod, lastWeek);
    return !(gaps.length === 1 && gaps[0] === t.byeWeek);
  });
  add(ctx, withBye.length === 32 && !mismatch.length ? "ok" : "warn", "L", "L.byeWeeks", "Bye weeks", `settings.proTeams[].byeWeek on ${withBye.length}/${teams.length} NFL teams (weeks ${Math.min(...withBye.map((t) => t.byeWeek ?? 0))}–${Math.max(...withBye.map((t) => t.byeWeek ?? 0))}: ${fmtCounts(countBy(withBye, (t) => t.byeWeek))}); matches the gap in each team's game list: ${teams.length - mismatch.length}/${teams.length}`, {
    url: r.call.template,
    status: r.res.status,
    path: "settings.proTeams[].byeWeek",
    sample: withBye[0] ? { id: withBye[0].id, abbrev: withBye[0].abbrev, byeWeek: withBye[0].byeWeek } : null,
  });
  const games = ctx.windows.reduce((a, w) => a + w.games, 0);
  add(ctx, games === 272 ? "ok" : "warn", "L", "L.schedule", "NFL schedule", `${games} regular-season games over weeks ${ctx.windows[0]?.week}–${lastWeek} (${ctx.windows.map((w) => w.games).join("/")} per week) from proGamesByScoringPeriod, with kickoff times (epoch ms)`, {
    path: "settings.proTeams[].proGamesByScoringPeriod[week][].{date, homeProTeamId, awayProTeamId}",
    sample: ctx.windows[0] ? { week: ctx.windows[0].week, firstKickoff: iso(ctx.windows[0].firstKickoff), games: ctx.windows[0].games } : null,
  });
}

function checkM(ctx: Ctx, L: League, f: Fetched) {
  const fc = f.fc;
  if (!fc) return add(ctx, "fail", "M", "M.matchRate", "FantasyCalc match rate", "FantasyCalc not fetched");
  const teRec = L.settings.scoringSettings.scoringItems.find((i) => i.statId === 53)?.pointsOverrides?.[keyForPosition(ctx, "TE") ?? "4"];
  add(ctx, "ok", "M", "M.format", "FantasyCalc format", `isDynasty=${fc.format.isDynasty}, numQbs=${fc.format.numQbs} (OP/superflex or ≥2 QB slots → 2), numTeams=${fc.format.numTeams} (nearest to ${L.settings.size}), ppr=${fc.format.ppr} (nearest to ${receptionPoints(L)}); TE premium ${teRec !== undefined ? `present (TE ${teRec}), tep not sent` : "none, so no tep parameter"}`, { url: fantasyCalcUrl(fc.format), path: "query parameters", sample: fc.format });
  if ("error" in fc) return add(ctx, "fail", "M", "M.matchRate", "FantasyCalc match rate", `FantasyCalc request failed: ${fc.error}`, { url: fantasyCalcUrl(fc.format) });
  const rostered = rosterEntries(L).map((x) => ({ id: String(x.e.playerId), name: x.e.playerPoolEntry.player.fullName, pos: positionOf(ctx, x.e.playerPoolEntry.player) }));
  const m = matchRate(rostered, fc.data, "espnId");
  // Explain each miss: is the player in FantasyCalc under another (or no) espnId?
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "").replace(/(jr|sr|ii|iii|iv)$/, "");
  const cardById = new Map(playersFromCards(f).map((pl) => [String(pl.id), pl]));
  const why = (x: { id: string; name: string; pos: string }) => {
    const hit = fc.data.find((e) => norm(e.player.name) === norm(x.name));
    const inj = cardById.get(x.id);
    const injNote = inj?.injuryStatus && inj.injuryStatus !== "ACTIVE" ? `, ESPN ${inj.injuryStatus}${inj.injuryDetails?.outForSeason ? " out for season" : ""}` : "";
    return `${x.name} (${x.pos}, ESPN id ${x.id}${injNote}: ${hit ? `in FantasyCalc as "${hit.player.name}" with espnId ${hit.player.espnId ?? "null"}` : "not in FantasyCalc by name either"})`;
  };
  add(ctx, m.rate >= 0.98 ? "ok" : "warn", "M", "M.matchRate", "FantasyCalc match rate", `${m.matched}/${m.eligible} rostered QB/RB/WR/TE matched by player.espnId (${pct(m.matched, m.eligible)}; target ≥ 98%)${m.misses.length ? `; misses: ${m.misses.map(why).join("; ")}` : ""}`, {
    url: fantasyCalcUrl(fc.format),
    status: fc.status,
    path: "[].player.espnId",
    sample: fc.data[0] ? { name: fc.data[0].player.name, espnId: fc.data[0].player.espnId } : null,
  });
}

/** Leaf-level differences between two JSON values (count only). */
function leafDiffs(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    let n = 0;
    for (const k of keys) n += leafDiffs((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]);
    return n;
  }
  return 1;
}

/** Compare one no-cookie response with what the cookie requests returned. */
function compareNoCookie(ctx: Ctx, f: Fetched, view: string, r: Got): { status: Status; detail: string } {
  const L = f.league;
  const d = r.data as Record<string, unknown> | undefined;
  if (!L || !d) return { status: "ok", detail: "" };
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  const same = (a: number, b: number | undefined, what: string) => ({ status: (a === b ? "ok" : "warn") as Status, detail: `; ${a} ${what} (with cookies ${b ?? "?"})` });
  switch (view) {
    case "mSettings": {
      const cookieSettings = (f.main?.data as { settings?: unknown } | undefined)?.settings;
      const n = leafDiffs(d.settings, cookieSettings);
      return { status: n ? "warn" : "ok", detail: n ? `; settings differ from the cookie response in ${n} leaf values` : "; settings identical to the cookie response" };
    }
    case "mRoster": {
      const ids = arr(d.teams).flatMap((t) => arr((t as { roster?: { entries?: unknown[] } }).roster?.entries).map((e) => (e as { playerId?: number }).playerId));
      const cookieIds = new Set(rosterEntries(L).map((x) => x.e.playerId));
      const shared = ids.filter((id) => id !== undefined && cookieIds.has(id)).length;
      return { status: shared === cookieIds.size && ids.length === cookieIds.size ? "ok" : "warn", detail: `; ${ids.length} roster entries, ${shared}/${cookieIds.size} of the cookie response's players` };
    }
    case "mTransactions2": {
      const nc = parseTx(r) ?? [];
      const ck = parseTx(f.txWeeks.find((x) => x.week === f.noCookieTxWeek)?.r);
      if (!ck) return { status: "warn", detail: `; ${nc.length} rows (cookie response for sp${f.noCookieTxWeek} unavailable)` };
      const { onlyA: onlyCookie, onlyB: onlyNo } = idOverlap(ck, nc);
      const mine = onlyCookie.filter((t) => involves(t, ctx.myTeamId));
      const explained = onlyNo.length === 0 && mine.length === onlyCookie.length;
      return {
        status: explained ? "ok" : "warn",
        detail: `; sp${f.noCookieTxWeek}: ${nc.length} rows vs ${ck.length} with cookies; ${onlyCookie.length} only with cookies (${fmtCounts(countBy(onlyCookie, (t) => `${t.type}/${t.status}`)) || "none"}), ${mine.length} of them involving the cookie holder's team (Team ${ctx.myTeamId ?? "?"}): its own pending claims and offers are hidden from everyone else${onlyNo.length ? `; ${onlyNo.length} rows only WITHOUT cookies` : ""}`,
      };
    }
    case "kona_player_info": {
      const ids = arr(d.players).map((x) => (x as { id?: number }).id);
      const ck = parsePlayers(f.fa.find((x) => x.pos === "QB")?.r)?.slice(0, ids.length).map((x) => x.id) ?? [];
      const shared = ids.filter((id) => id !== undefined && ck.includes(id)).length;
      return { status: shared === ids.length && ids.length === ck.length ? "ok" : "warn", detail: `; ${ids.length} free-agent QBs, ${shared} of them the cookie response's ${ck.length} most-owned` };
    }
    case "mDraftDetail":
      return same(arr((d.draftDetail as { picks?: unknown[] } | undefined)?.picks).length, (f.draft?.data as { draftDetail?: { picks?: unknown[] } } | undefined)?.draftDetail?.picks?.length, "draft picks");
    case "mStandings":
      return same(arr(d.teams).filter((t) => (t as { currentSimulationResults?: unknown }).currentSimulationResults).length, (f.standings?.data as { teams?: Array<{ currentSimulationResults?: unknown }> } | undefined)?.teams?.filter((t) => t.currentSimulationResults).length, "teams with ESPN playoff odds");
    case "mMatchupScore":
      return same(arr(d.schedule).length, (f.matchupScore?.data as { schedule?: unknown[] } | undefined)?.schedule?.length, "matchups");
    case "kona_league_communication":
      return same(arr(d.topics).length, (f.comm[0]?.data as { topics?: unknown[] } | undefined)?.topics?.length, "activity topics on page 0");
    case "kona_playercard": {
      const got = arr(d.players).map((x) => (x as { id?: number }).id);
      return { status: got.length === f.noCookieCardIds.length ? "ok" : "warn", detail: `; ${got.length}/${f.noCookieCardIds.length} requested player cards` };
    }
    default:
      return { status: "ok", detail: "" };
  }
}

function checkAuth(ctx: Ctx, f: Fetched) {
  const L = f.league;
  const s2 = !!ctx.auth.s2;
  const sw = !!ctx.auth.swid;
  add(ctx, s2 && sw ? "ok" : "warn", "AUTH", "AUTH.cookies", "Cookies available", `ESPN_S2 ${s2 ? "set" : "blank"}, ESPN_SWID ${sw ? "set" : "blank"}; sent only as the Cookie header "espn_s2=…; SWID=…", never in league-API URLs, logs or cache keys (cache keys hold a credential hash). The optional fan API (AUTH.fanApi) needs the SWID in its URL path: that URL is scrubbed from logs and shown as {SWID} in reports`, {});
  if (L) add(ctx, "ok", "AUTH", "AUTH.isPublic", "League visibility", `settings.isPublic ${L.settings.isPublic ?? "?"}: ${L.settings.isPublic ? "anyone with the league ID can read it" : "private: cookies required"}`, { url: f.main?.call.template, path: "settings.isPublic", sample: L.settings.isPublic ?? null });
  else if (f.main) failFetch(ctx, "AUTH", "AUTH.main", "League request with cookies", f.main);
  const results: string[] = [];
  for (const { view, r } of f.noCookie) {
    const cmp = r.outcome.ok ? compareNoCookie(ctx, f, view, r) : { status: "warn" as Status, detail: "" };
    results.push(`${view} ${r.outcome.ok ? `${cmp.status === "ok" ? "✓" : "≠"}${cmp.detail.replace(/^; /, " ")}` : `✗ ${r.outcome.code} (HTTP ${r.res.status})`}`);
    const failText = L?.settings.isPublic ? `HTTP ${r.res.status} [${r.outcome.code}] although settings.isPublic is true: this view needs cookies even for a public league` : `${r.outcome.message} [${r.outcome.code}]`;
    add(ctx, r.outcome.ok ? cmp.status : "warn", "AUTH", `AUTH.noCookies.${view}`, `${view} without cookies`, r.outcome.ok ? `works without cookies (HTTP ${r.res.status})${cmp.detail}` : failText, { url: r.call.template, status: r.res.status });
  }
  const wrong = (key: string, title: string, r: Got | undefined, who: string) => {
    if (!r) return;
    add(ctx, !r.outcome.ok ? "ok" : "warn", "AUTH", key, title, !r.outcome.ok ? `season ${ctx.season + 1} (${who}) → HTTP ${r.res.status}${r.res.isHtml ? " (HTML page)" : r.res.contentType ? ` ${r.res.contentType.split(";")[0]}` : ""}${r.outcome.detailTypes.length ? `, ESPN error type ${r.outcome.detailTypes.join(", ")}` : ""}; classified as "${r.outcome.code}": ${r.outcome.message}` : `season ${ctx.season + 1} unexpectedly returned data`, { url: r.call.template, status: r.res.status, path: "details[].type", sample: r.outcome.detailTypes });
  };
  wrong("AUTH.wrongSeason", "Error handling (wrong season)", f.wrongSeason, "Parker's league, with cookies");
  wrong("AUTH.public.wrongSeason", "Error handling (wrong season, no cookies)", f.pubWrongSeason, "public test league, no cookies");
  const desc = (r: Got | undefined) => (r ? `HTTP ${r.res.status}${r.res.isHtml ? " (HTML page)" : r.res.contentType ? ` ${r.res.contentType.split(";")[0]}` : ""}${r.outcome.detailTypes.length ? ` with details[].type ${r.outcome.detailTypes.join("/")}` : ""}` : "not requested");
  const specLike = (r: Got | undefined) => !!r && (r.res.isHtml || r.res.status === 401 || r.res.status === 403);
  const wrongs = [f.wrongSeason, f.pubWrongSeason].filter((r): r is Got => !!r && !r.outcome.ok);
  if (wrongs.length && wrongs.every((r) => !specLike(r)))
    ctx.p.cl.issue(`CLAUDE.md §2.2 "Errors" says a wrong season shows up as an HTML page, a 401 or a 403. Live ESPN answers a season the league doesn't exist in (${ctx.season + 1}, view mSettings) with ${desc(f.wrongSeason)} for Parker's league with cookies and ${desc(f.pubWrongSeason)} for the public test league without cookies (AUTH.wrongSeason, AUTH.public.wrongSeason). Private-league behaviour is untested (Parker's league is public). Options: (a) Phase 1 maps HTTP 404 + GENERAL_NOT_FOUND to "no league with this ID for that season, or not renewed yet" (the probe's classifier already does), (b) keep the HTML/401/403 messages for private leagues and cookie problems.`);
  if (f.fan)
    add(ctx, f.fan.ok ? (f.fan.leagueListed ? "ok" : "warn") : "warn", "AUTH", "AUTH.fanApi", "Fan API (list a cookie user's leagues)", f.fan.ok ? `HTTP ${f.fan.status}; ${f.fan.note}; Parker's league listed: ${f.fan.leagueListed ? "yes" : "no"}` : `HTTP ${f.fan.status}: ${f.fan.note}`, {
      url: "https://fan.api.espn.com/apis/v2/fans/{SWID}",
      status: f.fan.status,
      note: "SWID is in the URL path: treat the URL as a secret",
    });
  const needCookies = f.noCookie.filter((x) => !x.r.outcome.ok);
  if (L?.settings.isPublic && needCookies.length)
    ctx.p.cl.issue(`CLAUDE.md §2.2 says public leagues need no cookies. Parker's league is public (settings.isPublic true), yet ${needCookies.map((x) => `${x.view} (HTTP ${x.r.res.status}, ${x.r.outcome.code})`).join(", ")} failed without cookies while ${f.noCookie.length - needCookies.length} other views worked (AUTH.noCookies.*). Options: (a) for public leagues read without cookies, build activity and trade history from mTransactions2 only, (b) ask for cookies when recent activity is wanted.`);
  if (L?.settings.isPublic) {
    const tested = new Set(f.noCookie.map((x) => x.view));
    const untested = COOKIE_VIEWS.filter((v) => !tested.has(v));
    ctx.p.cl.issue(`Private-league behaviour is untested: Parker's league has settings.isPublic = true, so anyone with its league ID can read it (ESPN_LEAGUE_ID is as sensitive as the cookies). Requested without cookies: ${results.join("; ")}. Not requested on their own without cookies: ${untested.join(", ") || "none"}. The error classifier was exercised with wrong-season requests instead (AUTH.wrongSeason). Options: (a) accept, (b) Parker makes a private test league, (c) re-probe if the league goes private.`);
  }
}

/** Where SWID-shaped values ({GUID}) sit in Parker's league responses (collapsed JSON paths). */
function checkSwidLocations(ctx: Ctx, f: Fetched) {
  const counts: Record<string, number> = {};
  const walk = (v: unknown, p: JsonPath) => {
    if (typeof v === "string") {
      if (SWID_RE.test(v)) {
        const key = collapsePath(formatPath(p));
        counts[key] = (counts[key] ?? 0) + 1;
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...p, i]));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, [...p, k]);
  };
  const responses = [f.main, f.txDefault, f.txUnfiltered?.r, f.draft, f.matchupScore, f.standings, ...f.txWeeks.map((x) => x.r), ...f.comm, ...f.fa.map((x) => x.r), ...f.rosterWeeks.map((x) => x.r), ...f.future.map((x) => x.r), ...f.cards];
  for (const r of responses) if (r?.data) walk(r.data, []);
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return;
  const beyond = entries.filter(([p]) => !SPEC_SWID_PATHS.has(p));
  add(ctx, "ok", "AUTH", "AUTH.swidLocations", "Where SWIDs appear", `SWID-shaped values ({GUID}) in Parker's league responses by JSON path: ${entries.map(([p, n]) => `${p}×${n}`).join(", ")}. Fixtures placeholder every one of them (the sanitizer treats any {GUID} as a SWID)`, { path: "any string matching {8-4-4-4-12 hex}", sample: entries.length });
  if (beyond.length)
    ctx.p.cl.issue(`CLAUDE.md §0.5 names teams[].owners[], members[].id and the fan-API path as where SWIDs appear. Live responses also carry them at ${beyond.map(([p, n]) => `${p} (${n})`).join(", ")} (AUTH.swidLocations). Committed fixtures placeholder all of them. Options: (a) Phase 1 sanitizing and logging treat every {GUID} as a SWID (the probe's rule), (b) list the paths explicitly and re-check them each season.`);
}

function checkIds(ctx: Ctx) {
  const c = ctx.c;
  if (!c) return add(ctx, "fail", "IDS", "IDS.tables", "ID tables", "constant.py not fetched/parsed; slot, team and stat names are unavailable");
  const errs = Object.keys(c.parseErrors);
  const teamIds = Object.keys(c.proTeams).map(Number);
  add(ctx, errs.length ? "fail" : "ok", "IDS", "IDS.tables", "ID tables (constant.py)", `POSITION_MAP ${Object.keys(c.slotNames).length} slot ids (+${Object.keys(c.slotIdsByName).length} reverse names), PRO_TEAM_MAP ${teamIds.length} (0 = "${c.proTeams[0] ?? "?"}"; ids ${range(0, Math.max(...teamIds)).filter((i) => !teamIds.includes(i)).join(", ") || "none"} unused), PLAYER_STATS_MAP ${Object.keys(c.playerStats).length}, SETTINGS_SCORING_FORMAT_MAP ${Object.keys(c.scoringFormat).length}, ACTIVITY_MAP ${Object.keys(c.activity).length}, TRANSACTION_TYPES ${c.transactionTypes.length}${errs.length ? `; parse errors: ${errs.join(", ")}` : ""}`, {
    url: `https://raw.githubusercontent.com/${ESPN_API_REPO}/${ctx.sha}/${ESPN_API_CONSTANT_PATH}`,
    path: "POSITION_MAP / PRO_TEAM_MAP / PLAYER_STATS_MAP / SETTINGS_SCORING_FORMAT_MAP",
    sample: { 0: c.slotNames[0], 20: c.slotNames[20], 21: c.slotNames[21], 23: c.slotNames[23] },
  });
  const missing: string[] = [];
  for (const [file, markers] of Object.entries(FILTER_SOURCE_MARKERS)) {
    const src = ctx.sources[file];
    for (const m of markers) if (!src || !sourceHasMarker(src, m)) missing.push(`${file}: ${m}`);
  }
  add(ctx, missing.length ? "warn" : "ok", "IDS", "IDS.filters", "X-Fantasy-Filter payloads", missing.length ? `${missing.length} copied snippets no longer found upstream: ${missing.slice(0, 3).join(" | ")}` : `all ${Object.values(FILTER_SOURCE_MARKERS).flat().length} snippets we copied (free_agents, player_info/get_player_card, player pool, transactions, recent_activity, get_pro_players) are present at this commit`, { path: "scripts/lib/espn/filters.ts vs upstream", sample: Object.keys(FILTER_SOURCE_MARKERS) });
  const rule = 'if (pos != 25 and "/" not in POSITION_MAP[pos]) or "/" in self.name:';
  const settingsPy = ctx.sources["espn_api/football/settings.py"];
  const overrideReads = settingsPy ? (settingsPy.match(/pointsOverrides/g) ?? []).length : undefined;
  const readsOnly16 = upstreamHas(ctx, "espn_api/football/settings.py", 'scoring_item.get("pointsOverrides", {}).get("16")');
  add(ctx, upstreamHas(ctx, "espn_api/football/player.py", rule) ? "ok" : "warn", "IDS", "IDS.positionRule", "Position derivation rule", `espn-api player.py picks the first eligibleSlot that isn't 25 and has no "/"${upstreamHas(ctx, "espn_api/football/player.py", rule) ? "" : " [rule NOT found at this commit]"}; it never maps defaultPositionId, so our defaultPositionId table (E.defaultPosition) is empirical. espn-api's football/settings.py mentions pointsOverrides ${overrideReads ?? "?"} time(s)${readsOnly16 ? ', reading only key "16" (D/ST)' : ""}, so upstream doesn't settle the key space (K.overrideKeys does)`, { path: "espn_api/football/player.py, espn_api/football/settings.py", sample: rule });
}

// ---------------------------------------------------------------- fixtures

/** Keep only stat lines that pass `keep` (raw captures keep everything). */
function filterStats(keep: (s: { seasonId?: number; scoringPeriodId?: number }) => boolean) {
  return (x: unknown): unknown => {
    const walk = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, y] of Object.entries(v)) out[k] = k === "stats" && Array.isArray(y) ? y.filter((s) => keep(s as { seasonId?: number; scoringPeriodId?: number })) : walk(y);
        return out;
      }
      return v;
    };
    return walk(x);
  };
}

/** Free-agent fixtures: the most-owned FA_TOP plus the top FA_TOP by current-week projection. */
function faSubset(ctx: Ctx, week: number): Transform {
  return {
    fn: (x) => {
      const o = x as { players?: Array<{ id?: number; player?: Player }> };
      if (!Array.isArray(o.players)) return x;
      const proj = (e: { player?: Player }) => (e.player ? findStat(e.player, ctx.season, 1, 1, week)?.appliedTotal : undefined);
      const keep = new Set(o.players.slice(0, FA_TOP).map((e) => e.id));
      for (const e of [...o.players]
        .filter((e) => proj(e) !== undefined)
        .sort((a, b) => (proj(b) ?? 0) - (proj(a) ?? 0))
        .slice(0, FA_TOP))
        keep.add(e.id);
      return { ...o, players: o.players.filter((e) => keep.has(e.id)) };
    },
    note: `players limited to the ${FA_TOP} most-owned plus the top ${FA_TOP} by week-${week} projection (of a limit-${FA_LIMIT} response)`,
  };
}

async function saveAllFixtures(ctx: Ctx, f: Fetched) {
  const tag = (label: string) => `league/{leagueId}/${label}`;
  // Committed fixtures carry what Phase 1 tests need; previous seasons' stat lines stay in the raw captures.
  const thisSeason: Transform = { fn: filterStats((s) => s.seasonId === ctx.season), note: "previous seasons' stat lines dropped" };
  const onlyWeek = (week: number): Transform => ({ fn: filterStats((s) => s.seasonId === ctx.season && s.scoringPeriodId === week), note: `stat lines limited to ${ctx.season} scoring period ${week}` });
  const L = f.league;
  const current = L?.status.latestScoringPeriod;
  if (ctx.c) await saveFixture(ctx, `espn-api/${ctx.sha.slice(0, 7)}/constant.py (parsed tables)`, { source: `${ESPN_API_REPO}@${ctx.sha}/${ESPN_API_CONSTANT_PATH}`, license: "MIT (c) 2018 Christian Wendt", ...ctx.c }, { note: "parsed by scripts/lib/espn/constants.ts" }, { protect: protectAll, trim: false });
  await saveFixture(ctx, "seasons/{season}/view=proTeamSchedules_wl", f.proSchedule?.data, metaOf(f.proSchedule), { protect: protectAll, trim: false });
  if (ctx.leagueId) {
    await saveFixture(ctx, tag("view=mSettings+mTeam+mRoster+mMatchup+mStatus"), f.main?.data, metaOf(f.main), { transform: thisSeason });
    if (f.wrongSeason) await saveFixture(ctx, `league/{leagueId}/seasons={season+1}/view=mSettings (error body)`, f.wrongSeason.res.json ?? { text: f.wrongSeason.res.text.slice(0, 2000) }, metaOf(f.wrongSeason), { trim: false });
  }
  if (L) {
    await saveFixture(ctx, tag("view=mTransactions2 (no scoringPeriodId, no filter)"), f.txDefault?.data, metaOf(f.txDefault));
    for (const { week, r } of f.txWeeks) await saveFixture(ctx, tag(`view=mTransactions2&scoringPeriodId=${week} (filter: FA, waiver and trade types)`), r.data, metaOf(r));
    if (f.txUnfiltered) await saveFixture(ctx, tag(`view=mTransactions2&scoringPeriodId=${f.txUnfiltered.week} (no filter)`), f.txUnfiltered.r.data, metaOf(f.txUnfiltered.r));
    for (const [i, r] of f.comm.entries()) await saveFixture(ctx, tag(`communication/view=kona_league_communication (recent activity page ${i})`), r.data, metaOf(r));
    await saveFixture(ctx, tag("view=mDraftDetail"), f.draft?.data, metaOf(f.draft));
    await saveFixture(ctx, tag("view=mMatchupScore"), f.matchupScore?.data, metaOf(f.matchupScore), { transform: thisSeason });
    await saveFixture(ctx, tag("view=mStandings"), f.standings?.data, metaOf(f.standings));
    for (const { pos, r } of f.fa) await saveFixture(ctx, tag(`view=kona_player_info&scoringPeriodId={current} (free agents ${pos}, limit ${FA_LIMIT}; ${FA_TOP} most-owned + top ${FA_TOP} by projection)`), r.data, metaOf(r), { transform: compose(faSubset(ctx, current ?? 0), thisSeason) });
    for (const { week, r } of f.rosterWeeks) await saveFixture(ctx, tag(`view=mRoster&scoringPeriodId=${week}`), r.data, metaOf(r), { transform: onlyWeek(week) });
    // Only the next week's pool is committed (the other sampled weeks' evidence is in the report).
    const next = f.future[0];
    if (next) await saveFixture(ctx, tag(`view=kona_player_info&scoringPeriodId=${next.week} (player pool, top ${POOL_PAGE} by % owned; that week's stat lines only)`), next.r.data, metaOf(next.r), { transform: onlyWeek(next.week) });
    for (const [i, r] of f.cards.entries()) await saveFixture(ctx, tag(`view=kona_playercard (rostered players batch ${i + 1})`), r.data, metaOf(r), { transform: thisSeason });
    if (Array.isArray(f.universe?.data)) {
      // Public player universe: fantasy positions, plus a few players of every other defaultPositionId (P, IDP, HC, TQB).
      const rows = f.universe.data as Array<{ defaultPositionId?: number }>;
      const perOther = new Map<number, number>();
      const keep = rows.filter((x) => {
        const id = x.defaultPositionId;
        if (id === undefined) return false;
        if ([1, 2, 3, 4, 5, 16].includes(id)) return true;
        const n = perOther.get(id) ?? 0;
        perOther.set(id, n + 1);
        return n < 5;
      });
      await saveFixture(ctx, "seasons/{season}/players?view=players_wl (active; QB/RB/WR/TE/K/D/ST plus up to 5 per other position)", keep, metaOf(f.universe), { protect: protectAll });
    } else ctx.fixtureProblems++;
  }
  // Only the latest pool week is committed (the oracle evidence for the other weeks is in the report).
  const lastPool = f.pubPool[f.pubPool.length - 1];
  if (lastPool) await saveFixture(ctx, `public-league/{publicLeagueId}/view=kona_player_info&scoringPeriodId=${lastPool.week} (player pool, top ${PUBLIC_POOL} by % owned)`, lastPool.r.data === undefined ? undefined : replaceIdDeep(lastPool.r.data, PUBLIC_LEAGUE_ID, PUBLIC_LEAGUE_PLACEHOLDER), metaOf(lastPool.r), { transform: onlyWeek(lastPool.week) });
  await saveFixture(ctx, "public-league/{publicLeagueId}/view=mSettings+mTeam+mRoster+mStatus", f.pub?.data === undefined ? undefined : replaceIdDeep(f.pub.data, PUBLIC_LEAGUE_ID, PUBLIC_LEAGUE_PLACEHOLDER), metaOf(f.pub), { transform: thisSeason });
}

// ---------------------------------------------------------------- main

void runProbe("espn", async (p) => {
  const season = Number(p.env("ESPN_SEASON") ?? "2026");
  const leagueId = p.env("ESPN_LEAGUE_ID");
  const auth: EspnAuth = { s2: p.env("ESPN_S2"), swid: p.env("ESPN_SWID") };
  // Register private identifiers before anything is printed. Parker's SWID first → placeholder …0001.
  if (auth.swid) p.redactor.register(auth.swid, "swid");
  if (leagueId) p.redactor.register(leagueId, "league-id");

  const ctx: Ctx = { p, season, leagueId, auth, deps: { request: p.request, leagueCache: p.leagueCache }, sha: "master", shaDate: "", sources: {}, windows: [], proTeams: [], fixtures: [], fixtureProblems: 0, deferred: [], posById: {}, oracles: [], faTop: new Map(), txFacts: {} };
  p.cl.meta.leagues = [
    { label: "Parker's league", access: hasCookies(auth) ? "cookies (ESPN_S2 + ESPN_SWID)" : "no cookies (ESPN_S2/ESPN_SWID blank)", source: ".env.local ESPN_LEAGUE_ID + ESPN_SEASON", notes: "all checks A–M" },
    { label: "public test league", access: "no cookies", source: "CLAUDE.md §2.2 (planner-verified public league)", notes: "settings-level checks (A, B, C), its rosters, and its completed weeks as a second scoring oracle (K.public.*)" },
  ];
  if (!leagueId) {
    add(ctx, "fail", "A", "A.leagueId", "League ID", "ESPN_LEAGUE_ID is blank in .env.local: fill it in to probe Parker's league (only the public test league was checked)");
    p.cl.question("ESPN_LEAGUE_ID is blank: can you fill it in .env.local?");
  }

  await p.timed("espn-api sources", () => loadEspnApiSources(ctx));
  const f = await p.timed("fetch", () => fetchAll(ctx));
  ctx.posById = buildPosById(ctx, f);

  // Identities: Parker's league first (SWID placeholders stay stable), then the public league,
  // then sweep every other response for SWIDs (transactions, draft picks, messages…).
  // "Parker" (his own first name) stays readable in reports; fixtures still mask it (maskOwnMember).
  if (f.main?.data) ctx.ownLabel = registerLeagueIdentities(p.redactor, f.main.data, { mySwid: auth.swid, keepOwnWords: ["Parker"] }).ownLabel;
  if (f.pub?.data) registerLeagueIdentities(p.redactor, f.pub.data);
  const sweepList = [f.txDefault, f.txAlias, f.txAhead?.r, f.draft, f.matchupScore, f.standings, f.wrongSeason, f.pubWrongSeason, f.txUnfiltered?.r, ...f.txWeeks.map((x) => x.r), ...f.comm, ...f.fa.map((x) => x.r), ...f.rosterWeeks.map((x) => x.r), ...f.future.map((x) => x.r), ...f.cards, ...f.noCookie.map((x) => x.r), ...f.pubPool.map((x) => x.r)];
  for (const r of sweepList) if (r?.data) sweepIds(p.redactor, r.data);

  await p.timed("sanitize + save fixtures", () => saveAllFixtures(ctx, f));

  const L = f.league;
  const PL = f.pubLeague;
  const mainUrl = f.main?.call.template ?? "";
  const pubUrl = f.pub?.call.template ?? "";
  if (f.main && !f.main.outcome.ok) failFetch(ctx, "A", "A.fetch", "League request", f.main);
  if (f.main?.outcome.ok && !L) add(ctx, "fail", "A", "A.schema", "League response shape", `doesn't match the expected shape: ${f.leagueIssues.join(" | ")}`, { url: mainUrl });
  if (f.pub && !f.pub.outcome.ok) failFetch(ctx, "A", "A.public.fetch", "Public test league request", f.pub);
  if (f.pub?.outcome.ok && !PL) add(ctx, "fail", "A", "A.public.schema", "Public test league shape", f.pubIssues.join(" | "), { url: pubUrl });

  ctx.oracles = computeOracles(ctx, f);
  if (L) checkA(ctx, L, "", mainUrl, f.main?.data);
  if (PL) checkA(ctx, PL, "public.", pubUrl, f.pub?.data);
  if (L) checkB(ctx, L, "", slotEligibility(ctx, rosterEntries(L).map((x) => x.e.playerPoolEntry.player)), f.main?.data);
  if (PL) checkB(ctx, PL, "public.", slotEligibility(ctx, rosterEntries(PL).map((x) => x.e.playerPoolEntry.player)), f.pub?.data);
  if (L) checkC(ctx, L, "");
  if (PL) checkC(ctx, PL, "public.");
  if (L) {
    checkD(ctx, L, mainUrl);
    checkE(ctx, L, f, mainUrl);
  }
  if (PL) {
    const n = rosterEntries(PL).length;
    add(ctx, n ? "warn" : "ok", "E", "E.public.rosters", "Public test league rosters", n ? `NOT empty, unlike the spec's note: draftDetail.drafted ${(f.pub?.data as { draftDetail?: { drafted?: boolean } }).draftDetail?.drafted}, ${n} roster entries on ${PL.teams.length} teams, records ${PL.teams.map((t) => `${t.record?.overall.wins ?? "?"}-${t.record?.overall.losses ?? "?"}`).join(" ")}` : "empty (not drafted), as the spec expected", { url: pubUrl, path: "draftDetail.drafted / teams[].roster.entries", sample: n });
  }
  if (L) {
    checkF(ctx, L, f, mainUrl);
    checkG(ctx, L, f);
    checkH(ctx, L, f);
    checkI(ctx, L, f);
    checkJ(ctx, L, f, mainUrl);
    checkK(ctx, L, f);
  } else {
    // Parker's league couldn't be read: say so per item, so the public test league's sub-checks
    // (B, C, E, K) can't make these cells look verified in the matrix.
    const reason = !leagueId ? "ESPN_LEAGUE_ID is blank" : f.main && !f.main.outcome.ok ? `the league request failed (A.fetch: ${f.main.outcome.code})` : "the league response didn't parse (A.schema)";
    for (const item of ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "M"]) add(ctx, "fail", item, `${item}.blocked`, "Parker's league", `blocked: ${reason}; nothing for Parker's league was checked under ${item}`);
  }
  for (const run of ctx.oracles.filter((o) => o.scope === "public")) reportOracle(ctx, run);
  for (const { week, r } of f.pubPool) if (!parsePlayers(r)) failFetch(ctx, "K", `K.public.poolOracle.week${week}`, `Scoring oracle preview, public test league player pool week ${week}`, r);
  if (ctx.oracles.length) reportOverrideKeys(ctx);
  checkL(ctx, f);
  if (L) checkM(ctx, L, f);
  checkAuth(ctx, f);
  if (L) checkSwidLocations(ctx, f);
  const flush = (item: string) => {
    for (const d of ctx.deferred.filter((x) => x.item === item)) p.cl.add(d.item, d.key, d.title, d.status, d.summary, ...d.ev);
  };
  flush("IDS");
  checkIds(ctx);

  // Manifest for Phase 1 tests (my-team detection etc.). Placeholders only.
  const manifest = {
    platform: "espn",
    season,
    espnApi: { repo: ESPN_API_REPO, commit: ctx.sha },
    leagues: [
      L && {
        label: "Parker's league",
        leagueId: Number(p.redactor.placeholderOf(leagueId)) || null,
        isPublic: L.settings.isPublic ?? null,
        myTeamId: ctx.myTeamId ?? null,
        mySwid: p.redactor.placeholderOf(auth.swid) ?? null,
        numTeams: L.settings.size,
        currentWeek: L.status.latestScoringPeriod,
        fixtureLabelPrefix: "league/{leagueId}/",
      },
      PL && { label: "public test league", leagueId: PUBLIC_LEAGUE_PLACEHOLDER, isPublic: PL.settings.isPublic ?? null, myTeamId: null, numTeams: PL.settings.size, fixtureLabelPrefix: "public-league/{publicLeagueId}/" },
    ].filter(Boolean),
    fixtures: ctx.fixtures,
    notes: "Owner placeholders follow team ids (Owner 3 owns Team 3). Parker's SWID placeholder is always {00000000-0000-4000-8000-000000000001}.",
  };
  await saveFixture(ctx, "manifest", manifest, { note: "which placeholder SWID / team is Parker's" }, { trim: false, protect: protectAll, sweep: false });
  flush("FIX");
  add(ctx, ctx.fixtureProblems ? "warn" : "ok", "FIX", "FIX.saved", "Sanitized fixtures", `${ctx.fixtures.length} saved under fixtures/sanitized/espn (index.json maps sha256(label) file names to labels)${ctx.fixtureProblems ? `; ${ctx.fixtureProblems} planned fixture(s) not saved this run` : ""}; raw captures in fixtures/raw/espn (git-ignored)`, { sample: ctx.fixtures.slice(0, 3) });
  // Stale fixtures (labels this probe no longer produces) are removed only after a complete run.
  if (!ctx.fixtureProblems && L && PL) {
    const pr = await pruneFixtures(path.join(SANITIZED_DIR, "espn"), new Set(ctx.fixtures));
    const bad = pr.misnamed.length + pr.missingFiles.length;
    add(ctx, bad ? "warn" : "ok", "FIX", "FIX.prune", "Stale fixtures", `removed ${pr.removed.length} fixture(s) this probe no longer produces${pr.removed.length ? ` (${pr.removed.join("; ")})` : ""} and ${pr.unindexed.length} unindexed file(s); every remaining file is named sha256(label): ${pr.misnamed.length ? `NO (${pr.misnamed.join("; ")})` : "yes"}; index entries without a file: ${pr.missingFiles.length}`, { path: "fixtures/sanitized/espn/index.json" });
  } else add(ctx, "warn", "FIX", "FIX.prune", "Stale fixtures", "not pruned: this run was incomplete, so a missing fixture may just not have been refreshed");

  // Decisions and questions for the checkpoint report.
  const ev = overrideEvidence(ctx);
  p.cl.decision(`ID tables and X-Fantasy-Filter payloads are taken from ${ESPN_API_REPO}@${ctx.sha.slice(0, 7)} (MIT): constant.py is parsed at run time (scripts/lib/espn/constants.ts), filters are copied verbatim with a drift check (scripts/lib/espn/filters.ts); upstream behaviour the report cites is checked against the fetched source files.`);
  p.cl.decision(`Position = espn-api's eligibleSlots rule; the defaultPositionId table is derived empirically from the active player universe (${Object.entries(ctx.posById)
    .map(([id, pos]) => `${id} ${pos}`)
    .join(", ")}) and cross-checked against Sleeper's and DynastyProcess's espn_id → position (E.defaultPosition).`);
  p.cl.decision(`pointsOverrides are keyed by the player's defaultPositionId and REPLACE the base points (key space: ${ev.keyPos}/${ev.keyCases.length} discriminating player-weeks; replace vs add: ${ev.modeReplace}/${ev.modeCases.length}; K.overrideKeys), which matches the spec's byPosition rule once keys are translated to positions. Keys for positions without a discriminating player-week (e.g. QB, K) are inferred.`);
  const lt = L ? leagueTypeOf(L) : undefined;
  p.cl.decision(`League type: keeperCount 0 → redraft (settled for Parker's league${lt ? `: ${lt.type}` : ""}); keeperCount ≥ active roster → dynasty, otherwise keeper: that part is inferred and untested (no ESPN keeper/dynasty league probed; ESPN has no dynasty flag).`);
  p.cl.decision(`Transactions: request scoringPeriodId 1…current with espn-api's type filter and dedupe rows by id across requests. ${ctx.txFacts.zeroAlias ? "scoringPeriodId 0 returns the current period's rows (G.periodZero)" : "scoringPeriodId 0 was NOT shown to be a plain alias of the current period (G.periodZero)"}${ctx.txFacts.aheadRepeats === undefined ? "" : ctx.txFacts.aheadRepeats ? " and so does the next period (G.periodAhead)" : "; the next period returns different rows (G.periodAhead)"}, so only 1…current are requested. Lineup moves (ROSTER) are excluded. Phase 1's activity feature counts unique ids.`);
  p.cl.decision(`Free agents: one request per position with espn-api's free_agents() filter at limit ${FA_LIMIT} (espn-api's pool page size), then ranked by projection for the top ${FA_TOP} (H.top50). Future-week projections: espn-api's pool filter, page of ${POOL_PAGE}, sampled weeks only, cached 6 h (§2.10).`);
  p.cl.decision("Canonical scoring keys: range rules (points/yards allowed, FG distance, 100-199 yard games) are mapped by computing ranges from espn-api labels vs Sleeper key names; other rules use a candidate table (scripts/lib/espn/canonical.ts) that the Phase 1 oracle must confirm (C.canonical).");
  p.cl.decision(`Sanitized fixtures drop members[].notificationSettings, player analyst text/rankings (seasonOutlook, outlooks, rankings, draftRanksByRankType), creationInfo/lastUpdateInfo.platform and clientAddress (which app a member used) and previous seasons' stat lines; per-week fixtures keep only that week's lines; free-agent fixtures keep the ${FA_TOP} most-owned plus the top ${FA_TOP} by projection; raw captures keep everything. Team/member/division name fields are replaced by path; purely numeric names are never registered with the text scrubber (it would rewrite that number everywhere in report text).`);
  p.cl.decision(`The public test league's id is not registered in the redaction map (CLAUDE.md itself contains it, so check:leaks would flag the spec); its fixtures replace it with the fixed placeholder ${PUBLIC_LEAGUE_PLACEHOLDER} and URLs use {publicLeagueId}.`);
  p.cl.decision('Parker\'s own first name stays readable in reports ("Parker\'s team"); his member record is masked in fixtures (Owner/First/Last + his team id) like everyone else\'s.');
  p.cl.decision("Injury mapping proposal: ACTIVE→ACTIVE, QUESTIONABLE→QUESTIONABLE, DOUBTFUL→DOUBTFUL, OUT→OUT, INJURY_RESERVE→IR, SUSPENSION→SUSPENDED, DAY_TO_DAY and PROBABLE→QUESTIONABLE, missing (team D/ST)→ACTIVE; injuryReturnWeek from kona_playercard injuryDetails.expectedReturnDate (E.injuryReturn).");
  p.cl.decision("Trade history for the acceptance model: read TRADE_* rows per scoring period (proposals list their legs); if TRADE_ACCEPT rows arrive without items, refill them from player cards (players[].transactions) as espn-api does, or from recent-activity messages (TRADED).");

  // Issues computed from this run (the rest are added by the checks above).
  const pubRuns = ctx.oracles.filter((o) => o.scope === "public");
  if (PL && rosterEntries(PL).length) {
    const within = pubRuns.reduce((a, o) => a + o.result.withinPos, 0);
    const checked = pubRuns.reduce((a, o) => a + o.result.checked, 0);
    const completed = PL.status.latestScoringPeriod - 1;
    const tqb = slotCounts(PL).find((s) => slotName(ctx, s.id) === "TQB" && s.count > 0);
    p.cl.issue(`CLAUDE.md §2.2 expected the public test league to be undrafted with empty rosters; it has drafted (draftDetail.drafted ${(f.pub?.data as { draftDetail?: { drafted?: boolean } }).draftDetail?.drafted}, ${rosterEntries(PL).length} roster entries, ${completed} completed week(s) as of scoring period ${PL.status.latestScoringPeriod}). Harmless: it gave a second scoring oracle (${within}/${checked} = ${pct(within, checked)} within ${ORACLE_TOLERANCE} over ${pubRuns.length} run(s): K.public.*).${tqb ? ` It also starts a TQB (team QB, slot ${tqb.id}).` : ""} Evidence: E.public.rosters, B.public.starters.`);
  }
  const keyEv = overrideEvidence(ctx);
  p.cl.issue(`CLAUDE.md §2.2 says pointsOverrides "maps a lineupSlotId to points". Live evidence says the key is the player's defaultPositionId: on ${keyEv.keyCases.length} discriminating player-weeks the position-id reading matched ESPN ${keyEv.keyPos} times and the slot-id reading ${keyEv.keySlot} times (positions ${fmtCounts(countBy(keyEv.keyCases, (c) => c.pos)) || "none"}), and ESPN's own settings.statIdToOverridePosition uses position ids (K.overrideKeys). Overrides replace the base points (${keyEv.modeReplace}/${keyEv.modeCases.length} discriminating player-weeks). ${L ? `In Parker's league every override key is ${[...new Set(L.settings.scoringSettings.scoringItems.flatMap((i) => Object.keys(i.pointsOverrides ?? {})))].join("/") || "absent"}${L.settings.scoringSettings.scoringItems.every((i) => Object.keys(i.pointsOverrides ?? {}).every((k) => k === "16")) ? " (D/ST), where slot id and position id coincide, so his scoring is unaffected" : ""}.` : ""} Options: (a) Phase 1 adapter reads keys as defaultPositionId (recommended), (b) keep both readings in the oracle test until more leagues confirm.`);
  const canonText = canonicalIssue(ctx);
  if (canonText) p.cl.issue(canonText);
  const probedTypes = [L, PL].filter((x): x is League => !!x).map((x) => leagueTypeOf(x).type);
  if (!probedTypes.some((t) => t !== "redraft"))
    p.cl.issue(`No ESPN keeper or dynasty league was probed (Parker's league is ${L ? leagueTypeOf(L).type : "not read"}; the public test league is ${PL ? leagueTypeOf(PL).type : "not read"}). Untested: the keeper-vs-dynasty rule (A.leagueType) and traded future picks (I.futurePicks: ESPN's typeNames.moveTypes lists ${typeNameList(ctx.typeNames, "moveTypes").filter((x) => /DRAFT_TRADE/.test(x)).join(", ") || "no pick-trade moves"}). Options: (a) Parker provides an ESPN keeper/dynasty league ID, (b) find a public one, (c) mark ESPN dynasty/keeper support as unverified in the Import Report.`);
  p.cl.question("ESPN trade review: vetoVotesRequired and revisionHours show in the league JSON; does your ESPN league settings page describe trades as a 1-day review where the listed number of league votes vetoes a trade?");
  p.cl.question("How should ESPN's DAY_TO_DAY injury status map: QUESTIONABLE (my default) or ACTIVE?");
  p.cl.question("Do you have (or know) an ESPN keeper or dynasty league the probe could read, to test keeper/dynasty detection and traded picks?");
});

/** The Phase 1 scoring-map issue for Parker's league, built from C.canonical's summary. */
function canonicalIssue(ctx: Ctx): string | undefined {
  const cs = ctx.canonical;
  if (!cs) return undefined;
  const derived = cs.groups.derivedRule;
  const none = cs.groups.noKey;
  if (!derived.length && !none.length) return undefined;
  const fmtR = (r: CanonicalRule) => `${r.statId} ${r.abbr}${r.range ? ` ${fmtRange(r.range)}` : ""}`;
  const pa = derived.some((r) => r.family === "pts_allow");
  return `CLAUDE.md §5 makes Sleeper's stat keys canonical, but ${derived.length + none.length} of Parker's ${cs.rules.length} ESPN scoring rules have no 1:1 Sleeper key (C.canonical). Need a derived rule: ${derived.map(fmtR).join(", ") || "none"}${pa && cs.dstLines ? ` (D/ST points-allowed buckets that don't line up with Sleeper's ${sleeperBuckets("pts_allow").map((b) => b.key).join("/")}; in completed week(s) ${cs.weeks.join(" and ")}: ${cs.atRisk} of ${cs.dstLines} rostered D/ST lines had points allowed in a differing bucket, ${pct(cs.atRisk, cs.checkedPlayerWeeks)} of the ${cs.checkedPlayerWeeks} player-weeks in the oracle, against a 1% error budget for the 99% target)` : ""}. No Sleeper key: ${none.map(fmtR).join(", ") || "none"}. Options: (a) express each range as threshold bonuses on the raw stat (§4 bonuses: +p at ≥ lo, −p at ≥ hi+1; exact for actual stats, an expected value for projections), (b) add a range-rule type to Scoring, (c) put them in scoring.unmapped (the Phase 1 oracle would then miss those lines).`;
}
