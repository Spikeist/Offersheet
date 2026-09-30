/**
 * Phase 0 probe: Fleaflicker (CLAUDE.md §2.5, §17 Data Checklist A–M).
 *
 *   npm run probe:fleaflicker
 *   npm run probe:fleaflicker -- --rediscover     (ignore the pinned public test league)
 *
 * League: FLEAFLICKER_LEAGUE_ID from .env.local, else a pinned public test league (git-ignored,
 * see scripts/lib/fleaflicker/league-pick.ts). A second public league (pinned as "oracle") is used
 * only for the scoring-oracle preview. No login is needed; every request is a cached public GET.
 * Output: reports/probe-output/fleaflicker.{json,md}, fixtures/raw/fleaflicker (git-ignored),
 * fixtures/sanitized/fleaflicker (placeholders only).
 */
import { readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { TTL, writeFileAtomic } from "./lib/cache";
import type { Evidence } from "./lib/checklist";
import { ROOT } from "./lib/env";
import { FC_TEAM_SIZES, fantasyCalcUrl, getFantasyCalc, matchRate, nearest, type FcFormat, type RosteredPlayer } from "./lib/fantasycalc";
import { LeakError } from "./lib/fixtures";
import type { HttpResult } from "./lib/http";
import { runProbe, type ProbeContext } from "./lib/probe";
import { getSleeperPlayers } from "./lib/sleeper-players";
import {
  ENUM_DEFAULTS,
  apiUrl,
  boxscoreSchema,
  draftBoardSchema,
  enumOr,
  fd,
  int64,
  leagueRostersSchema,
  num,
  playerListingSchema,
  rosterSchema,
  rulesSchema,
  scoreboardSchema,
  sportradarId,
  standingsSchema,
  teamPicksSchema,
  tradesSchema,
  transactionsSchema,
  webUrl,
  type FfBoxscore,
  type FfDraftBoard,
  type FfDraftPick,
  type FfGame,
  type FfLeaguePlayer,
  type FfLeagueRosters,
  type FfPeriodRange,
  type FfPlayerListing,
  type FfRoster,
  type FfRules,
  type FfScoreboard,
  type FfStandings,
  type FfTeam,
  type FfTrades,
  type FfTransactions,
} from "./lib/fleaflicker/api";
import { FfClient, cacheableStatus, type Fetched, type Role } from "./lib/fleaflicker/client";
import { DOCS_URL, camelOf, parseDocs, snakeOf, type DocsFacts } from "./lib/fleaflicker/docs";
import { parseEasternTime, parseRulesPage, type HtmlRules } from "./lib/fleaflicker/html-rules";
import { FleaIdentities } from "./lib/fleaflicker/identities";
import { allCandidateIds, coverageCandidates, resolveLeagues, screenLeague, type PickedLeague, type Screen } from "./lib/fleaflicker/league-pick";
import { explainMismatches, type ExplainSummary } from "./lib/fleaflicker/oracle-explain";
import { dedupePicks, matchTradedPicks } from "./lib/fleaflicker/picks";
import { flexKind, mapInjury, mapPos, positionMatches, summarizeLineup } from "./lib/fleaflicker/positions";
import { getDynastyProcessIds, getNflverseByes, getSleeperWeekStats, normTeam, DP_IDMAP_URL, SLEEPER_STATS_URL, type WeekStats } from "./lib/fleaflicker/public-data";
import { diffHistogram, evaluate, statLine, summarizeOracle, type OracleRow, type OracleSummary } from "./lib/fleaflicker/scoring";
import { ADJUSTMENTS, ALL_ADJUSTMENTS, FF_CATEGORIES, classOf, convertRules, mappingCounts, scoringKeys, type AdjustmentId, type ConvertedScoring, type RuleMapping } from "./lib/fleaflicker/scoring-map";
import { WatchList } from "./lib/fleaflicker/watchlist";

const FF_CATEGORY_IDS = new Set(Object.keys(FF_CATEGORIES).map(Number));

const SEASON = seasonFor(new Date());
const TOLERANCE = 0.05;
const MAX_TX_PAGES = 20;
/** FetchTrades pages (10 trades each) read back to the start of this season; only page 1 becomes a fixture. */
const MAX_TRADE_PAGES = 3;
/** Sanitized fixtures keep the first pages only (raw captures keep everything). */
const TX_FIXTURE_PAGES = 3;
const FA_FIXTURE_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "D/ST", "LB"]);
/** Other public leagues whose rules (and standings, for the inactive-league check) are read. */
const COVERAGE_LEAGUES = 8;

function seasonFor(d: Date): number {
  return d.getUTCMonth() < 2 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
}

interface TxItem {
  time: number;
  week: number;
  type: string;
  typeOmitted: boolean;
  teamId?: number;
  playerId?: number;
  tradeId?: number;
  bid?: number;
}

interface LeagueData {
  pick: PickedLeague;
  role: Role;
  c: FfClient;
  standings: Fetched<FfStandings>;
  rules: Fetched<FfRules>;
  sbNow: Fetched<FfScoreboard>;
  currentWeek: number;
  /** Week the default scoreboard shows (schedulePeriod). */
  displayWeek: number;
  periods: FfPeriodRange[];
  weeks: number[];
  scoreboards: Map<number, Fetched<FfScoreboard>>;
  completedWeeks: number[];
  oracleWeeks: number[];
  boxscores: Map<number, Array<Fetched<FfBoxscore>>>;
  rosters: Fetched<FfLeagueRosters> | null;
  teamRosters: Map<number, Fetched<FfRoster>>;
  futureRoster: Fetched<FfRoster> | null;
  tx: { pages: Array<Fetched<FfTransactions>>; items: TxItem[]; reachedStart: boolean } | null;
  /** Completed trades, newest first (all pages read, up to MAX_TRADE_PAGES). */
  tradesDone: Array<Fetched<FfTrades>>;
  /** True when paging ended because resultOffsetNext was missing (the real trade count is known). */
  tradesReachedEnd: boolean;
  /** One FetchTrades request at result_offset = resultTotal − 1 (is the claimed total real?). */
  tradesTail: { offset: number; fetched: Fetched<FfTrades>; trades: number; repeatsFirstPage: boolean } | null;
  tradesPending: Fetched<FfTrades> | null;
  picks: Map<number, Fetched<{ picks?: FfDraftPick[] }>>;
  draftBoard: Fetched<FfDraftBoard> | null;
  fa: Map<string, Fetched<FfPlayerListing>>;
  /** Per free-agent listing: players whose position doesn't fit the requested filter. */
  faMismatch: Map<string, Record<string, number>>;
  faPage2: Fetched<FfPlayerListing> | null;
  extraPlayers: Array<Fetched<FfPlayerListing>>;
  html: { res: HttpResult | null; rules: HtmlRules | null; error?: string } | null;
  teamIds: number[];
}

/** Evidence entry. */
function ev(url: string | undefined, res: HttpResult | null | undefined, jsonPath?: string, sample?: unknown, note?: string): Evidence {
  return { url, status: res?.status, path: jsonPath, sample, note };
}

function teamsOf(st: FfStandings | null): FfTeam[] {
  return (st?.divisions ?? []).flatMap((d) => d.teams ?? []);
}

function gamesOf(f: Fetched<FfScoreboard> | undefined): FfGame[] {
  return f?.data?.games ?? [];
}

function weekOf(p: FfPeriodRange): number {
  return num(p.low?.ordinal ?? p.ordinal);
}

function lineupPlayers(box: FfBoxscore | null): Array<{ lp: FfLeaguePlayer; group: string; slot: string; side: "home" | "away" }> {
  const out: Array<{ lp: FfLeaguePlayer; group: string; slot: string; side: "home" | "away" }> = [];
  for (const g of box?.lineups ?? []) {
    for (const s of g.slots ?? []) {
      for (const side of ["home", "away"] as const) {
        const lp = s[side];
        if (lp) out.push({ lp, group: enumOr(g.group, "RosterPositionGroup"), slot: s.position?.label ?? "?", side });
      }
    }
  }
  return out;
}

