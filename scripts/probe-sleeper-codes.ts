/**
 * Probe: what Sleeper's numeric league-settings codes mean (CLAUDE.md §2.3: "check the meaning of
 * every numeric code against real leagues rather than assuming it"), from a bounded snowball crawl
 * of public leagues.
 *
 *   npm run probe:sleeper-codes
 *
 * Bounds: ≤ 250 leagues for 2026 and ≤ 900 requests per run, ≥ 400 ms between requests (the main
 * Sleeper probe shares the 1,000 calls/minute limit), responses cached 24 h (7 days for finished
 * seasons, including their 404s). Output is aggregate numbers only (CLAUDE.md §0.6): no league
 * names, IDs or usernames are printed or committed, and no sanitized fixtures of crawled leagues are
 * saved. Trimmed records (codes and counts, plus IDs so a rerun hits the cache), the sampling salt
 * and the identity watch list for `npm run check:leaks` stay in data-local/sleeper-codes/
 * (git-ignored).
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { TTL, writeFileAtomic } from "./lib/cache";
import { ROOT } from "./lib/env";
import { request, setHostGap } from "./lib/http";
import { runProbe } from "./lib/probe";
import { getSleeperPlayers } from "./lib/sleeper-players";
import { nflCalendar, type NflCalendar } from "./lib/sleeper-codes/calendar";
import { CRAWL_GAP_MS, CRAWL_TTL, SLEEPER_HOST, SleeperCrawlClient } from "./lib/sleeper-codes/client";
import {
  EXTRA_TRADE_LEGS,
  NameWatch,
  PREV_CALLS_MAX,
  crawl2026,
  extractDocSeeds,
  fetchCurrent2026,
  fetchMoreTransactions,
  fetchPicks,
  fetchPrev2025,
  selectCurrentSample,
  selectDeeperSeasons,
  selectPicksSample,
  selectPrevSample,
  selectTradeControlSample,
  type Current2026,
  type Prev2025,
  type Register,
} from "./lib/sleeper-codes/crawl";
import { URLS, evaluateAll, type Dataset } from "./lib/sleeper-codes/evaluate";
import { removeStaleTempFiles, withFsRetry } from "./lib/sleeper-codes/retry";
import { harvestFolder, redactedValues, writeWatchlist } from "./lib/sleeper-codes/watchlist";

const SEASON = "2026";
const MAX_REQUESTS = 900;
const MAX_LEAGUES = 250;
/** Calls the 2026 crawl may use; the rest goes to draft picks, current rosters and previous seasons. */
const CRAWL_CALLS = 360;
const PICKS_PER_STRATUM = 7;
const CURRENT_PER_GROUP = 6;
const PREV_MAX = 45;
const PREV_MIN_PER_VALUE = 4;
/** Measured average calls per previous-season league (the maximum is PREV_CALLS_MAX). */
const PREV_CALLS_AVG = 10;
/** Rare codes (playoff_round_type 1/2) need this many finished seasons before we go a season deeper. */
const RARE_MIN_SEASONS = 3;
const TRADE_CONTROL_MAX = 5;
/** Calls kept back from the first previous-season pass for the extra evidence. */
const EXTRA_RESERVE = 2 * TRADE_CONTROL_MAX * 5 + 3 * PREV_CALLS_AVG;
const DOCS_URL = "https://docs.sleeper.com/";
const LOCAL_DIR = path.join(ROOT, "data-local", "sleeper-codes");
const RAW_DIR = path.join(ROOT, "fixtures", "raw", "sleeper-codes");

/** When the 2026 lists were fetched live (stored locally, so cached reruns report the crawl day). */
async function crawlTimestamp(fetchedNow: boolean): Promise<Date> {
  const file = path.join(LOCAL_DIR, "crawl-meta.json");
  if (!fetchedNow) {
    try {
      const at = (JSON.parse(await readFile(file, "utf8")) as { crawledAt?: string }).crawledAt;
      if (at && Number.isFinite(Date.parse(at))) return new Date(at);
    } catch {
      // first run, or the file was removed
    }
  }
  const now = new Date();
  await withFsRetry(() => writeFileAtomic(file, JSON.stringify({ crawledAt: now.toISOString() })));
  return now;
}

/**
 * The sampling salt: random, created once, kept only in data-local/ (git-ignored) and never printed.
 * Every candidate ordering uses it, so the committed code alone can't reproduce the sample.
 */