function pct(n: number, d: number): string {
  return d ? `${((100 * n) / d).toFixed(1)}%` : "n/a";
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// ------------------------------------------------------------------------------------------------
// Loading

interface FixtureLog {
  /** Leak-check refusals (category + path only, never values). */
  errors: string[];
  /** Sanitized files written by this run (older ones are pruned at the end). */
  saved: Set<string>;
}

async function loadLeague(p: ProbeContext, ids: FleaIdentities, pick: PickedLeague, full: boolean, fx: FixtureLog): Promise<LeagueData> {
  const role: Role = pick.role;
  const c = new FfClient(p, ids, pick.id, role);
  const save = async (label: string, f: Fetched<unknown>, opts: { trim?: boolean; dropStats?: boolean; note?: string } = {}) => {
    try {
      const out = await c.fixture(label, f, opts);
      if (out) fx.saved.add(path.basename(out));
    } catch (err) {
      if (err instanceof LeakError) fx.errors.push(`${role}/${label}: ${err.message}`);
      else throw err;
    }
  };

  // Standings first: it registers every team and owner (placeholders follow its order).
  const standings = await c.get<FfStandings>("FetchLeagueStandings", { season: SEASON }, standingsSchema);
  await save(`FetchLeagueStandings?league_id={leagueId}&season=${SEASON}`, standings, { trim: true });
  const teamIds = teamsOf(standings.data).map((t) => t.id);

  const rules = await c.get<FfRules>("FetchLeagueRules", {}, rulesSchema);
  await save("FetchLeagueRules?league_id={leagueId}", rules);

  const sbNow = await c.get<FfScoreboard>("FetchLeagueScoreboard", { season: SEASON }, scoreboardSchema);
  await save(`FetchLeagueScoreboard?league_id={leagueId}&season=${SEASON}`, sbNow, { trim: true });
  const periods = sbNow.data?.eligibleSchedulePeriods ?? [];
  const weeks = periods.map(weekOf).filter((w) => w > 0);
  // The default scoreboard keeps showing the week that just ended (like Sleeper's display_week);
  // the scoring period that contains "now" is the current week.
  const nowPeriod = periods.find((x) => x.containsNow || x.low?.isNow);
  const displayWeek = num(sbNow.data?.schedulePeriod?.ordinal);
  const currentWeek = nowPeriod ? weekOf(nowPeriod) : displayWeek;

  const scoreboards = new Map<number, Fetched<FfScoreboard>>();
  const sbWeeks = full ? weeks : weeks.filter((w) => w < currentWeek);
  for (const w of sbWeeks) {
    const f = await c.get<FfScoreboard>("FetchLeagueScoreboard", { season: SEASON, scoring_period: w }, scoreboardSchema);
    scoreboards.set(w, f);
    await save(`FetchLeagueScoreboard?league_id={leagueId}&season=${SEASON}&scoring_period=${w}`, f, { trim: true });
  }
  const completedWeeks = sbWeeks.filter((w) => w < currentWeek && gamesOf(scoreboards.get(w)).length > 0 && gamesOf(scoreboards.get(w)).every((g) => g.isFinalScore));
  const oracleWeeks = completedWeeks.slice(-2);

  const boxscores = new Map<number, Array<Fetched<FfBoxscore>>>();
  for (const w of oracleWeeks) {
    const list: Array<Fetched<FfBoxscore>> = [];
    let i = 0;
    for (const g of gamesOf(scoreboards.get(w))) {
      i++;
      const f = await c.get<FfBoxscore>("FetchLeagueBoxscore", { fantasy_game_id: g.id, scoring_period: w }, boxscoreSchema, { tmpl: { fantasy_game_id: "{gameId}", scoring_period: w } });
      list.push(f);
      await save(`FetchLeagueBoxscore?league_id={leagueId}&fantasy_game_id={game ${i}}&scoring_period=${w}`, f, { trim: true });
    }
    boxscores.set(w, list);
  }

  const rosters = await c.get<FfLeagueRosters>("FetchLeagueRosters", { season: SEASON, external_id_type: "SPORTRADAR" }, leagueRostersSchema);
  await save(`FetchLeagueRosters?league_id={leagueId}&season=${SEASON}&external_id_type=SPORTRADAR`, rosters, { trim: true, dropStats: true });

  // Box-score players no longer on a roster: look up their Sportradar ids (the box score endpoint
  // rejects external_id_type with HTTP 400).
  const onRoster = new Set((rosters.data?.rosters ?? []).flatMap((r) => (r.players ?? []).map((x) => x.proPlayer.id)));
  const missing = [...new Set([...boxscores.values()].flat().flatMap((f) => lineupPlayers(f.data).map((x) => x.lp.proPlayer.id)))].filter((id) => !onRoster.has(id));
  const extraPlayers: Array<Fetched<FfPlayerListing>> = [];
  for (let i = 0; i < missing.length && i < 150; i += 30) {
    const batch = missing.slice(i, i + 30);
    const f = await c.get<FfPlayerListing>("FetchPlayerListing", { "filter.player_id": batch, external_id_type: "SPORTRADAR" }, playerListingSchema, { tmpl: { "filter.player_id": "{playerIds}", external_id_type: "SPORTRADAR" } });
    extraPlayers.push(f);
    await save(`FetchPlayerListing?league_id={leagueId}&filter.player_id={box-score players ${i / 30 + 1}}&external_id_type=SPORTRADAR`, f, { trim: true, dropStats: true });
  }

  const data: LeagueData = {
    pick,
    role,
    c,
    standings,
    rules,
    sbNow,
    currentWeek,
    displayWeek,
    periods,
    weeks,
    scoreboards,
    completedWeeks,
    oracleWeeks,
    boxscores,
    rosters,
    teamRosters: new Map(),
    futureRoster: null,
    tx: null,
    tradesDone: [],
    tradesReachedEnd: false,
    tradesTail: null,
    tradesPending: null,
    picks: new Map(),
    draftBoard: null,
    fa: new Map(),
    faMismatch: new Map(),
    faPage2: null,
    extraPlayers,
    html: null,
    teamIds,
  };

  // Settings the API lacks: the public HTML rules page (never printed or saved sanitized). Cached
  // with the league data (10 min), 4xx answers included.
  try {
    const url = webUrl(pick.id, "rules");
    const res = await p.request(url, { label: `${role} league rules page (HTML)`, cache: p.leagueCache(url), cacheIf: cacheableStatus });
    await p.saveRaw(`${role}:rules-page`, res.text, res, ".html");
    data.html = { res, rules: res.ok && res.isHtml ? parseRulesPage(res.text) : null, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    data.html = { res: null, rules: null, error: err instanceof Error ? err.message : String(err) };
  }
  if (!full) return data;

  for (const t of teamIds) {
    const ph = ids.teamPlaceholderId(t) ?? 0;
    const f = await c.get<FfRoster>("FetchRoster", { team_id: t, season: SEASON, scoring_period: currentWeek }, rosterSchema, { tmpl: { team_id: "{teamId}", season: SEASON, scoring_period: currentWeek } });
    data.teamRosters.set(t, f);
    await save(`FetchRoster?league_id={leagueId}&team_id=${ph}&season=${SEASON}&scoring_period=${currentWeek}`, f, { trim: true, dropStats: true });
  }
  const firstTeam = teamIds[0];
  if (firstTeam !== undefined) {
    const ph = ids.teamPlaceholderId(firstTeam) ?? 0;
    data.futureRoster = await c.get<FfRoster>("FetchRoster", { team_id: firstTeam, season: SEASON, scoring_period: currentWeek + 1 }, rosterSchema, { tmpl: { team_id: "{teamId}", season: SEASON, scoring_period: currentWeek + 1 } });
    await save(`FetchRoster?league_id={leagueId}&team_id=${ph}&season=${SEASON}&scoring_period=${currentWeek + 1}`, data.futureRoster, { trim: true, dropStats: true });
  }

  // Transactions: newest first, 30 per page; page back to the start of week 1.
  const week1Start = int64(periods[0]?.low?.startEpochMilli);
  const startOf = periods.map((x) => ({ week: weekOf(x), start: int64(x.low?.startEpochMilli) })).filter((x) => x.start > 0);
  const weekAt = (t: number) => startOf.filter((x) => x.start <= t).reduce((w, x) => Math.max(w, x.week), 0);
  const tx = { pages: [] as Array<Fetched<FfTransactions>>, items: [] as TxItem[], reachedStart: false };
  let offset = 0;
  for (let page = 0; page < MAX_TX_PAGES; page++) {
    const f = await c.get<FfTransactions>("FetchLeagueTransactions", offset ? { result_offset: offset } : {}, transactionsSchema, { tmpl: { result_offset: offset } });
    tx.pages.push(f);
    if (page < TX_FIXTURE_PAGES) await save(`FetchLeagueTransactions?league_id={leagueId}&result_offset=${offset}`, f, { trim: true, dropStats: true });
    const items = f.data?.items ?? [];
    for (const it of items) {
      const time = int64(it.timeEpochMilli);
      const t = it.transaction;
      if (!t) continue;
      tx.items.push({ time, week: weekAt(time), type: enumOr(t.type, "TransactionType"), typeOmitted: t.type === undefined, teamId: t.team?.id, playerId: t.player?.proPlayer.id, tradeId: t.tradeId, bid: t.bidAmount });
    }
    const oldest = Math.min(...items.map((it) => int64(it.timeEpochMilli)).filter((x) => x > 0));
    if (week1Start && oldest < week1Start) {
      tx.reachedStart = true;
      break;
    }
    if (!items.length || f.data?.resultOffsetNext === undefined) {
      tx.reachedStart = true; // nothing older exists
      break;
    }
    offset = f.data.resultOffsetNext;
  }
  data.tx = tx;

  // Trades: completed (newest first, 10 per page, all seasons) and pending review. Paged until the
  // trades are older than this season (only page 1 becomes a fixture). Then ONE request just below
  // the claimed resultTotal tells whether that total is real, without paging through everything.
  let tOffset = 0;
  for (let page = 0; page < MAX_TRADE_PAGES; page++) {
    const f = await c.get<FfTrades>("FetchTrades", tOffset ? { filter: "TRADES_COMPLETED", result_offset: tOffset } : { filter: "TRADES_COMPLETED" }, tradesSchema, { tmpl: { filter: "TRADES_COMPLETED", result_offset: tOffset } });
    data.tradesDone.push(f);
    if (page === 0) await save(`FetchTrades?league_id={leagueId}&filter=TRADES_COMPLETED&result_offset=${tOffset}`, f, { trim: true, dropStats: true });
    const trades = f.data?.trades ?? [];
    if (!trades.length || f.data?.resultOffsetNext === undefined) {
      data.tradesReachedEnd = Boolean(f.data);
      break;
    }
    if (Math.min(...trades.map((t) => int64(t.approvedOn ?? t.proposedOn))) < Date.UTC(SEASON, 0, 1)) break;
    tOffset = f.data.resultOffsetNext;
  }
  const lastTrades = data.tradesDone.at(-1)?.data;
  const claimed = data.tradesDone[0]?.data?.resultTotal;
  if (!data.tradesReachedEnd && claimed && lastTrades?.resultOffsetNext !== undefined && claimed > lastTrades.resultOffsetNext) {
    const offset = claimed - 1;
    const f = await c.get<FfTrades>("FetchTrades", { filter: "TRADES_COMPLETED", result_offset: offset }, tradesSchema, { tmpl: { filter: "TRADES_COMPLETED", result_offset: offset } });
    const firstIds = new Set((data.tradesDone[0]?.data?.trades ?? []).map((t) => t.id));
    const tail = f.data?.trades ?? [];
    data.tradesTail = { offset, fetched: f, trades: tail.length, repeatsFirstPage: tail.length > 0 && tail.every((t) => firstIds.has(t.id)) };
  }
  data.tradesPending = await c.get<FfTrades>("FetchTrades", { filter: "TRADES_UNDER_REVIEW" }, tradesSchema);
  await save("FetchTrades?league_id={leagueId}&filter=TRADES_UNDER_REVIEW", data.tradesPending, { trim: true, dropStats: true });

  for (const t of teamIds) {
    const ph = ids.teamPlaceholderId(t) ?? 0;
    const f = await c.get<{ picks?: FfDraftPick[] }>("FetchTeamPicks", { team_id: t }, teamPicksSchema, { tmpl: { team_id: "{teamId}" } });
    data.picks.set(t, f);
    await save(`FetchTeamPicks?league_id={leagueId}&team_id=${ph}`, f, { trim: true, dropStats: true });
  }
  data.draftBoard = await c.get<FfDraftBoard>("FetchLeagueDraftBoard", { season: SEASON }, draftBoardSchema);
  await save(`FetchLeagueDraftBoard?league_id={leagueId}&season=${SEASON}`, data.draftBoard, { trim: true, dropStats: true });

  // Free agents: one page per roster position, sorted by this week's projection.
  const faPositions = [...new Set((rules.data?.rosterPositions ?? []).filter((x) => (x.eligibility ?? []).length === 1 && (num(x.start) > 0 || num(x.max) > 0)).map((x) => x.label ?? ""))].filter(Boolean);
  for (const pos of faPositions.slice(0, 14)) {
    const f = await c.get<FfPlayerListing>("FetchPlayerListing", { "filter.free_agent_only": true, sort: "SORT_PROJECTIONS", "filter.position_eligibility": pos }, playerListingSchema);
    data.fa.set(pos, f);
    // The filter can be ignored (seen for D/ST in a league that can't start one): check every player.
    const off: Record<string, number> = {};
    for (const x of f.data?.players ?? []) if (!positionMatches(x.proPlayer, pos)) off[x.proPlayer.position ?? "?"] = (off[x.proPlayer.position ?? "?"] ?? 0) + 1;
    if (Object.keys(off).length) data.faMismatch.set(pos, off);
    const suffix = Object.keys(off).length ? " (position filter ignored: mixed positions)" : "";
    if (FA_FIXTURE_POSITIONS.has(pos)) await save(`FetchPlayerListing?league_id={leagueId}&filter.free_agent_only=true&sort=SORT_PROJECTIONS&filter.position_eligibility=${pos}${suffix}`, f, { trim: true, dropStats: true });
  }
  const rbFirst = data.fa.get("RB");
  if (rbFirst?.data?.resultOffsetNext) {
    data.faPage2 = await c.get<FfPlayerListing>("FetchPlayerListing", { "filter.free_agent_only": true, sort: "SORT_PROJECTIONS", "filter.position_eligibility": "RB", result_offset: rbFirst.data.resultOffsetNext }, playerListingSchema);
    await save(`FetchPlayerListing?league_id={leagueId}&filter.free_agent_only=true&sort=SORT_PROJECTIONS&filter.position_eligibility=RB&result_offset=${rbFirst.data.resultOffsetNext}`, data.faPage2, { trim: true, dropStats: true });
  }
  return data;
}

// ------------------------------------------------------------------------------------------------
// Checks

interface Docs {
  res: HttpResult;
  facts: DocsFacts;
}

/** The public API docs page (cached 7 days, like other probes' docs), parsed for checkable facts. */
async function loadDocs(p: ProbeContext): Promise<Docs | null> {
  try {
    const res = await p.request(DOCS_URL, { cache: { key: `fleaflicker-docs:${DOCS_URL}`, ttlMs: TTL.docs, namespace: "docs" }, cacheIf: (r) => r.status === 200, label: "Fleaflicker API docs" });
    return res.ok ? { res, facts: parseDocs(res.text) } : null;
  } catch {
    return null;
  }
}


/** What this run shows about FetchTrades.resultTotal and FetchLeagueTransactions' totals. */
function resultTotalText(L: LeagueData, docs: Docs | null): string {
  const trades = L.tradesDone.flatMap((f) => f.data?.trades ?? []);
  const claimed = L.tradesDone[0]?.data?.resultTotal;
  const tail = L.tradesTail;
  const txPages = L.tx?.pages ?? [];
  const verdict = L.tradesReachedEnd
    ? `paging to the end found ${trades.length} trades, so resultTotal ${claimed === trades.length ? "IS" : "is NOT"} the trade count`
    : tail
      ? tail.repeatsFirstPage
        ? `result_offset=${tail.offset} returned page 1 again (offset ignored), so the claim is not verified`
        : tail.trades
          ? `result_offset=${tail.offset} still returns ${tail.trades} trade(s), so resultTotal can be the real count`
          : `result_offset=${tail.offset} (just below it) returns no trades, so the list ends earlier and resultTotal is NOT the trade count`
      : `not verified in this run (${trades.length} trades read)`;
  const txWith = txPages.filter((f) => f.data?.resultTotal !== undefined).length;
  const documented = docs?.facts.schemas.FetchLeagueTransactionsResponse?.properties.includes("result_total");
  return `FetchTrades(TRADES_COMPLETED): resultTotal = ${claimed ?? "(omitted)"}; ${verdict}. FetchLeagueTransactions: resultTotal on ${txWith}/${txPages.length} pages${txWith === 0 && documented ? " although the docs list result_total, so it reads as 0 (proto3) and can't be used" : ""}`;
}

function checkApiConventions(p: ProbeContext, L: LeagueData, verifiedAdds: { checked: number; onTeam: number }, docs: Docs | null): void {
  const st = L.standings;
  const lg = st.data?.league as Record<string, unknown> | undefined;
  const camel = lg ? Object.keys(lg).filter((k) => /[A-Z]/.test(k)) : [];
  const snake = lg ? Object.keys(lg).filter((k) => k.includes("_")) : [];
  const docProps = docs?.facts.properties;
  const docSnakeOnly = docProps ? camel.filter((k) => docProps.has(snakeOf(k)) && !docProps.has(k)) : [];
  p.cl.add(
    "API",
    "API.keyCase",
    "JSON key style",
    docs ? "ok" : "warn",
    `live keys are camelCase: ${camel.length} camelCase, ${snake.length} snake_case keys on league. ${docs ? `The API docs name ${docSnakeOnly.length}/${camel.length} of those keys only in snake_case (${docSnakeOnly.slice(0, 5).map(snakeOf).join(", ")}…) — code against the live camelCase names` : "API docs page not read this run, so the docs' naming is not verified"}`,
    ev(st.url, st.res, "league.<keys>", camel.slice(0, 6)),
    ...(docs ? [ev(DOCS_URL, docs.res, "data-property-name", { snakeOnlyInDocs: docSnakeOnly.map(snakeOf).slice(0, 8) })] : []),
  );
  if (docs) {
    const used = ["FetchLeagueStandings", "FetchLeagueRules", "FetchLeagueScoreboard", "FetchLeagueBoxscore", "FetchLeagueRosters", "FetchRoster", "FetchLeagueTransactions", "FetchTrades", "FetchTeamPicks", "FetchLeagueDraftBoard", "FetchPlayerListing"];
    const undocumented = used.filter((u) => !docs.facts.paths.includes(u));
    const breakdownPath = docs.facts.paths.includes("FetchScoringBreakdown");
    const breakdownDef = docs.facts.definitions.some((d) => d.startsWith("FetchScoringBreakdown"));
    p.cl.add(
      "API",
      "API.docs",
      "Documented endpoints",
      undocumented.length ? "warn" : "ok",
      `the docs list ${docs.facts.paths.length} paths; ${used.length - undocumented.length}/${used.length} endpoints this probe calls are documented${undocumented.length ? ` (not listed: ${undocumented.join(", ")})` : ""}. FetchScoringBreakdown: ${breakdownDef ? "a response schema exists" : "no schema"}, ${breakdownPath ? "and a documented path" : "but no documented path (not called)"}`,
      ev(DOCS_URL, docs.res, "href=#path--… / #definition-ws.flea.api.…", { paths: docs.facts.paths.length, scoringBreakdown: { path: breakdownPath, definition: breakdownDef } }),
    );
  }

  const bn = (L.rules.data?.rosterPositions ?? []).find((x) => x.label === "BN");
  const benchGroupOmitted = [...L.teamRosters.values()].some((f) => (f.data?.groups ?? []).some((g) => g.group === undefined && (g.slots ?? []).some((s) => s.position?.label === "BN")));
  // A default that must NOT be trusted: hasPlayoffs is omitted (= false) although the league has playoffs.
  const htmlPlayoffTeams = L.html?.rules?.playoffs?.teams ?? 0;
  const hasPlayoffsTrap = lg !== undefined && lg.hasPlayoffs === undefined && htmlPlayoffTeams > 0;
  const status = verifiedAdds.checked > 0 && verifiedAdds.onTeam / verifiedAdds.checked >= 0.8 && bn && bn.group === undefined && !hasPlayoffsTrap ? "ok" : "warn";
  const defaults = Object.entries(ENUM_DEFAULTS);
  const docDefaults = docs ? defaults.filter(([, v]) => docs.facts.enumDefaults.has(v)) : [];
  p.cl.add(
    "API",
    "API.protoDefaults",
    "Omitted proto3 defaults",
    status,
    `missing numbers = 0, booleans = false, enums = first value; e.g. BN slot has no group (= BENCH), adds have no transaction type (= TRANSACTION_ADD: ${verifiedAdds.onTeam}/${verifiedAdds.checked} of those players are on that team now). ${docs ? `The docs mark ${docDefaults.length}/${defaults.length} of the enum defaults this probe assumes as default values (${defaults.filter(([, v]) => !docs.facts.enumDefaults.has(v)).map(([k, v]) => `${k}=${v} not marked`).join(", ") || "all"})` : "Docs not read: enum defaults not cross-checked"}${hasPlayoffsTrap ? `. Caveat: league.hasPlayoffs is omitted (= false under proto3) although the rules page shows ${htmlPlayoffTeams}-team playoffs, so this field must not be trusted` : ""}`,
    ev(L.rules.url, L.rules.res, "rosterPositions[label=BN].group", bn?.group ?? "(omitted)"),
    ev(L.teamRosters.values().next().value?.url, null, "groups[].group", benchGroupOmitted ? "(omitted) for the BN group" : "present"),
    ev(L.tx?.pages[0]?.url, L.tx?.pages[0]?.res, "items[].transaction.type", "(omitted) on adds; TRANSACTION_DROP on drops"),
    ev(st.url, st.res, "league.hasPlayoffs", lg?.hasPlayoffs ?? "(omitted)", `rules page: ${htmlPlayoffTeams ? `${htmlPlayoffTeams}-team playoffs` : "no playoff line"}`),
  );

  p.cl.warn(
    "API",
    "API.resultTotal",
    "Pagination totals",
    `${resultTotalText(L, docs)}. Adapter: page with resultOffsetNext until it is missing or items get older than needed`,
    ev(L.tradesDone[0]?.url, L.tradesDone[0]?.res, "resultTotal / resultOffsetNext / trades[]", { resultTotal: L.tradesDone[0]?.data?.resultTotal ?? "(omitted)", pages: L.tradesDone.length, trades: L.tradesDone.flatMap((f) => f.data?.trades ?? []).length, reachedEnd: L.tradesReachedEnd }),
    ...(L.tradesTail ? [ev(L.tradesTail.fetched.url, L.tradesTail.fetched.res, "trades[] at result_offset = resultTotal − 1", { trades: L.tradesTail.trades, repeatsFirstPage: L.tradesTail.repeatsFirstPage, resultOffsetNext: L.tradesTail.fetched.data?.resultOffsetNext ?? "(omitted)" })] : []),
    ev(L.tx?.pages[0]?.url, L.tx?.pages[0]?.res, "resultTotal", L.tx?.pages[0]?.data?.resultTotal ?? "(omitted)"),
  );

  const fetched: Array<Fetched<unknown> | null> = [L.standings, L.rules, L.sbNow, L.rosters, ...L.teamRosters.values(), ...[...L.boxscores.values()].flat(), ...(L.tx?.pages ?? []), ...L.tradesDone, ...L.picks.values(), ...L.fa.values(), L.draftBoard];
  const shapeProblems = fetched.flatMap((f) => (f ? f.issues.map((i) => `${f.url.replace(/^https:\/\/www\.fleaflicker\.com\/api\//, "")} → ${i}`) : []));
  if (shapeProblems.length) p.cl.warn("API", "API.shape", "Response shapes", `${shapeProblems.length} field(s) differ from the expected shape`, ev(undefined, null, undefined, shapeProblems.slice(0, 6)));
  else p.cl.ok("API", "API.shape", "Response shapes", "every response matched the expected (loose) schema", ev(undefined, null, undefined, "zod schemas in scripts/lib/fleaflicker/api.ts"));
}

function checkA(p: ProbeContext, L: LeagueData, mappings: { leagueType: string; review: string }, O: LeagueData | null): void {
  const st = L.standings;
  const lg = st.data?.league;
  const html = L.html?.rules ?? null;
  const ohtml = O?.html?.rules ?? null;
  const htmlUrl = webUrl("{leagueId}", "rules") + " (public HTML)";
  if (!st.data || !lg) {
    p.cl.fail("A", "A.standings", "League settings", `FetchLeagueStandings failed: ${st.error ?? "no data"}`, ev(st.url, st.res));
    return;
  }
  const active = lg.activeForCurrentSeason === true;
  p.cl.add("A", "A.season", "Season", active && st.data.season === SEASON ? "ok" : "fail", `season ${st.data.season}, activeForCurrentSeason=${active}, draftStatus=${enumOr(lg.draftStatus, "DraftStatus")}`, ev(st.url, st.res, "season / league.activeForCurrentSeason / league.draftStatus", { season: st.data.season, activeForCurrentSeason: lg.activeForCurrentSeason ?? "(omitted = false)", draftStatus: lg.draftStatus ?? "(omitted = NOT_YET_DRAFTED)" }));

  const sbNow = L.sbNow;
  const nowStart = int64(L.periods.find((x) => weekOf(x) === L.currentWeek)?.low?.startEpochMilli);
  const lag = L.displayWeek !== L.currentWeek;
  p.cl.add(
    "A",
    "A.currentWeek",
    "Current week",
    L.currentWeek > 0 ? "ok" : "fail",
    `week ${L.currentWeek} = the schedule period with containsNow (started ${nowStart ? new Date(nowStart).toISOString().slice(0, 16) + "Z" : "?"}); the default scoreboard ${lag ? `still displays week ${L.displayWeek} (schedulePeriod), like Sleeper's display_week — use containsNow` : `displays the same week (schedulePeriod.ordinal ${L.displayWeek}) in this run; containsNow is the field that marks "now"`}`,
    ev(sbNow.url, sbNow.res, "eligibleSchedulePeriods[].containsNow / .low.startEpochMilli; schedulePeriod.ordinal", { currentWeek: L.currentWeek, displayWeek: L.displayWeek }),
  );

  const teams = teamsOf(st.data);
  p.cl.add("A", "A.numTeams", "Number of teams", teams.length === num(lg.size) && teams.length > 0 ? "ok" : "warn", `${teams.length} teams (league.size ${num(lg.size)}, capacity ${num(lg.capacity)})`, ev(st.url, st.res, "divisions[].teams[] / league.size", teams.length));

  const withGames = L.weeks.filter((w) => gamesOf(L.scoreboards.get(w)).length > 0);
  const playoffFlagged = L.weeks.filter((w) => gamesOf(L.scoreboards.get(w)).some((g) => g.isPlayoffs));
  const noGames = L.weeks.filter((w) => !gamesOf(L.scoreboards.get(w)).length);
  const regEnd = withGames.filter((w) => !playoffFlagged.includes(w)).reduce((a, b) => Math.max(a, b), 0);
  const htmlAgrees = html?.playoffs ? html.playoffs.firstWeek === regEnd + 1 : null;
  p.cl.warn(
    "A",
    "A.regularSeasonWeeks",
    "Regular-season weeks",
    `weeks 1–${regEnd} (inferred: those weeks have scheduled games; weeks ${noGames.join(", ") || "none"} have none yet, so no isPlayoffs flag can be seen). ${htmlAgrees === null ? "HTML page not parsed" : htmlAgrees ? "HTML rules page agrees" : "HTML rules page DISAGREES"}`,
    ev(apiUrl("FetchLeagueScoreboard", { league_id: "{leagueId}", season: SEASON, scoring_period: "{week}" }), L.scoreboards.get(regEnd)?.res, "games[] per week; games[].isPlayoffs", { weeksWithGames: withGames.length, eligibleSchedulePeriods: L.weeks.length, weeksWithoutGames: noGames }),
  );

  if (html?.playoffs) {
    const pl = html.playoffs;
    const trap = lg.hasPlayoffs === undefined;
    p.cl.warn(
      "A",
      "A.playoffs",
      "Playoff start, teams, byes",
      `HTML only: ${pl.teams} teams, weeks ${pl.firstWeek}–${pl.lastWeek}, ${pl.byes} byes, ${pl.reseed === null ? "re-seeding not stated" : pl.reseed ? "re-seed each round" : "no re-seeding"}. The JSON API has no playoff settings${trap ? `; League.hasPlayoffs is omitted, which reads as false under proto3 although this league has ${pl.teams}-team playoffs, so it must not be trusted` : `; League.hasPlayoffs = ${String(lg.hasPlayoffs)}`}`,
      ev(htmlUrl, L.html?.res, "Calendar → Playoffs", html.playoffText),
      ev(st.url, st.res, "league.hasPlayoffs", lg.hasPlayoffs ?? "(omitted = false)"),
    );
  } else {
    p.cl.fail("A", "A.playoffs", "Playoff start, teams, byes", `not in the JSON API; HTML rules page ${L.html?.error ?? "had no Playoffs line"}`, ev(htmlUrl, L.html?.res, "Calendar → Playoffs"));
  }

  // Deadline and review wording: this league's page, and the second test league's page as a second sample.
  const deadlinePassed = L.tradesDone[0]?.data?.deadlinePassed;
  const second = O ? `second test league's page: ${ohtml ? (ohtml.tradingDeadline ? `Trading Deadline "${ohtml.tradingDeadline}"${parseEasternTime(ohtml.tradingDeadline) ? ` (= ${new Date(parseEasternTime(ohtml.tradingDeadline) as number).toISOString().slice(0, 16)}Z)` : ""}` : "no Trading Deadline line either") : `not read (${O.html?.error ?? "no page"})`}` : "no second league read";
  p.cl.warn(
    "A",
    "A.tradeDeadline",
    "Trade deadline",
    `no deadline field in the JSON API (only FetchTrades.deadlinePassed = ${deadlinePassed ?? "(omitted = false)"}). HTML Calendar: ${html?.tradingDeadline ? `"Trading Deadline" ${html.tradingDeadline}` : "no \"Trading Deadline\" line for this league"}; ${second}. ${html?.tradingDeadline || ohtml?.tradingDeadline ? "" : "Parsing a real deadline value is not verified in this run (only synthetic markup in the unit tests)."}`.trim(),
    ev(L.tradesDone[0]?.url, L.tradesDone[0]?.res, "deadlinePassed", deadlinePassed ?? "(omitted)"),
    ev(htmlUrl, L.html?.res, "Calendar → Trading Deadline", html?.tradingDeadline ?? "(not shown)"),
    ...(O ? [ev(htmlUrl, O.html?.res, "Calendar → Trading Deadline (second league)", ohtml?.tradingDeadline ?? "(not shown)")] : []),
  );

  const vetoesRequired = Math.max(0, ...L.tradesDone.flatMap((f) => (f.data?.trades ?? []).map((t) => num(t.numVetoesRequired))));
  p.cl.warn(
    "A",
    "A.tradeReview",
    "Trade review / veto",
    `→ '${mappings.review}' (inferred). API: completed trades carry numVetoesRequired = ${vetoesRequired}; HTML: Trade Review Period = "${html?.tradeReviewPeriod ?? "?"}"${O ? `; second test league's page: "${ohtml?.tradeReviewPeriod ?? "(not found)"}"` : ""}`,
    ev(L.tradesDone[0]?.url, L.tradesDone[0]?.res, "trades[].numVetoesRequired", vetoesRequired),
    ev(htmlUrl, L.html?.res, "Transaction Rules → Trade Review Period", html?.tradeReviewPeriod ?? "(not found)"),
    ...(O ? [ev(htmlUrl, O.html?.res, "Transaction Rules → Trade Review Period (second league)", ohtml?.tradeReviewPeriod ?? "(not found)")] : []),
  );

  // The Lifetime line also carries the year the league was founded: only the keeper count is shown.
  p.cl.warn(
    "A",
    "A.leagueType",
    "League type",
    `→ '${mappings.leagueType}' (inferred from maxKeepers ${num(lg.maxKeepers)} vs active roster ${num(lg.rosterRequirements?.rosterSize)}: 0 = redraft, ≥ roster = dynasty, else keeper). HTML Lifetime line: ${html?.keepers !== undefined ? `${html.keepers} keepers` : "no keeper count"}`,
    ev(st.url, st.res, "league.maxKeepers / league.rosterRequirements.rosterSize", { maxKeepers: lg.maxKeepers ?? "(omitted = 0)", rosterSize: lg.rosterRequirements?.rosterSize }),
    ev(htmlUrl, L.html?.res, "Miscellaneous → Lifetime (keeper count only)", html?.keepers ?? "(not found)"),
  );

  // Tiebreakers and seeding (CLAUDE.md §8: use them when the platform reports them): HTML only.
  if (html?.gameTiebreakers || html?.rankTiebreakers) {
    p.cl.warn(
      "A",
      "A.tiebreakers",
      "Tiebreakers",
      `HTML only (no JSON field): tied games ${html.gameTiesBroken === undefined ? "(not stated)" : html.gameTiesBroken ? "are broken" : "stay ties"}, by ${(html.gameTiebreakers ?? []).join(" → ") || "(none listed)"}; standings/playoff rank ties by ${(html.rankTiebreakers ?? []).join(" → ") || "(none listed)"}`,
      ev(htmlUrl, L.html?.res, "Tiebreakers → Individual Game Tiebreakers / Break Regular Season Ties / Power & Playoff Rank Tiebreakers", { game: html.gameTiebreakers, gameTiesBroken: html.gameTiesBroken, rank: html.rankTiebreakers }),
    );
  } else {
    p.cl.fail("A", "A.tiebreakers", "Tiebreakers", `not in the JSON API; HTML rules page ${L.html?.error ?? "had no Tiebreakers section"}`, ev(htmlUrl, L.html?.res, "Tiebreakers"));
  }
  p.cl.add(
    "A",
    "A.seeding",
    "Playoff seeding",
    html?.divisionWinnersRankedHigher === undefined ? "fail" : "warn",
    html?.divisionWinnersRankedHigher === undefined
      ? `not in the JSON API; HTML rules page ${L.html?.error ?? "has no \"Rank division winners higher\" line"}`
      : `HTML only: rank division winners higher = ${html.divisionWinnersRankedHigher ? "Yes" : "No"}${html.playoffs ? `; ${html.playoffs.byes} byes, ${html.playoffs.reseed ? "re-seeded each round" : "not re-seeded"}` : ""}; the model's seeding (wins, then points-for) needs these`,
    ev(htmlUrl, L.html?.res, "Tiebreakers → Rank division winners higher", html?.divisionWinnersRankedHigher ?? "(not found)"),
  );

  const completed = L.completedWeeks.length;
  const perTeamGames = teams.map((t) => num(t.recordOverall?.wins) + num(t.recordOverall?.losses) + num(t.recordOverall?.ties));
  const onePerWeek = L.completedWeeks.every((w) => gamesOf(L.scoreboards.get(w)).length * 2 === teams.length);
  const noMedian = perTeamGames.every((g) => g === completed) && onePerWeek;
  p.cl.warn("A", "A.medianGame", "Median game", `no API field. Inferred ${noMedian ? "OFF" : "possibly ON"}: every team has ${[...new Set(perTeamGames)].join("/")} decisions after ${completed} completed weeks and plays one game per week`, ev(st.url, st.res, "divisions[].teams[].recordOverall", { decisionsPerTeam: [...new Set(perTeamGames)], completedWeeks: completed }));

  const type = enumOr(lg.type, "LeagueType");
  p.cl.add("A", "A.pointsOnly", "Points-only vs head-to-head", html?.type || lg.type ? "ok" : "warn", `league.type = ${type}${lg.type ? "" : " (omitted = FP_H2H, the enum default)"}; HTML Type = "${html?.type ?? "?"}". FP_TOTAL would mean points-only`, ev(st.url, st.res, "league.type", lg.type ?? "(omitted)"), ev(htmlUrl, L.html?.res, "Miscellaneous → Type", html?.type ?? "(not found)"));

  const divs = st.data.divisions ?? [];
  const divisional = gamesOf(L.scoreboards.get(L.completedWeeks[0] ?? 1)).filter((g) => g.isDivisional).length;
  p.cl.ok("A", "A.divisions", "Divisions", `${divs.length} division(s): ${divs.map((d) => (d.teams ?? []).length).join("+")} teams; games carry isDivisional (${divisional} in week ${L.completedWeeks[0] ?? 1})`, ev(st.url, st.res, "divisions[].id / divisions[].name / divisions[].teams[]", divs.map((d, i) => ({ id: `division ${i + 1}`, teams: (d.teams ?? []).length }))));

  const waiver = enumOr(lg.waiverType, "WaiverResolutionType");
  const budgets = teams.map((t) => fd(t.waiverAcquisitionBudget)).filter((x) => x > 0);
  p.cl.ok("A", "A.faab", "Waivers / FAAB", `waiverType = ${waiver}${lg.waiverType ? "" : " (omitted = PRIORITY)"}; defaultWaiverBudget = ${num(lg.defaultWaiverBudget)}; teams with a remaining FAAB balance: ${budgets.length}. HTML: "${html?.claimsResolved ?? "?"}"`, ev(st.url, st.res, "league.waiverType / league.defaultWaiverBudget / teams[].waiverAcquisitionBudget", { waiverType: lg.waiverType ?? "(omitted)", defaultWaiverBudget: lg.defaultWaiverBudget ?? "(omitted)" }));
}

function checkB(p: ProbeContext, L: LeagueData): void {
  const r = L.rules;
  if (!r.data) {
    p.cl.fail("B", "B.rules", "Roster rules", `FetchLeagueRules failed: ${r.error ?? "no data"}`, ev(r.url, r.res));
    return;
  }
  const s = summarizeLineup(r.data.rosterPositions);
  const starters = s.lineup.reduce((n, x) => n + x.count, 0);
  p.cl.add("B", "B.startingSlots", "Starting slots", starters === num(r.data.numStarters) ? "ok" : "warn", `${starters} starters (numStarters ${num(r.data.numStarters)}): ${s.lineup.map((x) => `${x.slot}×${x.count}`).join(", ")}`, ev(r.url, r.res, "rosterPositions[group=START].label/.eligibility/.start", s.lineup.map((x) => ({ slot: x.slot, count: x.count, eligible: x.eligible }))));
  const flex = s.lineup.map((x) => ({ slot: x.slot, kind: flexKind(x) })).filter((x) => x.kind);
  p.cl.ok("B", "B.flex", "Flex / superflex slots", flex.length ? flex.map((x) => `${x.slot} → ${x.kind}`).join(", ") : "none", ev(r.url, r.res, "rosterPositions[].eligibility (2+ labels)", flex));
  const kSlots = s.lineup.filter((x) => x.eligible.includes("K"));
  const dstSlots = s.lineup.filter((x) => x.eligible.includes("DEF"));
  p.cl.ok("B", "B.kickerDst", "K and D/ST", `K slots: ${kSlots.map((x) => `${x.slot}×${x.count}`).join(", ") || "none"}; D/ST slots: ${dstSlots.map((x) => `${x.slot}×${x.count}`).join(", ") || "none"}; roster-only (start omitted = 0): ${s.rosterOnly.join(", ") || "none"}`, ev(r.url, r.res, "rosterPositions[label=K|D/ST].start", { rosterOnly: s.rosterOnly }));
  const idp = s.lineup.filter((x) => x.eligible.some((e) => e === "DL" || e === "LB" || e === "DB"));
  p.cl.add("B", "B.idp", "IDP slots", idp.length ? "warn" : "ok", idp.length ? `${idp.map((x) => `${x.slot}×${x.count}`).join(", ")}. Mapping decision: CB/S → DB, EDR (EDR/DE, EDR/LB) and IL (IL/DT, DE/IL) → DL, LB → LB` : "no IDP starters", ev(r.url, r.res, "rosterPositions[].eligibility", idp.map((x) => ({ slot: x.slot, eligible: x.eligible }))));
  p.cl.add("B", "B.unmappedSlots", "Slots the model can't express", s.unmappedEligibility.length ? "warn" : "ok", s.unmappedEligibility.length ? `${s.unmappedEligibility.map((x) => `${x.slot} (${x.labels.join("/")})`).join(", ")}: the model has no punter position` : "none", ev(r.url, r.res, "rosterPositions[].eligibility", s.unmappedEligibility));
  const bn = r.data.rosterPositions.find((x) => enumOr(x.group, "RosterPositionGroup") === "BENCH");
  p.cl.ok("B", "B.bench", "Bench", `${s.benchSlots} bench slots (numBench ${num(r.data.numBench)})`, ev(r.url, r.res, "rosterPositions[label=BN].max (group omitted = BENCH)", bn));
  p.cl.ok("B", "B.ir", "IR", `${s.irSlots} IR slots`, ev(r.url, r.res, "rosterPositions[group=INJURED].start", s.irSlots));
  p.cl.ok("B", "B.taxi", "Taxi squad", `${s.taxiSlots} taxi slots`, ev(r.url, r.res, "rosterPositions[group=TAXI].start", s.taxiSlots));
  const enforce = L.html?.rules?.enforceRosterMinimums;
  const merged = s.mergedLimits.map((m) => `${m.pos} ${s.positionLimits[m.pos]} = ${m.labels.map((l) => `${l} ${s.labelLimits[l]}`).join(" + ")}`);
  p.cl.add(
    "B",
    "B.positionLimits",
    "Position limits",
    merged.length || (enforce && Object.keys(s.positionMinimums).length) ? "warn" : "ok",
    `league maxima per label: ${Object.entries(s.labelLimits).map(([k, v]) => `${k} ${v}`).join(", ")}. Summed into model positions: ${Object.entries(s.positionLimits).map(([k, v]) => `${k} ${v}`).join(", ")}${merged.length ? ` (lossy: ${merged.join("; ")}, so e.g. ${s.mergedLimits[0]?.labels[0]} alone could exceed its own limit)` : ""}. Roster minimums: ${Object.entries(s.positionMinimums).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}; enforced: ${enforce === undefined ? "not stated" : enforce ? "Yes (HTML \"Enforce Roster Minimums\")" : "No"}. LeagueSettings has no minimums field (matters for trade legality, CLAUDE.md §7)`,
    ev(r.url, r.res, "rosterPositions[].max / .min", { maxByLabel: s.labelLimits, min: s.positionMinimums }),
    ev(webUrl("{leagueId}", "rules") + " (public HTML)", L.html?.res, "Transaction Rules → Enforce Roster Minimums", enforce ?? "(not found)"),
  );
  const rr = L.standings.data?.league.rosterRequirements;
  p.cl.ok("B", "B.maxRoster", "Max roster size", `active roster ${num(r.data.maxActive)} (starters + bench, excl. IR/taxi); total incl. IR/taxi ${num(r.data.maxRosterSize)}`, ev(r.url, r.res, "maxActive / maxRosterSize", { maxActive: r.data.maxActive, maxRosterSize: r.data.maxRosterSize }), ev(L.standings.url, L.standings.res, "league.rosterRequirements.rosterSize/starterCount/benchCount/reserveCount", rr ? { rosterSize: rr.rosterSize, starterCount: rr.starterCount, benchCount: rr.benchCount, reserveCount: rr.reserveCount } : undefined));
}

interface FirstDownEvidence {
  weeks: number[];
  /** Sleeper rows (all players) with a receiving TD, and those whose rec_fd is below rec_td. */
  tdRows: number;
  fdBelowTd: number;
  /** Player rows with each special-teams key, and how many also carry the idp_* twin: [rows, withIdp]. */
  st: { ff: [number, number]; fumRec: [number, number]; tklSolo: [number, number] };
}

function stEvidenceText(e: FirstDownEvidence): string {
  const { ff, fumRec, tklSolo } = e.st;
  const ffText = ff[0] && ff[1] === ff[0] ? " (always together: idp_ff includes it)" : "";
  const recText = fumRec[0] && fumRec[1] === 0 ? " (never together: separate counts)" : "";
  return `Sleeper player rows, weeks ${e.weeks.join(", ")}: st_ff on ${ff[0]}, ${ff[1]} of them also with idp_ff${ffText}; st_fum_rec on ${fumRec[0]}, ${fumRec[1]} of them with idp_fum_rec${recText}; st_tkl_solo on ${tklSolo[0]}, ${tklSolo[0] - tklSolo[1]} of them without any idp_tkl_solo`;
}

function effectText(e: AdjustmentEffect | undefined): string {
  if (!e) return "no oracle evidence";
  return `oracle rows fixed ${e.fixed}, broken ${e.broken} (${e.changed} changed)${e.detail ? `; ${e.detail}` : ""}`;
}

function checkC(p: ProbeContext, L: LeagueData, conv: { scoring: ConvertedScoring; mappings: RuleMapping[] }, observedKeys: Set<string>, coverage: CoverageResult, analysis: OracleAnalysis | null, fdEvidence: FirstDownEvidence): void {
  const r = L.rules;
  if (!r.data) {
    p.cl.fail("C", "C.rules", "Scoring rules", `FetchLeagueRules failed: ${r.error ?? "no data"}`, ev(r.url, r.res));
    return;
  }
  const { scoring, mappings } = conv;
  const counts = mappingCounts(mappings);
  const effect = (adj: AdjustmentId) => analysis?.effects.find((e) => e.adj === adj);
  p.cl.ok("C", "C.rules", "Scoring rules", `${mappings.length} rules in ${r.data.groups.length} groups (${r.data.groups.map((g) => `${g.label} ${(g.scoringRules ?? []).length}`).join(", ")}). Mapping: ${Object.entries(counts).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ")}`, ev(r.url, r.res, "groups[].scoringRules[].category.id/.points/.forEvery/.boundLower/.boundUpper/.applyTo/.applyToAll/.isBonus/.rangeType", mappings[0] ? { category: mappings[0].category, description: mappings[0].description } : undefined));

  // Core offense: which Sleeper keys each rule reads (a definition adjustment makes this ⚠️).
  const coreGroups = new Set(["Passing", "Rushing", "Receiving", "Misc"]);
  const coreRules = mappings.filter((m) => coreGroups.has(m.group) && (m.status === "per-unit" || m.status === "partial" || m.adjustments.length));
  const adjustedCore = coreRules.filter((m) => m.adjustments.length);
  const perUnitText = coreRules.filter((m) => m.status === "per-unit" || m.status === "partial").map((m) => `${m.category.replace(/^.*\((.*)\)$/, "$1")} → ${m.keys.join(" + ")}${m.adjustments.length ? " (adjusted)" : ""}`);
  const fdAdjusted = adjustedCore.some((m) => m.adjustments.includes("recFdIncludesRecTd"));
  p.cl.add(
    "C",
    "C.core",
    "Yards, TDs, turnovers, 2-pt, first downs",
    adjustedCore.length || coreRules.some((m) => m.status === "partial") ? "warn" : "ok",
    `per-unit rules → Sleeper keys: ${perUnitText.join("; ")}.${fdAdjusted ? ` Receiving First Down reads rec_fd + rec_td: Fleaflicker counts TD catches as first downs and Sleeper's rec_fd leaves them out (rec_fd < rec_td on ${fdEvidence.fdBelowTd}/${fdEvidence.tdRows} Sleeper rows with a receiving TD, weeks ${fdEvidence.weeks.join(", ")}); ${effectText(effect("recFdIncludesRecTd"))}. So perStat.rec_td includes the first-down point.` : ""}`,
    ev(r.url, r.res, "groups[Passing|Rushing|Receiving|Misc].scoringRules[] → perStat", Object.fromEntries(["pass_yd", "pass_td", "pass_int", "rush_yd", "rush_td", "rec_yd", "rec_td", "rec_fd", "fum", "fum_lost"].filter((k) => scoring.perStat[k] !== undefined).map((k) => [k, round6(scoring.perStat[k] as number)]))),
    ev(SLEEPER_STATS_URL(SEASON, fdEvidence.weeks.at(-1) ?? 1), null, "[].stats.rec_fd vs [].stats.rec_td", { rowsWithRecTd: fdEvidence.tdRows, recFdBelowRecTd: fdEvidence.fdBelowTd }),
  );

  const recRules = mappings.filter((m) => m.categoryId === 41 || m.categoryId === 123);
  const tePremium = scoring.byPosition.TE?.rec !== undefined && scoring.byPosition.TE.rec > (scoring.perStat.rec ?? 0);
  p.cl.ok("C", "C.receptions", "Receptions (incl. position-specific)", recRules.length ? `${recRules.map((m) => `${m.category}: ${m.description} [${m.status}]`).join("; ")}${tePremium ? "; TE premium via byPosition" : ""}` : "no reception or target rules", ev(r.url, r.res, "scoringRules[category.id=41|123].applyTo", recRules.map((m) => ({ category: m.category, positions: m.positions, keys: m.keys }))));

  const posSpecific = Object.entries(scoring.byPosition).map(([pos, v]) => `${pos}: ${Object.entries(v ?? {}).map(([k, x]) => `${k}=${round6(x)}`).join(", ")}`);
  p.cl.ok("C", "C.positionSpecific", "Position-specific rates", posSpecific.length ? `byPosition (replacement rates): ${posSpecific.slice(0, 6).join(" | ")}` : "none", ev(r.url, r.res, "scoringRules[].applyTo (subset of positions)", scoring.byPosition));

  const bonusRules = mappings.filter((m) => m.status === "bonus" || m.status === "tier" || m.status === "distance");
  const composite = bonusRules.filter((m) => m.keys.some((k) => k.includes("+")));
  const perGame = bonusRules.filter((m) => m.keys.includes("gp"));
  p.cl.warn(
    "C",
    "C.bonuses",
    "Bonuses and tiers",
    `${counts.bonus} threshold bonuses (≥ lo), ${counts.tier} bounded or ≤-only tiers, ${counts.distance} per-event distance rules. Tiers need a max (and ≤-only tiers a missing lower bound) — Scoring.bonuses only has a threshold; bounded tiers on whole-number stats can be split into two thresholds.${composite.length ? ` ${composite.length} bonus(es) read a sum of Sleeper keys (${composite.map((m) => `"${m.description}" → ${m.keys.join(", ")}`).join("; ")}): Scoring.bonuses needs a composite stat.` : ""}${perGame.length ? ` ${perGame.map((m) => `"${m.description}" (applyTo ${m.positions.join("/")}${m.droppedPositions.length ? `/${m.droppedPositions.join("/")}` : ""})`).join("; ")} is a punter stat that is always 0 for ${[...new Set(perGame.flatMap((m) => m.positions))].join("/")}, so it is a constant +${perGame[0]?.points} per game played for them (mapped to gp ≥ 1; ${effectText(effect("punterOnlyZeroTier"))}).` : ""}`,
    ev(r.url, r.res, "scoringRules[isBonus=true].boundLower/.boundUpper/.rangeType", bonusRules.slice(0, 4).map((m) => ({ description: m.description, keys: m.keys, status: m.status }))),
  );

  const byClass = (cls: "offense" | "dst" | "idp", filter?: (m: RuleMapping) => boolean) => mappings.filter((m) => m.positions.some((x) => classOf(x) === cls) && (!filter || filter(m)));
  const kRules = mappings.filter((m) => m.group === "Kicking");
  p.cl.add("C", "C.kickers", "Kicker rules", kRules.some((m) => m.status === "unmapped") ? "warn" : "ok", `${kRules.length} rules: ${summarizeStatuses(kRules)}${kRules.filter((m) => m.status === "unmapped").length ? `; unmapped: ${kRules.filter((m) => m.status === "unmapped").map((m) => m.description).join("; ")}` : ""}`, ev(r.url, r.res, "groups[Kicking].scoringRules[]", kRules.slice(0, 5).map((m) => ({ d: m.description, keys: m.keys, status: m.status }))));

  // D/ST: positions come from applyTo, which lists D/ST only when the league can start one.
  const dstRules = byClass("dst");
  const eligibility = L.standings.data?.league.rosterRequirements?.eligibility;
  const lineup = summarizeLineup(r.data.rosterPositions);
  const dstStarts = lineup.lineup.some((x) => x.eligible.includes("DEF"));
  const cov = coverage.dst;
  const covText = `other public leagues: ${cov.leagues}/${coverage.leagues} list D/ST in applyTo (${cov.rules} rules: ${Object.entries(cov.counts).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ") || "none"})`;
  if (dstRules.length) {
    p.cl.add("C", "C.dst", "D/ST rules", dstRules.some((m) => m.status === "unmapped" || m.status === "partial") ? "warn" : "ok", `${dstRules.length} rules apply to D/ST (applyTo ∋ D/ST): ${summarizeStatuses(dstRules)}; ${covText}`, ev(r.url, r.res, "groups[].scoringRules[applyTo ∋ D/ST]", dstRules.slice(0, 5).map((m) => ({ d: m.description, keys: m.keys, status: m.status }))));
  } else {
    p.cl.add(
      "C",
      "C.dst",
      "D/ST rules",
      cov.counts.unmapped || cov.counts.partial ? "warn" : "ok",
      `D/ST not scored here: no rule's applyTo lists D/ST (roster-only: ${dstStarts ? "a starting slot exists" : "no starting slot"}; league eligibility ${eligibility ? (eligibility.includes("D/ST") ? "includes" : "omits") : "not given for"} D/ST), although ${mappings.filter((m) => m.group === "Defense" || m.group === "Returning").length} Defense/Returning rules have applyToAll=true. ${covText}`,
      ev(r.url, r.res, "groups[].scoringRules[].applyTo (no D/ST) / .applyToAll", { rulesWithDst: 0, applyToAllRules: r.data.groups.flatMap((g) => g.scoringRules ?? []).filter((x) => x.applyToAll).length }),
      ev(L.standings.url, L.standings.res, "league.rosterRequirements.eligibility", eligibility ?? "(omitted)"),
    );
  }

  const idpRules = byClass("idp").filter((m) => m.group === "Defense");
  const idpAdjusted = idpRules.filter((m) => m.adjustments.length);
  const idpPartial = idpRules.filter((m) => m.status === "partial" || m.status === "unmapped");
  p.cl.add(
    "C",
    "C.idp",
    "IDP rules",
    idpAdjusted.length || idpPartial.length ? "warn" : "ok",
    `${idpRules.length} defense rules apply to IDP: ${summarizeStatuses(idpRules)}; keys ${[...new Set(idpRules.flatMap((m) => m.keys))].filter((k) => k.startsWith("idp_") || k.startsWith("st_")).join(", ")}.${idpAdjusted.length ? ` ${idpAdjusted.map((m) => m.category.replace(/^.*\((.*)\)$/, "$1")).join(", ")} also count special-teams plays for every position in applyTo (tackles and recoveries add st_tkl_solo / st_fum_rec; forced fumbles read idp_ff, which already includes them): ${effectText(effect("specialTeamsPlays"))}. ${stEvidenceText(fdEvidence)}.` : ""}${idpPartial.length ? ` Not fully mapped: ${idpPartial.map((m) => `${m.description} (${m.notes.at(-1) ?? ""})`).join("; ")}` : ""}`,
    ev(r.url, r.res, "groups[Defense].scoringRules[]", idpRules.slice(0, 4).map((m) => ({ d: m.description, keys: m.keys, status: m.status }))),
  );

  // Every rule the model can't express exactly, with points and reason (the Import Report lists them).
  const unm = mappings.filter((m) => m.status === "unmapped" || m.status === "partial");
  const reasons = new Map<string, number>();
  for (const m of unm) {
    const why = (m.notes.at(-1) ?? "").replace(/distance range [^ ]+ yds/, "distance range").replace(/^[A-Z/]+ players: /, "");
    reasons.set(why, (reasons.get(why) ?? 0) + 1);
  }
  p.cl.add(
    "C",
    "C.unmapped",
    "Unmapped rules",
    unm.length ? "warn" : "ok",
    unm.length ? `${unm.length} rule(s) not (fully) mapped (${counts.unmapped} unmapped, ${counts.partial} partial; every one with points and reason in the JSON evidence), by reason: ${[...reasons.entries()].map(([k, n]) => `${k} ×${n}`).join("; ")}` : "none",
    ev(r.url, r.res, "groups[].scoringRules[]", unm.map((m) => ({ rule: m.description, points: m.points, status: m.status, positions: m.positions, reason: m.notes.at(-1) ?? "" }))),
  );

  // Definition adjustments with their oracle evidence.
  const used = (analysis?.effects ?? []).filter((e) => e.rules > 0);
  p.cl.add(
    "C",
    "C.definitions",
    "Stat definitions vs Sleeper keys",
    used.length ? "warn" : "ok",
    used.length ? `${used.length} definition adjustment(s), inferred from the scoring oracle (so ⚠️ until an adapter test confirms them): ${used.map((e) => `${e.label} [${e.rules} rule(s); ${effectText(e)}]`).join("; ")}` : "none needed",
    ev(apiUrl("FetchLeagueBoxscore", { league_id: "{leagueId}", fantasy_game_id: "{gameId}", scoring_period: "{week}" }), null, "oracle rows with vs without each adjustment", used.map((e) => ({ adjustment: e.adj, rules: e.rules, fixed: e.fixed, broken: e.broken, changed: e.changed }))),
  );

  const keys = scoringKeys(scoring);
  const unseen = keys.filter((k) => !observedKeys.has(k));
  p.cl.add("C", "C.sleeperKeys", "Mapped keys exist in Sleeper stats", unseen.length ? "warn" : "ok", `${keys.length - unseen.length}/${keys.length} mapped keys appear in Sleeper's weekly stats (weeks ${[...fdEvidence.weeks].join(", ")}); not seen (rare events or wrong names — verify): ${unseen.join(", ") || "none"}`, ev(SLEEPER_STATS_URL(SEASON, L.oracleWeeks.at(-1) ?? 1), null, "[].stats.<key>", unseen));

  if (coverage.leagues > 0) {
    p.cl.add(
      "C",
      "C.otherLeagues",
      "Rule coverage across other public leagues",
      coverage.unmappedCategories.length ? "warn" : "ok",
      `${coverage.leagues} more public leagues, ${coverage.rules} rules, ${coverage.categories} categories: ${Object.entries(coverage.counts).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ")}. Unmapped (category: reason ×rules): ${coverage.unmappedCategories.slice(0, 10).join("; ") || "none"}${coverage.unmappedCategories.length > 10 ? ` … (${coverage.unmappedCategories.length} kinds; all in JSON)` : ""}. Category ids not in the mapping table: ${coverage.unknown.map((u) => `${u.id} ${u.name} (${u.abbreviation})`).join(", ") || "none"}`,
      ev(apiUrl("FetchLeagueRules", { league_id: "{leagueId}" }), null, "groups[].scoringRules[].category.id/.nameSingular", { unknownCategories: coverage.unknown, unmapped: coverage.unmappedCategories }),
    );
  }
}

function summarizeStatuses(ms: readonly RuleMapping[]): string {
  const c = mappingCounts(ms);
  return Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

function checkD(p: ProbeContext, L: LeagueData, ids: FleaIdentities, docs: Docs | null): void {
  const st = L.standings;
  const teams = teamsOf(st.data);
  p.cl.add("D", "D.teams", "Teams", teams.length ? "ok" : "fail", `${teams.length} teams with id, name, logo, record; placeholders Team 1…${teams.length}`, ev(st.url, st.res, "divisions[].teams[].id / .name / .logoUrl", teams.slice(0, 2).map((t) => ({ id: ids.teamPlaceholderId(t.id), name: ids.teamLabel(t.id) }))));
  const owners = teams.map((t) => (t.owners ?? []).length);
  const noOwner = owners.filter((n) => n === 0).length;
  p.cl.add("D", "D.owners", "Owner display names", noOwner ? "warn" : "ok", `${owners.reduce((a, b) => a + b, 0)} owners (displayName, id, avatar) across ${teams.length} teams; co-owned teams ${owners.filter((n) => n > 1).length}; teams with no owner ${noOwner}${noOwner ? " (open team; the adapter shows \"(no owner)\")" : ""}`, ev(st.url, st.res, "divisions[].teams[].owners[].displayName / .id", { ownersPerTeam: [...new Set(owners)] }));
  const params = docs?.facts.pathParams.FetchUserLeagues;
  const owned = docs?.facts.schemas.League?.properties.includes("owned_team");
  const docText = docs ? (params ? `the API docs list FetchUserLeagues (query: ${params.join(", ")}) and League.owned_team${owned ? "" : " is NOT in the League schema"}` : "the API docs do not list FetchUserLeagues") : "the API docs were not read this run";
  p.cl.warn(
    "D",
    "D.myTeam",
    "Which team is Parker's",
    L.pick.label === "Parker's league"
      ? `Parker's league: needs his Fleaflicker user id or email for FetchUserLeagues (${docText}) — not probed`
      : `public test league, so there is no "my team". ${docText}; not called, to avoid looking up a real person. Without login the user picks their team (as for public ESPN leagues)`,
    ev(apiUrl("FetchUserLeagues", { user_id: "{userId}" }), null, "leagues[].ownedTeam.id", "(not called)"),
    ...(docs ? [ev(DOCS_URL, docs.res, "#path--FetchUserLeagues parameters; ws.flea.api.League.owned_team", { params: params ?? "(no path)", ownedTeam: owned ?? false })] : []),
  );
}

interface DpCrosswalk {
  res: HttpResult;
  rowsWithBoth: number;
  rostered: number;
  foundByFleaflickerId: number;
  foundBySportradarId: number;
}

/** How far the DynastyProcess map gets for this league's rostered players (CLAUDE.md §2.9 crosswalk). */
async function dynastyProcessCrosswalk(L: LeagueData): Promise<DpCrosswalk | null> {
  try {
    const { res, rows } = await getDynastyProcessIds();
    const players = (L.rosters?.data?.rosters ?? []).flatMap((r) => r.players ?? []);
    const byFf = new Set(rows.filter((r) => r.fleaflicker_id && r.sleeper_id).map((r) => r.fleaflicker_id));
    const bySr = new Set(rows.filter((r) => r.sportradar_id && r.sleeper_id).map((r) => r.sportradar_id));
    return {
      res,
      rowsWithBoth: byFf.size,
      rostered: players.length,
      foundByFleaflickerId: players.filter((x) => byFf.has(String(x.proPlayer.id))).length,
      foundBySportradarId: players.filter((x) => bySr.has(sportradarId(x.proPlayer) ?? "")).length,
    };
  } catch {
    return null;
  }
}

function checkE(p: ProbeContext, L: LeagueData, sleeperBySr: Map<string, string>, dp: DpCrosswalk | null, docs: Docs | null): void {
  const f = L.rosters;
  if (!f?.data) {
    p.cl.fail("E", "E.rosters", "Rosters", `FetchLeagueRosters failed: ${f?.error ?? "no data"}`, ev(f?.url, f?.res));
    return;
  }
  const rosters = f.data.rosters;
  const players = rosters.flatMap((r) => r.players ?? []);
  p.cl.ok("E", "E.rosters", "Every rostered player", `${players.length} players on ${rosters.length} teams (${Math.min(...rosters.map((r) => (r.players ?? []).length))}–${Math.max(...rosters.map((r) => (r.players ?? []).length))} per team), incl. IR and taxi`, ev(f.url, f.res, "rosters[].team.id / rosters[].players[].proPlayer", players[0] ? { id: players[0].proPlayer.id, nameFull: players[0].proPlayer.nameFull, position: players[0].proPlayer.position, proTeamAbbreviation: players[0].proPlayer.proTeamAbbreviation } : undefined));

  const groups: Record<string, number> = {};
  let teamsOk = 0;
  for (const t of L.teamRosters.values()) {
    if (t.data) teamsOk++;
    for (const g of t.data?.groups ?? []) {
      const name = enumOr(g.group, "RosterPositionGroup");
      groups[name] = (groups[name] ?? 0) + (g.slots ?? []).filter((s) => s.leaguePlayer).length;
    }
  }
  const firstRoster = L.teamRosters.values().next().value;
  // What FetchLeagueRosters' player entries carry (no lineup slot or roster group).
  const lrKeys: Record<string, number> = {};
  const displayGroups = new Set<string>();
  for (const x of players) {
    for (const k of Object.keys(x)) lrKeys[k] = (lrKeys[k] ?? 0) + 1;
    if (x.displayGroup) displayGroups.add(x.displayGroup);
  }
  const slotKeys = Object.keys(lrKeys).filter((k) => /slot|group|position|lineup/i.test(k) && k !== "displayGroup");
  p.cl.add(
    "E",
    "E.slotGroups",
    "Starters, bench, IR, taxi",
    teamsOk === L.teamIds.length && teamsOk > 0 ? "ok" : "warn",
    `FetchRoster per team (${teamsOk}/${L.teamIds.length}): ${Object.entries(groups).map(([k, v]) => `${k} ${v}`).join(", ")} players. FetchLeagueRosters player entries carry only ${Object.keys(lrKeys).join(", ")} (displayGroup is a stat-display group: ${[...displayGroups].join("/")})${slotKeys.length ? `; slot-like keys: ${slotKeys.join(", ")}` : " — no slot or roster group"}, so IR/taxi need FetchRoster (1 call per team)`,
    ev(firstRoster?.url, firstRoster?.res, "groups[].group (START | omitted = BENCH | INJURED | TAXI) / groups[].slots[].leaguePlayer", groups),
    ev(f.url, f.res, "rosters[].players[] keys", lrKeys),
  );

  const pos: Record<string, number> = {};
  for (const x of players) pos[x.proPlayer.position ?? "?"] = (pos[x.proPlayer.position ?? "?"] ?? 0) + 1;
  const unmappedPos = Object.keys(pos).filter((k) => !mapPos(k) || k.includes("/"));
  p.cl.add("E", "E.positions", "Positions", unmappedPos.length ? "warn" : "ok", `${Object.entries(pos).map(([k, v]) => `${k} ${v}`).join(", ")}${unmappedPos.length ? `; needs a decision: ${unmappedPos.join(", ")} (P has no model position; dual "WR/CB" uses its first part)` : ""}`, ev(f.url, f.res, "rosters[].players[].proPlayer.position / .positionEligibility", pos));

  const withTeam = players.filter((x) => x.proPlayer.proTeamAbbreviation).length;
  p.cl.add("E", "E.nflTeam", "NFL team", withTeam === players.length ? "ok" : "warn", `${withTeam}/${players.length} have proTeamAbbreviation; bye week in proPlayer.nflByeWeek`, ev(f.url, f.res, "rosters[].players[].proPlayer.proTeamAbbreviation", [...new Set(players.map((x) => x.proPlayer.proTeamAbbreviation))].slice(0, 8)));

  const inj: Record<string, number> = {};
  let unknownInj = 0;
  for (const x of players) {
    const i = x.proPlayer.injury;
    if (!i) continue;
    const m = mapInjury(i);
    if (!m.known) unknownInj++;
    const k = `${i.typeAbbreviaition ?? "?"}/${i.severity ?? "(omitted)"}→${m.status}`;
    inj[k] = (inj[k] ?? 0) + 1;
  }
  const injKeys = [...new Set(players.flatMap((x) => (x.proPlayer.injury ? Object.keys(x.proPlayer.injury) : [])))];
  const docInjury = docs?.facts.schemas.Injury?.properties;
  const severities = docs?.facts.schemas.InjurySeverity?.enumValues;
  p.cl.add(
    "E",
    "E.injury",
    "Injury status",
    unknownInj ? "warn" : "ok",
    `${Object.values(inj).reduce((a, b) => a + b, 0)} players with an injury object: ${Object.entries(inj).map(([k, v]) => `${k} ×${v}`).join(", ")}. Injury keys seen: ${injKeys.join(", ")} — no return week${injKeys.includes("typeAbbreviaition") ? '; the abbreviation key is spelled "typeAbbreviaition"' : ""}${docInjury ? ` (the docs' Injury schema: ${docInjury.join(", ")})` : ""}. ${severities ? `The docs' InjurySeverity values: ${severities.join("/")}, so IR, PUP and suspensions only show in the abbreviation` : "Severity values not checked against the docs this run"}`,
    ev(f.url, f.res, "rosters[].players[].proPlayer.injury.typeAbbreviaition / .severity / .typeFull", inj),
  );

  const idsUnique = new Set(players.map((x) => x.proPlayer.id)).size === players.length;
  p.cl.add("E", "E.playerIds", "Platform player id", idsUnique ? "ok" : "warn", `proPlayer.id: numeric, ${idsUnique ? "unique" : "NOT unique"} across rosters (range ${Math.min(...players.map((x) => x.proPlayer.id))}–${Math.max(...players.map((x) => x.proPlayer.id))})`, ev(f.url, f.res, "rosters[].players[].proPlayer.id", players[0]?.proPlayer.id));

  const withSr = players.filter((x) => sportradarId(x.proPlayer));
  const matched = withSr.filter((x) => sleeperBySr.has(sportradarId(x.proPlayer) ?? ""));
  p.cl.add(
    "E",
    "E.crosswalk",
    "Crosswalk to Sleeper ids",
    matched.length === players.length ? "ok" : "warn",
    `with external_id_type=SPORTRADAR every player gets externalIds[].id (type omitted = SPORTRADAR): ${withSr.length}/${players.length}; ${matched.length}/${players.length} (${pct(matched.length, players.length)}) match a Sleeper player's sportradar_id — incl. K, P and IDP. DynastyProcess map (CLAUDE.md §2.9): ${dp ? `${dp.rowsWithBoth} rows have both fleaflicker_id and sleeper_id, finding ${dp.foundByFleaflickerId}/${dp.rostered} rostered players by fleaflicker_id (${dp.foundBySportradarId}/${dp.rostered} via its sportradar_id)` : "not available this run"}`,
    ev(f.url, f.res, "rosters[].players[].proPlayer.externalIds[].id", "<sportradar uuid>"),
    ...(dp ? [ev(DP_IDMAP_URL, dp.res, "fleaflicker_id / sleeper_id / sportradar_id", { rowsWithFleaflickerAndSleeper: dp.rowsWithBoth, foundByFleaflickerId: dp.foundByFleaflickerId, foundBySportradarId: dp.foundBySportradarId, rostered: dp.rostered })] : []),
  );

  const keepers = rosters.map((r) => (r.players ?? []).filter((x) => x.isKeeper).length);
  p.cl.ok("E", "E.keepers", "Keeper flags", `isKeeper on ${keepers.reduce((a, b) => a + b, 0)} players (${Math.min(...keepers)}–${Math.max(...keepers)} per team)`, ev(f.url, f.res, "rosters[].players[].isKeeper", keepers));
}

function checkF(p: ProbeContext, L: LeagueData, docs: Docs | null): void {
  const teams = teamsOf(L.standings.data);
  const regular = L.weeks.filter((w) => gamesOf(L.scoreboards.get(w)).length > 0 && !gamesOf(L.scoreboards.get(w)).some((g) => g.isPlayoffs));
  const remaining = regular.filter((w) => w >= L.currentWeek);
  const complete = remaining.every((w) => {
    const g = gamesOf(L.scoreboards.get(w));
    return g.length * 2 === teams.length && g.every((x) => x.home?.id && x.away?.id);
  });
  const sb = L.scoreboards.get(remaining[0] ?? L.currentWeek);
  p.cl.add("F", "F.schedule", "Remaining matchups", complete && remaining.length ? "ok" : "warn", `weeks ${remaining[0]}–${remaining.at(-1)}: ${remaining.length} weeks × ${teams.length / 2} games, every game has both teams (FetchLeagueScoreboard per week)`, ev(sb?.url, sb?.res, "games[].id / games[].home.id / games[].away.id / games[].isDivisional", { weeks: remaining.length, gamesPerWeek: gamesOf(sb).length }));

  // Recompute W-L-T and points for/against from completed weeks.
  const rec = new Map<number, { w: number; l: number; t: number; pf: number; pa: number }>();
  for (const w of L.completedWeeks) {
    for (const g of gamesOf(L.scoreboards.get(w))) {
      const sides = [
        { team: g.home?.id, res: enumOr(g.homeResult, "GameResult"), pf: fd(g.homeScore?.score), pa: fd(g.awayScore?.score) },
        { team: g.away?.id, res: enumOr(g.awayResult, "GameResult"), pf: fd(g.awayScore?.score), pa: fd(g.homeScore?.score) },
      ];
      for (const s of sides) {
        if (s.team === undefined) continue;
        const r = rec.get(s.team) ?? { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
        if (s.res === "WIN") r.w++;
        else if (s.res === "LOSE") r.l++;
        else if (s.res === "TIE") r.t++;
        r.pf += s.pf;
        r.pa += s.pa;
        rec.set(s.team, r);
      }
    }
  }
  let recOk = 0;
  let ptsOk = 0;
  for (const t of teams) {
    const r = rec.get(t.id);
    if (!r) continue;
    if (r.w === num(t.recordOverall?.wins) && r.l === num(t.recordOverall?.losses) && r.t === num(t.recordOverall?.ties)) recOk++;
    if (Math.abs(r.pf - fd(t.pointsFor)) < 0.05 && Math.abs(r.pa - fd(t.pointsAgainst)) < 0.05) ptsOk++;
  }
  const t0 = teams[0];
  p.cl.add("F", "F.records", "Current W-L-T", recOk === teams.length ? "ok" : "warn", `standings records match the completed scoreboards for ${recOk}/${teams.length} teams (weeks ${L.completedWeeks.join(", ")}); omitted losses/ties = 0`, ev(L.standings.url, L.standings.res, "divisions[].teams[].recordOverall.wins/.losses/.ties", t0 ? { wins: t0.recordOverall?.wins ?? "(omitted)", losses: t0.recordOverall?.losses ?? "(omitted)", ties: t0.recordOverall?.ties ?? "(omitted)" } : undefined));
  p.cl.add("F", "F.points", "Points for / against", ptsOk === teams.length ? "ok" : "warn", `pointsFor/pointsAgainst equal the sum of completed game scores for ${ptsOk}/${teams.length} teams`, ev(L.standings.url, L.standings.res, "divisions[].teams[].pointsFor.value / .pointsAgainst.value", t0 ? { pointsFor: fd(t0.pointsFor), pointsAgainst: fd(t0.pointsAgainst) } : undefined));
  const playoffWeeks = L.weeks.filter((w) => !regular.includes(w));
  const flags = ["is_playoffs", "is_consolation", "is_championship_game", "is_third_place_game"];
  const docFlags = docs?.facts.schemas.FantasyGame?.properties.filter((x) => flags.includes(x)) ?? [];
  p.cl.warn(
    "F",
    "F.playoffGames",
    "Playoff matchups",
    `weeks ${playoffWeeks.join(", ") || "none"} have no games yet (the bracket is not set), so playoff games can't be seen in this run. ${docs ? `The docs' FantasyGame schema has ${docFlags.length ? docFlags.map(camelOf).join(" / ") : "no playoff flags"}` : "Docs not read: playoff flags unverified"}`,
    ev(apiUrl("FetchLeagueScoreboard", { league_id: "{leagueId}", season: SEASON, scoring_period: playoffWeeks[0] ?? "{week}" }), L.scoreboards.get(playoffWeeks[0] ?? 0)?.res, "games[] (empty)", 0),
    ...(docs ? [ev(DOCS_URL, docs.res, "ws.flea.api.FantasyGame properties", docFlags)] : []),
  );
}

/**
 * Transactions with no `type` should be adds (TRANSACTION_ADD is the enum default): the player
 * should still be on that team unless a later drop by that team exists.
 */
function verifyOmittedTypeIsAdd(L: LeagueData): { checked: number; onTeam: number } {
  const verify = { checked: 0, onTeam: 0 };
  const items = L.tx?.items ?? [];
  const onTeam = new Map<number, number>();
  for (const r of L.rosters?.data?.rosters ?? []) for (const x of r.players ?? []) onTeam.set(x.proPlayer.id, r.team.id);
  const droppedAfter = new Set<string>(); // player:team pairs whose last event (by time) is a drop
  for (const x of [...items].sort((a, b) => a.time - b.time)) {
    if (x.playerId === undefined || x.teamId === undefined) continue;
    const k = `${x.playerId}:${x.teamId}`;
    if (x.type === "TRANSACTION_DROP") droppedAfter.add(k);
    else if (x.typeOmitted) droppedAfter.delete(k);
  }
  for (const x of items) {
    if (!x.typeOmitted || x.playerId === undefined || x.teamId === undefined || droppedAfter.has(`${x.playerId}:${x.teamId}`)) continue;
    verify.checked++;
    if (onTeam.get(x.playerId) === x.teamId) verify.onTeam++;
  }
  return verify;
}

/** Keys on transaction items and their transaction objects, and any week-like key among them. */
function transactionKeys(L: LeagueData): { itemKeys: Set<string>; txKeys: Set<string>; weekLike: string[] } {
  const itemKeys = new Set<string>();
  const txKeys = new Set<string>();
  for (const f of L.tx?.pages ?? [])
    for (const it of f.data?.items ?? []) {
      Object.keys(it).forEach((k) => itemKeys.add(k));
      Object.keys(it.transaction ?? {}).forEach((k) => txKeys.add(k));
    }
  return { itemKeys, txKeys, weekLike: [...itemKeys, ...txKeys].filter((k) => /week|period|ordinal/i.test(k)) };
}

function checkG(p: ProbeContext, L: LeagueData, ids: FleaIdentities): void {
  const tx = L.tx;
  if (!tx) return;
  const first = tx.pages[0];
  if (!first?.data) {
    p.cl.fail("G", "G.transactions", "Transactions", `FetchLeagueTransactions failed: ${first?.error ?? "no data"}`, ev(first?.url, first?.res));
    return;
  }
  const season = tx.items.filter((x) => x.week >= 1);
  const byType: Record<string, number> = {};
  for (const x of season) byType[x.type] = (byType[x.type] ?? 0) + 1;
  p.cl.add("G", "G.transactions", "This season's transactions", tx.reachedStart ? "ok" : "warn", `${season.length} since week 1 (${tx.pages.length} pages of 30, newest first${tx.reachedStart ? "" : `; stopped after ${MAX_TX_PAGES} pages`}): ${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(", ")}`, ev(first.url, first.res, "items[].timeEpochMilli / items[].transaction.type/.team/.player/.bidAmount/.tradeId; resultOffsetNext", first.data.items?.[0]?.transaction ? { timeEpochMilli: "(epoch ms)", type: first.data.items[0].transaction.type ?? "(omitted = TRANSACTION_ADD)" } : undefined));

  const perTeam = new Map<number, { adds: number; drops: number; last: number }>();
  for (const x of season) {
    if (x.teamId === undefined) continue;
    const t = perTeam.get(x.teamId) ?? { adds: 0, drops: 0, last: 0 };
    if (x.type === "TRANSACTION_DROP") t.drops++;
    else if (x.type === "TRANSACTION_ADD" || x.type === "TRANSACTION_CLAIM") t.adds++;
    t.last = Math.max(t.last, x.week);
    perTeam.set(x.teamId, t);
  }
  const sample = [...perTeam.entries()].slice(0, 4).map(([id, v]) => ({ team: ids.teamLabel(id), adds: v.adds, drops: v.drops, lastActiveWeek: v.last }));
  const { itemKeys, txKeys, weekLike } = transactionKeys(L);
  p.cl.warn(
    "G",
    "G.addDropCounts",
    "Add/drop counts per team",
    `${perTeam.size}/${L.teamIds.length} teams made moves this season. Keys on items: ${[...itemKeys].join(", ")}; on items[].transaction: ${[...txKeys].join(", ")} — ${weekLike.length ? `week-like: ${weekLike.join(", ")}` : "no week or period field"}, so the week is derived from timeEpochMilli and each week's start (eligibleSchedulePeriods[].low.startEpochMilli)`,
    ev(first.url, first.res, "items[].transaction.team.id + items[].timeEpochMilli", sample),
  );

  // "Current Season Opened" is US Eastern wall time without a zone: parse it explicitly.
  const openedText = L.html?.rules?.seasonOpened;
  const opened = openedText ? parseEasternTime(openedText) : null;
  const leagueYearStart = opened ?? Date.UTC(SEASON, 1, 1);
  const week1 = int64(L.periods[0]?.low?.startEpochMilli);
  const trades = L.tradesDone.flatMap((f) => f.data?.trades ?? []);
  const thisYear = trades.filter((t) => int64(t.approvedOn ?? t.proposedOn) >= leagueYearStart);
  const inSeason = thisYear.filter((t) => int64(t.approvedOn ?? t.proposedOn) >= week1);
  const tf = L.tradesDone[0];
  const example = thisYear[0] ?? trades[0];
  p.cl.add(
    "G",
    "G.trades",
    "Trades with players and picks",
    tf?.data ? "ok" : "fail",
    `FetchTrades(TRADES_COMPLETED), newest first, ${L.tradesDone.length} page(s) of 10 read ${L.tradesReachedEnd ? "to the end" : `back past the start of ${SEASON}`}: ${trades.length} trades read, ${thisYear.length} in this league year (opened ${opened ? `${new Date(opened).toISOString().slice(0, 16)}Z, from "${openedText}" read as US Eastern time` : "? — no Current Season Opened line; Feb 1 assumed"}), ${inSeason.length} since week 1. Each has proposedOn/approvedOn, both teams, playersObtained, picksObtained, playersReleased`,
    ev(tf?.url, tf?.res, "trades[].approvedOn / .teams[].team.id / .playersObtained[].proPlayer / .picksObtained[].season+.slot.round+.originalOwner", example ? { approvedOn: new Date(int64(example.approvedOn ?? example.proposedOn)).toISOString().slice(0, 10), status: example.status, sides: (example.teams ?? []).map((s) => ({ team: ids.teamLabel(s.team?.id), players: (s.playersObtained ?? []).map((x) => x.proPlayer.nameFull), picks: (s.picksObtained ?? []).map((x) => `${x.season} R${x.slot?.round ?? "?"}`) })) } : undefined),
  );
  const pend = L.tradesPending;
  p.cl.add("G", "G.pendingTrades", "Trades under review", pend?.data ? "ok" : "warn", `${(pend?.data?.trades ?? []).length} trade(s) under review now`, ev(pend?.url, pend?.res, "trades[] (filter=TRADES_UNDER_REVIEW)", (pend?.data?.trades ?? []).length));
}

function checkH(p: ProbeContext, L: LeagueData): void {
  if (!L.fa.size) {
    p.cl.fail("H", "H.freeAgents", "Free agents", "no free-agent listing fetched", ev(undefined, null));
    return;
  }
  const summary = [...L.fa.entries()].map(([pos, f]) => ({ pos, n: (f.data?.players ?? []).length, total: f.data?.resultTotal, owned: (f.data?.players ?? []).filter((x) => x.owner).length, withProj: (f.data?.players ?? []).filter((x) => x.viewingProjectedPoints?.value !== undefined).length, offPosition: Object.values(L.faMismatch.get(pos) ?? {}).reduce((a, b) => a + b, 0) }));
  const first = L.fa.values().next().value;
  const owned = summary.reduce((n, x) => n + x.owned, 0);
  const eligibility = L.standings.data?.league.rosterRequirements?.eligibility;
  const ignored = [...L.faMismatch.entries()].map(([pos, off]) => `${pos}: ${Object.values(off).reduce((a, b) => a + b, 0)}/${(L.fa.get(pos)?.data?.players ?? []).length} returned players are not ${pos} (${Object.entries(off).map(([k, n]) => `${k} ${n}`).join(", ")}; resultTotal ${L.fa.get(pos)?.data?.resultTotal ?? "?"})${eligibility ? ` — ${pos} is ${eligibility.includes(pos) ? "in" : "NOT in"} league.rosterRequirements.eligibility` : ""}`);
  p.cl.add(
    "H",
    "H.freeAgents",
    "Free agents by position",
    owned || ignored.length ? "warn" : "ok",
    `FetchPlayerListing(filter.free_agent_only=true, sort=SORT_PROJECTIONS) per position: ${summary.map((x) => `${x.pos} ${x.n}/${x.total ?? "?"}`).join(", ")}; ${owned} rostered players leaked in. Position check of every returned player: ${ignored.length ? `the filter was IGNORED for ${ignored.join("; ")}. Adapter: request a position only when it is in the league's eligibility, and verify positions` : "all match their filter"}`,
    ev(first?.url, first?.res, "players[].proPlayer.position / .positionEligibility; resultTotal / resultOffsetNext", summary.slice(0, 4)),
    ...[...L.faMismatch.keys()].map((pos) => ev(L.fa.get(pos)?.url, L.fa.get(pos)?.res, "players[].proPlayer.position", L.faMismatch.get(pos))),
  );
  const p2 = L.faPage2;
  p.cl.add("H", "H.pagination", "Paging beyond 30", p2?.data ? "ok" : "warn", p2?.data ? `result_offset=${L.fa.get("RB")?.data?.resultOffsetNext} returned ${(p2.data.players ?? []).length} more RBs (30 per page); top 50 per position = 2 calls` : "no second page needed/fetched", ev(p2?.url, p2?.res, "players[] (result_offset)", (p2?.data?.players ?? []).length));
}

function checkI(p: ProbeContext, L: LeagueData, ids: FleaIdentities, docs: Docs | null): void {
  const all = [...L.picks.values()].flatMap((f) => f.data?.picks ?? []);
  const first = L.picks.values().next().value;
  if (!all.length) {
    p.cl.fail("I", "I.futurePicks", "Future pick ownership", `FetchTeamPicks returned no picks (${first?.error ?? "empty"})`, ev(first?.url, first?.res));
    return;
  }
  // A traded pick is listed under both teams (the original owner's copy has lost=true): dedupe.
  const d = dedupePicks([...L.picks.entries()].map(([teamId, f]) => ({ teamId, picks: f.data?.picks ?? [] })));
  const seasons = [...new Set(d.distinct.map((x) => x.season))].sort();
  const rounds = Math.max(...d.distinct.map((x) => x.round));
  const expected = seasons.length * rounds * L.teamIds.length;
  p.cl.add(
    "I",
    "I.futurePicks",
    "Future pick ownership",
    d.distinct.length === expected && !d.conflicts ? "ok" : "warn",
    `FetchTeamPicks per team (${L.picks.size} calls): ${d.entries} entries = ${d.distinct.length} distinct picks after dedup on (season, slot.round, originalOwner ?? ownedBy) — ${d.distinct.length === expected ? "exactly" : "expected"} ${seasons.length} seasons (${seasons.join(", ")}) × ${rounds} rounds × ${L.teamIds.length} teams${d.conflicts ? `; ${d.conflicts} pick(s) whose non-lost copies disagree on the owner` : ""}. Summing the per-team lists would count each traded pick twice`,
    ev(first?.url, first?.res, "picks[].ownedBy.id / .season / .slot.round / .originalOwner / .traded / .lost", { entries: d.entries, distinct: d.distinct.length, expected, conflicts: d.conflicts }),
  );
  const tradedPicks = d.distinct.filter((x) => x.traded);
  const allTrades = L.tradesDone.flatMap((f) => f.data?.trades ?? []);
  const m = matchTradedPicks(d.distinct, allTrades);
  p.cl.warn(
    "I",
    "I.tradedPicks",
    "Traded picks",
    `${tradedPicks.length} traded pick(s) (owner ≠ original team), each listed twice: the new owner's copy and the original owner's copy with lost=true (${d.lostCopies} lost copies; ${d.onlyLost} pick(s) with only a lost copy, i.e. forfeited). ${m.matched}/${m.traded} match a completed trade's picksObtained (same season, round, original team, receiving side). Adapter rule: dedupe as above and take ownedBy of the copy without lost; ⚠️ until the adapter does`,
    ev(first?.url, first?.res, "picks[].originalOwner.id / picks[].traded / picks[].lost", tradedPicks.slice(0, 3).map((x) => ({ season: x.season, round: x.round, from: ids.teamLabel(x.originalTeam), to: ids.teamLabel(x.owner), copies: x.copies, lostCopies: x.lostCopies }))),
    ev(L.tradesDone[0]?.url, L.tradesDone[0]?.res, "trades[].teams[].picksObtained[].season/.slot.round/.originalOwner.id", `${m.matched}/${m.traded}`),
  );
  const db = L.draftBoard;
  const cells = (db?.data?.rows ?? []).flatMap((r) => r.cells ?? []);
  const documentedKeys = docs?.facts.schemas.FetchLeagueDraftBoardResponse?.properties;
  const undocumented = db?.data && documentedKeys ? Object.keys(db.data).filter((k) => !documentedKeys.includes(snakeOf(k))) : [];
  p.cl.add(
    "I",
    "I.draftBoard",
    "This season's draft board",
    db?.data ? "ok" : "warn",
    db?.data
      ? `${(db.data.rows ?? []).length} rounds, ${cells.length} cells (${cells.filter((x) => x.player).length} with a player, ${cells.filter((x) => x.fromOtherTeam || x.tradeId).length} traded); ${documentedKeys ? `top-level keys not in the docs' FetchLeagueDraftBoardResponse (${documentedKeys.join(", ")}): ${undocumented.join(", ") || "none"}` : "docs not read: top-level keys not checked"}`
      : `FetchLeagueDraftBoard failed: ${db?.error}`,
    ev(db?.url, db?.res, "rows[].cells[].team / .player / .slot / .tradeId / .fromOtherTeam", cells.length),
  );
}

function checkJ(p: ProbeContext, L: LeagueData): void {
  const all = [...L.teamRosters.values()].flatMap((f) => (f.data?.groups ?? []).flatMap((g) => (g.slots ?? []).map((s) => s.leaguePlayer).filter((x): x is FfLeaguePlayer => Boolean(x))));
  const hasProj = (x: FfLeaguePlayer) => Boolean(x.viewingProjectedPoints && (x.viewingProjectedPoints.value !== undefined || x.viewingProjectedPoints.formatted !== undefined));
  const withProj = all.filter(hasProj);
  const first = L.teamRosters.values().next().value;
  const sample = withProj.find((x) => x.proPlayer.position === "WR") ?? withProj[0];
  // Why players have no projection: punters (never projected), injury, bye, other.
  const causes: Record<string, number> = {};
  const punters = { total: 0, projected: 0, withProjectedStats: 0 };
  for (const x of all) {
    if (x.proPlayer.position === "P") {
      punters.total++;
      if (hasProj(x)) punters.projected++;
      const games = (x as { requestedGames?: Array<{ statsProjected?: unknown[]; pointsProjected?: unknown }> }).requestedGames ?? [];
      if (games.some((g) => (g.statsProjected ?? []).length > 0 || g.pointsProjected !== undefined)) punters.withProjectedStats++;
    }
    if (hasProj(x)) continue;
    const inj = mapInjury(x.proPlayer.injury).status;
    const cause = x.proPlayer.position === "P" ? "punter" : inj !== "ACTIVE" ? `injury ${inj}` : x.proPlayer.nflByeWeek === L.currentWeek ? "bye" : "other (healthy, not on bye)";
    causes[cause] = (causes[cause] ?? 0) + 1;
  }
  p.cl.add(
    "J",
    "J.currentWeek",
    "This week's projections (league-scored)",
    withProj.length ? (punters.total && !punters.projected ? "warn" : "ok") : "fail",
    `FetchRoster(scoring_period=${L.currentWeek}): ${withProj.length}/${all.length} rostered players have viewingProjectedPoints in this league's scoring. Without one (${all.length - withProj.length}): ${Object.entries(causes).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}.${punters.total ? ` Punters projected: ${punters.projected}/${punters.total}; with any projected stats or points in requestedGames: ${punters.withProjectedStats}/${punters.total}${punters.projected || punters.withProjectedStats ? "" : " — Fleaflicker projects no punter, although P and K/P slots can start one here"}` : ""}`,
    ev(first?.url, first?.res, "groups[].slots[].leaguePlayer.viewingProjectedPoints.value", sample ? { player: sample.proPlayer.nameFull, projected: fd(sample.viewingProjectedPoints) } : undefined),
    ev(first?.url, first?.res, "groups[].slots[].leaguePlayer (no viewingProjectedPoints) by cause", causes),
  );
  const catsByPos = new Map<string, Set<string>>();
  const idsByPos = new Map<string, Set<number>>();
  for (const x of all) {
    const pos = x.proPlayer.position ?? "?";
    const s = catsByPos.get(pos) ?? new Set<string>();
    const i = idsByPos.get(pos) ?? new Set<number>();
    for (const st of x.viewingProjectedStats ?? []) {
      s.add(st.category.abbreviation ?? String(st.category.id));
      i.add(st.category.id);
    }
    catsByPos.set(pos, s);
    idsByPos.set(pos, i);
  }
  const perPos = [...catsByPos.values()].map((v) => v.size).filter((n) => n > 0);
  const qbRush = [...(idsByPos.get("QB") ?? [])].some((id) => id === 21 || id === 22 || id === 24);
  p.cl.warn(
    "J",
    "J.statProjections",
    "Stat-level projections",
    `viewingProjectedStats has only ${Math.min(...perPos)}–${Math.max(...perPos)} display stats per position (${[...catsByPos.entries()].slice(0, 4).map(([k, v]) => `${k}: ${[...v].join("/")}`).join("; ")})${idsByPos.has("QB") ? `; QB ${qbRush ? "includes" : "has no"} rushing category (ids 21/22/24)` : ""} — too partial to rescore; use the league-scored points`,
    ev(first?.url, first?.res, "groups[].slots[].leaguePlayer.viewingProjectedStats[].category", Object.fromEntries([...catsByPos.entries()].slice(0, 3).map(([k, v]) => [k, [...v]]))),
  );
  const fut = L.futureRoster;
  const futPlayers = (fut?.data?.groups ?? []).flatMap((g) => (g.slots ?? []).map((s) => s.leaguePlayer).filter((x): x is FfLeaguePlayer => Boolean(x)));
  const futProj = futPlayers.filter((x) => x.viewingProjectedPoints?.value !== undefined).length;
  p.cl.add("J", "J.futureWeeks", "Future-week projections", futProj ? "ok" : "warn", `FetchRoster(scoring_period=${L.currentWeek + 1}): ${futProj}/${futPlayers.length} players have a projection${futProj ? "" : " — no future-week projections"}. Not blocking: CLAUDE.md §6 already uses Sleeper weekly projections × league scoring for every platform except ESPN and MFL`, ev(fut?.url, fut?.res, "groups[].slots[].leaguePlayer.viewingProjectedPoints", futProj));
  const sbCur = L.scoreboards.get(L.currentWeek);
  const games = gamesOf(sbCur);
  const withTeamProj = games.filter((g) => g.homeScore?.projected !== undefined || g.awayScore?.projected !== undefined).length;
  p.cl.add("J", "J.teamProjection", "Team projected score", withTeamProj ? "ok" : "warn", `week ${L.currentWeek} scoreboard: ${withTeamProj}/${games.length} games carry homeScore.projected / awayScore.projected`, ev(sbCur?.url, sbCur?.res, "games[].homeScore.projected.value", games[0] ? fd(games[0].homeScore?.projected) : undefined));
  const fa = L.fa.values().next().value;
  const faProj = (fa?.data?.players ?? []).filter((x) => x.viewingProjectedPoints?.value !== undefined).length;
  p.cl.add("J", "J.freeAgents", "Free-agent projections", faProj ? "ok" : "warn", `free-agent listing: ${faProj}/${(fa?.data?.players ?? []).length} with viewingProjectedPoints (sorted by it)`, ev(fa?.url, fa?.res, "players[].viewingProjectedPoints.value", faProj));
}

interface OracleContext {
  scoring: ConvertedScoring;
  mappings: RuleMapping[];
  statsByWeek: Map<number, WeekStats>;
  sleeperBySr: Map<string, string>;
  sleeperDefs: Set<string>;
}

function runOracle(L: LeagueData, o: OracleContext): { rows: OracleRow[]; summary: OracleSummary } {
  const srByFf = new Map<number, string>();
  const collect = (players: FfLeaguePlayer[]) => {
    for (const x of players) {
      const sr = sportradarId(x.proPlayer);
      if (sr) srByFf.set(x.proPlayer.id, sr);
    }
  };
  collect((L.rosters?.data?.rosters ?? []).flatMap((r) => r.players ?? []));
  for (const f of L.extraPlayers) collect(f.data?.players ?? []);
  const rows: OracleRow[] = [];
  for (const w of L.oracleWeeks) {
    const ws = o.statsByWeek.get(w);
    for (const f of L.boxscores.get(w) ?? []) {
      for (const { lp } of lineupPlayers(f.data)) {
        const pp = lp.proPlayer;
        const ffPos = pp.position ?? "?";
        const pos = mapPos(ffPos);
        const actual = fd(lp.viewingActualPoints);
        const base = { week: w, ffId: pp.id, name: pp.nameFull ?? String(pp.id), ffPos, pos, actual };
        if (!pos) {
          rows.push({ ...base, computed: null, diff: null, reason: `no model position (${ffPos})` });
          continue;
        }
        const sleeperId = pos === "DEF" ? (o.sleeperDefs.has(normTeam(pp.proTeamAbbreviation)) ? normTeam(pp.proTeamAbbreviation) : undefined) : o.sleeperBySr.get(srByFf.get(pp.id) ?? "");
        if (!sleeperId) {
          rows.push({ ...base, computed: null, diff: null, reason: "no Sleeper id (crosswalk)" });
          continue;
        }
        if (!ws) {
          rows.push({ ...base, computed: null, diff: null, reason: "no Sleeper stats for the week" });
          continue;
        }
        const stats = ws.bySleeperId.get(sleeperId);
        const computed = stats ? evaluate(stats, pos, o.scoring) : 0;
        rows.push({ ...base, computed: round2(computed), diff: round2(computed - actual), reason: stats ? undefined : "no Sleeper stats row", statLine: stats ? statLine(stats, o.scoring) : {}, sleeper: stats ?? {} });
      }
    }
  }
  return { rows, summary: summarizeOracle(rows, TOLERANCE) };
}

interface AdjustmentEffect {
  adj: AdjustmentId;
  label: string;
  /** Rules in this league that use the adjustment. */
  rules: number;
  /** Compared rows whose recomputed points change when the adjustment is switched off. */
  changed: number;
  /** Rows within tolerance only with the adjustment (and the reverse). */
  fixed: number;
  broken: number;
  /** Extra evidence (counts), e.g. how many QB/K who played were short without it. */
  detail?: string;
}

interface OracleAnalysis {
  summary: OracleSummary;
  /** The same recomputation with every definition adjustment switched off. */
  baseline: OracleSummary;
  effects: AdjustmentEffect[];
  explain: ExplainSummary;
}

/** Recompute with all adjustments, with none, and without each one; then explain the mismatches. */
function analyzeOracle(L: LeagueData, o: OracleContext): OracleAnalysis | null {
  if (![...L.boxscores.values()].flat().length) return null;
  const groups = L.rules.data?.groups ?? [];
  const full = runOracle(L, o);
  const base = runOracle(L, { ...o, scoring: convertRules(groups, { disable: ALL_ADJUSTMENTS }).scoring });
  const within = (r: OracleRow | undefined) => r !== undefined && r.diff !== null && Math.abs(r.diff) <= TOLERANCE;
  const effects: AdjustmentEffect[] = ALL_ADJUSTMENTS.map((adj) => {
    const without = runOracle(L, { ...o, scoring: convertRules(groups, { disable: [adj] }).scoring }).rows;
    let changed = 0;
    let fixed = 0;
    let broken = 0;
    full.rows.forEach((r, i) => {
      const w = without[i];
      if (r.diff === null || !w || w.diff === null) return;
      if (Math.abs(r.diff - w.diff) > 0.001) changed++;
      if (within(r) && !within(w)) fixed++;
      if (!within(r) && within(w)) broken++;
    });
    const e: AdjustmentEffect = { adj, label: ADJUSTMENTS[adj].label, rules: o.mappings.filter((m) => m.adjustments.includes(adj)).length, changed, fixed, broken };
    if (adj === "punterOnlyZeroTier") {
      const played = without.filter((r) => (r.pos === "QB" || r.pos === "K") && r.diff !== null && (r.sleeper?.gp ?? 0) > 0);
      const tier = o.mappings.find((m) => m.adjustments.includes(adj));
      if (tier) e.detail = `QB/K who played: ${played.filter((r) => (r.diff ?? 0) <= -tier.points + TOLERANCE).length}/${played.length} were at least ${tier.points} pts short without it`;
    }
    return e;
  });
  return { summary: full.summary, baseline: base.summary, effects, explain: explainMismatches(full.summary.mismatches, o.mappings, TOLERANCE) };
}

function reportOracle(p: ProbeContext, L: LeagueData, a: OracleAnalysis | null, key: string, title: string): void {
  const boxes = [...L.boxscores.values()].flat();
  if (!a) {
    p.cl.fail("K", key, title, "no completed-week box scores", ev(undefined, null));
    return;
  }
  const { summary, baseline, explain } = a;
  const byPos = Object.entries(summary.byPos).map(([k, v]) => `${k} ${v.within}/${v.compared}`).join(", ");
  const hist = diffHistogram(summary.mismatches);
  const v = explain.verdicts;
  const usedAdj = a.effects.filter((e) => e.rules > 0);
  const top = explain.explanations.slice(0, 8).map((x) => ({ week: x.row.week, player: x.row.name, pos: x.row.ffPos, fleaflicker: round2(x.row.actual), recomputed: x.row.computed, diff: x.row.diff, verdict: x.verdict, causes: x.causes.map((c) => `${c.rule}: ${c.points ?? `${c.min}…${c.max}`}`) }));
  p.cl.add(
    "K",
    key,
    title,
    summary.rate >= 0.99 ? "ok" : "warn",
    `PREVIEW: recomputed ${summary.compared} player-weeks (weeks ${L.oracleWeeks.join(", ")}) from Sleeper weekly stats × the converted rules: ${summary.within} (${pct(summary.within, summary.compared)}) within ${TOLERANCE} pts (target 99%); leaving out the ${summary.zeroZero} rows where both sides are 0 (mostly players who didn't play): ${summary.within - summary.zeroZero}/${summary.compared - summary.zeroZero} (${pct(summary.within - summary.zeroZero, summary.compared - summary.zeroZero)}).${usedAdj.length ? ` Without the definition adjustments: ${baseline.within} (${pct(baseline.within, baseline.compared)}).` : ""} By position: ${byPos}. Skipped: ${Object.entries(summary.skipped).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}. ${summary.mismatches.length} mismatches: ${v.explained} explained exactly by unmapped rules (estimated from Sleeper's *_td_lng / _40p, fgm_lng / fgm_yds / buckets, pass_lng), ${v.consistent} consistent only with rules Sleeper's stats can't resolve, ${v.unexplained} unexplained. Differences (recomputed − Fleaflicker): ${hist.slice(0, 12).map((h) => `${h.diff}×${h.count}`).join(", ") || "none"}${hist.length > 12 ? ` … (${hist.length} values; full histogram in JSON)` : ""}`,
    ev(apiUrl("FetchLeagueBoxscore", { league_id: "{leagueId}", fantasy_game_id: "{gameId}", scoring_period: "{week}" }), boxes[0]?.res, "lineups[].slots[].home|away.viewingActualPoints vs Sleeper [].stats", top.slice(0, 3)),
  );
  (p.cl.meta.oracle as Record<string, unknown>)[key] = {
    league: L.pick.label,
    weeks: L.oracleWeeks,
    tolerance: TOLERANCE,
    compared: summary.compared,
    within: summary.within,
    rate: round2(summary.rate * 100),
    zeroZeroRows: summary.zeroZero,
    rateWithoutZeroZero: round2(summary.rateNonZero * 100),
    withoutAdjustments: { within: baseline.within, rate: round2(baseline.rate * 100) },
    adjustments: a.effects,
    byPos: summary.byPos,
    skipped: summary.skipped,
    verdicts: v,
    unmappedRuleEffects: explain.byRule,
    diffHistogram: hist,
    unexplainedDiffHistogram: diffHistogram(explain.explanations.filter((x) => x.verdict === "unexplained").map((x) => x.row)),
    mismatches: explain.explanations.map((x) => ({ week: x.row.week, player: x.row.name, pos: x.row.ffPos, fleaflicker: round2(x.row.actual), recomputed: x.row.computed, diff: x.row.diff, verdict: x.verdict, residual: x.residual, causes: x.causes.map((c) => ({ rule: c.rule, points: c.points, min: c.min, max: Number.isFinite(c.max) ? c.max : "unbounded", basis: c.basis })), stats: x.row.statLine, reason: x.row.reason })),
  };
}

function checkK(p: ProbeContext, L: LeagueData, analysis: OracleAnalysis | null, statsByWeek: Map<number, WeekStats>, sleeperBySr: Map<string, string>, docs: Docs | null): void {
  const boxes = [...L.boxscores.values()].flat();
  const first = boxes[0];
  const players = boxes.flatMap((f) => lineupPlayers(f.data));
  // viewingActualPoints: {value} = points, {formatted:"0"} = 0 (value omitted), {formatted:"—"} = did not play.
  const kinds = { points: 0, zero: 0, didNotPlay: 0, missing: 0 };
  for (const { lp } of players) {
    const v = lp.viewingActualPoints;
    if (!v) kinds.missing++;
    else if (typeof v.value === "number") kinds.points++;
    else if (Number.isFinite(Number(v.formatted))) kinds.zero++;
    else kinds.didNotPlay++;
  }
  p.cl.add(
    "K",
    "K.leaguePoints",
    "League-scored points, completed weeks",
    kinds.missing === 0 && players.length ? "ok" : "warn",
    `FetchLeagueBoxscore for weeks ${L.oracleWeeks.join(", ")} (${boxes.length} games), ${players.length} lineup entries (starters, bench, IR): ${kinds.points} with points (value), ${kinds.zero} scored 0 (formatted "0", value omitted), ${kinds.didNotPlay} did not play (formatted "—", no value)${kinds.missing ? `, ${kinds.missing} without the field` : ""}`,
    ev(first?.url, first?.res, "lineups[].group / lineups[].slots[].home|away.viewingActualPoints.value|.formatted", { ...kinds, sample: players[0] ? { player: players[0].lp.proPlayer.nameFull, points: fd(players[0].lp.viewingActualPoints) } : undefined }),
  );

  // Season-to-date league-scored totals (CLAUDE.md §6 actual_ppg and games played g).
  const rostered = [...L.teamRosters.values()].flatMap((f) => (f.data?.groups ?? []).flatMap((g) => (g.slots ?? []).map((s) => s.leaguePlayer).filter((x): x is FfLeaguePlayer => Boolean(x))));
  const withBoth = rostered.filter((x) => x.seasonTotal && x.seasonAverage);
  const derived = withBoth.map((x) => ({ x, g: fd(x.seasonAverage) ? fd(x.seasonTotal) / fd(x.seasonAverage) : 0 }));
  const integral = derived.filter((d) => d.g > 0 && Math.abs(d.g - Math.round(d.g)) < 0.02);
  const gDist: Record<string, number> = {};
  for (const d of integral) gDist[String(Math.round(d.g))] = (gDist[String(Math.round(d.g))] ?? 0) + 1;
  // Cross-check g with Sleeper's games played (gp) over the completed weeks. FetchRoster players carry
  // no external ids, so their Sportradar id comes from FetchLeagueRosters (external_id_type=SPORTRADAR).
  const srOf = new Map<number, string>();
  for (const q of (L.rosters?.data?.rosters ?? []).flatMap((r) => r.players ?? [])) {
    const sr = sportradarId(q.proPlayer);
    if (sr) srOf.set(q.proPlayer.id, sr);
  }
  const doneWeeks = L.completedWeeks.filter((w) => statsByWeek.has(w));
  let gpCompared = 0;
  let gpAgree = 0;
  if (doneWeeks.length === L.completedWeeks.length && doneWeeks.length) {
    for (const d of integral) {
      const sid = sleeperBySr.get(sportradarId(d.x.proPlayer) ?? srOf.get(d.x.proPlayer.id) ?? "");
      if (!sid) continue;
      gpCompared++;
      const gp = doneWeeks.reduce((n, w) => n + ((statsByWeek.get(w)?.bySleeperId.get(sid)?.gp ?? 0) > 0 ? 1 : 0), 0);
      if (gp === Math.round(d.g)) gpAgree++;
    }
  }
  const sample = withBoth.find((x) => x.proPlayer.position === "QB") ?? withBoth[0];
  p.cl.add(
    "K",
    "K.seasonTotals",
    "Season-to-date league-scored points",
    withBoth.length && gpCompared && gpAgree / gpCompared >= 0.95 ? "ok" : "warn",
    `FetchRoster leaguePlayer.seasonTotal / .seasonAverage (${docs ? (docs.facts.schemas.LeaguePlayer?.properties.includes("season_total") ? "documented in the LeaguePlayer schema" : "not in the docs' LeaguePlayer schema") : "docs not read"}): ${withBoth.length}/${rostered.length} rostered players carry both; games played g = total ÷ average is a whole number for ${integral.length} (g: ${Object.entries(gDist).map(([k, n]) => `${k}×${n}`).join(", ") || "none"}); ${gpCompared ? `g equals Sleeper's games played (weeks with gp, weeks ${doneWeeks.join(", ")}) for ${gpAgree}/${gpCompared}` : doneWeeks.length === L.completedWeeks.length ? "not cross-checked (no Sleeper id for these players)" : "not cross-checked (Sleeper stats for a completed week missing)"}. Candidate Fleaflicker source for CLAUDE.md §6 actual_ppg (= seasonAverage, league-scored) and g`,
    ev(L.teamRosters.values().next().value?.url, L.teamRosters.values().next().value?.res, "groups[].slots[].leaguePlayer.seasonTotal.value / .seasonAverage.value", sample ? { player: sample.proPlayer.nameFull, seasonTotal: fd(sample.seasonTotal), seasonAverage: round2(fd(sample.seasonAverage)) } : undefined),
  );

  const catsByPos = new Map<string, Set<string>>();
  let catchCount = 0;
  let caughtOfTargets = 0;
  for (const { lp } of players) {
    const s = catsByPos.get(lp.proPlayer.position ?? "?") ?? new Set<string>();
    for (const st of lp.viewingActualStats ?? []) {
      s.add(`${st.category.id}:${st.category.abbreviation ?? "?"}`);
      if (st.category.id === 41) catchCount++;
      if (/^\d+\/\d+$/.test(st.value?.formatted ?? "")) caughtOfTargets++;
    }
    catsByPos.set(lp.proPlayer.position ?? "?", s);
  }
  const perPos = [...catsByPos.values()].map((v) => v.size).filter((n) => n > 0);
  p.cl.warn(
    "K",
    "K.rawStats",
    "Raw stat lines",
    `box scores only carry ${Math.min(...perPos)}–${Math.max(...perPos)} display stats per position (${[...catsByPos.entries()].slice(0, 4).map(([k, v]) => `${k}: ${[...v].map((x) => x.split(":")[1]).join("/")}`).join("; ")}); receptions: ${catchCount} Catch (id 41) values, ${caughtOfTargets} "caught/targets" texts. Not enough to recompute points, so the oracle uses Sleeper's weekly stats via the Sportradar crosswalk`,
    ev(first?.url, first?.res, "lineups[].slots[].home.viewingActualStats[].category/.value", Object.fromEntries([...catsByPos.entries()].slice(0, 3).map(([k, v]) => [k, [...v]]))),
  );

  // Starters' points should add up to the team score.
  let sumOk = 0;
  let games = 0;
  for (const f of boxes) {
    const g = f.data?.game;
    if (!g) continue;
    games++;
    const lp = lineupPlayers(f.data).filter((x) => x.group === "START");
    const home = lp.filter((x) => x.side === "home").reduce((n, x) => n + fd(x.lp.viewingActualPoints), 0);
    const away = lp.filter((x) => x.side === "away").reduce((n, x) => n + fd(x.lp.viewingActualPoints), 0);
    if (Math.abs(home - fd(g.homeScore?.score)) < 0.05 && Math.abs(away - fd(g.awayScore?.score)) < 0.05) sumOk++;
  }
  p.cl.add("K", "K.lineupTotals", "Starters add up to the team score", sumOk === games && games ? "ok" : "warn", `${sumOk}/${games} games: Σ START-group player points = game score (both sides)`, ev(first?.url, first?.res, "lineups[group=START].slots[] vs game.homeScore.score", `${sumOk}/${games}`));

  reportOracle(p, L, analysis, "K.oraclePreview", "Scoring oracle preview (this league)");
}

async function checkL(p: ProbeContext, L: LeagueData, docs: Docs | null): Promise<void> {
  const players = (L.rosters?.data?.rosters ?? []).flatMap((r) => r.players ?? []);
  const byTeam = new Map<string, Set<number>>();
  for (const x of players) {
    const t = normTeam(x.proPlayer.proTeamAbbreviation);
    if (!t || x.proPlayer.nflByeWeek === undefined) continue;
    const s = byTeam.get(t) ?? new Set<number>();
    s.add(x.proPlayer.nflByeWeek);
    byTeam.set(t, s);
  }
  const consistent = [...byTeam.values()].every((s) => s.size === 1);
  p.cl.add("L", "L.byeWeeks", "Bye weeks", consistent && byTeam.size >= 30 ? "ok" : "warn", `proPlayer.nflByeWeek on every player: ${byTeam.size} NFL teams, ${consistent ? "one bye per team" : "CONFLICTING byes within a team"}`, ev(L.rosters?.url, L.rosters?.res, "rosters[].players[].proPlayer.nflByeWeek", Object.fromEntries([...byTeam.entries()].slice(0, 4).map(([k, v]) => [k, [...v]]))));
  try {
    const nv = await getNflverseByes(SEASON);
    let agree = 0;
    const disagree: string[] = [];
    for (const [team, weeks] of byTeam) {
      const nvByes = nv.byes.get(team);
      if (nvByes && nvByes.length === 1 && weeks.has(nvByes[0] as number)) agree++;
      else disagree.push(`${team}: fleaflicker ${[...weeks].join("/")} vs nflverse ${(nvByes ?? []).join("/") || "?"}`);
    }
    p.cl.add("L", "L.byeCrossCheck", "Byes vs nflverse", disagree.length ? "warn" : "ok", `${agree}/${byTeam.size} teams agree with nflverse games.csv (${nv.games} regular-season games)${disagree.length ? `; differ: ${disagree.slice(0, 5).join("; ")}` : ""}`, ev("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv", nv.res, "season/game_type/week/home_team/away_team", `${agree}/${byTeam.size}`));
  } catch (err) {
    p.cl.warn("L", "L.byeCrossCheck", "Byes vs nflverse", `nflverse games.csv not available: ${err instanceof Error ? err.message : String(err)}`, ev(undefined, null));
  }
  const games = [...L.teamRosters.values()].flatMap((f) => (f.data?.groups ?? []).flatMap((g) => (g.slots ?? []).map((s) => (s.leaguePlayer as { requestedGames?: Array<{ game?: unknown }> } | undefined)?.requestedGames ?? []))).flat();
  const scheduleLike = docs ? docs.facts.paths.filter((x) => /schedule|progame|nfl/i.test(x)) : [];
  p.cl.warn(
    "L",
    "L.nflSchedule",
    "NFL schedule",
    `${docs ? `none of the ${docs.facts.paths.length} documented paths is an NFL schedule${scheduleLike.length ? ` (schedule-like: ${scheduleLike.join(", ")})` : ""}` : "docs not read: endpoint list unverified"}; FetchRoster gives each player's own game for the requested week (${games.filter((g) => g.game).length} requestedGames[].game entries this week). Use the shared nflverse / ESPN proTeamSchedules sources (probe:shared)`,
    ev(apiUrl("FetchRoster", { league_id: "{leagueId}", team_id: "{teamId}", scoring_period: "{week}" }), null, "groups[].slots[].leaguePlayer.requestedGames[].game.home/.away/.startTimeEpochMilli"),
    ...(docs ? [ev(DOCS_URL, docs.res, "#path--…", docs.facts.paths)] : []),
  );
}

interface FormatNote {
  /** Target rates by model position (points per target) when the league scores targets. */
  targetRates: Record<string, number>;
  /** Catch rate (receptions ÷ targets) of this league's rostered players in Sleeper's completed-week stats. */
  catchRates: Record<string, { rec: number; tgt: number }>;
  ppr: number;
  numQbs: number;
  /** Per FantasyCalc list: rostered QB/RB/WR/TE found by sleeperId, of how many, among how many entries. */
  lists: Partial<Record<"redraft" | "dynasty", { found: number; total: number; entries: number }>>;
}

async function checkM(p: ProbeContext, L: LeagueData, conv: ConvertedScoring, leagueType: string, sleeperBySr: Map<string, string>, statsByWeek: Map<number, WeekStats>): Promise<FormatNote> {
  const players = (L.rosters?.data?.rosters ?? []).flatMap((r) => r.players ?? []);
  // Skill players by their first position: a dual "WR/CB" player counts as a WR.
  const skillPos = (x: FfLeaguePlayer) => {
    const pos = mapPos(x.proPlayer.position);
    return pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE" ? pos : null;
  };
  const skill = players.filter((x) => skillPos(x));
  const rostered: RosteredPlayer[] = skill.map((x) => ({ id: String(x.proPlayer.id), name: x.proPlayer.nameFull ?? String(x.proPlayer.id), pos: skillPos(x) ?? "?" }));
  const lineup = summarizeLineup(L.rules.data?.rosterPositions ?? []);
  const qbSlots = lineup.lineup.filter((x) => x.eligible.includes("QB")).reduce((n, x) => n + x.count, 0);
  const recRate = conv.perStat.rec ?? 0;
  const base = { numQbs: (qbSlots >= 2 ? 2 : 1) as 1 | 2, numTeams: nearest(FC_TEAM_SIZES, L.teamIds.length), ppr: nearest([0, 0.5, 1] as const, recRate) };
  const ourSleeper = new Map(skill.map((x) => [String(x.proPlayer.id), sleeperBySr.get(sportradarId(x.proPlayer) ?? "")]));

  // Target-based reception scoring has no FantasyCalc ppr/tep equivalent: measure the catch rate.
  const note: FormatNote = { targetRates: {}, catchRates: {}, ppr: base.ppr, numQbs: base.numQbs, lists: {} };
  for (const pos of ["RB", "WR", "TE"] as const) {
    const t = conv.byPosition[pos]?.rec_tgt ?? conv.perStat.rec_tgt;
    if (t) note.targetRates[pos] = round6(t);
  }
  if (Object.keys(note.targetRates).length) {
    for (const x of skill) {
      const pos = skillPos(x);
      const sid = ourSleeper.get(String(x.proPlayer.id));
      if (!pos || pos === "QB" || !sid) continue;
      const c = (note.catchRates[pos] ??= { rec: 0, tgt: 0 });
      for (const w of L.completedWeeks) {
        const s = statsByWeek.get(w)?.bySleeperId.get(sid);
        c.rec += s?.rec ?? 0;
        c.tgt += s?.rec_tgt ?? 0;
      }
    }
  }

  // Which list matters (CLAUDE.md §9/§11): redraft values for perception and acceptance g in redraft
  // and keeper leagues; dynasty values for future value in keeper and dynasty leagues (and g in dynasty).
  const role = (kind: "redraft" | "dynasty") =>
    kind === "redraft"
      ? leagueType === "dynasty"
        ? "not used in a dynasty league"
        : `used for trade perception and the acceptance feature g in ${leagueType} leagues (CLAUDE.md §9, §11)`
      : leagueType === "redraft"
        ? "not used in a redraft league"
        : `used for future value (B_future)${leagueType === "dynasty" ? " and g" : ""} in ${leagueType} leagues (CLAUDE.md §9, §10)`;
  let agree = 0;
  let disagree = 0;
  const disagreeNames: string[] = [];
  /** In FantasyCalc (by sleeperId) but not found by fleaflickerId: a real id gap in FantasyCalc. */
  const idGaps = new Set<string>();
  for (const kind of ["redraft", "dynasty"] as const) {
    const format: FcFormat = { isDynasty: kind === "dynasty", ...base };
    try {
      const { data: fc, res } = await getFantasyCalc(format);
      const byFf = matchRate(rostered, fc, "fleaflickerId");
      const fcSleeper = new Set(fc.map((e) => e.player.sleeperId).filter(Boolean).map(String));
      const found = skill.filter((x) => fcSleeper.has(ourSleeper.get(String(x.proPlayer.id)) ?? ""));
      const misses = skill.filter((x) => !fcSleeper.has(ourSleeper.get(String(x.proPlayer.id)) ?? ""));
      const noSleeperId = misses.filter((x) => !ourSleeper.get(String(x.proPlayer.id))).length;
      const missFf = new Set(byFf.misses.map((x) => x.id));
      for (const x of found) if (missFf.has(String(x.proPlayer.id))) idGaps.add(x.proPlayer.nameFull ?? String(x.proPlayer.id));
      const rate = skill.length ? found.length / skill.length : 0;
      const used = !role(kind).startsWith("not used");
      note.lists[kind] = { found: found.length, total: skill.length, entries: fc.length };
      p.cl.add(
        "M",
        `M.${kind}`,
        `FantasyCalc match rate (${kind} values)`,
        rate >= 0.98 ? "ok" : "warn",
        `${found.length}/${skill.length} rostered QB/RB/WR/TE (${pct(found.length, skill.length)}) found among ${fc.length} FantasyCalc entries by sleeperId through the Sportradar crosswalk — the canonical id path (target ≥ 98%). Cross-check by FantasyCalc's fleaflickerId: ${byFf.matched}/${byFf.eligible}. This list is ${role(kind)}.${used && rate < 0.98 ? ` ${misses.length} rostered skill players are not in it and would get the value floor (FantasyCalc's ${kind} list has only ${fc.length} entries).` : ""} Misses${misses.length > 15 ? " (first 15)" : ""}: ${misses.slice(0, 15).map((x) => `${x.proPlayer.nameFull} (${x.proPlayer.position})`).join(", ") || "none"}${noSleeperId ? `; ${noSleeperId} of them have no Sleeper id` : ""}`,
        ev(fantasyCalcUrl(format), res, "[].player.sleeperId (and .fleaflickerId)", { fcEntries: fc.length, rostered: skill.length, bySleeperId: found.length, byFleaflickerId: byFf.matched }),
      );
      for (const e of fc) {
        const ff = e.player.fleaflickerId;
        const ours = ff === null || ff === undefined ? undefined : ourSleeper.get(String(ff));
        if (!ours || !e.player.sleeperId) continue;
        if (String(e.player.sleeperId) === ours) agree++;
        else {
          disagree++;
          disagreeNames.push(e.player.name);
        }
      }
    } catch (err) {
      p.cl.fail("M", `M.${kind}`, `FantasyCalc match rate (${kind})`, `FantasyCalc unavailable: ${err instanceof Error ? err.message : String(err)}`, ev(fantasyCalcUrl(format), null));
    }
  }
  p.cl.add(
    "M",
    "M.idIntegrity",
    "FantasyCalc ids agree with the crosswalk",
    disagree || idGaps.size ? "warn" : "ok",
    `${agree} FantasyCalc entries (both lists) whose fleaflickerId is a rostered player carry the same sleeperId as the Sportradar crosswalk; ${disagree} disagree${disagreeNames.length ? ` (${[...new Set(disagreeNames)].slice(0, 8).join(", ")})` : ""}. Rostered players FantasyCalc lists by sleeperId but not by fleaflickerId: ${idGaps.size}${idGaps.size ? ` (${[...idGaps].slice(0, 8).join(", ")}) — so match by sleeperId, not fleaflickerId` : ""}`,
    ev(undefined, null, "[].player.fleaflickerId vs [].player.sleeperId", { agree, disagree, idGaps: idGaps.size }),
  );
  const cr = Object.entries(note.catchRates).filter(([, c]) => c.tgt > 0);
  p.cl.add(
    "M",
    "M.format",
    "FantasyCalc format for this league",
    Object.keys(note.targetRates).length ? "warn" : "ok",
    `requested numQbs=${base.numQbs} (${qbSlots} QB-eligible starting slots), numTeams=${base.numTeams}, ppr=${base.ppr} (reception rate ${recRate}), no tep.${Object.keys(note.targetRates).length ? ` The league scores TARGETS instead (${Object.entries(note.targetRates).map(([k, v]) => `${k} ${v}`).join(", ")} per target); FantasyCalc has no target-based format. At this league's rostered players' catch rates (${cr.map(([k, c]) => `${k} ${pct(c.rec, c.tgt)}`).join(", ") || "n/a"}, weeks ${L.completedWeeks.join(", ")}) that is about ${cr.map(([k, c]) => `${k} ${round2((note.targetRates[k] ?? 0) / (c.rec / c.tgt))}`).join(", ")} points per reception — a strong TE premium. Mapping to ppr/tep is a planner question` : ""}`,
    ev(undefined, null, "FetchLeagueRules → perStat.rec / byPosition.*.rec_tgt; Sleeper stats rec, rec_tgt", { targetRates: note.targetRates, catchRates: note.catchRates }),
  );
  return note;
}

interface CoverageResult {
  /** Other public leagues read (rules). */
  leagues: number;
  rules: number;
  categories: number;
  counts: Record<string, number>;
  unmappedCategories: string[];
  unknown: Array<{ id: number; name: string; abbreviation: string }>;
  /** D/ST: leagues whose rules list D/ST in applyTo, those rules and their mapping statuses. */
  dst: { leagues: number; rules: number; counts: Record<string, number> };
  /** FetchLeagueStandings?season=<this season> of the same leagues (aggregates only). */
  screens: Array<{ screen: Screen; url: string; status: number | undefined }>;
}

/**
 * Rules of other public leagues (coverage of the mapping table) and their standings screen (to see
 * what the API returns for leagues not active this season). Identities go to the watch list only.
 */
async function ruleCoverage(p: ProbeContext, ids: FleaIdentities, exclude: string[], salt: string, watch: WatchList): Promise<CoverageResult> {
  const out: CoverageResult = { leagues: 0, rules: 0, categories: 0, counts: {}, unmappedCategories: [], unknown: [], dst: { leagues: 0, rules: 0, counts: {} }, screens: [] };
  const cats = new Set<number>();
  const unmapped = new Map<string, number>();
  for (const id of coverageCandidates(exclude, salt).slice(0, COVERAGE_LEAGUES)) {
    ids.transientLeagueId(id);
    const f = await new FfClient(p, ids, id, "coverage").get<FfRules>("FetchLeagueRules", {}, rulesSchema, { sweep: false });
    const { screen, fetched } = await screenLeague(p, ids, id, SEASON);
    watch.addStandings(fetched.data, id);
    out.screens.push({ screen, url: fetched.url, status: fetched.res?.status });
    if (!f.data) continue;
    out.leagues++;
    const { mappings } = convertRules(f.data.groups);
    const dstRules = mappings.filter((m) => m.positions.includes("DEF"));
    if (dstRules.length) {
      out.dst.leagues++;
      out.dst.rules += dstRules.length;
      for (const m of dstRules) out.dst.counts[m.status] = (out.dst.counts[m.status] ?? 0) + 1;
    }
    for (const m of mappings) {
      out.rules++;
      cats.add(m.categoryId);
      out.counts[m.status] = (out.counts[m.status] ?? 0) + 1;
      const k = `${m.category}: ${m.notes.at(-1) ?? ""}`;
      if (m.status === "unmapped") unmapped.set(k, (unmapped.get(k) ?? 0) + 1);
    }
    for (const g of f.data.groups)
      for (const r of g.scoringRules ?? []) {
        if (FF_CATEGORY_IDS.has(r.category.id) || out.unknown.some((u) => u.id === r.category.id)) continue;
        out.unknown.push({ id: r.category.id, name: r.category.nameSingular ?? "?", abbreviation: r.category.abbreviation ?? "?" });
      }
  }
  out.categories = cats.size;
  out.unmappedCategories = [...unmapped.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`);
  out.unknown.sort((a, b) => a.id - b.id);
  return out;
}

/** What FetchLeagueStandings returns for public leagues that are not active this season (screens only). */
function checkInactive(p: ProbeContext, coverage: CoverageResult): void {
  const screens = coverage.screens;
  const answered = screens.filter((s) => s.status === 200);
  const inactive = answered.filter((s) => !s.screen.active);
  const url = apiUrl("FetchLeagueStandings", { league_id: "{otherLeagueId}", season: SEASON });
  if (!inactive.length) {
    p.cl.na("A", "A.inactiveLeague", "League not active this season", `not tested: none of the ${answered.length} other public leagues screened this run is inactive for ${SEASON}, so the inactive-league behaviour is not verified in this run`, { url, status: answered.length ? 200 : undefined, path: "league.activeForCurrentSeason", sample: answered.length });
    return;
  }
  const seasons = [...new Set(inactive.map((s) => s.screen.season ?? "(omitted)"))];
  const games = inactive.map((s) => s.screen.maxGames);
  const post = inactive.filter((s) => s.screen.postseasonTeams > 0).length;
  p.cl.warn(
    "A",
    "A.inactiveLeague",
    "League not active this season",
    `${inactive.length} of ${answered.length} other public leagues screened are not active for ${SEASON} (league.activeForCurrentSeason omitted = false). FetchLeagueStandings?season=${SEASON} still answers HTTP 200 with season = ${seasons.join("/")} and teams with up to ${Math.min(...games) === Math.max(...games) ? Math.max(...games) : `${Math.min(...games)}–${Math.max(...games)}`} decided games${post ? ` (${post} of those leagues with postseason records)` : ""} — last season's final standings, not ${SEASON}'s. Adapter: check activeForCurrentSeason and show a clear error`,
    { url, status: 200, path: "league.activeForCurrentSeason / season / divisions[].teams[].recordOverall / .recordPostseason", sample: { inactive: inactive.length, screened: answered.length, season: seasons, maxDecidedGames: games, withPostseason: post } },
  );
}

const SANITIZED_DIR = path.join(ROOT, "fixtures", "sanitized", "fleaflicker");

/** Remove sanitized files (and index entries) this run didn't write. Returns how many. */
async function pruneStaleFixtures(saved: ReadonlySet<string>): Promise<number> {
  const indexPath = path.join(SANITIZED_DIR, "index.json");
  let index: Record<string, unknown>;
  try {
    index = JSON.parse(readFileSync(indexPath, "utf8")) as Record<string, unknown>;
  } catch {
    return 0;
  }
  let removed = 0;
  for (const file of Object.keys(index)) {
    if (saved.has(file)) continue;
    rmSync(path.join(SANITIZED_DIR, file), { force: true });
    delete index[file];
    removed++;
  }
  if (removed) await writeFileAtomic(indexPath, JSON.stringify(index, null, 2) + "\n");
  return removed;
}

function inferLeagueType(L: LeagueData): string {
  const lg = L.standings.data?.league;
  const keepers = num(lg?.maxKeepers);
  const roster = num(lg?.rosterRequirements?.rosterSize) || num(L.rules.data?.maxActive);
  if (keepers === 0) return "redraft";
  return roster > 0 && keepers >= roster ? "dynasty" : "keeper";
}

function inferReview(L: LeagueData): string {
  const vetoes = Math.max(0, ...L.tradesDone.flatMap((f) => (f.data?.trades ?? []).map((t) => num(t.numVetoesRequired))));
  const review = L.html?.rules?.tradeReviewPeriod ?? "";
  if (vetoes > 0) return "league_vote";
  if (/no vetoes/i.test(review) || review) return "commissioner";
  return "none";
}

// ------------------------------------------------------------------------------------------------

/** Sleeper rows by kind: numeric ids are players, TEAM_* team totals, other codes team D/ST. */
function rowKind(id: string): "player" | "team" | "def" {
  return /^\d+$/.test(id) ? "player" : id.startsWith("TEAM_") ? "team" : "def";
}

/** Which Sleeper row kinds carry each return-TD key (evidence for the st_td mapping). */
function returnTdEvidence(statsByWeek: Map<number, WeekStats>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const ws of statsByWeek.values())
    for (const [id, s] of ws.bySleeperId)
      for (const k of ["st_td", "kr_td", "pr_td", "def_st_td"])
        if ((s[k] ?? 0) > 0) {
          const kind = rowKind(id);
          (out[k] ??= {})[kind] = (out[k]?.[kind] ?? 0) + 1;
        }
  return out;
}

/**
 * How Sleeper's keys relate, from every player row: rec_fd vs rec_td on rows with a receiving TD
 * (a TD catch is a first down, so rec_fd < rec_td means rec_fd leaves TD catches out), and whether
 * special-teams keys come with their idp_* twin (st_ff always with idp_ff = included in it).
 */
function firstDownEvidence(statsByWeek: Map<number, WeekStats>): FirstDownEvidence {
  const out: FirstDownEvidence = { weeks: [...statsByWeek.keys()].sort((a, b) => a - b), tdRows: 0, fdBelowTd: 0, st: { ff: [0, 0], fumRec: [0, 0], tklSolo: [0, 0] } };
  for (const ws of statsByWeek.values())
    for (const [id, s] of ws.bySleeperId) {
      if (rowKind(id) !== "player") continue;
      for (const [k, st, idp] of [["ff", "st_ff", "idp_ff"], ["fumRec", "st_fum_rec", "idp_fum_rec"], ["tklSolo", "st_tkl_solo", "idp_tkl_solo"]] as const) {
        if (!(s[st] ?? 0)) continue;
        out.st[k][0]++;
        if (s[idp] ?? 0) out.st[k][1]++;
      }
      if (!(s.rec_td ?? 0)) continue;
      out.tdRows++;
      if ((s.rec_fd ?? 0) < (s.rec_td ?? 0)) out.fdBelowTd++;
    }
  return out;
}

/** A generic, placeholder-free description of a league (no directory-visible qualifiers). */
function describeLeague(L: LeagueData, leagueType: string): string {
  const teams = teamsOf(L.standings.data).length;
  const divs = (L.standings.data?.divisions ?? []).length;
  return `${teams}-team ${leagueType} league${divs > 1 ? ` in ${divs} divisions` : ""}, in season (week ${L.currentWeek})`;
}

async function loadStats(p: ProbeContext, weeks: Iterable<number>, into: Map<number, WeekStats>): Promise<void> {
  for (const w of [...new Set(weeks)].sort((a, b) => a - b)) {
    if (into.has(w)) continue;
    try {
      into.set(w, await p.timed("Sleeper weekly stats", () => getSleeperWeekStats(SEASON, w)));
    } catch (err) {
      p.cl.issue(`Sleeper weekly stats for week ${w} unavailable (${err instanceof Error ? err.message : String(err)}); checks that need them are skipped for that week.`);
    }
  }
}

interface FindingsInput {
  L: LeagueData;
  O: LeagueData | null;
  conv: { scoring: ConvertedScoring; mappings: RuleMapping[] };
  leagueType: string;
  analysis: OracleAnalysis | null;
  coverage: CoverageResult;
  dp: DpCrosswalk | null;
  format: FormatNote;
  statsByWeek: Map<number, WeekStats>;
  fdEvidence: FirstDownEvidence;
  docs: Docs | null;
}

/** Issues (spec deviations with evidence and options), decisions and questions — all from this run's data. */
function reportFindings(p: ProbeContext, x: FindingsInput): void {
  const { L, O, conv, leagueType, analysis, coverage, dp, format, statsByWeek, fdEvidence, docs } = x;
  const html = L.html?.rules;
  const rulesUrl = webUrl("{leagueId}", "rules");
  const lg = L.standings.data?.league;
  const lineup = summarizeLineup(L.rules.data?.rosterPositions ?? []);
  const teams = teamsOf(L.standings.data);
  const rosterPlayers = (L.rosters?.data?.rosters ?? []).flatMap((r) => r.players ?? []);
  const rostered = [...L.teamRosters.values()].flatMap((f) => (f.data?.groups ?? []).flatMap((g) => (g.slots ?? []).map((s) => s.leaguePlayer).filter((v): v is FfLeaguePlayer => Boolean(v))));
  const punters = rostered.filter((v) => v.proPlayer.position === "P");
  const puntersProjected = punters.filter((v) => v.viewingProjectedPoints?.value !== undefined || v.viewingProjectedPoints?.formatted !== undefined).length;
  const futPlayers = (L.futureRoster?.data?.groups ?? []).flatMap((g) => (g.slots ?? []).map((s) => s.leaguePlayer).filter((v): v is FfLeaguePlayer => Boolean(v)));
  const futProj = futPlayers.filter((v) => v.viewingProjectedPoints?.value !== undefined).length;
  const counts = mappingCounts(conv.mappings);
  const effects = (analysis?.effects ?? []).filter((e) => e.rules > 0);
  const v = analysis?.explain.verdicts;
  const trades = L.tradesDone.flatMap((f) => f.data?.trades ?? []);
  const adds = verifyOmittedTypeIsAdd(L);
  const picks = dedupePicks([...L.picks.entries()].map(([teamId, f]) => ({ teamId, picks: f.data?.picks ?? [] })));
  const pickMatch = matchTradedPicks(picks.distinct, trades);
  const rt = returnTdEvidence(statsByWeek);
  const kinds = (k: string) => Object.entries(rt[k] ?? {}).map(([kind, n]) => `${n} ${kind}`).join(", ") || "no";
  const eligibility = lg?.rosterRequirements?.eligibility ?? [];
  const applyAll = (L.rules.data?.groups ?? []).flatMap((g) => g.scoringRules ?? []).filter((r) => r.applyToAll);
  const applyAllEqElig = applyAll.filter((r) => [...(r.applyTo ?? [])].sort().join(",") === [...eligibility].sort().join(",")).length;
  const inactive = coverage.screens.filter((s) => s.status === 200 && !s.screen.active);
  const pSlots = lineup.unmappedEligibility.map((u) => u.slot);

  // --- Spec deviations and platform traps (CLAUDE.md §0.3: evidence + options) ---
  p.cl.issue(
    `Settings missing from Fleaflicker's JSON API although CLAUDE.md §2.1 says Fleaflicker has everything we need: playoff teams, start week and byes; trade deadline; trade review period; tiebreakers; division-winner seeding; roster-minimum enforcement — evidence: FetchLeagueRules / FetchLeagueStandings have no such fields (league.hasPlayoffs is ${lg?.hasPlayoffs === undefined ? "omitted, i.e. false under proto3, although this league has playoffs" : String(lg.hasPlayoffs)}); the public HTML rules page (${rulesUrl}, HTTP ${L.html?.res?.status ?? "?"}) shows "${html?.playoffText ?? "no playoff line"}", Trading Deadline ${html?.tradingDeadline ? `"${html.tradingDeadline}"` : "not shown"}, review "${html?.tradeReviewPeriod ?? "?"}", ${html?.gameTiebreakers?.length ?? 0} game and ${html?.rankTiebreakers?.length ?? 0} rank tiebreakers, division winners ranked higher = ${html?.divisionWinnersRankedHigher ?? "?"}, enforce roster minimums = ${html?.enforceRosterMinimums ?? "?"}. Options: (a) parse the public rules page in the adapter (one request, fragile if the page changes); (b) infer the regular season from the schedule and ask the user to confirm the rest in the Import Report; (c) both: parse, then show for confirmation.`,
  );
  p.cl.issue(
    `Fleaflicker projects only the current week, and ${puntersProjected ? "not every punter" : "no punter in this league"} — evidence: FetchRoster?scoring_period=${L.currentWeek + 1} → ${futProj}/${futPlayers.length} players with viewingProjectedPoints; scoring_period=${L.currentWeek}: ${puntersProjected}/${punters.length} punters projected; viewingProjectedStats has only a few display stats per position. Options: Sleeper projections × league scoring for every week (the CLAUDE.md §6 path for "all others"), optionally blending Fleaflicker's league-scored current-week number as for ESPN; punters from Sleeper or at the value floor.`,
  );
  p.cl.issue(
    `Box scores carry league-scored points but only a few display stats per position, so the §5 oracle needs another stat source — evidence: FetchLeagueBoxscore lineups[].slots[].home.viewingActualStats (K.rawStats). Options: oracle against Sleeper weekly stats via the Sportradar crosswalk (done here: ${analysis ? `${pct(analysis.summary.within, analysis.summary.compared)} within 0.05 pts` : "not run"}); or FetchScoringBreakdown, which ${docs ? (docs.facts.definitions.some((d) => d.startsWith("FetchScoringBreakdown")) ? `has a response schema in the API docs but ${docs.facts.paths.includes("FetchScoringBreakdown") ? "also a documented path" : "no documented path"}` : "is not in the API docs") : "is unverified (docs not read)"} (not called).`,
  );
  p.cl.issue(
    `Paging and transaction weeks — evidence (API.resultTotal, G.addDropCounts): ${resultTotalText(L, docs)}; transactions carry ${transactionKeys(L).weekLike.length ? `week-like keys (${transactionKeys(L).weekLike.join(", ")})` : "no week or period field (timeEpochMilli only)"}. Options: page with resultOffsetNext until it is missing or items are older than needed; derive the week from timeEpochMilli and eligibleSchedulePeriods[].low.startEpochMilli.`,
  );
  if (inactive.length) {
    p.cl.issue(
      `A league not active for ${SEASON} still answers FetchLeagueStandings?season=${SEASON} with HTTP 200 and last season's final standings — evidence: ${inactive.length} of ${coverage.screens.filter((s) => s.status === 200).length} other public leagues screened this run (A.inactiveLeague: season = ${[...new Set(inactive.map((s) => s.screen.season))].join("/")}, up to ${Math.max(...inactive.map((s) => s.screen.maxGames))} decided games, ${inactive.filter((s) => s.screen.postseasonTeams > 0).length} with postseason records). Option: check league.activeForCurrentSeason (omitted = false) and show a clear error.`,
    );
  }
  if (effects.length) {
    p.cl.issue(
      `Fleaflicker stat definitions differ from the Sleeper keys of the same name (so a plain key-to-key scoring map is wrong) — evidence (scoring oracle, weeks ${L.oracleWeeks.join(", ")}): ${effects.map((e) => `${e.label}: ${effectText(e)}`).join("; ")}; Sleeper's rec_fd < rec_td on ${fdEvidence.fdBelowTd}/${fdEvidence.tdRows} player rows with a receiving TD; ${stEvidenceText(fdEvidence)}. Options: keep these definition adjustments in the Fleaflicker scoring map and cover them with adapter oracle tests (done in this probe's converter, switchable); or report such rules as unmapped.`,
    );
  }
  const unm = conv.mappings.filter((m) => m.status === "unmapped" || m.status === "partial");
  if (unm.length) {
    p.cl.issue(
      `${unm.length} scoring rule(s) in the test league can't be expressed exactly with Sleeper keys (${counts.unmapped} unmapped, ${counts.partial} partial; C.unmapped lists them all), e.g. ${unm.slice(0, 3).map((m) => `"${m.description}"`).join("; ")}. Oracle: ${v ? `${v.explained} mismatches explained exactly by them (lengths pinned by *_td_lng, fgm_lng/fgm_yds, pass_lng), ${v.consistent} consistent only with rules Sleeper's stats can't resolve, ${v.unexplained} unexplained` : "not run"}. Options: keep them in scoring.unmapped (shown in the Import Report) and accept the error; or add length-band rules evaluated from Sleeper's *_td_lng / fgm_lng / fgm_yds when those pin the event down (a rule type outside the linear Scoring model).`,
    );
  }
  p.cl.issue(
    `Sleeper stores an individual's kick/punt return TD as st_td and a team D/ST's as def_st_td — evidence (Sleeper weekly stats, weeks ${[...statsByWeek.keys()].sort().join(", ")}): st_td on ${kinds("st_td")} rows; pr_td on ${kinds("pr_td")} rows; kr_td on ${kinds("kr_td")} rows; def_st_td on ${kinds("def_st_td")} rows. Fleaflicker scores KR and PR TDs separately. Option (used): map both to st_td only when both rules exist with the same points and positions (added once); otherwise report them unmapped.`,
  );
  const tiers = conv.mappings.filter((m) => m.status === "tier").length;
  const composite = conv.mappings.filter((m) => m.keys.some((k) => k.includes("+")));
  const perGame = conv.mappings.filter((m) => m.keys.includes("gp"));
  p.cl.issue(
    `Scoring.bonuses (CLAUDE.md §4) has only a threshold (≥). This league needs ${tiers} bounded or ≤-only tiers (e.g. "between 400 and 499"), ${composite.length} bonus(es) on a sum of keys (${composite.map((m) => m.keys.join(", ")).join("; ") || "none"}) and ${perGame.length} per-game constant(s) (gp ≥ 1). Options: add an optional max (and no lower bound) and composite stats to bonuses — what this probe's converter uses; or split bounded tiers on whole-number stats into two thresholds (+p at lo, −p at hi+1).`,
  );
  p.cl.issue(
    `CLAUDE.md §2.5 says Fleaflicker omits fields whose value is zero; the live JSON follows proto3 and also omits false booleans and each enum's first value — evidence: rosterPositions[label=BN] has no group (= BENCH), ${adds.checked} adds have no transaction type (= TRANSACTION_ADD; ${adds.onTeam}/${adds.checked} of those players are on that team now), league.type ${lg?.type === undefined ? "omitted (= FP_H2H)" : "present"}, league.waiverType ${lg?.waiverType === undefined ? "omitted (= PRIORITY)" : "present"}${docs ? `; the API docs mark ${Object.values(ENUM_DEFAULTS).filter((d) => docs.facts.enumDefaults.has(d)).length}/${Object.values(ENUM_DEFAULTS).length} of those enum defaults as defaults` : ""}. Trap: league.hasPlayoffs is omitted (false) although the league has playoffs. Option: read every missing field as its proto3 default, except hasPlayoffs (take playoffs from the rules page or the user).`,
  );
  if (docs) {
    const camel = lg ? Object.keys(lg).filter((k) => /[A-Z]/.test(k)) : [];
    const snakeOnly = camel.filter((k) => docs.facts.properties.has(snakeOf(k)) && !docs.facts.properties.has(k));
    p.cl.issue(`Fleaflicker's API docs name fields in snake_case; the live API returns camelCase — evidence: ${snakeOnly.length}/${camel.length} live league keys appear in the docs only as ${snakeOnly.slice(0, 4).map(snakeOf).join(", ")}… (API.keyCase). Option: code the adapter against the live camelCase names, validated with zod.`);
  }
  if (L.displayWeek !== L.currentWeek) {
    p.cl.issue(
      `The current week is the schedule period with containsNow (week ${L.currentWeek}); FetchLeagueScoreboard's default schedulePeriod still shows week ${L.displayWeek} — evidence: A.currentWeek. Option: always take eligibleSchedulePeriods[].containsNow, never schedulePeriod.`,
    );
  }
  p.cl.issue(
    `FetchLeagueRosters has no lineup slot or roster group, so starters/bench/IR/taxi need one FetchRoster call per team (${L.teamIds.length} calls here) — evidence: E.slotGroups. Option: one FetchRoster per team per import, cached with the league data (10 min).`,
  );
  if (dp) {
    p.cl.issue(
      `The CLAUDE.md §2.9 DynastyProcess map is not usable for Fleaflicker ids: ${dp.rowsWithBoth} rows have both fleaflicker_id and sleeper_id, finding ${dp.foundByFleaflickerId}/${dp.rostered} rostered players; external_id_type=SPORTRADAR matches ${rosterPlayers.filter((q) => sportradarId(q.proPlayer)).length}/${rosterPlayers.length} to Sleeper's sportradar_id — evidence: E.crosswalk. Option (used): crosswalk through Sportradar ids.`,
    );
  }
  if (pSlots.length || punters.length) {
    p.cl.issue(
      `Fleaflicker leagues can start punters (this league: ${pSlots.join(", ") || "no P slot"}; ${rosterPlayers.filter((q) => q.proPlayer.position === "P").length} punters rostered) but CLAUDE.md §4 Pos has no P, and Fleaflicker projects no punter (${puntersProjected}/${punters.length}) — evidence: B.unmappedSlots, E.positions, J.currentWeek. Options: add 'P' to Pos (the scoring map already maps punting keys); or treat punters as unmapped (value floor, P slots left empty).`,
    );
  }
  if (Object.keys(lineup.positionMinimums).length || lineup.mergedLimits.length) {
    p.cl.issue(
      `Roster limits the model can't hold: minimums ${Object.entries(lineup.positionMinimums).map(([k, n]) => `${k} ${n}`).join(", ") || "none"} (enforced: ${html?.enforceRosterMinimums === undefined ? "not stated" : html.enforceRosterMinimums ? "Yes" : "No"}), and separate maxima ${lineup.mergedLimits.map((m) => `${m.labels.map((l) => `${l} ${lineup.labelLimits[l]}`).join(" + ")} → ${m.pos}`).join("; ")} merged into one model position — evidence: B.positionLimits; LeagueSettings (CLAUDE.md §4) has positionLimits by model Pos only and no minimums. Options: add positionMinimums and per-label limits to LeagueSettings so §7 trade legality can enforce them; or ignore minimums and warn on the trade card.`,
    );
  }
  if (picks.lostCopies) {
    p.cl.issue(
      `FetchTeamPicks lists each traded pick under both teams (the original owner's copy has lost=true): ${picks.entries} entries for ${picks.distinct.length} distinct picks, ${picks.distinct.filter((q) => q.traded).length} traded (${pickMatch.matched}/${pickMatch.traded} match completed trades) — evidence: I.futurePicks, I.tradedPicks. Option (implemented in scripts/lib/fleaflicker/picks.ts for the adapter): dedupe on (season, round, originalOwner ?? ownedBy) and take the owner from the copy without lost.`,
    );
  }
  if (L.faMismatch.size) {
    p.cl.issue(
      `FetchPlayerListing ignored filter.position_eligibility for ${[...L.faMismatch.keys()].join(", ")} (a position not in this league's eligibility ${JSON.stringify(eligibility)}): it returned other positions (${[...L.faMismatch.values()].map((o) => Object.entries(o).map(([k, n]) => `${k} ${n}`).join(", ")).join("; ")}) — evidence: H.freeAgents. Options: request only positions in league.rosterRequirements.eligibility, and check each returned player's position.`,
    );
  }
  if (applyAll.length) {
    p.cl.issue(
      `Scoring rules with applyToAll=true still carry applyTo, and it equals the league's eligible positions (${applyAllEqElig}/${applyAll.length} rules here; eligibility ${JSON.stringify(eligibility)}): D/ST is left out when the league can't start one, and ${coverage.dst.leagues} of ${coverage.leagues} other public leagues list D/ST in applyTo explicitly — evidence: C.dst. Option (used): take positions from applyTo; treat applyToAll as informational.`,
    );
  }
  const red = format.lists.redraft;
  if (leagueType === "keeper" && red && red.total && red.found / red.total < 0.98) {
    p.cl.issue(
      `Keeper leagues use redraft values for trade perception and the acceptance feature g (CLAUDE.md §9, §11), but FantasyCalc's redraft list (numQbs=${format.numQbs}, ppr=${format.ppr}) has only ${red.entries} entries and covers ${red.found}/${red.total} (${pct(red.found, red.total)}) of this league's rostered QB/RB/WR/TE — evidence: M.redraft. Options: accept the value floor for the rest; or fall back to dynasty values rescaled to the redraft scale for players missing from the redraft list.`,
    );
  }
  if (Object.keys(format.targetRates).length) {
    const cr = Object.entries(format.catchRates).filter(([, c]) => c.tgt > 0);
    p.cl.issue(
      `This league scores targets instead of receptions (${Object.entries(format.targetRates).map(([k, n]) => `${k} ${n}`).join(", ")} per target); FantasyCalc's format has only ppr (0 / 0.5 / 1) and tep — evidence: M.format (at this league's catch rates that is about ${cr.map(([k, c]) => `${k} ${round2((format.targetRates[k] ?? 0) / (c.rec / c.tgt))}`).join(", ")} per reception). Options: request the nearest ppr plus tep for the TE premium; or ppr=0 as now; or the ppr implied by the catch rate.`,
    );
  }

  // --- Decisions ---
  if (L.pick.label === "public test league") {
    const idp = lineup.lineup.some((s) => s.eligible.some((e) => e === "DL" || e === "LB" || e === "DB"));
    const features = [idp ? "IDP" : "", lineup.taxiSlots ? "taxi" : "", lineup.irSlots ? "IR" : "", pSlots.length ? "punter slots" : ""].filter(Boolean).join(" + ");
    p.cl.decision(
      `Fleaflicker test league: FLEAFLICKER_LEAGUE_ID is blank, so the probe uses a pinned public ${SEASON} league: ${teams.length} teams in ${(L.standings.data?.divisions ?? []).length} division(s), ${leagueType} (maxKeepers ${num(lg?.maxKeepers)} of a ${num(lg?.rosterRequirements?.rosterSize)}-player active roster)${features ? `, ${features}` : ""}, ${L.completedWeeks.length} week(s) played${picks.distinct.some((q) => q.traded) ? ", with traded future picks" : ""}. Its id and how it was found are kept only in git-ignored files; the order in which candidate leagues are tried is shuffled with a secret salt from the git-ignored pin file.`,
    );
  }
  if (O) {
    const oc = convertRules(O.rules.data?.groups ?? []).scoring;
    const rec = oc.perStat.rec;
    const passTd = oc.perStat.pass_td;
    p.cl.decision(
      `The scoring-oracle preview also runs on a second pinned public league with more conventional offensive scoring (${rec ? `${rec} per reception` : "no reception points"}${passTd ? `, ${passTd}-pt pass TD` : ""}), because the main test league ${Object.keys(format.targetRates).length ? "scores targets instead of receptions and " : ""}has ${unm.length} rules the Sleeper keys can't express exactly.`,
    );
  }
  p.cl.decision(
    `Canonical ids for Fleaflicker players: request rosters/listings with external_id_type=SPORTRADAR and match Sleeper's players DB sportradar_id (${rosterPlayers.filter((q) => sportradarId(q.proPlayer)).length}/${rosterPlayers.length} rostered players carry one), instead of the DynastyProcess fleaflicker_id${dp ? ` (${dp.rowsWithBoth} usable rows, ${dp.foundByFleaflickerId} rostered players found)` : ""}. D/ST maps by NFL team code.`,
  );
  p.cl.decision("Fleaflicker JSON is read with camelCase keys (live API) and proto3 defaults: missing number = 0, missing boolean = false, missing enum = its first value (e.g. BN slot group → BENCH, transaction type → TRANSACTION_ADD), except league.hasPlayoffs. A scoring rule's bounds come from rangeType, because a bound of 0 is omitted.");
  p.cl.decision("Position mapping: CB/S → DB, EDR/IL (and DE/DT) → DL, LB → LB, D/ST → DEF; P (punter) has no model position and is reported as unmapped; a dual 'WR/CB' player uses its first position (also for the FantasyCalc match rate).");
  p.cl.decision(`League type is inferred from maxKeepers vs the active roster size (0 → redraft, ≥ roster → dynasty, else keeper): this league → ${leagueType}. Trade review: numVetoesRequired > 0 → league_vote; a review period without vetoes → commissioner.`);
  p.cl.decision(`Scoring conversion: a rule's positions come from applyTo (applyToAll only marks "every position this league allows"). Definition adjustments (${ALL_ADJUSTMENTS.join(", ")}) are switchable, and the oracle reports what each one fixes and breaks.`);
  p.cl.decision("Privacy: strangers' public leagues are described only generically in committed text; the rules-page \"Lifetime\" line is reduced to the keeper count; division ids are replaced (500000N); identities of leagues that are screened or read but never sanitized go to the git-ignored watch list for check:leaks.");

  // --- Questions ---
  if (L.pick.label === "public test league") p.cl.question("Do you have a Fleaflicker league? If so, fill in FLEAFLICKER_LEAGUE_ID in .env.local and I'll re-run the probe on it.");
  p.cl.question("Fleaflicker playoff settings, trade deadline, trade review, tiebreakers, division-winner seeding and roster-minimum enforcement are only on the league's public HTML rules page — OK for the adapter to read that page, or should the Import Report ask the user to confirm them?");
  p.cl.question("Should the normalized Scoring.bonuses get an optional `max` (tiers like \"≤ 0 points allowed\"), composite stats (\"rec_fd+rec_td ≥ 4\") and per-game constants (gp ≥ 1)?");
  p.cl.question(`Punters: Fleaflicker leagues can start a P (and a K/P flex), and Fleaflicker projected ${puntersProjected} of this league's ${punters.length} punters. Add 'P' to the Pos type, or treat punters as unmapped (valued at the floor, P slots left empty)?`);
  if (Object.keys(format.targetRates).length) p.cl.question("Target-scoring leagues (points per target, not per reception): which FantasyCalc format — nearest ppr plus tep for the TE premium, ppr=0, or the ppr implied by the catch rate?");
  if (Object.keys(lineup.positionMinimums).length) p.cl.question("Add per-position roster minimums (and per-label maxima such as CB vs S) to LeagueSettings so trade legality (§7) can enforce them?");
  if (analysis) p.cl.meta.oracleSummary = { rate: round2(analysis.summary.rate * 100), compared: analysis.summary.compared, rateWithoutZeroZero: round2(analysis.summary.rateNonZero * 100), withoutAdjustments: round2(analysis.baseline.rate * 100) };
}

runProbe("fleaflicker", async (p) => {
  const rediscover = process.argv.includes("--rediscover");
  const ids = new FleaIdentities(p.redactor);
  const watch = new WatchList((v) => ids.isPublicName(v));
  const fx: FixtureLog = { errors: [], saved: new Set() };
  p.cl.meta.season = SEASON;
  p.cl.meta.oracle = {};

  // Public data first: NFL player and team names are data, not leaguemates' identities (a division
  // named after a quarterback would otherwise be registered and flag every public players file).
  const sleeper = await p.timed("Sleeper players DB", () => getSleeperPlayers());
  const sleeperBySr = new Map<string, string>();
  const sleeperDefs = new Set<string>();
  const publicNames: string[] = [];
  for (const pl of Object.values(sleeper.data)) {
    const sr = (pl as { sportradar_id?: string | null }).sportradar_id;
    if (sr) sleeperBySr.set(String(sr).toLowerCase(), pl.player_id);
    if (pl.position === "DEF") sleeperDefs.add(pl.player_id);
    if (pl.full_name) publicNames.push(pl.full_name);
    if (pl.first_name && pl.last_name) publicNames.push(`${pl.first_name} ${pl.last_name}`);
  }
  ids.addPublicNames(publicNames);

  const picked = await p.timed("resolve league", () => resolveLeagues(p, ids, { season: SEASON, rediscover, watch }));
  p.cl.meta.leagueSelection = { log: picked.log, screened: picked.screened.map((s) => ({ source: s.source, ok: s.screen.ok, teams: s.screen.teams, gamesPlayed: s.screen.gamesPlayed, reason: s.screen.reason })) };
  if (!picked.primary) {
    p.cl.fail("A", "A.league", "League to probe", "no usable league: FLEAFLICKER_LEAGUE_ID is blank and no public test league passed screening", ev(undefined, null, undefined, picked.log));
    p.cl.question("Do you have a Fleaflicker league? If so, fill in FLEAFLICKER_LEAGUE_ID in .env.local.");
    await watch.save();
    return;
  }

  const L = await p.timed("load primary league", () => loadLeague(p, ids, picked.primary as PickedLeague, true, fx));
  const O = picked.oracle ? await p.timed("load oracle league", () => loadLeague(p, ids, picked.oracle as PickedLeague, false, fx)) : null;
  const leagueType = inferLeagueType(L);
  const review = inferReview(L);
  p.cl.meta.leagues = [
    { label: L.pick.label, access: L.pick.access, source: L.pick.source, notes: describeLeague(L, leagueType) },
    ...(O ? [{ label: O.pick.label, access: O.pick.access, source: O.pick.source, notes: `${teamsOf(O.standings.data).length}-team league, used for the scoring-oracle preview only` }] : []),
  ];

  // Public weekly stats: every completed week (oracle, season totals, catch rates).
  const statsByWeek = new Map<number, WeekStats>();
  await loadStats(p, [...L.completedWeeks, ...(O?.oracleWeeks ?? [])], statsByWeek);
  const observedKeys = new Set<string>();
  for (const ws of statsByWeek.values()) ws.keys.forEach((k) => observedKeys.add(k));
  const fdEvidence = firstDownEvidence(statsByWeek);

  const conv = convertRules(L.rules.data?.groups ?? []);
  const coverage = await p.timed("rule coverage (other leagues)", () => ruleCoverage(p, ids, [L.pick.id, picked.oracle?.id ?? ""], picked.salt, watch));
  const dp = await p.timed("DynastyProcess id map", () => dynastyProcessCrosswalk(L));
  const docs = await p.timed("API docs", () => loadDocs(p));
  const oracleCtx: OracleContext = { scoring: conv.scoring, mappings: conv.mappings, statsByWeek, sleeperBySr, sleeperDefs };
  const analysis = analyzeOracle(L, oracleCtx);
  const oconv = O ? convertRules(O.rules.data?.groups ?? []) : null;
  const oAnalysis = O && oconv ? analyzeOracle(O, { ...oracleCtx, scoring: oconv.scoring, mappings: oconv.mappings }) : null;

  // Checks (identities from every response are registered by now).
  checkA(p, L, { leagueType, review }, O);
  checkInactive(p, coverage);
  checkB(p, L);
  checkC(p, L, conv, observedKeys, coverage, analysis, fdEvidence);
  checkD(p, L, ids, docs);
  checkE(p, L, sleeperBySr, dp, docs);
  checkF(p, L, docs);
  checkG(p, L, ids);
  checkH(p, L);
  checkI(p, L, ids, docs);
  checkJ(p, L);
  checkK(p, L, analysis, statsByWeek, sleeperBySr, docs);
  await checkL(p, L, docs);
  const format = await checkM(p, L, conv.scoring, leagueType, sleeperBySr, statsByWeek);

  // Second league: scoring oracle only.
  if (O && oconv) {
    const oc = mappingCounts(oconv.mappings);
    p.cl.add("C", "C.oracleLeague", "Second league's rules", oconv.mappings.length ? "ok" : "warn", `${oconv.mappings.length} rules: ${Object.entries(oc).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ")}; unmapped: ${oconv.scoring.unmapped.slice(0, 6).map((u) => u.label).join("; ") || "none"}`, ev(O.rules.url, O.rules.res, "groups[].scoringRules[]", oconv.scoring.perStat));
    reportOracle(p, O, oAnalysis, "K.oraclePreview2", "Scoring oracle preview (second league)");
  }

  checkApiConventions(p, L, verifyOmittedTypeIsAdd(L), docs);

  // Sleeper stats for the box-score players (public data, for a future adapter oracle test).
  const boxIds = new Set<string>();
  const srByFf = new Map<number, string>();
  for (const x of (L.rosters?.data?.rosters ?? []).flatMap((r) => r.players ?? [])) {
    const sr = sportradarId(x.proPlayer);
    if (sr) srByFf.set(x.proPlayer.id, sr);
  }
  for (const f of L.extraPlayers) for (const x of f.data?.players ?? []) if (sportradarId(x.proPlayer)) srByFf.set(x.proPlayer.id, sportradarId(x.proPlayer) as string);
  for (const f of [...L.boxscores.values()].flat())
    for (const { lp } of lineupPlayers(f.data)) {
      const sid = sleeperBySr.get(srByFf.get(lp.proPlayer.id) ?? "");
      if (sid) boxIds.add(sid);
    }
  const keepKeys = new Set([...scoringKeys(conv.scoring), "gp"]);
  for (const [w, ws] of statsByWeek) {
    if (!L.oracleWeeks.includes(w)) continue;
    const subset = [...boxIds]
      .filter((id) => ws.bySleeperId.has(id))
      .map((id) => ({ player_id: id, week: w, stats: Object.fromEntries(Object.entries(ws.bySleeperId.get(id) ?? {}).filter(([k]) => keepKeys.has(k))) }));
    try {
      const out = await p.saveSanitized(`sleeper/stats/nfl/${SEASON}/${w}?season_type=regular (primary box-score players)`, subset, { url: SLEEPER_STATS_URL(SEASON, w), status: ws.res.status, contentType: ws.res.contentType, note: "public data; players in the primary league's box scores; only the stat keys its scoring reads, plus gp" }, { protect: () => true });
      fx.saved.add(path.basename(out));
    } catch (err) {
      if (err instanceof LeakError) fx.errors.push(`sleeper stats week ${w}: ${err.message}`);
      else throw err;
    }
  }

  // Remove sanitized fixtures from earlier runs that this run no longer writes (only after a full load).
  const pruned = L.standings.data ? await pruneStaleFixtures(fx.saved) : 0;

  // Fixtures: leak check results and size.
  const index = (() => {
    try {
      return JSON.parse(readFileSync(path.join(SANITIZED_DIR, "index.json"), "utf8")) as Record<string, { label: string }>;
    } catch {
      return {} as Record<string, { label: string }>;
    }
  })();
  const files = Object.keys(index);
  let bytes = 0;
  let largest = 0;
  for (const f of files) {
    try {
      const s = statSync(path.join(SANITIZED_DIR, f)).size;
      bytes += s;
      largest = Math.max(largest, s);
    } catch {
      // listed but missing
    }
  }

  // Watch list (git-ignored) for strangers' leagues we read but never sanitize.
  for (const id of allCandidateIds()) if (id !== L.pick.id && id !== O?.pick.id) watch.addId(id, "league-id");
  const watchEntries = await watch.save();
  p.cl.meta.fixtures = { sanitizedFiles: files.length, sanitizedBytes: bytes, largestBytes: largest, leakErrors: fx.errors.length, prunedStale: pruned, skippedNames: ids.skippedNames, shortOwnerIds: ids.shortUserIds };
  p.cl.meta.watchList = { entries: watchEntries, idsShorterThan6DigitsLeftOut: watch.skippedShortIds, publicOrPlaceholderNamesLeftOut: watch.skippedNames };
  if (fx.errors.length) {
    p.cl.fail("FIX", "FIX.sanitized", "Sanitized fixtures", `${fx.errors.length} fixture(s) refused by the leak check: ${fx.errors.slice(0, 3).join(" | ")}`, ev(undefined, null));
    p.cl.issue(`Sanitizer: ${fx.errors.length} fixture(s) not saved (leak check). See the FIX check.`);
  } else {
    p.cl.ok("FIX", "FIX.sanitized", "Sanitized fixtures", `${files.length} files, ${(bytes / 1e6).toFixed(2)} MB (largest ${(largest / 1e6).toFixed(2)} MB); every one passed the leak check. Owners → Owner N, teams → Team N (id 400000N), divisions → Division N (id 500000N), leagues → League N; free text and initials replaced; bulky keys trimmed (listed in each index entry). Strangers' leagues read but not saved: ${watchEntries} identities in the git-ignored watch list for check:leaks`, ev(undefined, null, "fixtures/sanitized/fleaflicker/index.json", files.length));
  }

  reportFindings(p, { L, O, conv, leagueType, analysis, coverage, dp, format, statsByWeek, fdEvidence, docs });
});