async function sampleSalt(): Promise<{ salt: string; created: boolean }> {
  const file = path.join(LOCAL_DIR, "sample-salt.json");
  try {
    const salt = (JSON.parse(await readFile(file, "utf8")) as { salt?: unknown }).salt;
    if (typeof salt === "string" && /^[0-9a-f]{32,}$/.test(salt)) return { salt, created: false };
  } catch {
    // first run
  }
  const salt = randomBytes(16).toString("hex");
  await withFsRetry(() => writeFileAtomic(file, JSON.stringify({ salt, createdAt: new Date().toISOString() })));
  return { salt, created: true };
}

/** NFL week windows from nflverse games.csv (same cache entry and 7-day TTL as the shared probe). */
async function loadCalendar(): Promise<{ calendar?: NflCalendar; status: number; fromCache: boolean }> {
  try {
    const res = await request(URLS.nflGames, { cache: { key: `nfl-schedule:${URLS.nflGames}`, ttlMs: TTL.nflSchedule, namespace: "nfl-schedule" }, label: "nflverse games.csv", timeoutMs: 180_000 });
    return { calendar: res.ok && !res.isHtml ? nflCalendar(res.text) : undefined, status: res.status, fromCache: res.fromCache };
  } catch {
    return { status: 0, fromCache: false };
  }
}

void runProbe("sleeper-codes", async (p) => {
  // First: this crawler shares Sleeper's rate limit with the main Sleeper probe.
  setHostGap(SLEEPER_HOST, CRAWL_GAP_MS);
  // Raw responses go to fixtures/raw/sleeper-codes/ (git-ignored); labels are scrubbed to placeholders.
  const client = new SleeperCrawlClient(MAX_REQUESTS - 2, async (apiPath, _template, res) => {
    await withFsRetry(() => p.saveRaw(`crawl${apiPath}`, res.json ?? res.text, res));
  });
  const register: Register = (id, category) => {
    if (id) p.redactor.register(id, category);
  };
  const names = new NameWatch();
  const { salt, created: saltCreated } = await sampleSalt();

  // ---- Seeds: Parker's league/user when set, else the example IDs in the public API docs
  const seeds = { leagueIds: [] as string[], userIds: [] as string[] };
  const seedSources: string[] = [];
  const envLeague = p.env("SLEEPER_LEAGUE_ID");
  const envUser = p.env("SLEEPER_USERNAME");
  if (envLeague) {
    seeds.leagueIds.push(envLeague);
    seedSources.push("SLEEPER_LEAGUE_ID");
  }
  if (envUser) {
    const r = await client.get<{ user_id?: string }>(`/user/${encodeURIComponent(envUser)}`, "user/{username}", CRAWL_TTL.crawl);
    if (typeof r.data?.user_id === "string") {
      register(r.data.user_id, "user-id");
      seeds.userIds.push(r.data.user_id);
      seedSources.push("SLEEPER_USERNAME");
    }
  }
  if (!seeds.leagueIds.length && !seeds.userIds.length) {
    // The docs page is HTML, which the HTTP cache skips by default: cache it explicitly (7 days).
    const docs = await request(DOCS_URL, { cache: { key: "sleeper-codes:docs", ttlMs: CRAWL_TTL.docs, namespace: "sleeper-codes" }, cacheIf: (res) => res.status === 200, label: "Sleeper API docs" });
    const docSeeds = docs.ok ? extractDocSeeds(docs.text) : { leagueIds: [], userIds: [] };
    for (const id of docSeeds.leagueIds) register(id, "league-id");
    for (const id of docSeeds.userIds) register(id, "user-id");
    seeds.leagueIds.push(...docSeeds.leagueIds);
    seeds.userIds.push(...docSeeds.userIds);
    seedSources.push(`docs.sleeper.com example IDs (${docSeeds.leagueIds.length} leagues, ${docSeeds.userIds.length} users; HTTP ${docs.status})`);
  }
  if (!seeds.leagueIds.length && !seeds.userIds.length) p.cl.issue("No crawl seeds: SLEEPER_LEAGUE_ID / SLEEPER_USERNAME are blank and the docs page gave no example IDs.");

  // Same TTL as the league lists, so the NFL week and the leagues' week fields are one snapshot.
  const stateRes = await client.get<{ week?: number; season?: string; display_week?: number; season_type?: string }>("/state/nfl", "state/nfl", CRAWL_TTL.crawl);

  // ---- 2026 snowball
  const liveBefore = client.live;
  const crawl = await p.timed("crawl 2026 leagues", () =>
    crawl2026(client, seeds, { season: SEASON, maxLeagues: MAX_LEAGUES, perUserCap: 5, minUserQueue: 30, callBudget: CRAWL_CALLS, salt }, register, names),
  );
  const leagues = crawl.leagues;
  const crawledAt = await crawlTimestamp(client.live > liveBefore || saltCreated);
  const state = {
    week: stateRes.data?.week ?? 0,
    season: stateRes.data?.season ?? SEASON,
    displayWeek: stateRes.data?.display_week,
    seasonType: stateRes.data?.season_type,
    weekday: `${crawledAt.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" })} (US Eastern)`,
  };

  // previous_league_id "0" means "no previous season": check once that such a league doesn't exist.
  const zeroLinkStatus = leagues.some((l) => l.previousLink === "zero") ? (await client.get("/league/0", "league/0", CRAWL_TTL.finished, { cacheNotFound: true })).status : undefined;

  // Budget left after the crawl: previous seasons get ~10 calls each (measured 9.5), picks and
  // current rosters take what's left above that reserve.
  const prevReserve = PREV_MAX * PREV_CALLS_AVG + EXTRA_RESERVE;

  // ---- 2026 draft picks: keeper flags and rookie share by league type
  const pickSample = selectPicksSample(leagues, PICKS_PER_STRATUM, salt);
  const currentSample = selectCurrentSample(leagues, CURRENT_PER_GROUP, salt);
  await p.timed("draft picks", async () => {
    for (const l of pickSample) {
      if (client.remaining <= prevReserve + currentSample.length) break;
      l.picks = await fetchPicks(client, l);
    }
  });

  // ---- 2026 rosters so far: best ball, late start weeks and position limits are rare among renewed leagues
  const current: Current2026[] = [];
  await p.timed("current rosters", async () => {
    for (const c of currentSample) {
      if (client.remaining <= prevReserve) break;
      current.push(await fetchCurrent2026(client, c.league, c.reasons));
    }
  });

  // ---- 2025 (previous season) details for a stratified sample
  const prevSample = selectPrevSample(leagues, PREV_MAX, PREV_MIN_PER_VALUE, salt);
  const prev: Prev2025[] = [];
  await p.timed("previous seasons", async () => {
    for (const l of prevSample) {
      if (client.remaining < PREV_CALLS_MAX + EXTRA_RESERVE) break;
      if (!l.previousLeagueId) continue;
      prev.push(await fetchPrev2025(client, { fromLeagueId: l.leagueId, leagueId: l.previousLeagueId, depth: 1 }, register, names));
    }
  });

  // ---- Extra evidence where the first pass is thin (only while the budget lasts)
  const tradeControls = selectTradeControlSample(prev, TRADE_CONTROL_MAX, salt);
  await p.timed("extra evidence", async () => {
    // Earlier seasons of the leagues with rare playoff-round codes, up to 3 seasons back.
    for (let round = 0; round < 3; round++) {
      const deeper = selectDeeperSeasons(prev, RARE_MIN_SEASONS, 3, salt);
      if (!deeper.length) break;
      for (const link of deeper) {
        if (client.remaining < PREV_CALLS_MAX + TRADE_CONTROL_MAX * 2 * EXTRA_TRADE_LEGS.length) break;
        prev.push(await fetchPrev2025(client, link, register, names));
      }
    }
    for (const x of [...tradeControls.disabled, ...tradeControls.enabled]) {
      if (client.remaining < EXTRA_TRADE_LEGS.length) break;
      await fetchMoreTransactions(client, x, EXTRA_TRADE_LEGS);
    }
  });

  // ---- Positions for the position-limit check (players DB is cached 24 h and shared)
  let positionOf: Dataset["positionOf"];
  if (prev.some((x) => x.rosterGroups?.length) || current.some((c) => c.rosterGroups?.length)) {
    const players = await getSleeperPlayers().catch(() => undefined);
    if (players) positionOf = (id) => players.data[id]?.position ?? undefined;
  }

  // ---- NFL calendar for dating trades (nflverse, shared 7-day cache)
  const cal = await p.timed("nfl calendar", loadCalendar);

  // ---- Local records (git-ignored): IDs kept only so reruns reuse the cache
  await withFsRetry(() => writeFileAtomic(path.join(LOCAL_DIR, "leagues-2026.json"), JSON.stringify(leagues, null, 1)));
  await withFsRetry(() => writeFileAtomic(path.join(LOCAL_DIR, "previous-2025.json"), JSON.stringify(prev, null, 1)));
  await withFsRetry(() => writeFileAtomic(path.join(LOCAL_DIR, "current-2026-rosters.json"), JSON.stringify(current, null, 1)));
  await removeStaleTempFiles(RAW_DIR);

  // ---- Watch list for check:leaks: every identity in the raw captures (values never printed)
  const harvest = await p.timed("watch list", () => harvestFolder(RAW_DIR));
  const mapped = await redactedValues(path.join(RAW_DIR, "redaction-map.json"));
  const watch = await withFsRetry(() => writeWatchlist(path.join(LOCAL_DIR, "watchlist.json"), harvest.entries, mapped));
  for (const e of harvest.entries) if (e.category === "league-name" || e.category === "team-name" || e.category === "username") names.add(e.value);
  console.log(`  watch list: ${watch.total} identities (${watch.added} new, ${watch.dropped} dropped by the current rules) from ${harvest.files} raw captures, by category ${JSON.stringify(watch.byCategory)}`);

  // ---- Evaluate and report (aggregates only)
  const result = evaluateAll({
    state,
    leagues,
    prev,
    current,
    positionOf,
    calendar: cal.calendar,
    calendarStatus: cal.status,
    zeroLinkStatus,
    crawl: {
      seedSources,
      usersFetched: crawl.usersFetched,
      usersWithNewLeagues: crawl.usersWithNewLeagues,
      usersQueued: crawl.usersQueued,
      leagueUserLists: crawl.leagueUserLists,
      draftsSeen: crawl.draftsSeen,
      stoppedBy: crawl.stoppedBy,
      picksRequested: pickSample.length,
      currentRequested: currentSample.length,
      prevRequested: prevSample.length,
      calls: client.calls,
      live: client.live,
      cached: client.cached,
      statusCounts: client.statusCounts,
      byTemplate: client.byTemplate,
    },
  });
  const leagueLine = {
    label: `Crawled public Sleeper leagues (${leagues.length} for 2026, ${prev.filter((x) => x.found && x.depth === 1).length} previous seasons, ${current.length} with 2026 rosters)`,
    access: "public, no login",
    source: `snowball crawl: league members → their ${SEASON} leagues, in a salted order; seeds: ${seedSources.join("; ")}`,
    notes: "aggregate numbers only; names and IDs never leave data-local/ and fixtures/raw/ (git-ignored)",
  };

  // ---- Leak check BEFORE anything is printed: the report must not contain any name seen in the crawl
  const leaked = names.findIn(JSON.stringify({ result, leagueLine }));
  for (const n of leaked) register(n, "free-text"); // the console scrubber and the saved report then mask them

  p.cl.meta.leagues = [leagueLine];
  Object.assign(p.cl.meta, result.meta);
  p.cl.meta.nflCalendar = { url: URLS.nflGames, status: cal.status, fromCache: cal.fromCache, seasons: cal.calendar?.seasons.length ?? 0 };
  p.cl.meta.watchlist = { identities: watch.total, added: watch.added, dropped: watch.dropped, byCategory: watch.byCategory, rawCaptures: harvest.files };
  for (const c of result.checks) p.cl.add("CODES", c.key, c.title, c.status, c.summary, ...c.evidence);
  for (const i of result.issues) p.cl.issue(i);
  for (const d of result.decisions) p.cl.decision(d);
  for (const q of result.questions) p.cl.question(q);
  p.cl.decision(
    "Crawled leaguemates' IDs (league, user, draft) are registered with the Redactor so no console line or report can show them; display names and league names are never stored in the trimmed records, only keyword flags; every identity in the raw captures goes to a git-ignored watch list that check:leaks loads; and the report is checked against every name seen before anything is printed.",
  );
  if (leaked.length) p.cl.warn("CODES", "CODES.privacy", "Report leak check", `${leaked.length} crawled name(s) matched report text and were masked — review the generator`);
  else
    p.cl.ok(
      "CODES",
      "CODES.privacy",
      "Report leak check",
      `no crawled league, draft, team or user name (${names.names.size} seen, ≥ 10 chars) appears in the report; watch list for check:leaks: ${watch.total} identities (${Object.entries(watch.byCategory)
        .map(([k, n]) => `${n} ${k}`)
        .join(", ")}) from ${harvest.files} raw captures, git-ignored`,
    );
});
