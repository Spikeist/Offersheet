/**
 * Phase 0 probe: Sleeper (CLAUDE.md §2.3, §17 Data Checklist A–M).
 *
 *   npm run probe:sleeper
 *
 * League: SLEEPER_LEAGUE_ID, else SLEEPER_USERNAME's leagues, else the pinned public test league, else
 * (only with --allow-crawl) a public test league found by a salted random walk
 * (scripts/lib/sleeper/discover.ts). Every leaguemate identity is registered with the Redactor before
 * anything is printed; reports contain placeholders only ("Team 3", user 2000…03), and a stranger's
 * test league is described only generically. Its sanitized fixtures go to git-ignored
 * data-local/fixtures-sanitized/sleeper (only minimized copies are committed, in
 * fixtures/sanitized/min/sleeper/); Parker's league and public data go to fixtures/sanitized/sleeper.
 *
 * Code meanings are cross-checked against the crawl of public leagues (npm run probe:sleeper-codes,
 * reports/probe-output/sleeper-codes.json), and a few crawled leagues feed a cross-league scoring
 * oracle whose results are reported in aggregate only. CLAUDE.md §0.6: no new crawls of strangers'
 * leagues without asking Parker first, so without --allow-crawl those leagues are read from the HTTP
 * cache only (never from the network), and a check that needs data the cache lacks says
 * "untested: needs --allow-crawl (ask Parker first)".
 *
 *   npm run probe:sleeper
 *   npx tsx scripts/probe-sleeper.ts --allow-crawl     (only after Parker agreed to a new crawl)
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ZodType } from "zod";
import { writeFileAtomic } from "./lib/cache";
import type { Evidence } from "./lib/checklist";
import { FC_TEAM_SIZES, getFantasyCalc, matchRate, nearest, type FcEntry, type FcFormat } from "./lib/fantasycalc";
import { LeakError, RAW_DIR, sanitizedDirFor } from "./lib/fixtures";
import { setHostGap } from "./lib/http";
import type { ProbeContext } from "./lib/probe";
import { crawlAllowed, runProbe } from "./lib/probe";
import { registerScrubber } from "./lib/redact";
import { Redactor, type JsonPath } from "./lib/sanitize";
import { getSleeperPlayers, type SleeperPlayer } from "./lib/sleeper-players";
import {
  auditMyTeamLookup,
  bracketShape,
  classifyCoverage,
  countBy,
  findMyRoster,
  hasProjection,
  impliedByes,
  lastPlayoffWeek,
  matchupPairs,
  NON_STARTING,
  pickOwnership,
  recordsFromMatchups,
  repeatedPairWeeks,
  rosterPoints,
  slotCounts,
  SLOT_ELIGIBLE,
  summarizeTransactions,
  tradeReviewFromSettings,
  unknownSlots,
} from "./lib/sleeper/analyze";
import { endpoints, fetchJson, type Fetched } from "./lib/sleeper/api";
import { crawlGist, crawlValueClause, eligibleForOracle, firstClause, ORACLE_TARGETS, pickOneMore, pickOracleLeagues, readCrawlLeagues, readCrawlScoringKeys, readProbeChecks, type CrawlLeague, type ProbeChecks } from "./lib/sleeper/crawl";
import { chooseLeague, rankUserLeagues, validLeagues, type LeagueChoice } from "./lib/sleeper/discover";
import { pruneStaleFixtures } from "./lib/sleeper/fixturePrune";
import { NEEDS_CRAWL, crawlGateNote } from "./lib/shared/crawl-gate";
import { fixtureFolders, partitionLabels, whereSaved } from "./lib/shared/fixture-folders";
import { placeholderCollisions, protectAll, protectDraftPicks, protectLeagueData, SleeperIdentities, structuralStrings } from "./lib/sleeper/identities";
import { leaguePoints, round2, runOracle, type OracleResult, type OracleWeekInput, type StatLine } from "./lib/sleeper/oracle";
import { newSalt } from "./lib/sleeper/salt";
import { aliasSourcesSeen, keyGroup, PROJECTION_ALIASES, projectedKeySets, projectionCoverage, statsFrequency, toScoringStats, type CoverageRow, type RowKind, type StatGroup } from "./lib/sleeper/scoringKeys";
import { crawlReading, describeSettings, SETTINGS_NEEDED, type Confidence } from "./lib/sleeper/settings";
import {
  BracketSchema,
  DraftPickSchema,
  DraftSchema,
  LeagueSchema,
  MatchupSchema,
  parseArray,
  parseOne,
  PickSchema,
  RosterSchema,
  StateSchema,
  StatRowSchema,
  TransactionSchema,
  UserSchema,
  type SleeperBracketMatch,
  type SleeperDraft,
  type SleeperDraftPick,
  type SleeperLeague,
  type SleeperMatchup,
  type SleeperRoster,
  type SleeperState,
  type SleeperStatRow,
  type SleeperTradedPick,
  type SleeperTransaction,
  type SleeperUser,
} from "./lib/sleeper/types";
import { Watchlist } from "./lib/sleeper/watchlist";

/** Positions the engine models (CLAUDE.md §4 Pos). */
const POS = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"] as const;
const IDP_POS = ["DL", "LB", "DB"];
/** Injury statuses the normalized model knows (CLAUDE.md §4 PlayerInfo.injury), by Sleeper spelling. */
const INJURY_MAP: Record<string, string> = { Questionable: "QUESTIONABLE", Doubtful: "DOUBTFUL", Out: "OUT", IR: "IR", PUP: "PUP", Sus: "SUSPENDED", NA: "NA" };
const FA_PER_POSITION = 25;
const USER_LEAGUES_KEPT = 5;
/** Sleeper allows 1000 calls/minute; other Phase 0 probes may call Sleeper at the same time, so this one stays well under. */
const SLEEPER_GAP_MS = 200;
/** Cross-league oracle: leagues from the crawl sample (git-ignored choice file keeps the salt and the picks). */
const CROSS_ORACLE_FILE = path.join(RAW_DIR, "sleeper", "cross-oracle.json");
const CROSS_ORACLE_MIN = 3;
const CROSS_ORACLE_MAX = 5;

/** Short names of Sleeper codes verified by probe:sleeper-codes (full meanings in settings.ts). */
const CODE_NAMES: Record<string, Record<number, string>> = {
  type: { 0: "redraft", 1: "keeper", 2: "dynasty", 3: "guillotine" },
  playoff_type: { 0: "losers advance (toilet bowl)", 1: "winners advance (consolation games for places)" },
  playoff_seed_type: { 0: "fixed bracket", 1: "re-seed after each round" },
  playoff_round_type: { 0: "one week per round", 1: "two-week championship", 2: "two weeks per round" },
};
const codeName = (key: string, v: number | undefined) => (v === undefined ? "absent" : (CODE_NAMES[key]?.[v] ?? "unknown code"));

interface DraftBundle {
  id: string;
  draftF: Fetched<unknown>;
  draft: SleeperDraft | null;
  picksF: Fetched<unknown>;
  picks: SleeperDraftPick[];
  tradedF: Fetched<unknown>;
  traded: unknown[];
}

interface StatsWeek {
  week: number;
  f: Fetched<unknown>;
  rows: SleeperStatRow[];
  bad: number;
  stats: Map<string, StatLine>;
}

interface ProjWeek {
  week: number;
  f: Fetched<unknown>;
  rows: SleeperStatRow[];
  byId: Map<string, SleeperStatRow>;
  problems: string[];
}

interface Proj {
  weeks: ProjWeek[];
  now?: ProjWeek;
  next?: ProjWeek;
  last?: ProjWeek;
  /**
   * Current week, every position (QB…DEF plus DL/LB/DB) in one call: the projection-key analysis
   * must not depend on which positions this league happens to start. Undefined when the league's
   * own call already has every position.
   */
  wide?: ProjWeek;
  all: SleeperStatRow[];
  positions: string[];
}

interface ScheduleRow {
  week?: number;
  home?: string;
  away?: string;
  status?: string;
  date?: string;
  game_id?: string;
}

interface ScheduleData {
  f: Fetched<unknown>;
  rows: ScheduleRow[];
  /** NFL teams with a (not canceled) game, per week. */
  teamsByWeek: Map<number, Set<string>>;
  allTeams: Set<string>;
  /** Date (YYYY-MM-DD) of the week's last game. */
  lastDateByWeek: Map<number, string>;
}

/** Everything fetched for the chosen league, parsed. */
interface Data {
  p: ProbeContext;
  role: string;
  choice: LeagueChoice;
  season: number;
  currentWeek: number;
  stateF: Fetched<unknown>;
  state: SleeperState | null;
  leagueF: Fetched<unknown>;
  league: SleeperLeague;
  settings: Record<string, unknown>;
  usersF: Fetched<unknown>;
  users: SleeperUser[];
  rostersF: Fetched<unknown>;
  rosters: SleeperRoster[];
  matchupsF: Map<number, Fetched<unknown>>;
  matchups: Map<number, SleeperMatchup[]>;
  txF: Map<number, Fetched<unknown>>;
  txByWeek: Map<number, SleeperTransaction[]>;
  allTx: SleeperTransaction[];
  tradedF: Fetched<unknown>;
  traded: SleeperTradedPick[];
  draftsF: Fetched<unknown>;
  drafts: SleeperDraft[];
  draftBundles: DraftBundle[];
  winnersF: Fetched<unknown>;
  winners: SleeperBracketMatch[];
  losersF: Fetched<unknown>;
  losers: SleeperBracketMatch[];
  parseProblems: string[];
  playersF: { ok: boolean; status: number; fromCache: boolean; bytes?: number; contentLength?: string; error?: string };
  players: Record<string, SleeperPlayer>;
  /** Everyone on a roster now (players ∪ reserve ∪ taxi). */
  rostered: Set<string>;
  num: (k: string) => number | undefined;
  lastScored: number;
  playoffStart: number;
  /** Last fantasy playoff week, from the bracket's rounds and settings.playoff_round_type. */
  lastPlayoff: number;
  startWeek: number;
  numTeams: number;
  /** Positions the league can start (from roster_positions), in POS order. */
  positions: string[];
  /** Env modes only: the user's league list, trimmed for the fixture (every kept league registered). */
  userLeaguesKept: SleeperLeague[];
  userLeaguesTotal: number;
  /** probe:sleeper-codes and probe:shared outputs (null when those probes haven't run). */
  crawl: ProbeChecks | null;
  shared: ProbeChecks | null;
  schedule: ScheduleData | null;
}

const iso = (ms: number | null | undefined) => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : "n/a");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
/** injury_status for display: null and "" are both "no status" but shown apart. */
const injuryLabel = (v: unknown) => (v === null || v === undefined ? "null" : v === "" ? '""' : String(v));
/** "min–max" of a list, or "n/a" when empty. */
const span = (xs: number[]) => (xs.length ? `${Math.min(...xs)}–${Math.max(...xs)}` : "n/a");
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

void runProbe("sleeper", async (p) => {
  setHostGap("api.sleeper.app", SLEEPER_GAP_MS);
  const disc = new Redactor("sleeper/discovery");
  registerScrubber(disc);
  const oracleIds = new Redactor("sleeper/oracle-leagues");
  registerScrubber(oracleIds);
  const watch = new Watchlist();
  try {
    await probe(p, disc, oracleIds, watch);
  } finally {
    await disc.saveMap();
    await oracleIds.saveMap();
    const n = await watch.save();
    console.log(`  watch list (git-ignored, contents never printed): ${n} strangers' identities`);
  }
});

async function probe(p: ProbeContext, disc: Redactor, oracleIds: Redactor, watch: Watchlist): Promise<void> {
  const { cl } = p;
  const env = p.envStatus();
  cl.meta.env = { SLEEPER_USERNAME: env.SLEEPER_USERNAME, SLEEPER_LEAGUE_ID: env.SLEEPER_LEAGUE_ID };

  // ---- NFL state (public) ----
  const stateF = await fetchJson<unknown>(p, endpoints.state());
  const state = parseOne(StateSchema, stateF.data).value;
  const season = Number(state?.season ?? 2026);
  const currentWeek = state?.week ?? 4;
  await p.saveRaw("state/nfl", stateF.data, stateF.res);
  await saveClean(p, "state/nfl", stateF, stateF.data, protectAll);

  // ---- choose the league ----
  const allowCrawl = crawlAllowed();
  cl.meta.crawlGate = crawlGateNote(allowCrawl);
  const choice = await p.timed("choose league", () => chooseLeague(p, disc, watch, season, currentWeek, { allowCrawl }));
  const role = choice.mode === "fallback" ? "public-test-league" : "parker-league";
  if (!choice.leagueId) {
    if (choice.needsCrawl) cl.na("A", "A.league", "League selected", choice.failure ?? NEEDS_CRAWL, { note: choice.notes.join("; ") || undefined });
    else cl.fail("A", "A.league", "League selected", `no league: ${choice.failure ?? "unknown"}`, { note: choice.notes.join("; ") || undefined });
    cl.question("Please fill SLEEPER_USERNAME (or SLEEPER_LEAGUE_ID) in .env.local so the probe can check your Sleeper league.");
    return;
  }
  if (choice.pinnedStale) {
    cl.warn("A", "A.pinnedLeague", "Pinned test league", choice.pinnedStale);
    cl.issue(`Sleeper test league: ${choice.pinnedStale}.`);
  }

  const d = await p.timed("league data", () => loadLeague(p, choice, role, season, currentWeek, stateF, state));
  if (!d) return;
  await p.timed("fixtures", () => saveLeagueFixtures(d));
  cl.decision(
    "Sleeper sanitizer: user IDs, display names and team names are numbered by roster (owner of roster N → user 2000…0N / Owner N / Team N; co-owners and other users after the last roster), league IDs/names by league (League 1 = the probed league); every placeholder comes from one allocator, and the run fails the fixture check if two raw values ever share one. Names are replaced however short (short ones on exact match only). Free text (player nicknames, notes, league descriptions, chat previews) becomes [text N]; notification flags, W/L record strings, mascot item types and values equal to ordinary data (positions, statuses, a player's own name) are left as they are. IDs seen only while choosing the league go to a separate, ID-only redaction map, and every stranger's identity seen while choosing goes to a git-ignored watch list that npm run check:leaks loads.",
  );

  const typeName = codeName("type", d.num("type"));
  cl.meta.leagues = [
    {
      label: choice.mode === "fallback" ? "Public test league (fallback)" : "Parker's league",
      access: "public by ID (Sleeper needs no login)",
      source: choice.mode === "fallback" ? "a stranger's public league found by a salted discovery walk (see Decisions); described only generically here" : choice.mode === "env-league" ? "SLEEPER_LEAGUE_ID" : "SLEEPER_USERNAME → leagues",
      notes: choice.mode === "fallback" ? `a public in-season ${d.numTeams}-team ${typeName} league` : `${d.numTeams} teams, status ${d.league.status}, settings.type ${String(d.settings.type)} (${typeName}); ${choice.notes.join("; ")}`,
    },
  ];
  const listed = d.userLeaguesTotal;
  if (choice.mode === "env-username" && listed > 1) cl.question(`Your Sleeper username has ${listed} leagues for ${season}; the probe used the in-season one closest to 12 teams. Set SLEEPER_LEAGUE_ID if you want a different one.`);
  if (choice.mode === "fallback") {
    cl.decision(
      "Fallback Sleeper league: SLEEPER_USERNAME and SLEEPER_LEAGUE_ID are blank, so the probe picks a stranger's public in-season league by a salted random walk over public league member lists (seeded from example IDs in Sleeper's API docs), preferring one that exercises trades, IR and K/DEF slots. The random salt and the walk's details live only in the git-ignored choice file, so the pick can't be re-derived from the code, and the committed reports and fixtures describe the league only generically. The seed's league list isn't committed (a one-entry example stands in). The probe switches to Parker's league automatically once either variable is set.",
    );
    cl.question("Please fill SLEEPER_USERNAME (or SLEEPER_LEAGUE_ID) in .env.local so Phase 0 can check your own Sleeper league (and the stranger's test-league fixtures can be replaced).");
  }

  d.schedule = await p.timed("schedule", () => loadSchedule(d));
  checkA(d);
  checkB(d);
  const proj = await p.timed("projections", () => loadProjections(d));
  const statsWeeks = await p.timed("stats", () => loadStats(d));
  checkC(d, proj, statsWeeks);
  checkD(d);
  checkE(d);
  checkF(d);
  checkG(d);
  checkH(d, proj.now);
  checkI(d);
  checkJ(d, proj, statsWeeks);
  await p.timed("oracle", () => checkK(d, statsWeeks));
  await p.timed("cross-league oracle", () => checkCrossLeagueOracle(d, statsWeeks, oracleIds, watch, allowCrawl));
  await checkL(d, proj);
  await p.timed("fantasycalc", () => checkM(d));
  await savePublicSubsets(d, proj);
  // Stale fixtures, in both folders: each keeps exactly the labels this run saved there, so a
  // stranger's copy left in the committed folder is always removed (fixtures/sanitized/min/ is never touched).
  const split = partitionLabels("sleeper", savedLabels);
  const pruned: string[] = [];
  const strangerPruned: string[] = [];
  for (const f of fixtureFolders("sleeper")) {
    const keep = new Set(f.committed ? split.committed : split.local);
    pruned.push(...(await pruneStaleFixtures(f.dir, `${role}/`, keep)));
    // The manifest lives in one folder (committed with Parker's league, else git-ignored): drop a copy in the other.
    pruned.push(...(await pruneStaleFixtures(f.dir, SANITIZED_MANIFEST_LABEL, keep)));
    // Once Parker's own league is probed, a stranger's test-league fixtures are no longer needed.
    if (role === "parker-league") strangerPruned.push(...(await pruneStaleFixtures(f.dir, "public-test-league/", new Set())));
  }
  const collisions = placeholderCollisions(p.redactor);
  cl.add(
    "FIX",
    "fixtures.sanitized",
    "Sanitized fixtures",
    collisions.length || fixtureStats.refused ? "fail" : "ok",
    `${fixtureStats.saved} saved: ${whereSaved("sleeper", split.committed.length, split.local.length)}; ${fixtureStats.refused} refused by the leak check, ${pruned.length} stale fixture(s) removed with their index entries${role === "parker-league" ? `, ${strangerPruned.length} public-test-league fixture(s) deleted (Parker's league replaces them)` : ""}; ${p.redactor.entries().length} identities registered, placeholders ${collisions.length ? `NOT unique: ${collisions.join(", ")}` : "unique"}`,
  );
  if (role === "parker-league") cl.decision("With Parker's own Sleeper league probed, the stranger's public-test-league fixtures and manifest entry are deleted from both fixture folders.");

  cl.meta.counts = {
    rosters: d.rosters.length,
    users: d.users.length,
    rosteredPlayers: d.rostered.size,
    transactions: d.allTx.length,
    tradedPickRows: d.traded.length,
    drafts: d.drafts.length,
  };
}

// ============================================================================================
// Loading, identity registration and fixtures
// ============================================================================================

async function loadLeague(p: ProbeContext, choice: LeagueChoice, role: string, season: number, currentWeek: number, stateF: Fetched<unknown>, state: SleeperState | null): Promise<Data | null> {
  const { cl } = p;
  const id = choice.leagueId;
  const leagueF = await fetchJson<unknown>(p, endpoints.league(id));
  if (!leagueF.ok || !leagueF.data) {
    cl.fail("A", "A.league", "League fetched", leagueF.ok ? "league not found (HTTP 200 with a null body)" : `failed: ${leagueF.error}`, { url: leagueF.template, status: leagueF.status });
    if (choice.mode !== "fallback") cl.question("The Sleeper league in .env.local couldn't be read. Please check SLEEPER_LEAGUE_ID (or SLEEPER_USERNAME).");
    return null;
  }
  const lp = parseOne(LeagueSchema, leagueF.data);
  if (!lp.value) {
    cl.fail("A", "A.league", "League shape", `league object is missing required fields: ${lp.problems.join("; ")}`, { url: leagueF.template, status: leagueF.status });
    return null;
  }
  const league = lp.value;
  const parseProblems: string[] = [];
  const arr = <T>(schema: ZodType<T>, f: Fetched<unknown>, label: string): T[] => {
    if (!f.ok) {
      parseProblems.push(`${label}: ${f.error}`);
      return [];
    }
    if (f.data === null) return [];
    const r = parseArray(schema, f.data);
    if (r.bad) parseProblems.push(`${label}: ${r.bad} row(s) failed validation (${r.problems.join("; ")})`);
    return r.value;
  };

  const usersF = await fetchJson<unknown>(p, endpoints.users(id));
  const rostersF = await fetchJson<unknown>(p, endpoints.rosters(id));
  const users = arr(UserSchema, usersF, "users");
  const rosters = arr(RosterSchema, rostersF, "rosters");

  const matchupsF = new Map<number, Fetched<unknown>>();
  const matchups = new Map<number, SleeperMatchup[]>();
  for (let w = 1; w <= 18; w++) {
    const f = await fetchJson<unknown>(p, endpoints.matchups(id, w));
    matchupsF.set(w, f);
    matchups.set(w, arr(MatchupSchema, f, `matchups/${w}`));
  }
  const txF = new Map<number, Fetched<unknown>>();
  const txByWeek = new Map<number, SleeperTransaction[]>();
  for (let w = 0; w <= Math.min(18, currentWeek + 1); w++) {
    const f = await fetchJson<unknown>(p, endpoints.transactions(id, w));
    txF.set(w, f);
    txByWeek.set(w, arr(TransactionSchema, f, `transactions/${w}`));
  }
  const allTx = [...txByWeek.values()].flat();
  const tradedF = await fetchJson<unknown>(p, endpoints.tradedPicks(id));
  const traded = arr(PickSchema, tradedF, "traded_picks");
  const draftsF = await fetchJson<unknown>(p, endpoints.drafts(id));
  const drafts = arr(DraftSchema, draftsF, "drafts");
  const draftBundles: DraftBundle[] = [];
  for (const dr of drafts.slice(0, 3)) {
    const draftF = await fetchJson<unknown>(p, endpoints.draft(dr.draft_id));
    const picksF = await fetchJson<unknown>(p, endpoints.draftPicks(dr.draft_id));
    const tradedDF = await fetchJson<unknown>(p, endpoints.draftTradedPicks(dr.draft_id));
    draftBundles.push({
      id: dr.draft_id,
      draftF,
      draft: parseOne(DraftSchema, draftF.data).value,
      picksF,
      picks: arr(DraftPickSchema, picksF, "draft picks"),
      tradedF: tradedDF,
      traded: Array.isArray(tradedDF.data) ? tradedDF.data : [],
    });
  }
  const winnersF = await fetchJson<unknown>(p, endpoints.winnersBracket(id));
  const losersF = await fetchJson<unknown>(p, endpoints.losersBracket(id));
  const winners = arr(BracketSchema, winnersF, "winners_bracket");
  const losers = arr(BracketSchema, losersF, "losers_bracket");

  // Players DB (public, ≤ 1 download a day, shared with the other probes).
  let players: Record<string, SleeperPlayer> = {};
  let playersF: Data["playersF"];
  try {
    const r = await getSleeperPlayers();
    players = r.data;
    playersF = { ok: true, status: r.res.status, fromCache: r.res.fromCache, bytes: Buffer.byteLength(r.res.text, "utf8"), contentLength: r.res.headers["content-length"] };
  } catch (err) {
    playersF = { ok: false, status: 0, fromCache: false, error: err instanceof Error ? err.message : String(err) };
  }

  const rostered = new Set<string>();
  for (const r of rosters) for (const pid of [...(r.players ?? []), ...(r.reserve ?? []), ...(r.taxi ?? [])]) rostered.add(pid);

  // ---- register every identity before anything league-specific is printed ----
  const referenced = new Set<string>(rostered);
  for (const rows of matchups.values()) for (const m of rows) for (const pid of m.players ?? []) referenced.add(pid);
  for (const t of allTx) for (const pid of [...Object.keys(t.adds ?? {}), ...Object.keys(t.drops ?? {})]) referenced.add(pid);
  for (const b of draftBundles) for (const pk of b.picks) referenced.add(pk.player_id);
  const playerNames = [...referenced].map((pid) => players[pid]?.full_name ?? [players[pid]?.first_name, players[pid]?.last_name].filter(Boolean).join(" ")).filter((n): n is string => Boolean(n));
  const teamCodes = Object.values(players).filter((pl) => pl.position === "DEF").map((pl) => pl.player_id);
  const structural = structuralStrings({
    league,
    rosters,
    transactions: allTx,
    drafts,
    playerNames,
    extra: [...POS, ...teamCodes, ...Object.keys(INJURY_MAP), "DNR", "COV", "Active", "Inactive", "Injured Reserve"],
  });
  const numTeams = league.total_rosters || rosters.length;
  const ids = new SleeperIdentities(p.redactor, structural, numTeams);
  ids.league(league, 1);
  ids.members(users, rosters);
  ids.leagueExtras(league);
  if (choice.userId) ids.user(choice.userId);
  const lookup = choice.userLookup?.ok ? parseOne(UserSchema, choice.userLookup.data).value : null;
  if (lookup) ids.userObject(lookup);
  ids.transactions(allTx);
  ids.drafts([...drafts, ...draftBundles.map((b) => b.draft).filter((x): x is SleeperDraft => x !== null)]);
  ids.draftPicks(draftBundles.flatMap((b) => b.picks));
  // Env modes: the user's (Parker's) league list is saved trimmed: the probed league plus the next
  // few by rank, each registered from the same raw objects the fixture is built from. The fallback
  // never fetches the stranger's list (its fixture is a one-entry example built from this league).
  const rawList: unknown[] = choice.mode !== "fallback" && choice.userLeagues?.ok && Array.isArray(choice.userLeagues.data) ? choice.userLeagues.data : [];
  const others = rankUserLeagues(rawList.filter((l) => isRecord(l) && l.league_id !== league.league_id)).slice(0, USER_LEAGUES_KEPT - 1);
  others.forEach((l, i) => {
    ids.league(l, i + 2);
    ids.leagueExtras(l);
  });
  const keepIds = new Set([league.league_id, ...others.map((l) => l.league_id)]);
  const userLeaguesKept = validLeagues(rawList).filter((l) => keepIds.has(l.league_id));
  ids.sweepLongIds([leagueF.data, usersF.data, rostersF.data, [...matchupsF.values()].map((f) => f.data), [...txF.values()].map((f) => f.data), tradedF.data, draftsF.data, winnersF.data, losersF.data, choice.userLookup?.data ?? null, rawList]);
  ids.sweepLongIds(draftBundles.map((b) => [b.draftF.data, b.tradedF.data]));
  for (const b of draftBundles) ids.sweepLongIds(b.picksF.data, protectDraftPicks);
  p.cl.meta.sanitizer = { registered: p.redactor.entries().length, skippedAsOrdinaryData: ids.skipped };

  const settings = league.settings;
  const num = (k: string) => (typeof settings[k] === "number" ? (settings[k] as number) : undefined);
  const lastScored = num("last_scored_leg") ?? Math.max(0, currentWeek - 1);
  const playoffStart = num("playoff_week_start") ?? 15;
  const wb = bracketShape(winners);
  const rounds = wb.rounds || Math.ceil(Math.log2(Math.max(2, num("playoff_teams") ?? 2)));
  return {
    p,
    role,
    choice,
    season,
    currentWeek,
    stateF,
    state,
    leagueF,
    league,
    settings,
    usersF,
    users,
    rostersF,
    rosters,
    matchupsF,
    matchups,
    txF,
    txByWeek,
    allTx,
    tradedF,
    traded,
    draftsF,
    drafts,
    draftBundles,
    winnersF,
    winners,
    losersF,
    losers,
    parseProblems,
    playersF,
    players,
    rostered,
    num,
    lastScored,
    playoffStart,
    lastPlayoff: lastPlayoffWeek(playoffStart, rounds, num("playoff_round_type")),
    startWeek: num("start_week") ?? 1,
    numTeams,
    positions: startablePositions(league.roster_positions),
    userLeaguesKept,
    userLeaguesTotal: rawList.length,
    crawl: readProbeChecks("sleeper-codes"),
    shared: readProbeChecks("shared"),
    schedule: null,
  };
}

const fixtureStats = { saved: 0, refused: 0 };
/** Labels written this run (stale ones under the role prefix are pruned at the end). */
const savedLabels = new Set<string>();

/** Save a sanitized copy; a LeakError is reported as ❌ (the fixture is not written) instead of crashing. */
async function saveClean(p: ProbeContext, label: string, f: Pick<Fetched<unknown>, "template" | "status" | "res">, body: unknown, protect: (path: JsonPath) => boolean, note?: string): Promise<boolean> {
  try {
    await p.saveSanitized(label, body, { url: f.template, status: f.status, contentType: f.res?.contentType, note }, { protect });
    fixtureStats.saved++;
    savedLabels.add(label);
    return true;
  } catch (err) {
    if (!(err instanceof LeakError)) throw err;
    fixtureStats.refused++;
    p.cl.fail("FIX", `fixture.${label}`, "Sanitized fixture", `not saved: ${err.message}`);
    return false;
  }
}

async function saveLeagueFixtures(d: Data): Promise<void> {
  const { p, role, league } = d;
  const id = league.league_id;
  const both = async (rawKey: string, label: string, f: Fetched<unknown>, protect: (path: JsonPath) => boolean = protectLeagueData) => {
    await p.saveRaw(rawKey, f.data, f.res);
    await saveClean(p, `${role}/${label}`, f, f.data, protect);
  };
  await both(`league/${id}`, "league/{leagueId}", d.leagueF);
  await both(`league/${id}/users`, "league/{leagueId}/users", d.usersF);
  await both(`league/${id}/rosters`, "league/{leagueId}/rosters", d.rostersF);
  for (const [w, f] of d.matchupsF) await both(`league/${id}/matchups/${w}`, `league/{leagueId}/matchups/${w}`, f);
  for (const [w, f] of d.txF) await both(`league/${id}/transactions/${w}`, `league/{leagueId}/transactions/${w}`, f);
  await both(`league/${id}/traded_picks`, "league/{leagueId}/traded_picks", d.tradedF);
  await both(`league/${id}/drafts`, "league/{leagueId}/drafts", d.draftsF);
  for (const [i, b] of d.draftBundles.entries()) {
    const n = i === 0 ? "{draftId}" : `{draftId${i + 1}}`;
    await both(`draft/${b.id}`, `draft/${n}`, b.draftF);
    await both(`draft/${b.id}/picks`, `draft/${n}/picks`, b.picksF, protectDraftPicks);
    await both(`draft/${b.id}/traded_picks`, `draft/${n}/traded_picks`, b.tradedF);
  }
  await both(`league/${id}/winners_bracket`, "league/{leagueId}/winners_bracket", d.winnersF);
  await both(`league/${id}/losers_bracket`, "league/{leagueId}/losers_bracket", d.losersF);

  const ch = d.choice;
  if (ch.userLookup) {
    await p.saveRaw("user/lookup", ch.userLookup.data, ch.userLookup.res);
    await saveClean(p, `${role}/user/{userId}`, ch.userLookup, ch.userLookup.data, protectLeagueData);
  }
  if (ch.mode === "fallback") {
    // A stranger's real league list would reveal their other leagues: commit a one-entry example
    // instead, built from this league's own object plus the two list-only fields.
    const latest = [...d.allTx].sort((a, b) => b.created - a.created)[0];
    const example = [{ ...(isRecord(d.leagueF.data) ? d.leagueF.data : {}), display_order: 0, last_transaction_id: latest?.transaction_id ?? null }];
    await saveClean(
      p,
      `${role}/user/{userId}/leagues/nfl/${d.season} (one-entry example)`,
      { template: endpoints.userLeagues("{userId}", d.season).template, status: 200 },
      example,
      protectLeagueData,
      "synthetic one-entry example: the probed league's /league/{leagueId} object plus the list-only fields display_order and last_transaction_id; the real league list isn't fetched or committed",
    );
  } else if (ch.userLeagues?.ok && Array.isArray(ch.userLeagues.data)) {
    await p.saveRaw(`user/leagues/${d.season}`, ch.userLeagues.data, ch.userLeagues.res);
    await saveClean(p, `${role}/user/{userId}/leagues/nfl/${d.season}`, ch.userLeagues, d.userLeaguesKept, protectLeagueData, `trimmed to the probed league + the next ${d.userLeaguesKept.length - 1} by rank`);
  }
}

/** The NFL schedule from Sleeper's undocumented /schedule (public), for byes and game dates. */
async function loadSchedule(d: Data): Promise<ScheduleData | null> {
  const f = await fetchJson<unknown>(d.p, endpoints.schedule(d.season), "schedule");
  if (!f.ok || !Array.isArray(f.data)) return { f, rows: [], teamsByWeek: new Map(), allTeams: new Set(), lastDateByWeek: new Map() };
  const rows = (f.data as unknown[]).filter(isRecord) as ScheduleRow[];
  const teamsByWeek = new Map<number, Set<string>>();
  const allTeams = new Set<string>();
  const lastDateByWeek = new Map<number, string>();
  for (const g of rows) {
    for (const t of [g.home, g.away]) if (t) allTeams.add(t);
    if (typeof g.week !== "number" || g.status === "canceled") continue;
    const s = teamsByWeek.get(g.week) ?? new Set<string>();
    for (const t of [g.home, g.away]) if (t) s.add(t);
    teamsByWeek.set(g.week, s);
    if (typeof g.date === "string" && g.date > (lastDateByWeek.get(g.week) ?? "")) lastDateByWeek.set(g.week, g.date);
  }
  return { f, rows, teamsByWeek, allTeams, lastDateByWeek };
}

// ============================================================================================
// Evidence helpers
// ============================================================================================

function ev(d: Data, f: Fetched<unknown> | { template: string; status: number }, path: string, sample?: unknown, note?: string): Evidence {
  return { url: f.template, status: f.status, path, sample: sample === undefined ? undefined : d.p.redactor.apply(sample, { protect: protectLeagueData }), note };
}

/** True when every named probe:sleeper-codes check exists with status ok. */
function crawlOk(d: Data, ...keys: string[]): boolean {
  return !!d.crawl && keys.every((k) => d.crawl?.checks.get(k)?.status === "ok");
}

/** What a probe:sleeper-codes check says about one value (quoted as evidence), or null. */
function crawlClause(d: Data, key: string, value: number | string): string | null {
  const c = d.crawl?.checks.get(key);
  return c && value !== "" ? crawlValueClause(c.summary, value) : null;
}

/** "probe:sleeper-codes CODES.x (ok)" style citation, or a note that the crawl output is missing. */
function crawlCite(d: Data, ...keys: string[]): string {
  if (!d.crawl) return "probe:sleeper-codes output not found, so this reading is unverified";
  return `probe:sleeper-codes ${keys.map((k) => `${k} ${d.crawl?.checks.get(k)?.status ?? "missing"}`).join(", ")}`;
}

/**
 * The player's position for this league: his listed position if the league can start it, else the
 * first fantasy position the league can start (two-way players such as a WR/DB in a league without
 * IDP), else his listed position.
 */
function fantasyPos(pl: SleeperPlayer | undefined, allowed: readonly string[] = POS): string {
  if (!pl) return "?";
  const pos = pl.position ?? "";
  const fps = pl.fantasy_positions ?? [];
  if (allowed.includes(pos)) return pos;
  const fit = fps.find((x) => allowed.includes(x));
  if (fit) return fit;
  if ((POS as readonly string[]).includes(pos)) return pos;
  return fps.find((x) => (POS as readonly string[]).includes(x)) ?? (pos || "?");
}

function playerLabel(d: Data, pid: string): string {
  const pl = d.players[pid];
  const name = pl?.full_name ?? [pl?.first_name, pl?.last_name].filter(Boolean).join(" ");
  return `${name || "unknown"} (${fantasyPos(pl, d.positions)}, ${pl?.team ?? "FA"}, id ${pid})`;
}

/** Positions a lineup can start (from roster_positions), for projections/free agents. */
function startablePositions(rosterPositions: string[]): string[] {
  const out = new Set<string>();
  for (const s of rosterPositions) for (const pos of SLOT_ELIGIBLE[s] ?? []) out.add(pos);
  return POS.filter((x) => out.has(x));
}

/** DEF rows vs player rows, for projection/stat key maps (projections embed the player object). */
const projKind = (r: SleeperStatRow): RowKind => (r.player?.position === "DEF" ? "DEF" : "player");

// ============================================================================================
// A. League basics
// ============================================================================================

function checkA(d: Data): void {
  const { p, league, settings, num, state, stateF, leagueF: lf } = d;
  const { cl } = p;
  const evidence: Record<string, { confidence: Confidence; basis: string }> = {};

  // Season
  const seasonOk = league.season === String(d.season) && state?.season === league.season;
  cl.add("A", "A.season", "Season", seasonOk ? "ok" : "warn", `league.season ${league.season}; /state/nfl season ${state?.season ?? "?"} (league_season ${state?.league_season ?? "?"})`, ev(d, lf, "season", league.season), ev(d, stateF, "season", state?.season));

  // Regular season (computed first: the current-week check leans on scored weeks)
  const start = num("start_week");
  const pws = num("playoff_week_start");
  const regWeeks: number[] = [];
  if (start !== undefined && pws !== undefined) for (let w = start; w < pws; w++) regWeeks.push(w);
  const regPaired = regWeeks.length > 0 && regWeeks.every((w) => matchupPairs(w, d.matchups.get(w) ?? []).pairs.length * 2 === d.numTeams);
  const scoredOk = [...d.matchups].every(([w, rows]) => (w <= d.lastScored ? rows.some((r) => (r.points ?? 0) > 0) : rows.every((r) => !r.points)));

  // Current week
  const leg = num("leg");
  const weekConsistent = state !== null && d.lastScored === state.week - 1;
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/New_York" }).format(new Date());
  const lagging = state ? [state.display_week !== undefined && state.display_week !== state.week ? `display_week (${state.display_week})` : "", leg !== undefined && leg !== state.week ? `settings.leg (${leg})` : ""].filter(Boolean) : [];
  cl.add(
    "A",
    "A.currentWeek",
    "Current week",
    state ? (weekConsistent && scoredOk ? "ok" : "warn") : "fail",
    state ? `NFL week ${state.week} (display_week ${state.display_week ?? "?"}, ${state.season_type}); league settings.leg ${leg ?? "?"}, last_scored_leg ${d.lastScored} → weeks ${d.startWeek}–${d.lastScored} completed; matchups have points exactly for weeks ≤ ${d.lastScored}: ${scoredOk ? "yes" : "NO"}` : "no /state/nfl",
    ev(d, stateF, "week / display_week / season_type", { week: state?.week, display_week: state?.display_week, leg: state?.leg, season_type: state?.season_type }),
    ev(d, lf, "settings.leg / settings.last_scored_leg", { leg, last_scored_leg: num("last_scored_leg") }, state ? `run on a ${weekday} (US Eastern) of NFL week ${state.week}: ${lagging.length ? `${lagging.join(" and ")} still behind` : "display_week and settings.leg equal the NFL week"}` : undefined),
  );
  if (weekConsistent && scoredOk) evidence.last_scored_leg = { confidence: "verified", basis: `equals /state/nfl week − 1; matchups for weeks ≤ ${d.lastScored} have points, later weeks none` };
  if (state) {
    cl.decision(
      `currentWeek = /state/nfl \`week\` (the NFL week whose games are next); completed weeks = start_week..settings.last_scored_leg. ${
        lagging.length ? `On this run (a ${weekday}, US Eastern) ${lagging.join(" and ")} lagged behind week ${state.week}` : `On this run display_week and settings.leg both matched week ${state.week}, but`
      }${lagging.length ? ";" : ""} settings.leg advances only when the league's weekly waivers run (${crawlCite(d, "CODES.leg")}), so neither is used for the current week.`,
    );
  }

  // Teams
  const nt = num("num_teams");
  const teamsOk = league.total_rosters === nt && d.rosters.length === league.total_rosters;
  cl.add("A", "A.numTeams", "Number of teams", teamsOk ? "ok" : "warn", `total_rosters ${league.total_rosters}, settings.num_teams ${nt ?? "?"}, /rosters length ${d.rosters.length}`, ev(d, lf, "total_rosters / settings.num_teams", { total_rosters: league.total_rosters, num_teams: nt }), ev(d, d.rostersF, "[].roster_id", d.rosters.length));
  if (teamsOk) evidence.num_teams = { confidence: "verified", basis: "equals total_rosters and the number of rosters" };

  cl.add(
    "A",
    "A.regularSeasonWeeks",
    "Regular-season weeks",
    start !== undefined && pws !== undefined && regPaired ? "ok" : "warn",
    start !== undefined && pws !== undefined ? `weeks ${start}–${pws - 1} (start_week..playoff_week_start−1); ${regPaired ? `every week has ${d.numTeams / 2} matchup pairs` : "NOT every week is fully paired"}` : "start_week or playoff_week_start missing",
    ev(d, lf, "settings.start_week / settings.playoff_week_start", { start_week: start, playoff_week_start: pws }),
    ev(d, d.matchupsF.get(start ?? 1) ?? lf, "[].matchup_id (weeks start..playoff_week_start−1)", `${regWeeks.length} weeks all fully paired: ${regPaired}`),
  );
  if (start !== undefined && regPaired && scoredOk) evidence.start_week = { confidence: "verified", basis: `week ${start} is the first week with matchups and points` };
  cl.add("A", "A.playoffWeekStart", "Playoff start week", pws !== undefined ? "ok" : "fail", pws !== undefined ? `NFL week ${pws}` : "settings.playoff_week_start missing", ev(d, lf, "settings.playoff_week_start", pws));

  const pt = num("playoff_teams");
  const wb = bracketShape(d.winners);
  const lb = bracketShape(d.losers);
  const bracketAgrees = pt !== undefined && wb.seededTeams === pt;
  cl.add(
    "A",
    "A.playoffTeams",
    "Playoff teams",
    pt === undefined ? "fail" : bracketAgrees ? "ok" : "warn",
    `settings.playoff_teams ${pt ?? "?"}; winners_bracket seeds ${wb.seededTeams} teams (${wb.matches} matches, ${wb.rounds} rounds, ${wb.decided} decided)`,
    ev(d, lf, "settings.playoff_teams", pt),
    ev(d, d.winnersF, "[].t1 / [].t2 without t1_from/t2_from", { matches: wb.matches, rounds: wb.rounds, seeded: wb.seededTeams, placementGames: wb.placementGames }, wb.decided === 0 && wb.matches ? "the bracket already exists with no match decided (w/l null): provisional seeds" : undefined),
  );
  if (bracketAgrees) evidence.playoff_teams = { confidence: "verified", basis: "winners_bracket seeds the same number of teams" };
  const byes = pt !== undefined ? impliedByes(pt) : undefined;
  const pst = num("playoff_seed_type");
  cl.add(
    "A",
    "A.playoffByes",
    "Playoff byes",
    byes !== undefined && wb.matches > 0 && wb.byes === byes ? "ok" : "warn",
    `no settings key; derived ${byes ?? "?"} (next power of two − playoff_teams); winners_bracket gives ${wb.byes} team(s) a first-round bye`,
    ev(d, d.winnersF, "[r>1].t1/t2 set without *_from", { derived: byes, fromBracket: wb.byes, firstRoundTeams: wb.firstRoundTeams }),
    ev(d, lf, "settings.playoff_seed_type", pst, `${codeName("playoff_seed_type", pst)} (${crawlCite(d, "CODES.playoffSeedType")})`),
  );

  const prt = num("playoff_round_type");
  const prtKnown = prt === undefined || [0, 1, 2].includes(prt);
  const rounds = wb.rounds || Math.ceil(Math.log2(Math.max(2, pt ?? 2)));
  const uncapped = pws !== undefined ? pws + (prt === 2 ? 2 * rounds : prt === 1 ? rounds + 1 : rounds) - 1 : undefined;
  const prtClause = crawlClause(d, "CODES.playoffRoundType", prt ?? 0);
  cl.add(
    "A",
    "A.playoffRounds",
    "Playoff round length",
    pws !== undefined && wb.rounds > 0 && prtKnown && crawlOk(d, "CODES.playoffRoundType") && uncapped !== undefined && uncapped <= 18 ? "ok" : "warn",
    `playoff_round_type ${prt ?? "absent"} (${codeName("playoff_round_type", prt ?? 0)}) × ${wb.rounds || `${rounds} (from playoff_teams; no bracket yet)`} bracket round(s) → playoff weeks ${pws ?? "?"}–${d.lastPlayoff}${uncapped !== undefined && uncapped > 18 ? ` (would run to week ${uncapped}: capped at 18)` : ""}; code meaning per ${crawlCite(d, "CODES.playoffRoundType")}${prtClause ? `, which for this value says "${prtClause}"` : ""}`,
    ev(d, lf, "settings.playoff_round_type", prt ?? null),
    ev(d, d.winnersF, "[].r (max)", wb.rounds),
  );

  const ptype = num("playoff_type");
  const ptClause = crawlClause(d, "CODES.playoffType", ptype ?? "");
  const pstClause = crawlClause(d, "CODES.playoffSeedType", pst ?? "");
  cl.add(
    "A",
    "A.playoffType",
    "Playoff format codes",
    ptype !== undefined && pst !== undefined && [0, 1].includes(ptype) && [0, 1].includes(pst) && crawlOk(d, "CODES.playoffType", "CODES.playoffSeedType") ? "ok" : "warn",
    `playoff_type ${ptype ?? "absent"} → ${codeName("playoff_type", ptype)}; playoff_seed_type ${pst ?? "absent"} → ${codeName("playoff_seed_type", pst)}; meanings per ${crawlCite(d, "CODES.playoffType", "CODES.playoffSeedType")}${ptClause || pstClause ? ` ("${[ptClause, pstClause].filter(Boolean).join('"; "')}")` : ""}`,
    ev(d, lf, "settings.playoff_type / settings.playoff_seed_type", { playoff_type: ptype, playoff_seed_type: pst }),
    ev(d, d.losersF, "losers_bracket", { matches: lb.matches, rounds: lb.rounds, seeded: lb.seededTeams }, lb.matches ? "a losers bracket exists" : "no losers bracket"),
  );

  // Trades
  const td = num("trade_deadline");
  const trades = d.allTx.filter((t) => t.type === "trade" && t.status === "complete");
  const lastTradeLeg = trades.reduce((m, t) => Math.max(m, t.leg), 0);
  const noDeadline = td === 99;
  const deadlineCheck = noDeadline ? "CODES.tradeDeadlineNone" : "CODES.tradeDeadline";
  const deadlineConsistent = td === undefined || noDeadline || lastTradeLeg <= td;
  cl.add(
    "A",
    "A.tradeDeadline",
    "Trade deadline",
    td !== undefined && crawlOk(d, deadlineCheck) && deadlineConsistent ? "ok" : "warn",
    `${td === undefined ? "settings.trade_deadline missing" : noDeadline ? "trade_deadline 99 → no deadline" : `trade_deadline ${td} → trades complete through league week ${td} (the last transaction leg with trades; 99 means no deadline)`}; meaning per ${crawlCite(d, deadlineCheck)}; this league's latest completed trade is in leg ${lastTradeLeg || "n/a"}${deadlineConsistent ? "" : " — AFTER the deadline"}`,
    ev(d, lf, "settings.trade_deadline", td ?? null),
    ev(d, lf, "settings.disable_trades", num("disable_trades") ?? null),
  );

  // Trade review: the mapping from veto_auto_poll (F1), checked against this league's own trades.
  const mapping = tradeReviewFromSettings(settings);
  const trd = num("trade_review_days");
  const vvn = num("veto_votes_needed");
  const vap = num("veto_auto_poll");
  const timed = trades.filter((t) => typeof t.status_updated === "number").map((t) => ({ days: ((t.status_updated as number) - t.created) / 86_400_000, poll: isRecord(t.metadata) && Boolean(t.metadata.poll_id) }));
  const withPoll = timed.filter((t) => t.poll).length;
  const fastest = timed.length ? Math.min(...timed.map((t) => t.days)) : undefined;
  const notEnforced = mapping === "none" && trd !== undefined && trd > 0 && fastest !== undefined && fastest < trd;
  const contradicts = mapping === "none" ? withPoll > 0 : timed.length > 0 && withPoll < timed.length;
  // This league alone verifies the mapping for its own value when 3+ trades all agree with it.
  const locallyVerified = timed.length >= 3 && !contradicts && (mapping === "league_vote" ? withPoll === timed.length : withPoll === 0);
  // With the poll on: did every polled trade wait trade_review_days (the "vote length" reading)?
  const pollEarly = mapping === "league_vote" && trd !== undefined && trd > 0 ? timed.filter((t) => t.poll && t.days < trd) : [];
  const daysText = timed.map((t) => t.days.toFixed(2)).join(", ");
  const vapClause = crawlClause(d, "CODES.tradeReview", vap ?? 0);
  cl.add(
    "A",
    "A.tradeReview",
    "Trade review / veto",
    (crawlOk(d, "CODES.tradeReview") || locallyVerified) && !contradicts ? "ok" : "warn",
    `veto_auto_poll ${vap ?? "absent"} → tradeReview '${mapping}' (${mapping === "none" ? "no veto poll: trades process as soon as they're accepted, whatever trade_review_days says" : `every trade opens a veto poll; trade_review_days ${trd ?? "?"}, veto_votes_needed ${vvn ?? "?"}`}); mapping per ${crawlCite(d, "CODES.tradeReview")}${vapClause ? ` ("veto_auto_poll = ${vapClause}")` : ""}; this league: ${
      timed.length
        ? `${timed.length} completed trade(s) processed ${daysText} day(s) after they were proposed, veto poll (metadata.poll_id) on ${withPoll}${locallyVerified ? " (verifies the mapping for this value)" : ""}${notEnforced ? `; one completed ${(fastest as number).toFixed(2)} days after it was proposed although trade_review_days is ${trd}, so the review days aren't enforced here` : ""}${pollEarly.length ? `; ${pollEarly.length} of ${withPoll} polled trade(s) completed sooner than trade_review_days (fastest ${Math.min(...pollEarly.map((t) => t.days)).toFixed(2)} days), so the vote doesn't always run its full length` : ""}${contradicts ? " — CONTRADICTS the mapping" : ""}`
        : "no completed trades to time"
    }`,
    ev(d, lf, "settings.trade_review_days / veto_votes_needed / veto_auto_poll / veto_show_votes", { trade_review_days: trd, veto_votes_needed: vvn, veto_auto_poll: vap, veto_show_votes: num("veto_show_votes") }),
    ev(d, d.txF.get(trades[0]?.leg ?? 1) ?? lf, "[type=trade].status_updated − created (days); [type=trade].metadata.poll_id", { days: timed.map((t) => Math.round(t.days * 100) / 100), withPoll }),
  );
  if (notEnforced) evidence.trade_review_days = { confidence: "corroborated", basis: `not enforced without the veto poll here: a trade completed ${(fastest as number).toFixed(2)} days after it was proposed with trade_review_days ${trd}` };
  if (pollEarly.length) evidence.trade_review_days = { confidence: "inferred", basis: `not a fixed wait here: ${pollEarly.length} of ${withPoll} polled trades completed sooner than ${trd} days` };
  if (timed.length && !contradicts) evidence.veto_auto_poll = { confidence: locallyVerified ? "verified" : "corroborated", basis: `veto poll on ${withPoll}/${timed.length} completed trades here` };
  if (pollEarly.length) {
    cl.issue(`Sleeper veto polls don't always run for trade_review_days: in this league (veto_auto_poll 1, trade_review_days ${trd}), ${pollEarly.length} of ${withPoll} completed trades that carried a veto poll completed sooner (fastest ${Math.min(...pollEarly.map((t) => t.days)).toFixed(2)} days after they were proposed)${d.crawl?.checks.has("CODES.tradeReview") ? ", while the crawl (probe:sleeper-codes CODES.tradeReview) saw none finish sooner in its few poll trades" : ""} — evidence: GET https://api.sleeper.app/v1/league/{leagueId}/transactions/{week} (HTTP 200), path [type=trade].metadata.poll_id and status_updated − created — options: model the veto window as "up to trade_review_days" (veto risk applies only while the poll is open; the reason a poll ends early, e.g. commissioner action or enough votes, isn't in the data); keep 'league_vote' as the mapping.`);
  }
  cl.decision(`Sleeper tradeReview = 'league_vote' when settings.veto_auto_poll = 1, else 'none'; 'commissioner' is never produced (Sleeper shows no approval step in the data). trade_review_days matters only with the poll (${crawlCite(d, "CODES.tradeReview")}).`);

  // League type
  const type = num("type");
  const draftScoring = d.drafts.map((x) => String(x.metadata?.scoring_type ?? "")).filter(Boolean);
  const corroborated = type === 2 ? draftScoring.some((s) => s.startsWith("dynasty")) : type === 0 ? draftScoring.length > 0 && draftScoring.every((s) => !s.startsWith("dynasty")) : type === 3 ? num("last_chopped_leg") !== undefined : false;
  if (corroborated) evidence.type = { confidence: "corroborated", basis: type === 3 ? "settings.last_chopped_leg present" : `draft metadata.scoring_type ${draftScoring.join(", ")}` };
  const futurePickRows = d.traded.filter((t) => Number(t.season) > d.season).length;
  cl.add(
    "A",
    "A.leagueType",
    "League type",
    type !== undefined && [0, 1, 2, 3].includes(type) && (corroborated || crawlOk(d, "CODES.type", "CODES.type3")) ? "ok" : "warn",
    `settings.type ${type ?? "?"} → ${codeName("type", type)} (codes per ${crawlCite(d, "CODES.type", "CODES.type3")})${corroborated ? `; corroborated here by ${type === 3 ? "settings.last_chopped_leg" : "the draft's metadata.scoring_type"}` : "; not corroborated by this league's own data"}; taxi_slots ${num("taxi_slots") ?? "?"}, draft_rounds ${num("draft_rounds") ?? "?"}, max_keepers ${num("max_keepers") ?? "?"}, ${d.traded.length} traded-pick row(s) (${futurePickRows} for future seasons)`,
    ev(d, lf, "settings.type", type ?? null),
    ev(d, d.draftsF, "[].metadata.scoring_type", draftScoring),
  );

  // Median game
  const lam = num("league_average_match");
  const played = Math.max(0, d.lastScored - (start ?? 1) + 1);
  const games = d.rosters.map((r) => (r.settings.wins ?? 0) + (r.settings.losses ?? 0) + (r.settings.ties ?? 0));
  const expectPerWeek = lam === 1 ? 2 : 1;
  const medianVerified = games.length > 0 && games.every((g) => g === played * expectPerWeek);
  if (medianVerified) evidence.league_average_match = { confidence: "verified", basis: `every roster has ${played * expectPerWeek} decisions after ${played} scored weeks` };
  cl.add(
    "A",
    "A.medianGame",
    "Median game",
    lam === undefined ? "fail" : medianVerified ? "ok" : "warn",
    `league_average_match ${lam ?? "?"} → ${lam === 1 ? "on" : "off"}; ${medianVerified ? "verified" : "NOT confirmed"}: W+L+T per roster = ${[...new Set(games)].join("/")} after ${played} scored week(s) (expect ${played * expectPerWeek})`,
    ev(d, lf, "settings.league_average_match", lam ?? null),
    ev(d, d.rostersF, "[].settings.wins + losses + ties", [...new Set(games)]),
  );

  // Divisions + points-only
  const rosterDivs = d.rosters.filter((r) => r.settings.division !== undefined).length;
  const metaDivs = Object.keys(league.metadata ?? {}).filter((k) => /^division_\d+$/.test(k));
  const divCount = num("divisions");
  const hasDivs = divCount !== undefined && divCount > 1;
  cl.add(
    "A",
    "A.divisions",
    "Divisions",
    hasDivs ? (rosterDivs === d.rosters.length ? "ok" : "warn") : rosterDivs === 0 && crawlOk(d, "CODES.divisions") ? "ok" : "warn",
    hasDivs
      ? `settings.divisions ${divCount}; rosters with settings.division ${rosterDivs}/${d.rosters.length}; metadata division names ${metaDivs.length}`
      : `no divisions: settings.divisions ${divCount ?? "absent"}, rosters[].settings.division on ${rosterDivs}/${d.rosters.length}; key names (settings.divisions, rosters[].settings.division, metadata division_N) per ${crawlCite(d, "CODES.divisions")}`,
    ev(d, lf, "settings.divisions / metadata.division_N", { divisions: divCount ?? null, metadataDivisionKeys: metaDivs.length }),
    ev(d, d.rostersF, "[].settings.division", rosterDivs),
  );
  const pointsKeys = Object.keys(settings).filter((k) => /points_only|total_points|h2h|head/i.test(k));
  cl.warn(
    "A",
    "A.pointsOnly",
    "Points-only flag",
    `no points-only setting among the ${Object.keys(settings).length} settings keys${pointsKeys.length ? ` (candidates: ${pointsKeys.join(", ")})` : ""}; ${regPaired ? `every regular-season week (${regWeeks.length}) has head-to-head pairs, so pointsOnly = false (derived)` : "NOT every regular-season week has complete head-to-head pairs, so points-only can't be ruled out"}`,
    ev(d, lf, "settings (all keys)", Object.keys(settings).length),
    ev(d, d.matchupsF.get(start ?? 1) ?? lf, "[].matchup_id pairs per regular-season week", `${regWeeks.length} weeks fully paired: ${regPaired}`),
  );

  // Every settings key with meaning + confidence (this league's evidence, then the crawl)
  if (d.traded.length && num("pick_trading") === 1) evidence.pick_trading = { confidence: "corroborated", basis: `${d.traded.length} traded-pick rows exist` };
  // best_ball: in a best-ball league every team's points equal its potential (optimal-lineup) points.
  const atPotential = d.rosters.map((r) => {
    const s = r.settings as Record<string, unknown>;
    return typeof s.ppts === "number" ? Math.abs(rosterPoints(r.settings).pf - (s.ppts + Number(s.ppts_decimal ?? 0) / 100)) < 0.011 : undefined;
  });
  if (d.lastScored >= 1 && atPotential.length && atPotential.every((x) => x !== undefined)) {
    const n = atPotential.filter(Boolean).length;
    const bb = num("best_ball") ?? 0;
    if (bb === 0 && n < atPotential.length / 2) evidence.best_ball = { confidence: "verified", basis: `points equal potential points on only ${n}/${atPotential.length} rosters, so managers set the lineups` };
    if (bb === 1 && n === atPotential.length) evidence.best_ball = { confidence: "verified", basis: "points equal potential points on every roster" };
  }
  const maxIr = Math.max(0, ...d.rosters.map((r) => r.reserve?.length ?? 0));
  const maxTaxi = Math.max(0, ...d.rosters.map((r) => r.taxi?.length ?? 0));
  if (num("reserve_slots") !== undefined && maxIr <= (num("reserve_slots") as number) && maxIr > 0) evidence.reserve_slots = { confidence: "corroborated", basis: `max IR used ${maxIr}` };
  if (num("taxi_slots") !== undefined && maxTaxi <= (num("taxi_slots") as number) && maxTaxi > 0) evidence.taxi_slots = { confidence: "corroborated", basis: `max taxi used ${maxTaxi}` };
  const dr = d.draftBundles[0]?.draft;
  if (dr && typeof dr.settings?.rounds === "number" && dr.settings.rounds === num("draft_rounds")) evidence.draft_rounds = { confidence: "verified", basis: "equals the draft's settings.rounds" };
  const waiverBids = d.allTx.filter((t) => typeof t.settings?.waiver_bid === "number").length;
  if (waiverBids && num("waiver_type") === 2) evidence.waiver_type = { confidence: "corroborated", basis: `${waiverBids} waiver claims carry settings.waiver_bid (FAAB)` };
  const budget = num("waiver_budget");
  const maxUsed = Math.max(0, ...d.rosters.map((r) => Number((r.settings as Record<string, unknown>).waiver_budget_used ?? 0)));
  if (budget !== undefined && waiverBids && maxUsed > 0 && maxUsed <= budget) evidence.waiver_budget = { confidence: "corroborated", basis: `FAAB bids exist and every roster's waiver_budget_used (max ${maxUsed}) is within it` };
  const rows = describeSettings(settings, evidence, d.crawl?.checks ?? null);
  d.settingsRows = rows;
  const unknown = rows.filter((r) => r.confidence === "unknown");
  const byConf = countBy(rows, (r) => r.confidence);
  cl.add(
    "A",
    "A.settingsKeys",
    "All settings keys",
    unknown.length ? "warn" : "ok",
    `${rows.length} keys: ${Object.entries(byConf).map(([k, v]) => `${v} ${k}`).join(", ")}; meaning not established: ${unknown.map((r) => r.key).join(", ") || "none"}`,
    ev(d, lf, "settings.*", Object.fromEntries(rows.slice(0, 12).map((r) => [r.key, r.value])), "full table (value, meaning, confidence, basis) in the settings-keys fixture"),
  );

  // Still unresolved after this league + the crawl: needed keys that stay inferred/unknown, crawl
  // checks that aren't fully verified, and the crawl's open questions.
  const unresolved = rows.filter((r) => (SETTINGS_NEEDED.has(r.key) || r.key.startsWith("position_limit_")) && (r.confidence === "inferred" || r.confidence === "unknown"));
  // The crawl's own first clause names what is open, except for CODES.leg whose summary opens with what is settled.
  const CRAWL_TOPICS: Record<string, string> = { "CODES.leg": "which weekday each waiver_day_of_week value is" };
  const crawlOpen = d.crawl ? [...d.crawl.checks].filter(([k, c]) => k.startsWith("CODES.") && c.status !== "ok") : [];
  const parts = [
    unresolved.length ? `needed keys still inferred: ${unresolved.map((r) => `${r.key}=${String(r.value)} (${r.basis ?? "meaning from the key name"})`).join("; ")}` : "",
    crawlOpen.length ? `crawl checks not fully verified: ${crawlOpen.map(([k, c]) => `${k} (${CRAWL_TOPICS[k] ?? crawlGist(c.summary)})`).join("; ")}` : "",
    d.crawl?.questions.length ? `open crawl questions: ${d.crawl.questions.map((q) => firstClause(q, 100)).join(" | ")}` : "",
  ].filter(Boolean);
  if (!d.crawl) {
    cl.issue(`Sleeper settings codes are inferred from this one league because probe:sleeper-codes output (reports/probe-output/sleeper-codes.json) isn't there: ${rows.filter((r) => SETTINGS_NEEDED.has(r.key) && r.confidence !== "verified").map((r) => `${r.key}=${String(r.value)}`).join(", ")} — evidence: GET https://api.sleeper.app/v1/league/{leagueId} (HTTP ${lf.status}), path settings.* — options: run npm run probe:sleeper-codes, then rerun this probe.`);
  } else if (parts.length) {
    cl.issue(`Sleeper settings still unresolved after this league and the crawl of public leagues — ${parts.join(" — ")} — evidence: GET https://api.sleeper.app/v1/league/{leagueId} (HTTP ${lf.status}), path settings.* (full table in the settings-keys fixture); reports/probe-output/sleeper-codes.md — options: use the verified meanings as they are; for the rest, use the stated reading with an Import Report note (veto_votes_needed matters only with the veto poll), and decide how to treat guillotine leagues (settings.type 3).`);
  }
  if (d.parseProblems.length) cl.warn("A", "A.shapes", "Response validation", `${d.parseProblems.length} problem(s): ${d.parseProblems.slice(0, 4).join(" | ")}`);
  else cl.ok("A", "A.shapes", "Response validation", "every league response matched its zod schema (required fields present)");
}

// ============================================================================================
// B. Lineup
// ============================================================================================

function checkB(d: Data): void {
  const { p, league, num, leagueF: lf } = d;
  const { cl } = p;
  const counts = slotCounts(league.roster_positions);
  const unknown = unknownSlots(league.roster_positions);
  const starters = league.roster_positions.filter((s) => !NON_STARTING.has(s)).length;
  const draftSettings = d.draftBundles[0]?.draft?.settings ?? d.drafts[0]?.settings ?? null;
  const draftSlots = draftSettings ? Object.fromEntries(Object.entries(draftSettings).filter(([k]) => k.startsWith("slots_")).map(([k, v]) => [k.slice(6).toUpperCase(), v])) : {};
  const draftAgrees = Object.keys(draftSlots).length > 0 && Object.entries(counts).every(([s, c]) => draftSlots[s] === undefined || draftSlots[s] === c);
  cl.add(
    "B",
    "B.slots",
    "Starting slots",
    unknown.length ? "warn" : "ok",
    `${starters} starters: ${Object.entries(counts).filter(([s]) => !NON_STARTING.has(s)).map(([s, c]) => `${s}×${c}`).join(", ")}${unknown.length ? `; UNKNOWN slot names: ${unknown.join(", ")}` : ""}${draftAgrees ? "; the draft's slots_* settings agree" : ""}`,
    ev(d, lf, "roster_positions[]", league.roster_positions),
    ev(d, d.draftsF, "[].settings.slots_*", draftSlots),
  );

  // FLEX-type eligibility as used in real lineups (platform knowledge, checked against starters).
  const observed: Record<string, Record<string, number>> = {};
  let empty = 0;
  for (let w = d.startWeek; w <= d.lastScored; w++) {
    for (const m of d.matchups.get(w) ?? []) {
      (m.starters ?? []).forEach((pid, i) => {
        const slot = league.roster_positions[i];
        if (!slot) return;
        if (pid === "0" || !pid) {
          empty++;
          return;
        }
        const pos = fantasyPos(d.players[pid], d.positions);
        (observed[slot] ??= {})[pos] = (observed[slot]?.[pos] ?? 0) + 1;
      });
    }
  }
  const violations = Object.entries(observed).flatMap(([slot, byPos]) => Object.keys(byPos).filter((pos) => !(SLOT_ELIGIBLE[slot] ?? []).includes(pos)).map((pos) => `${slot}←${pos}`));
  cl.add(
    "B",
    "B.slotEligibility",
    "Slot eligibility",
    violations.length ? "warn" : "ok",
    `eligibility is platform knowledge (not in the API); starters in weeks ${d.startWeek}–${d.lastScored} fit it: ${violations.length ? `NO (${violations.join(", ")})` : "yes"}; ${empty} empty starter slot(s) ("0")`,
    ev(d, d.matchupsF.get(d.lastScored) ?? lf, "[].starters[i] ↔ roster_positions[i]", observed),
  );

  cl.ok("B", "B.bench", "Bench", `${counts.BN ?? 0} bench (BN) slots`, ev(d, lf, "roster_positions[] = 'BN'", counts.BN ?? 0));

  const irSlots = num("reserve_slots");
  const allow = Object.fromEntries(Object.keys(d.settings).filter((k) => k.startsWith("reserve_allow_")).sort().map((k) => [k.slice(14), d.settings[k]]));
  const maxIr = Math.max(0, ...d.rosters.map((r) => r.reserve?.length ?? 0));
  const irStatuses = countBy(d.rosters.flatMap((r) => r.reserve ?? []), (pid) => injuryLabel(d.players[pid]?.injury_status));
  cl.add(
    "B",
    "B.ir",
    "IR slots",
    irSlots === undefined ? "fail" : maxIr <= irSlots ? "ok" : "warn",
    `reserve_slots ${irSlots ?? "?"} (max used ${maxIr}); allowed statuses: ${Object.entries(allow).filter(([, v]) => v === 1).map(([k]) => k).join(", ") || "none"} (+ IR); on IR now: ${Object.entries(irStatuses).map(([k, v]) => `${k} ${v}`).join(", ") || "nobody"}${irStatuses.PUP && !("pup" in allow) ? " (PUP is on IR although there is no reserve_allow_pup flag)" : ""}${irStatuses.null ? "; a player whose status cleared can stay on IR" : ""}`,
    ev(d, lf, "settings.reserve_slots / settings.reserve_allow_*", { reserve_slots: irSlots, ...allow }),
    ev(d, d.rostersF, "[].reserve[] → players DB injury_status", irStatuses),
  );

  const taxi = num("taxi_slots");
  const maxTaxi = Math.max(0, ...d.rosters.map((r) => r.taxi?.length ?? 0));
  const taxiExp = countBy(d.rosters.flatMap((r) => r.taxi ?? []), (pid) => `years_exp ${String(d.players[pid]?.years_exp ?? "?")}`);
  cl.add(
    "B",
    "B.taxi",
    "Taxi squad",
    taxi === undefined ? "fail" : maxTaxi <= taxi ? "ok" : "warn",
    `taxi_slots ${taxi ?? "?"} (max used ${maxTaxi}), taxi_years ${num("taxi_years") ?? "?"}, taxi_allow_vets ${num("taxi_allow_vets") ?? "?"}, taxi_deadline ${num("taxi_deadline") ?? "?"}`,
    ev(d, lf, "settings.taxi_slots / taxi_years / taxi_allow_vets / taxi_deadline", { taxi_slots: taxi, taxi_years: num("taxi_years"), taxi_allow_vets: num("taxi_allow_vets"), taxi_deadline: num("taxi_deadline") }),
    ev(d, d.rostersF, "[].taxi[] → players DB years_exp", taxiExp),
  );

  const limitKeys = Object.keys(d.settings).filter((k) => k.startsWith("position_limit_"));
  const limitsCheck = d.crawl?.checks.get("CODES.positionLimits");
  const limitsReading = limitsCheck ? crawlReading(limitsCheck.summary) : null;
  // This league's active rosters (players minus IR and taxi) against its own limits.
  let limitsOver = 0;
  let limitsReached = 0;
  for (const k of limitKeys) {
    const pos = k.slice(15).toUpperCase();
    const limit = Number(d.settings[k]);
    for (const r of d.rosters) {
      const out = new Set([...(r.reserve ?? []), ...(r.taxi ?? [])]);
      const n = (r.players ?? []).filter((pid) => !out.has(pid) && fantasyPos(d.players[pid], d.positions) === pos).length;
      if (n > limit) limitsOver++;
      else if (n === limit) limitsReached++;
    }
  }
  const limitsMeaning = `${crawlCite(d, "CODES.positionLimits")}${limitsReading ? ` (reading: ${limitsReading})` : ""}`;
  cl.add(
    "B",
    "B.positionLimits",
    "Position limits",
    limitKeys.length ? (limitsOver === 0 && crawlOk(d, "CODES.positionLimits") ? "ok" : "warn") : limitsCheck ? "ok" : "warn",
    limitKeys.length
      ? `${limitKeys.map((k) => `${k.slice(15).toUpperCase()} ≤ ${String(d.settings[k])}`).join(", ")}; this league's active rosters (players minus IR/taxi): ${limitsOver} roster-limit pair(s) over, ${limitsReached} at the limit; meaning per ${limitsMeaning}`
      : `no position_limit_* keys: this league sets no limits (key names position_limit_<pos> per ${limitsMeaning})`,
    ev(d, lf, "settings.position_limit_*", Object.fromEntries(limitKeys.map((k) => [k, d.settings[k]]))),
    ev(d, d.draftsF, "[].settings.enforce_position_limits", draftSettings?.enforce_position_limits ?? null, "draft-only setting"),
  );

  const active = league.roster_positions.length;
  const sizes = d.rosters.map((r) => (r.players?.length ?? 0) - (r.reserve?.length ?? 0) - (r.taxi?.length ?? 0));
  const over = sizes.filter((s) => s > active).length;
  const irInPlayers = d.rosters.every((r) => (r.reserve ?? []).every((pid) => (r.players ?? []).includes(pid)) && (r.taxi ?? []).every((pid) => (r.players ?? []).includes(pid)));
  cl.add(
    "B",
    "B.maxRoster",
    "Max roster size",
    over === 0 && irInPlayers ? "ok" : "warn",
    `active roster = roster_positions length ${active} (${starters} starters + ${counts.BN ?? 0} BN), plus IR ${irSlots ?? 0} and taxi ${taxi ?? 0}; active sizes now ${span(sizes)}, ${over} over the limit; players[] ${irInPlayers ? "includes" : "does NOT include"} reserve and taxi`,
    ev(d, d.rostersF, "[].players.length − reserve.length − taxi.length", sizes),
  );
}

// ============================================================================================
// C. Scoring
// ============================================================================================

function scoringGroup(k: string): string {
  if (k.startsWith("idp_")) return "IDP";
  if (/^(fgm|fgmiss|xpm|xpmiss|fga|xpa)/.test(k)) return "kicking";
  if (/^(pts_allow|yds_allow|def_|sack$|int$|fum_rec$|safe$|ff$|blk_kick$|st_|tkl|qb_hit)/.test(k)) return "defense/special teams";
  if (k.startsWith("bonus_rec_")) return "position reception bonus";
  if (k.startsWith("bonus_")) return "bonus";
  if (k.endsWith("_fd") || k === "fd") return "first downs";
  if (k.startsWith("pass_")) return "passing";
  if (k.startsWith("rush_")) return "rushing";
  if (k === "rec" || k.startsWith("rec_")) return "receiving";
  if (k.startsWith("fum")) return "fumbles";
  if (/^(kr|pr)(_|$)/.test(k)) return "returns";
  return "other";
}

function checkC(d: Data, proj: Proj, statsWeeks: StatsWeek[]): void {
  const { p, league, leagueF: lf } = d;
  const { cl } = p;
  const sc = league.scoring_settings;
  const keys = Object.keys(sc).sort();
  const nonZero = keys.filter((k) => sc[k] !== 0);
  const groups: Record<string, Record<string, number>> = {};
  for (const k of nonZero) (groups[scoringGroup(k)] ??= {})[k] = round6(sc[k] as number);
  cl.ok("C", "C.rules", "Scoring rules", `${keys.length} scoring_settings keys, ${nonZero.length} non-zero; groups: ${Object.entries(groups).map(([g, v]) => `${g} ${Object.keys(v).length}`).join(", ")}`, ev(d, lf, "scoring_settings", Object.fromEntries(nonZero.map((k) => [k, round6(sc[k] as number)]))));

  const show = (item: string, key: string, title: string, group: string[], extraNote?: string) => {
    const entries = keys.filter((k) => group.includes(scoringGroup(k)));
    const nz = entries.filter((k) => sc[k] !== 0);
    if (!entries.length) cl.na(item, key, title, `no ${group.join("/")} keys in scoring_settings`, ev(d, lf, "scoring_settings", null));
    else cl.ok(item, key, title, `${nz.map((k) => `${k} ${round6(sc[k] as number)}`).join(", ") || "all zero"}${extraNote ? `; ${extraNote}` : ""}`, ev(d, lf, `scoring_settings.{${entries.slice(0, 6).join(",")}${entries.length > 6 ? ",…" : ""}}`, Object.fromEntries(entries.map((k) => [k, round6(sc[k] as number)]))));
  };
  const rec = sc.rec ?? 0;
  const tep = sc.bonus_rec_te ?? 0;
  cl.ok("C", "C.receptions", "Reception scoring", `rec ${rec} (${rec === 1 ? "PPR" : rec === 0.5 ? "half PPR" : rec === 0 ? "standard, no PPR" : "custom"}); position bonuses: ${["bonus_rec_te", "bonus_rec_rb", "bonus_rec_wr", "bonus_rec_qb"].map((k) => `${k} ${sc[k] ?? "absent"}`).join(", ")} → TE premium ${tep > 0 ? "ON" : "off"}`, ev(d, lf, "scoring_settings.rec / bonus_rec_*", { rec, bonus_rec_te: sc.bonus_rec_te, bonus_rec_rb: sc.bonus_rec_rb, bonus_rec_wr: sc.bonus_rec_wr }, "bonus_rec_te etc. stay ordinary perStat keys: /stats carries them as per-reception stats (see K.oracleCrossLeague)"));
  show("C", "C.passing", "Passing", ["passing"]);
  show("C", "C.rushRec", "Rushing and receiving", ["rushing", "receiving"]);
  show("C", "C.fumbles", "Fumbles", ["fumbles"]);
  show("C", "C.firstDowns", "First downs", ["first downs"]);
  // Threshold bonuses (bonus_rec_yd_100 …) in /stats: flags per game? (Per-reception/first-down bonuses are counts.)
  const thresholdValues = countBy(statsWeeks.flatMap((sw) => sw.rows.flatMap((r) => Object.entries(r.stats ?? {}).filter(([k, v]) => v !== 0 && /^bonus_.*_\d+p?$/.test(k)).map(([, v]) => String(v)))), (v) => v);
  show("C", "C.bonuses", "Bonuses", ["bonus"], Object.keys(thresholdValues).length ? `threshold bonuses (bonus_*_<n>) in /stats weeks ${statsWeeks.map((x) => x.week).join(", ")} take the values ${Object.entries(thresholdValues).map(([v, n]) => `${v} (${n} rows)`).join(", ")}: a per-game flag` : "no threshold bonus seen in the sampled /stats weeks");
  show("C", "C.kicking", "Kicking", ["kicking"]);
  show("C", "C.defense", "DEF / special teams", ["defense/special teams", "returns"]);
  show("C", "C.idp", "IDP", ["IDP"]);

  // Projection keys vs scoring keys: aliases (DEF/returns), then what's still missing. The analysis
  // uses every position (proj.wide), not just the ones this league starts.
  const statsOk = statsWeeks.filter((s) => s.f.ok);
  const statsRows = statsOk.flatMap((s) => s.rows);
  const statsKind = (pid: string): RowKind | null => {
    const pl = d.players[pid];
    return !pl ? null : pl.position === "DEF" ? "DEF" : "player";
  };
  const statGroup = (pid: string): StatGroup | null => {
    const pl = d.players[pid];
    if (!pl) return null;
    const pos = fantasyPos(pl, POS);
    return pos === "DEF" ? "DEF" : pos === "K" ? "K" : IDP_POS.includes(pos) ? "IDP" : ["QB", "RB", "WR", "TE"].includes(pos) ? "OFF" : null;
  };
  const projRows = [...proj.all, ...(proj.wide?.rows ?? [])];
  const { seen, direct } = projectedKeySets(projRows, projKind);
  const aliasSrc = aliasSourcesSeen(seen);
  const freq = statsOk.length ? statsFrequency(statsOk.map((s) => s.rows), statGroup) : null;
  const countWeek = proj.wide ?? proj.now;
  const projCount = (kind: RowKind, key: string) => (countWeek?.rows ?? []).filter((r) => projKind(r) === kind && (r.stats?.[key] ?? 0) !== 0).length;
  const statCount = (kind: RowKind, key: string) => statsRows.filter((r) => statsKind(r.player_id) === kind && (r.stats?.[key] ?? 0) !== 0).length;
  const aliasEvidence = {
    projections: {
      DEF: { st_td: projCount("DEF", "st_td"), def_st_td: projCount("DEF", "def_st_td"), def_kr_td: projCount("DEF", "def_kr_td"), def_pr_td: projCount("DEF", "def_pr_td") },
      player: { def_kr_td: projCount("player", "def_kr_td"), pr_td: projCount("player", "pr_td"), st_td: projCount("player", "st_td"), def_kr_yd: projCount("player", "def_kr_yd"), kr_yd: projCount("player", "kr_yd") },
    },
    stats: {
      DEF: { def_st_td: statCount("DEF", "def_st_td"), st_td: statCount("DEF", "st_td"), def_kr_td: statCount("DEF", "def_kr_td"), def_pr_td: statCount("DEF", "def_pr_td") },
      player: { st_td: statCount("player", "st_td"), pr_td: statCount("player", "pr_td"), kr_td: statCount("player", "kr_td"), kr_yd: statCount("player", "kr_yd"), def_kr_yd: statCount("player", "def_kr_yd") },
    },
  };
  const aliasSeenText = PROJECTION_ALIASES.filter((a) => seen[a.kind].has(a.from)).map((a) => `${a.kind} ${a.from} → ${a.to.join("+")}`);
  const floaty = nonZero.filter((k) => Math.abs((sc[k] as number) - round6(sc[k] as number)) > 1e-9);
  cl.warn(
    "C",
    "C.unmapped",
    "Unmapped rules",
    `/stats: none, the scoring_settings keys are the /stats keys (checked by K.oracle); /projections: needs a small key map because it spells special-teams and return stats differently (${aliasSeenText.join("; ") || "no alias source seen"}; DEF rows' own return components dropped) — non-zero row counts below (projections: week ${countWeek?.week ?? "?"}, ${proj.wide ? "all positions" : "this league's positions"}; /stats weeks ${statsOk.map((s) => s.week).join(", ")}: few return TDs, so a small sample)${floaty.length ? `; float32 noise on ${floaty.join(", ")} (e.g. ${sc[floaty[0] as string]}): round rates to 6 decimals` : ""}`,
    { url: "https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular&position[]=…  vs  https://api.sleeper.app/stats/nfl/{season}/{week}?season_type=regular", status: 200, path: "[].stats.{st_td,def_st_td,def_kr_td,def_pr_td,pr_td,kr_yd,def_kr_yd} by DEF vs player rows", sample: aliasEvidence },
    ev(d, lf, "scoring_settings (values)", Object.fromEntries(floaty.map((k) => [k, sc[k]]))),
  );
  cl.decision("Sleeper projections → league points: apply the key map (DEF st_td → def_st_td; player def_kr_td and pr_td → st_td; player def_kr_yd → kr_yd; drop DEF rows' def_kr_td/def_pr_td/pr_td/pr_yd), then Σ scoring_settings[k] × stat; /stats needs no map.");

  // This league's non-zero rules for positions it can start: projected, via the key map, or a proposal per key.
  const startable = new Set<StatGroup>(["OFF", ...(d.positions.includes("K") ? (["K"] as const) : []), ...(d.positions.includes("DEF") ? (["DEF"] as const) : []), ...(IDP_POS.some((x) => d.positions.includes(x)) ? (["IDP"] as const) : [])]);
  const relevant = nonZero.filter((k) => startable.has(keyGroup(k)));
  const ignored = nonZero.filter((k) => !startable.has(keyGroup(k)));
  const thisLeague = projectionCoverage(relevant.map((key) => ({ key })), direct, aliasSrc, freq);
  const needWork = thisLeague.filter((r) => r.kind !== "projected" && r.kind !== "alias");
  const viaAlias = thisLeague.filter((r) => r.kind === "alias");
  d.projectionUncovered = needWork.map((r) => r.key);
  const ignoredGroups = [...new Set(ignored.map(keyGroup))].join("/");
  cl.add(
    "C",
    "C.projectionCoverage",
    "Rules projections can't cover",
    needWork.length ? "warn" : "ok",
    `${relevant.length} non-zero rules for positions this league starts${ignored.length ? ` (${ignored.length} more for ${ignoredGroups}, which its lineup can't start, ignored)` : ""}: ${thisLeague.filter((r) => r.kind === "projected").length} in /projections, ${viaAlias.length} via the key map (${viaAlias.map((r) => r.key).join(", ") || "none"}), ${needWork.length} not projected${needWork.length ? `: ${needWork.map((r) => `${r.key} ${round6(sc[r.key] as number)} → ${r.kind}`).join(", ")}` : ""}`,
    { url: "https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular&position[]=…", status: 200, path: "[].stats keys (union over fetched weeks, all positions)", sample: Object.fromEntries(needWork.map((r) => [r.key, `${r.kind}: ${r.how}`])) },
  );
  if (needWork.length) {
    cl.issue(`Scoring rules of this league that Sleeper projections don't carry, with a proposed treatment each: ${needWork.map((r) => `${r.key} (${round6(sc[r.key] as number)}) → ${r.kind}: ${r.how}`).join("; ")} — evidence: GET https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular&position[]=… (HTTP 200), path [].stats has none of these keys in weeks ${proj.weeks.map((w) => w.week).join(", ")} (week ${proj.wide?.week ?? d.currentWeek} with every position); frequencies from /stats weeks ${statsOk.map((s) => s.week).join(", ")} — options: apply the per-key treatment (derive / expected value / league-average rate / 0 only for rare events) and list each in the Import Report (recommended); or treat them all as 0.`);
  }

  // The same question across every key the crawled leagues score (F7): Parker's league is unknown.
  const crawlKeys = readCrawlScoringKeys();
  if (!crawlKeys) {
    cl.na("C", "C.projectionCoverageAll", "Projection coverage across leagues", "skipped: probe:sleeper-codes output (meta.scoringKeysNonzero) not found; run npm run probe:sleeper-codes first");
  } else {
    const table = projectionCoverage(crawlKeys.keys, direct, aliasSrc, freq);
    d.keyCoverage = table;
    const byKind = countBy(table, (r) => r.kind);
    const gaps = table.filter((r) => r.kind !== "projected" && r.kind !== "alias");
    const common = gaps.filter((r) => (r.leagues ?? 0) >= Math.max(5, Math.round(crawlKeys.leagues * 0.2)));
    cl.add(
      "C",
      "C.projectionCoverageAll",
      "Projection coverage across leagues",
      gaps.length ? "warn" : "ok",
      `${table.length} scoring keys are non-zero somewhere in the ${crawlKeys.leagues} crawled public leagues; against /projections for every position (week ${proj.wide?.week ?? d.currentWeek}) plus this league's weeks: ${Object.entries(byKind).map(([k, v]) => `${v} ${k}`).join(", ")}; not projected but scored in ≥ 20% of leagues: ${common.map((r) => `${r.key} (${r.leagues}) → ${r.kind}`).join(", ") || "none"}; rate-model vs zero-rare judged on 2 weeks of /stats per position group (a small sample); full table in the projection-key-coverage fixture`,
      { url: "https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular&position[]=…", status: 200, path: "[].stats keys vs probe:sleeper-codes meta.scoringKeysNonzero", sample: gaps.slice(0, 40).map((r) => `${r.key} ${r.leagues}: ${r.kind}`) },
    );
    if (gaps.length) {
      cl.issue(`Across ${crawlKeys.leagues} crawled public Sleeper leagues, ${gaps.length} of ${table.length} scored keys never appear in Sleeper projections (any position)${common.length ? `, including common ones: ${common.map((r) => `${r.key} in ${r.leagues} leagues (${r.kind}: ${r.how})`).join("; ")}` : ""} — evidence: GET https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular&position[]=… (HTTP 200) key union vs reports/probe-output/sleeper-codes.json meta.scoringKeysNonzero; frequencies from /stats weeks ${statsOk.map((s) => s.week).join(", ")} — options: implement the per-key treatments in the projection-key-coverage fixture (derive fgmiss = fga − fgm; split fgm_50p; expected value for DEF brackets and threshold bonuses; league-average rates for events that aren't rare) with 0 only for rare events (recommended), or show the uncovered rules in the Import Report and treat them as 0.`);
    }
  }

  const statKeys = new Set<string>();
  for (const r of statsRows) for (const k of Object.keys(r.stats ?? {})) statKeys.add(k);
  const neverInStats = relevant.filter((k) => !statKeys.has(k));
  const sw0 = statsOk[0];
  cl.add(
    "C",
    "C.statsCoverage",
    "Rules never seen in actual stats",
    sw0 ? "ok" : "fail",
    sw0 ? `${neverInStats.length ? `${neverInStats.length} relevant non-zero rule(s) had no occurrences in weeks ${statsOk.map((x) => x.week).join(", ")} of /stats (rare events, so not proof the key is missing): ${neverInStats.join(", ")}` : `every relevant non-zero rule occurs in weeks ${statsOk.map((x) => x.week).join(", ")} of /stats`}; the stats feed has ${statKeys.size} keys` : "no stats weeks loaded",
    { url: sw0?.f.template ?? "https://api.sleeper.app/stats/nfl/{season}/{week}?season_type=regular", status: sw0?.f.status, path: "[].stats keys (union)", sample: statKeys.size },
  );

  // DEF points-allowed brackets: are projections a one-hot flag for the bracket holding the mean?
  const leagueDefRows = proj.all.filter((r) => r.player?.position === "DEF" && r.stats);
  const defRows = leagueDefRows.length ? leagueDefRows : (proj.wide?.rows ?? []).filter((r) => r.player?.position === "DEF" && r.stats);
  const brackets = (st: Record<string, number>, prefix: string) => Object.keys(st).filter((k) => k.startsWith(prefix) && /\d/.test(k.slice(prefix.length)));
  let oneHot = 0;
  let matchesFloor = 0;
  let floorVsRound = 0;
  let example: { flag: string; mean: number; roundedWouldBe: boolean } | null = null;
  for (const r of defRows) {
    const st = r.stats as Record<string, number>;
    const b = brackets(st, "pts_allow_");
    if (b.length !== 1 || st[b[0] as string] !== 1) continue;
    oneHot++;
    const suffix = (b[0] as string).slice("pts_allow_".length);
    if (typeof st.pts_allow !== "number" || !inBracket(Math.floor(st.pts_allow), suffix)) continue;
    matchesFloor++;
    const roundedElsewhere = !inBracket(Math.round(st.pts_allow), suffix);
    if (roundedElsewhere) floorVsRound++;
    if (!example || (roundedElsewhere && !example.roundedWouldBe)) example = { flag: b[0] as string, mean: st.pts_allow, roundedWouldBe: roundedElsewhere };
  }
  const scoredBrackets = startable.has("DEF") ? nonZero.filter((k) => k.startsWith("pts_allow_") || k.startsWith("yds_allow_")) : [];
  const sampleDef = defRows[0];
  cl.add(
    "C",
    "C.defBrackets",
    "DEF bracket rules vs projections",
    defRows.length && oneHot ? "warn" : defRows.length ? "ok" : "warn",
    defRows.length
      ? `${oneHot}/${defRows.length} projected DEF rows (${leagueDefRows.length ? "this league's weeks" : `week ${proj.wide?.week ?? "?"}, all-positions call`}) set exactly one pts_allow_* flag to 1, and ${matchesFloor} of those are the bracket holding floor(projected pts_allow) (${floorVsRound} where rounding would pick a different bracket): a step function of the mean, not an expected value; ${scoredBrackets.length ? `this league scores ${scoredBrackets.length} bracket rule(s)` : startable.has("DEF") ? "this league scores no bracket rules" : "this league starts no DEF, but most leagues score these brackets"}`
      : "no DEF projection rows",
    { url: "https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular&position[]=DEF", status: 200, path: "[position=DEF].stats.pts_allow / pts_allow_* / yds_allow_*", sample: sampleDef?.stats ? Object.fromEntries(Object.entries(sampleDef.stats).filter(([k]) => k.startsWith("pts_allow") || k.startsWith("yds_allow"))) : null },
  );
  if (oneHot && example) {
    cl.issue(`Sleeper DEF projections flag a single points-allowed bracket (the one containing floor(projected pts_allow): ${matchesFloor}/${oneHot} rows), so bracket scoring from projections is a step function — evidence: GET https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular&position[]=DEF (HTTP 200), e.g. path [].stats.${example.flag} = 1 alongside pts_allow = ${example.mean}${example.roundedWouldBe ? " (rounding would pick the next bracket)" : ""} — options: treat points/yards allowed as Normal(mean = pts_allow, sd from config) and take the expected bracket points (like §5 bonuses; recommended), or use the flag as given.`);
  }
}

/** Does x fall in a Sleeper bracket suffix such as "0", "1_6", "35p"? */
function inBracket(x: number, suffix: string): boolean {
  const plus = /^(\d+)p$/.exec(suffix);
  if (plus) return x >= Number(plus[1]);
  const range = /^(\d+)_(\d+)$/.exec(suffix);
  if (range) return x >= Number(range[1]) && x <= Number(range[2]);
  return /^\d+$/.test(suffix) ? x === Number(suffix) : false;
}

// ============================================================================================
// D. Teams
// ============================================================================================

function checkD(d: Data): void {
  const { p, users, rosters } = d;
  const { cl } = p;
  const userIds = new Set(users.map((u) => u.user_id));
  const owners = rosters.filter((r) => r.owner_id);
  const ownersKnown = owners.filter((r) => userIds.has(r.owner_id as string)).length;
  const coOwners = rosters.flatMap((r) => r.co_owners ?? []);
  const withRoster = new Set([...owners.map((r) => r.owner_id as string), ...coOwners]);
  const noRoster = users.filter((u) => !withRoster.has(u.user_id)).length;
  const teamNames = users.filter((u) => typeof u.metadata?.team_name === "string" && (u.metadata.team_name as string).trim()).length;
  const commish = users.filter((u) => u.is_owner).length;
  const sampleUser = users.find((u) => u.user_id === rosters[0]?.owner_id) ?? users[0];
  cl.ok(
    "D",
    "D.users",
    "Users",
    `${users.length} users: display_name on ${users.filter((u) => u.display_name).length}, metadata.team_name on ${teamNames}, is_owner (commissioner) ${commish}, bots ${users.filter((u) => u.is_bot).length}`,
    ev(d, d.usersF, "[].user_id / display_name / metadata.team_name / is_owner", sampleUser ? { user_id: sampleUser.user_id, display_name: sampleUser.display_name, team_name: sampleUser.metadata?.team_name ?? null, is_owner: sampleUser.is_owner } : null),
  );
  cl.add(
    "D",
    "D.join",
    "Rosters ↔ users",
    ownersKnown === rosters.length ? "ok" : "warn",
    `${ownersKnown}/${rosters.length} rosters have an owner_id found in /users; ${coOwners.length} co-owner(s); ${rosters.length - owners.length} orphan roster(s); ${noRoster} user(s) without a roster`,
    ev(d, d.rostersF, "[].owner_id / [].co_owners[]", rosters.slice(0, 3).map((r) => ({ roster_id: r.roster_id, owner_id: r.owner_id, co_owners: r.co_owners ?? null }))),
  );
  cl.ok("D", "D.teamNames", "Team names", `metadata.team_name set for ${teamNames}/${users.length} users; the rest have none, so the team name falls back to display_name`, ev(d, d.usersF, "[].metadata.team_name", teamNames));
  cl.decision("Sleeper team name = users[].metadata.team_name when set, else the owner's display_name (what the Sleeper app shows).");

  // The §2.3 my-team rule for every member: owner_id first, then co_owners.
  const audit = auditMyTeamLookup(rosters);
  const auditOk = audit.owners.resolved === audit.owners.total && audit.coOwners.resolved === audit.coOwners.total && audit.onSeveralRosters === 0;
  cl.add(
    "D",
    "D.myTeamLookup",
    "My-team rule for every member",
    auditOk && audit.owners.total > 0 && audit.coOwners.total > 0 ? "ok" : "warn",
    `the §2.3 lookup (owner_id, then co_owners) run for every member resolves to their own roster: owner_id ${audit.owners.resolved}/${audit.owners.total}, co_owners ${audit.coOwners.resolved}/${audit.coOwners.total}${audit.coOwners.total ? "" : " (no co-owners here, so that branch is untested with live data; unit tests cover it)"}; ${audit.onSeveralRosters} user(s) on more than one roster`,
    ev(d, d.rostersF, "[].owner_id / [].co_owners[]", { owners: audit.owners, coOwners: audit.coOwners, onSeveralRosters: audit.onSeveralRosters }),
  );

  // My team
  const uid = d.choice.userId;
  const mine = uid ? findMyRoster(rosters, uid) : null;
  d.myRoster = mine;
  if (d.choice.mode === "fallback") {
    cl.add("D", "D.myTeamDetection", "My-team detection", mine ? "ok" : "warn", mine ? `works for the fallback's "me" (the member whose league list led here): rosters[].${mine.via} → roster ${mine.rosterId}` : 'the fallback\'s "me" user has no roster here', ev(d, d.rostersF, `[].${mine?.via ?? "owner_id"}`, mine ? { roster_id: mine.rosterId, [mine.via]: uid } : null));
    cl.na("D", "D.parkersTeam", "Parker's team", "not tested: SLEEPER_USERNAME is blank (fill it in .env.local)");
  } else if (uid) {
    cl.add("D", "D.parkersTeam", "Parker's team", mine ? "ok" : "fail", mine ? `found via rosters[].${mine.via} → roster ${mine.rosterId} (Team ${mine.rosterId})` : "SLEEPER_USERNAME's user_id owns no roster in this league", ev(d, d.rostersF, `[].${mine?.via ?? "owner_id"}`, mine ? { roster_id: mine.rosterId } : null));
  } else {
    cl.warn("D", "D.parkersTeam", "Parker's team", "SLEEPER_LEAGUE_ID is set but SLEEPER_USERNAME is blank or wasn't found, so the user must pick their team (or fill SLEEPER_USERNAME)");
  }
}

// ============================================================================================
// E. Rosters
// ============================================================================================

function checkE(d: Data): void {
  const { p, rosters, players } = d;
  const { cl } = p;
  const total = rosters.reduce((s, r) => s + (r.players?.length ?? 0), 0);
  const reserve = rosters.reduce((s, r) => s + (r.reserve?.length ?? 0), 0);
  const taxi = rosters.reduce((s, r) => s + (r.taxi?.length ?? 0), 0);
  const startersN = rosters.reduce((s, r) => s + (r.starters?.length ?? 0), 0);
  const keepers = rosters.filter((r) => Array.isArray(r.keepers) && r.keepers.length).length;
  const r0 = rosters[0];
  cl.ok(
    "E",
    "E.rosters",
    "Roster lists",
    `${rosters.length} rosters: ${total} players (incl. ${reserve} on IR via reserve[], ${taxi} on taxi[]), ${startersN} current starters; keepers[] used on ${keepers}`,
    ev(d, d.rostersF, "[].players / starters / reserve / taxi / keepers", r0 ? { roster_id: r0.roster_id, players: (r0.players ?? []).length, starters: r0.starters, reserve: r0.reserve, taxi: r0.taxi, keepers: r0.keepers ?? null } : null),
  );
  if (!d.playersF.ok) {
    cl.fail("E", "E.playersDb", "Players DB join", `players DB failed: ${d.playersF.error}`, { url: "https://api.sleeper.app/v1/players/nfl", status: d.playersF.status });
    return;
  }
  const missing = [...d.rostered].filter((pid) => !players[pid]);
  const nPlayers = Object.keys(players).length;
  const mb = d.playersF.bytes !== undefined ? (d.playersF.bytes / 1e6).toFixed(2) : "?";
  const sizeText = `${mb} MB decoded (${d.playersF.bytes ?? "?"} bytes)${d.playersF.contentLength ? `, content-length ${d.playersF.contentLength}` : "; no content-length header, so the transfer size isn't reported"}`;
  cl.add(
    "E",
    "E.playersDb",
    "Players DB join",
    missing.length ? "warn" : "ok",
    `${d.rostered.size - missing.length}/${d.rostered.size} rostered IDs found in /players/nfl (${nPlayers} players, ${sizeText}; ${d.playersF.fromCache ? "from the 24 h cache" : "downloaded"}); team DEF IDs are team codes (e.g. "DAL") and are in the DB${missing.length ? `; missing: ${missing.join(", ")}` : ""}`,
    { url: "https://api.sleeper.app/v1/players/nfl", status: d.playersF.status, path: "{player_id}.position / team / injury_status", sample: players.DAL ? { DAL: { position: players.DAL.position, team: players.DAL.team } } : null },
  );
  if (d.playersF.bytes !== undefined && d.playersF.bytes > 7_000_000) {
    cl.issue(`Sleeper /players/nfl is ${mb} MB decoded with ${nPlayers} players, not "about 5 MB" as CLAUDE.md §2.3 says — evidence: GET https://api.sleeper.app/v1/players/nfl (HTTP ${d.playersF.status}), response body ${d.playersF.bytes} bytes after decoding${d.playersF.contentLength ? `, content-length ${d.playersF.contentLength}` : ", no content-length header"} — options: plan cache/KV storage for about ${Math.ceil(d.playersF.bytes / 1e6)} MB per daily copy, or keep a trimmed subset (id, name, position, team, status, injury, age, IDs); keep the once-a-day fetch. The ~5 MB in the spec is probably the compressed transfer size (not measurable here without a second download).`);
  }
  const byPos = countBy(d.rostered, (pid) => fantasyPos(players[pid], d.positions));
  const noTeam = [...d.rostered].filter((pid) => players[pid] && !players[pid]?.team);
  cl.ok("E", "E.positions", "Positions and NFL teams", `rostered by position: ${Object.entries(byPos).map(([k, v]) => `${k} ${v}`).join(", ")}; ${noTeam.length} rostered player(s) with no NFL team`, { url: "https://api.sleeper.app/v1/players/nfl", status: d.playersF.status, path: "{player_id}.position / fantasy_positions / team", sample: noTeam.slice(0, 5).map((pid) => playerLabel(d, pid)) });
  const inj = countBy(d.rostered, (pid) => injuryLabel(players[pid]?.injury_status));
  const unmapped = Object.keys(inj).filter((k) => k !== "null" && k !== '""' && !INJURY_MAP[k]);
  const allInj = countBy(Object.values(players), (pl) => injuryLabel(pl.injury_status));
  const extraStatuses = Object.keys(allInj).filter((k) => k !== "null" && k !== '""' && !INJURY_MAP[k]);
  cl.add(
    "E",
    "E.injury",
    "Injury status",
    unmapped.length ? "warn" : "ok",
    `rostered injury_status: ${Object.entries(inj).map(([k, v]) => `${k} ${v}`).join(", ")}${unmapped.length ? `; not in the normalized enum: ${unmapped.join(", ")}` : ""}${extraStatuses.length ? `; the players DB (all players) also shows ${extraStatuses.join(", ")}` : ""}`,
    { url: "https://api.sleeper.app/v1/players/nfl", status: d.playersF.status, path: "{player_id}.injury_status", sample: INJURY_MAP },
  );
  cl.decision(`Sleeper injury_status → normalized: ${Object.entries(INJURY_MAP).map(([k, v]) => `${k}→${v}`).join(", ")}; null/"" → ACTIVE. Proposed for statuses outside the enum: DNR (did not report) → OUT, COV (COVID list) → OUT. Seen in the players DB today: ${Object.entries(allInj).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  const emptyStarters = rosters.reduce((s, r) => s + (r.starters ?? []).filter((x) => x === "0").length, 0);
  cl.ok("E", "E.emptySlots", "Empty starter slots", `${emptyStarters} empty slot(s) in current starters; an empty slot is the string "0"`, ev(d, d.rostersF, "[].starters[] = \"0\"", emptyStarters));
}

// ============================================================================================
// F. Schedule
// ============================================================================================

function checkF(d: Data): void {
  const { p, matchups, rosters } = d;
  const { cl } = p;
  const reg: number[] = [];
  for (let w = d.startWeek; w < d.playoffStart; w++) reg.push(w);
  const weekPairs = reg.map((w) => matchupPairs(w, matchups.get(w) ?? []));
  const bad = weekPairs.filter((x) => x.pairs.length * 2 !== d.numTeams || x.problems.length || x.nullIds);
  const future = weekPairs.filter((x) => x.week >= d.currentWeek);
  const firstFuture = future[0];
  cl.add(
    "F",
    "F.regularSeason",
    "Regular-season matchups",
    bad.length ? "warn" : "ok",
    `weeks ${reg[0]}–${reg[reg.length - 1]}: ${weekPairs.length - bad.length}/${weekPairs.length} weeks have ${d.numTeams / 2} complete matchup_id pairs${bad.length ? `; problems: ${bad.map((b) => `week ${b.week}: ${b.problems.join(", ") || `${b.nullIds} null`}`).join("; ")}` : ""}`,
    ev(d, d.matchupsF.get(reg[0] ?? 1) ?? d.leagueF, "[].matchup_id / [].roster_id", weekPairs[0]?.pairs),
  );
  const futureFull = future.length > 0 && future.every((x) => x.pairs.length * 2 === d.numTeams);
  cl.add(
    "F",
    "F.futureWeeks",
    "Future weeks",
    futureFull ? "ok" : "warn",
    `future regular-season weeks ${future[0]?.week ?? "?"}–${future[future.length - 1]?.week ?? "?"}: ${future.filter((x) => x.pairs.length * 2 === d.numTeams).length}/${future.length} already carry complete matchup_id pairs (points 0)${futureFull ? ", so the remaining schedule is known" : ""}`,
    ev(d, d.matchupsF.get(firstFuture?.week ?? d.currentWeek) ?? d.leagueF, "[].matchup_id", firstFuture?.pairs),
  );
  const po: number[] = [];
  for (let w = d.playoffStart; w <= 18; w++) po.push(w);
  const poPairs = po.map((w) => matchupPairs(w, matchups.get(w) ?? []));
  const poWithIds = poPairs.filter((x) => x.pairs.length > 0);
  const pairsByWeek = new Map<number, Array<[number, number]>>([...matchups].map(([w, rows]) => [w, matchupPairs(w, rows).pairs]));
  const repeats = repeatedPairWeeks(pairsByWeek, poWithIds.map((x) => x.week));
  const repeatText = [...repeats].map(([w, e]) => (e === null ? `${w}: pairs not seen before` : `${w} = ${e}`)).join(", ");
  const allRepeat = repeats.size > 0 && [...repeats.values()].every((v) => v !== null);
  cl.add(
    "F",
    "F.playoffWeeks",
    "Playoff-week matchups",
    poWithIds.length ? "warn" : "ok",
    poWithIds.length
      ? `weeks ${poWithIds.map((x) => x.week).join(", ")} (≥ playoff_week_start ${d.playoffStart}) ALSO return matchup_id pairs for all ${d.numTeams} rosters before the playoffs; ${allRepeat ? `each repeats an earlier week's pairs exactly (week ${repeatText}): the regular-season round robin continued` : `compared with earlier weeks: ${repeatText}`}, not playoff games; use winners_bracket instead`
      : "playoff weeks have no matchup pairs yet",
    ev(d, d.matchupsF.get(d.playoffStart) ?? d.leagueF, "[].matchup_id", poPairs[0]?.pairs),
  );
  if (poWithIds.length) {
    const wb = bracketShape(d.winners);
    cl.issue(`Before the playoffs, Sleeper returns regular-looking matchup_id pairs for playoff weeks and an already-filled winners_bracket — evidence: GET https://api.sleeper.app/v1/league/{leagueId}/matchups/${d.playoffStart} (HTTP 200) path [].matchup_id pairs all ${d.numTeams} rosters${allRepeat ? `, and each playoff week repeats an earlier week's pairs exactly (${repeatText}), i.e. the round robin continued` : ""}; GET …/winners_bracket (HTTP 200) has ${wb.matches} matches with ${wb.decided} decided — options: treat weeks ≥ playoff_week_start as playoffs and ignore their matchup_id (planned), take only the bracket's structure (rounds, byes, placement games) and seed from simulated standings; re-check once the playoffs start (Phase 3).`);
    cl.decision(`Regular season = weeks start_week..playoff_week_start−1 from settings; matchups for weeks ≥ playoff_week_start are ignored until the playoffs start, and winners_bracket is read for structure only (its seeds are provisional mid-season).`);
  }

  // Records vs matchups
  const completed: Array<{ week: number; rows: SleeperMatchup[] }> = [];
  for (let w = d.startWeek; w <= d.lastScored; w++) completed.push({ week: w, rows: matchups.get(w) ?? [] });
  const rebuilt = recordsFromMatchups(completed, d.num("league_average_match") === 1);
  const mismatches: string[] = [];
  for (const r of rosters) {
    const got = rebuilt.get(r.roster_id);
    const pts = rosterPoints(r.settings);
    if (!got) {
      mismatches.push(`roster ${r.roster_id}: no matchups`);
      continue;
    }
    const recOk = got.w === (r.settings.wins ?? 0) && got.l === (r.settings.losses ?? 0) && got.t === (r.settings.ties ?? 0);
    const pfOk = Math.abs(got.pf - pts.pf) < 0.011;
    const paOk = Math.abs(got.pa - pts.pa) < 0.011;
    if (!recOk || !pfOk || !paOk) mismatches.push(`roster ${r.roster_id}: ${!recOk ? `record ${got.w}-${got.l}-${got.t} vs ${r.settings.wins}-${r.settings.losses}-${r.settings.ties}` : ""}${!pfOk ? ` PF ${round2(got.pf)} vs ${round2(pts.pf)}` : ""}${!paOk ? ` PA ${round2(got.pa)} vs ${round2(pts.pa)}` : ""}`);
  }
  const s0 = rosters[0]?.settings;
  cl.add(
    "F",
    "F.records",
    "Records and points",
    mismatches.length ? "warn" : "ok",
    `rosters[].settings wins/losses/ties and fpts(+fpts_decimal/100)/fpts_against(+_decimal) ${mismatches.length ? `differ from matchups for ${mismatches.length} roster(s): ${mismatches.slice(0, 4).join("; ")}` : `match a rebuild from weeks ${d.startWeek}–${d.lastScored} matchups for all ${rosters.length} rosters`}; also ppts (potential points)`,
    ev(d, d.rostersF, "[].settings.{wins,losses,ties,fpts,fpts_decimal,fpts_against,fpts_against_decimal,ppts}", s0 ? { wins: s0.wins, losses: s0.losses, ties: s0.ties, fpts: s0.fpts, fpts_decimal: s0.fpts_decimal, fpts_against: s0.fpts_against, fpts_against_decimal: s0.fpts_against_decimal } : null),
  );
}

// ============================================================================================
// G. Transactions
// ============================================================================================

function checkG(d: Data): void {
  const { p, allTx } = d;
  const { cl } = p;
  const s = summarizeTransactions(allTx);
  const perWeek = [...d.txByWeek].map(([w, list]) => `${w}:${list.length}`).join(" ");
  cl.ok(
    "G",
    "G.byWeek",
    "Transactions per week",
    `${s.total} in legs 0–${Math.max(...d.txByWeek.keys())} (leg:count ${perWeek}); types ${Object.entries(s.byType).map(([k, v]) => `${k} ${v}`).join(", ")}; statuses ${Object.entries(s.byStatus).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    ev(d, d.txF.get(1) ?? d.leagueF, "[].type / status / leg / created / status_updated", s.byTypeStatus),
  );
  const done = s.trades.filter((t) => t.status === "complete");
  const t0 = done[0];
  cl.add(
    "G",
    "G.trades",
    "Trades",
    done.length ? "ok" : "warn",
    done.length ? `${done.length} completed trade(s) (${s.trades.length} total): ${done.map((t) => `leg ${t.leg} on ${iso(t.created)}, ${(t.roster_ids ?? []).length} teams, ${Object.keys(t.adds ?? {}).length} player(s), ${(t.draft_picks ?? []).length} pick(s), ${(t.waiver_budget ?? []).length} FAAB transfer(s)`).join("; ")}` : "no completed trades this season (fields not exercised)",
    ev(d, d.txF.get(t0?.leg ?? 1) ?? d.leagueF, "[type=trade].{roster_ids,adds,drops,draft_picks,waiver_budget,consenter_ids,creator,created,status_updated}", t0 ? { leg: t0.leg, roster_ids: t0.roster_ids, adds: t0.adds, drops: t0.drops, draft_picks: t0.draft_picks, waiver_budget: t0.waiver_budget, created: t0.created, status_updated: t0.status_updated } : null),
  );
  const perRoster = [...s.perRoster].sort((a, b) => a[0] - b[0]).map(([rid, x]) => `${rid}: +${x.adds}/−${x.drops}`);
  cl.ok("G", "G.addDrop", "Adds and drops per team", `completed adds/drops by roster (adds/drops maps): ${perRoster.join(", ")}`, ev(d, d.txF.get(1) ?? d.leagueF, "[status=complete].adds{player_id: roster_id} / drops{…}", Object.fromEntries([...s.perRoster].slice(0, 3))));
  const totalMoves = d.rosters.map((r) => (r.settings as Record<string, unknown>).total_moves);
  const completedAdds = [...s.perRoster.values()].reduce((a, x) => a + x.adds, 0);
  if (totalMoves.every((x) => x === 0) && completedAdds > 0) {
    cl.warn("G", "G.totalMoves", "rosters[].settings.total_moves", `0 on every roster although ${completedAdds} completed adds exist: don't use it; count transactions instead`, ev(d, d.rostersF, "[].settings.total_moves", [...new Set(totalMoves)]));
    cl.issue(`Sleeper rosters[].settings.total_moves is 0 for every roster even though ${completedAdds} completed adds exist — evidence: GET https://api.sleeper.app/v1/league/{leagueId}/rosters (HTTP 200), path [].settings.total_moves = 0 — options: derive activity from /transactions (planned), ignore total_moves.`);
  }
  const seasonStart = d.state?.season_start_date ? Date.parse(d.state.season_start_date) : NaN;
  const preseasonInLeg1 = (d.txByWeek.get(1) ?? []).filter((t) => Number.isFinite(seasonStart) && t.created < seasonStart).length;
  cl.ok(
    "G",
    "G.timing",
    "Week and timestamps",
    `leg = fantasy week; created/status_updated are epoch ms (first ${iso(s.firstCreated)}, last ${iso(s.lastCreated)}); ${preseasonInLeg1} leg-1 transaction(s) were created before the season start (${d.state?.season_start_date ?? "?"})${preseasonInLeg1 ? ", so offseason moves are filed under leg 1" : ""}; leg 0 had ${d.txByWeek.get(0)?.length ?? 0}`,
    ev(d, d.txF.get(1) ?? d.leagueF, "[].leg / created / status_updated", { preseasonInLeg1 }),
  );
  cl.decision("Transaction weeks: use `leg` for the fantasy week, but activity windows (acceptance model 'a', §11) use the `created` timestamp, because offseason moves can be filed under leg 1.");
  const bids = allTx.filter((t) => typeof t.settings?.waiver_bid === "number");
  const used = d.rosters.map((r) => (r.settings as Record<string, unknown>).waiver_budget_used);
  const failedWithNotes = allTx.filter((t) => t.status === "failed" && isRecord(t.metadata) && typeof t.metadata.notes === "string").length;
  cl.ok("G", "G.faab", "FAAB", `waiver_budget ${d.num("waiver_budget") ?? "?"}; ${bids.length} waiver claim(s) carry settings.waiver_bid; rosters[].settings.waiver_budget_used ${[...new Set(used)].join("/")}; ${failedWithNotes} failed claim(s) carry metadata.notes (free text, sanitized)`, ev(d, d.txF.get(1) ?? d.leagueF, "[type=waiver].settings.waiver_bid", bids.slice(0, 5).map((t) => t.settings?.waiver_bid)));
}

// ============================================================================================
// H. Free agents
// ============================================================================================

function checkH(d: Data, projNow: ProjWeek | undefined): void {
  const { p, players } = d;
  const { cl } = p;
  if (!d.playersF.ok) {
    cl.fail("H", "H.freeAgents", "Free agents", "players DB unavailable");
    return;
  }
  const positions = d.positions;
  const fa = Object.values(players).filter((pl) => (pl as Record<string, unknown>).active === true && pl.team && positions.includes(fantasyPos(pl, positions)) && !d.rostered.has(pl.player_id));
  const byPos = countBy(fa, (pl) => fantasyPos(pl, positions));
  const withProj = projNow ? fa.filter((pl) => hasProjection(projNow.byId.get(pl.player_id)?.stats)).length : 0;
  const stubOnly = projNow ? fa.filter((pl) => projNow.byId.has(pl.player_id) && !hasProjection(projNow.byId.get(pl.player_id)?.stats)).length : 0;
  cl.ok(
    "H",
    "H.freeAgents",
    "Free agents",
    `no FA endpoint; derived as players DB (active, on an NFL team, league positions ${positions.join("/")}) minus all rostered (incl. IR/taxi): ${fa.length} available (${Object.entries(byPos).map(([k, v]) => `${k} ${v}`).join(", ")}); week ${projNow?.week ?? "?"}: ${withProj} with a real projection, ${stubOnly} with only an ADP stub row, ${fa.length - withProj - stubOnly} with no row`,
    { url: "https://api.sleeper.app/v1/players/nfl", status: d.playersF.status, path: "{player_id}.active / team / fantasy_positions  minus  rosters[].players", sample: byPos },
  );
  cl.decision("Sleeper free agents = players DB (active, NFL team set, a position the league can start) minus every rostered player (players[] incl. IR/taxi). The top 50 per position by league-scored projection (real projection rows only, not ADP stubs) become LeagueSnapshot.freeAgents. Waiver status isn't exposed; waiver_clear_days is in settings.");
}

// ============================================================================================
// I. Draft picks
// ============================================================================================

function checkI(d: Data): void {
  const { p, traded, num } = d;
  const { cl } = p;
  const type = num("type");
  const futureMatters = type === 1 || type === 2;
  const seasons = [...new Set(traded.map((t) => String(t.season)))].sort();
  const futureRows = traded.filter((t) => Number(t.season) > d.season).length;
  const pastRows = traded.length - futureRows;
  cl.add(
    "I",
    "I.tradedPicks",
    "Traded picks",
    d.tradedF.ok ? (futureMatters || traded.length ? "ok" : "na") : "fail",
    d.tradedF.ok ? `${traded.length} traded-pick row(s) for season(s) ${seasons.join(", ") || "none"} (${futureRows} future, ${pastRows} for the ${d.season} draft already held); rows give the original team (roster_id), previous_owner_id and current owner_id (all roster IDs)` : `failed: ${d.tradedF.error}`,
    ev(d, d.tradedF, "[].{season,round,roster_id,previous_owner_id,owner_id}", traded.slice(0, 2)),
  );
  if (futureMatters) {
    const rounds = num("draft_rounds") ?? 0;
    const pool = [...new Set([String(d.season + 1), ...seasons.filter((s) => Number(s) > d.season)])].sort();
    const own = pickOwnership(d.rosters.map((r) => r.roster_id), pool, rounds, traded.filter((t) => Number(t.season) > d.season));
    const counts = [...own.perRoster.values()];
    cl.warn(
      "I",
      "I.ownership",
      "Future pick ownership",
      `derivable: each team owns its own ${rounds} round(s) per future season, then apply traded_picks → seasons ${pool.join(", ")}: ${own.total} picks, ${own.moved} moved, picks per team ${span(counts)}${own.outside ? `, ${own.outside} row(s) beyond draft_rounds` : ""}${pastRows ? `; ${pastRows} row(s) are for the ${d.season} draft already held (still listed, ignore)` : ""}; which future seasons are tradable isn't in the API (assumed: seasons that appear in traded_picks, plus next season)`,
      ev(d, d.leagueF, "settings.draft_rounds", rounds),
    );
  } else {
    cl.na("I", "I.ownership", "Future pick ownership", `redraft league (settings.type ${type}): future picks don't matter`);
  }
  const b = d.draftBundles[0];
  if (!b) {
    cl.add("I", "I.drafts", "Drafts", d.draftsF.ok ? "warn" : "fail", d.draftsF.ok ? "no drafts listed" : `failed: ${d.draftsF.error}`, ev(d, d.draftsF, "[]", 0));
  } else {
    const dr = b.draft;
    const keepers = b.picks.filter((pk) => pk.is_keeper).length;
    const s = dr?.settings ?? {};
    // Evidence from the raw JSON rows (the zod schema stringifies roster_id; the API sends a number).
    const rawPicks = Array.isArray(b.picksF.data) ? (b.picksF.data as unknown[]).filter(isRecord) : [];
    const rosterIdTypes = countBy(rawPicks, (pk) => (pk.roster_id === null ? "null" : typeof pk.roster_id));
    cl.ok(
      "I",
      "I.drafts",
      "Drafts",
      `${d.drafts.length} draft(s); latest: season ${dr?.season ?? "?"}, ${dr?.status ?? "?"}, type ${dr?.type ?? "?"}, ${String(s.rounds ?? "?")} rounds, player_type ${String(s.player_type ?? "?")}; draft_order keyed by user_id (${Object.keys(dr?.draft_order ?? {}).length}), slot_to_roster_id (${Object.keys(dr?.slot_to_roster_id ?? {}).length}); ${b.picks.length} picks, is_keeper on ${keepers}; picks' roster_id is a JSON ${Object.entries(rosterIdTypes).map(([k, v]) => `${k} (${v})`).join(", ") || "n/a"}`,
      ev(d, b.draftF, "draft_order / slot_to_roster_id / settings.rounds / metadata.scoring_type", { draft_order: dr?.draft_order ?? null, slot_to_roster_id: dr?.slot_to_roster_id ?? null, rounds: s.rounds, scoring_type: dr?.metadata?.scoring_type }),
      ev(d, b.picksF, "[].{round,pick_no,roster_id,picked_by,player_id,is_keeper} (raw JSON)", rawPicks.slice(0, 2).map((pk) => ({ round: pk.round, pick_no: pk.pick_no, roster_id: pk.roster_id, picked_by: pk.picked_by, player_id: pk.player_id, is_keeper: pk.is_keeper }))),
    );
    const nextDraft = d.drafts.find((x) => Number(x.season) > d.season);
    cl.add("I", "I.futureDraft", "Next season's draft", nextDraft ? "ok" : futureMatters ? "warn" : "na", nextDraft ? `a ${nextDraft.season} draft exists (${nextDraft.status})` : `no ${d.season + 1} draft object yet (drafts list only has ${[...new Set(d.drafts.map((x) => x.season))].join(", ")}); next year's draft order is unknown until Sleeper creates it`, ev(d, d.draftsF, "[].season", d.drafts.map((x) => x.season)));
    // The raw body shows whether draft_id is a bare number (the parsed data can't: the big-int-safe parse quotes it).
    const rawText = b.tradedF.res?.text ?? "";
    const bare = (rawText.match(/"draft_id"\s*:\s*-?\d{16,}/g) ?? []).length;
    const asString = b.traded.filter((t) => isRecord(t) && typeof t.draft_id === "string").length;
    cl.add(
      "I",
      "I.draftTradedPicks",
      "Draft traded picks",
      bare ? "warn" : "ok",
      `/draft/{draftId}/traded_picks returns ${b.traded.length} row(s)${bare ? `; draft_id is a bare 19-digit JSON number in ${bare} row(s), which plain JSON.parse rounds; the probe parses Sleeper bodies big-int-safe (scripts/lib/sleeper/json.ts), so it stays a string with every digit (${asString}/${b.traded.length} rows) and the fixture's draft_id joins with the draft` : ""}`,
      ev(d, b.tradedF, "[].draft_id (raw JSON type)", bare ? "number (16+ digits)" : b.traded.length ? "string" : "no rows"),
    );
    if (bare) cl.issue(`Sleeper /draft/{draftId}/traded_picks returns draft_id as a bare 19-digit JSON number (${bare} of ${b.traded.length} rows), which JSON.parse rounds — evidence: GET https://api.sleeper.app/v1/draft/{draftId}/traded_picks (HTTP ${b.tradedF.status}), path [].draft_id — options: parse every Sleeper body big-int-safe, quoting whole integer tokens of 16+ digits before JSON.parse (as scripts/lib/sleeper/json.ts does; recommended for the Phase 1 adapter), or take the draft ID from the request.`);
  }
}

// ============================================================================================
// J. Projections (+ loading)
// ============================================================================================

async function loadProjections(d: Data): Promise<Proj> {
  const positions = d.positions;
  const wanted = [...new Set([d.currentWeek - 1, d.currentWeek, d.currentWeek + 1, d.lastPlayoff])].filter((w) => w >= 1 && w <= 18);
  const load = async (week: number, pos: string[]): Promise<ProjWeek> => {
    const f = await fetchJson<unknown>(d.p, endpoints.projections(d.season, week, pos), "projections");
    const parsed = f.ok ? parseArray(StatRowSchema, f.data) : { value: [], problems: [f.error ?? "failed"], bad: 0 };
    return { week, f, rows: parsed.value, byId: new Map(parsed.value.map((r) => [r.player_id, r])), problems: parsed.problems };
  };
  const weeks: ProjWeek[] = [];
  for (const week of wanted) weeks.push(await load(week, positions));
  // Every position in one call (current week) for the projection-key analysis (C.*).
  const wide = POS.every((x) => positions.includes(x)) ? undefined : await load(d.currentWeek, [...POS]);
  const find = (w: number) => weeks.find((x) => x.week === w);
  return { weeks, now: find(d.currentWeek), next: find(d.currentWeek + 1), last: find(d.lastPlayoff), wide: wide?.f.ok ? wide : undefined, all: weeks.flatMap((w) => w.rows), positions };
}

function checkJ(d: Data, proj: Proj, statsWeeks: StatsWeek[]): void {
  const { p } = d;
  const { cl } = p;
  const now = proj.now;
  if (!now || !now.f.ok) {
    cl.fail("J", "J.endpoint", "Projections endpoint", `week ${d.currentWeek} projections failed: ${now?.f.error ?? "not fetched"}`, now ? { url: now.f.template, status: now.f.status } : {});
    return;
  }
  const posCounts = countBy(now.rows, (r) => String(r.player?.position ?? "?"));
  const realNow = now.rows.filter((r) => hasProjection(r.stats)).length;
  cl.add(
    "J",
    "J.endpoint",
    "Projections endpoint",
    now.problems.length ? "warn" : "ok",
    `undocumented /projections works; one call with repeated position[] (${proj.positions.join(", ")}) returned ${now.rows.length} rows (${Object.entries(posCounts).map(([k, v]) => `${k} ${v}`).join(", ")}), of which ${realNow} carry a real projection and ${now.rows.length - realNow} are ADP-only stubs (stats like {adp_dd_ppr}, opponent null); company ${[...new Set(now.rows.map((r) => r.company))].join("/")}${now.problems.length ? `; validation: ${now.problems.join("; ")}` : ""}`,
    { url: now.f.template, status: now.f.status, path: "[].{player_id,week,stats{…},team,opponent,last_modified}", sample: now.rows[0] ? { player_id: now.rows[0].player_id, week: now.rows[0].week, team: now.rows[0].team, opponent: now.rows[0].opponent, stats: Object.fromEntries(Object.entries(now.rows[0].stats ?? {}).slice(0, 6)) } : null },
  );

  const relevant = [...d.rostered].filter((pid) => (POS as readonly string[]).includes(fantasyPos(d.players[pid], d.positions)));
  const stamps: Array<{ week: number; stamped: number; real: number; days: string[]; stubStamped: number }> = [];
  for (const w of proj.weeks) {
    const fromSchedule = d.schedule?.teamsByWeek.get(w.week);
    const teamsPlaying = fromSchedule && fromSchedule.size ? fromSchedule : new Set(w.rows.filter((r) => r.opponent && r.team).map((r) => r.team as string));
    const allTeams = d.schedule?.allTeams.size ? d.schedule.allTeams : new Set(w.rows.map((r) => r.team).filter((t): t is string => Boolean(t)));
    const byeTeams = [...allTeams].filter((t) => !teamsPlaying.has(t)).sort();
    const cov = classifyCoverage(
      relevant.map((pid) => ({ id: pid, team: d.players[pid]?.team, injury: d.players[pid]?.injury_status, projected: hasProjection(w.byId.get(pid)?.stats), hasRow: w.byId.has(pid), depth: d.players[pid]?.depth_chart_order })),
      teamsPlaying,
    );
    const stamped = w.rows.filter((r) => typeof r.last_modified === "number");
    const days = [...new Set(stamped.map((r) => iso(r.last_modified)))].sort();
    stamps.push({ week: w.week, stamped: stamped.length, real: w.rows.filter((r) => hasProjection(r.stats)).length, days, stubStamped: stamped.filter((r) => !hasProjection(r.stats)).length });
    const past = w.week < d.currentWeek;
    const role = w.week === d.currentWeek ? "current week" : past ? "past week (for the 'hot' feature)" : w === proj.last ? "last playoff week" : "next week";

    // A past week: were its projections (re)written after the games? (§11 'hot' needs pre-game numbers.)
    let pastNote = "";
    let restamped = false;
    if (past) {
      const lastGame = d.schedule?.lastDateByWeek.get(w.week);
      const firstStamp = stamped.length ? Math.min(...stamped.map((r) => r.last_modified as number)) : undefined;
      restamped = lastGame !== undefined && firstStamp !== undefined && iso(firstStamp) > lastGame;
      const sw = statsWeeks.find((s) => s.week === w.week && s.f.ok);
      let compared = 0;
      let equal = 0;
      if (sw) {
        for (const r of w.rows) {
          const pr = r.stats?.pts_ppr;
          const actual = sw.stats.get(r.player_id)?.pts_ppr;
          if (typeof pr !== "number" || typeof actual !== "number" || r.player?.position === "DEF") continue;
          compared++;
          if (Math.abs(pr - actual) < 0.005) equal++;
        }
      }
      pastNote = `; last_modified ${firstStamp !== undefined ? new Date(firstStamp).toISOString().slice(0, 16) : "n/a"}Z vs the week's last game on ${lastGame ?? "?"}: ${restamped ? "re-stamped AFTER the games" : "not after the games"}${sw ? `; projected pts_ppr equals the actual pts_ppr for ${equal} of ${compared} players, so the rows are ${equal * 20 < compared ? "not" : "possibly"} overwritten with actuals` : ""}`;
      if (restamped) {
        cl.issue(`Sleeper past-week projections are re-stamped after the week's games (week ${w.week}: last_modified from ${new Date(firstStamp as number).toISOString().slice(0, 16)}Z, the week's last game was on ${lastGame}) — evidence: GET https://api.sleeper.app/projections/nfl/{season}/${w.week}?season_type=regular&position[]=… (HTTP ${w.f.status}), path [].last_modified${sw ? `; projected pts_ppr equals the actual in ${equal} of ${compared} cases, so they weren't simply replaced by actuals` : ""}, but whether they still are the pre-kickoff numbers can't be told — options: (a) for §11 'hot', snapshot each week's projections before kickoff (cache keyed by week, kept beyond the 6 h TTL; recommended), (b) accept possibly revised numbers; a later phase can measure drift by fetching one week before and after kickoff.`);
      }
    }
    const status: "ok" | "warn" | "fail" = !w.f.ok ? "fail" : cov.rate >= 0.97 && !restamped ? "ok" : "warn";
    cl.add(
      "J",
      `J.coverage.w${w.week}`,
      `Coverage week ${w.week} (${role})`,
      status,
      w.f.ok
        ? `${cov.healthyProjected.length}/${cov.expected} healthy rostered players with a game have a real projection (${pct(cov.rate)}), not counting ${cov.backupMissing.length} healthy backup(s) (depth chart 2+) that Sleeper doesn't project; not projected: ${cov.injuredMissing.length} injured (IR/Out/PUP/NA/Sus, expected) + ${cov.healthyMissing.length} other healthy${cov.healthyMissing.length ? ` (${cov.healthyMissing.slice(0, 6).map((pid) => `${playerLabel(d, pid)} ${injuryLabel(d.players[pid]?.injury_status)}, depth ${d.players[pid]?.depth_chart_order ?? "none"}`).join("; ")})` : ""}; ${cov.injuredProjected.length} injured still projected; ${cov.bye.length} on bye (${byeTeams.length} teams off${byeTeams.length ? `: ${byeTeams.join(", ")}` : ""}), ${cov.noTeam.length} without an NFL team; ${cov.stubRows} rostered players have only an ADP stub row; last_modified on ${stamped.length} rows (${days.join(", ") || "none"})${pastNote}`
        : `failed: ${w.f.error}`,
      { url: w.f.template, status: w.f.status, path: "[].stats (real vs ADP-only) for rostered players; players DB depth_chart_order; [].last_modified", sample: { healthyProjected: cov.healthyProjected.length, healthyMissing: cov.healthyMissing.length, backupMissing: cov.backupMissing.length, injuredMissing: cov.injuredMissing.length, bye: cov.bye.length, noTeam: cov.noTeam.length, stubRows: cov.stubRows } },
    );
  }
  const statKeys = new Set<string>();
  for (const r of proj.all) for (const k of Object.keys(r.stats ?? {})) statKeys.add(k);
  cl.ok("J", "J.statKeys", "Projection stat keys", `${statKeys.size} stat keys, mostly the /stats keys (exceptions: the special-teams/return key map in C.unmapped), incl. Sleeper's own pts_std/pts_half_ppr/pts_ppr totals; league-scored points must be computed (stats × scoring_settings)`, { url: now.f.template, status: now.f.status, path: "[].stats keys", sample: [...statKeys].sort() });

  // last_modified: a per-week batch stamp, not a per-row edit time.
  const futureStamps = stamps.filter((s) => s.week > d.currentWeek && s.days.length);
  const batch = stamps.every((s) => s.days.length <= 1);
  const seasonStart = d.state?.season_start_date;
  const afterStart = seasonStart !== undefined && futureStamps.length > 0 && futureStamps.every((s) => s.days.every((day) => day >= seasonStart));
  const sharedLm = d.shared?.checks.get("PROJ-S.lastModified");
  const stampText = stamps.map((s) => `week ${s.week}: ${s.days.join("/") || "none"} on ${s.stamped} rows (${s.real} real${s.stubStamped ? `, ${s.stubStamped} stubs` : ""})`).join("; ");
  if (futureStamps.length) {
    cl.decision(
      `Sleeper projections' last_modified is ${batch ? "a per-week batch stamp: every stamped row of a week carries the same day" : "not one day per week"} (${stampText}), so it can't show whether far-future numbers were re-projected${sharedLm ? ` (probe:shared PROJ-S.lastModified, ${sharedLm.status}: ${firstClause(sharedLm.summary, 140)})` : ""}. The far-future stamps are ${afterStart ? `after the season start (${seasonStart}), not the preseason §2.3 describes` : `not all after the season start (${seasonStart ?? "?"})`}; §6's shape-only use of future weeks stands.`,
    );
    if (afterStart) {
      cl.issue(`CLAUDE.md §2.3 says far-future Sleeper projections were last modified in the preseason; today every stamped row of weeks ${futureStamps.map((s) => s.week).join(", ")} is dated ${[...new Set(futureStamps.flatMap((s) => s.days))].join("/")}, after the season start (${seasonStart}) — evidence: GET https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular&position[]=… (HTTP 200), path [].last_modified (${stampText}) — but it's a batch stamp, so it doesn't prove the numbers were re-projected — options: keep using far-future weeks for their shape only (§6, planned); measure re-projection later by comparing values fetched on different days.`);
    }
  }
}

// ============================================================================================
// K. Completed weeks: scoring oracle preview (+ cross-league)
// ============================================================================================

/** Actual stats for the last two completed weeks (undocumented /stats), for the oracle and C. */
async function loadStats(d: Data): Promise<StatsWeek[]> {
  const out: StatsWeek[] = [];
  for (const week of [d.lastScored - 1, d.lastScored].filter((w) => w >= d.startWeek)) {
    const f = await fetchJson<unknown>(d.p, endpoints.stats(d.season, week), "stats");
    const parsed = f.ok ? parseArray(StatRowSchema, f.data) : { value: [], bad: 0, problems: [] };
    const stats = new Map<string, StatLine>();
    for (const r of parsed.value) if (r.stats) stats.set(r.player_id, r.stats);
    out.push({ week, f, rows: parsed.value, bad: parsed.bad, stats });
  }
  return out;
}

async function checkK(d: Data, statsWeeks: StatsWeek[]): Promise<void> {
  const { p } = d;
  const { cl } = p;
  const weeks: number[] = [];
  for (let w = d.startWeek; w <= d.lastScored; w++) weeks.push(w);
  let starterSumsOk = 0;
  let entries = 0;
  let withPoints = 0;
  for (const w of weeks) {
    for (const m of d.matchups.get(w) ?? []) {
      entries++;
      if (m.players_points && Object.keys(m.players_points).length) withPoints++;
      const sum = (m.starters_points ?? []).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - (m.points ?? 0)) < 0.011) starterSumsOk++;
    }
  }
  const benchIncluded = weeks.every((w) => (d.matchups.get(w) ?? []).every((m) => (m.players ?? []).every((pid) => typeof m.players_points?.[pid] === "number")));
  const w1 = d.matchups.get(d.lastScored)?.[0];
  cl.add(
    "K",
    "K.playersPoints",
    "League-scored points",
    withPoints === entries && entries > 0 ? "ok" : "warn",
    `/matchups weeks ${weeks[0]}–${weeks[weeks.length - 1]}: players_points on ${withPoints}/${entries} team-weeks (${benchIncluded ? "every player on the roster, bench too" : "NOT every rostered player"}); Σ starters_points = points on ${starterSumsOk}/${entries}`,
    ev(d, d.matchupsF.get(d.lastScored) ?? d.leagueF, "[].players_points{player_id: points} / starters_points[] / points", w1 ? { points: w1.points, starters_points: (w1.starters_points ?? []).slice(0, 4), players_points: Object.fromEntries(Object.entries(w1.players_points ?? {}).slice(0, 4)) } : null),
  );

  const oracleWeeks = statsWeeks.map((x) => x.week);
  const inputs: OracleWeekInput[] = [];
  for (const sw of statsWeeks) {
    const { week: w, f, stats } = sw;
    if (!f.ok) {
      cl.fail("K", `K.stats.w${w}`, `Stats endpoint week ${w}`, `failed: ${f.error}`, { url: f.template, status: f.status });
      continue;
    }
    const onRosters = new Set((d.matchups.get(w) ?? []).flatMap((m) => m.players ?? []));
    await p.saveRaw(`stats/nfl/${d.season}/${w}`, f.data, f.res);
    await saveClean(p, `${d.role}/stats/nfl/${d.season}/${w} (subset)`, f, sw.rows.filter((r) => onRosters.has(r.player_id)), protectAll, "trimmed to players on the probed league's rosters that week");
    const cats = countBy(sw.rows, (r) => String(r.category ?? "?"));
    const idpRows = sw.rows.filter((r) => IDP_POS.includes(fantasyPos(d.players[r.player_id], IDP_POS))).length;
    cl.add("K", `K.stats.w${w}`, `Stats endpoint week ${w}`, sw.bad ? "warn" : "ok", `undocumented /stats works (was unverified): ${sw.rows.length} rows (${Object.entries(cats).map(([k, v]) => `${k} ${v}`).join(", ")}), ${idpRows} of them IDP players; sparse (missing key = 0); company ${[...new Set(sw.rows.map((r) => r.company))].join("/")}`, { url: f.template, status: f.status, path: "[].{player_id,stats{…},team,opponent,game_id}", sample: sw.rows.find((r) => r.player_id === "DAL")?.stats ?? null });
    inputs.push({ week: w, entries: (d.matchups.get(w) ?? []).map((m) => ({ rosterId: m.roster_id, players: m.players ?? [], playersPoints: m.players_points ?? {} })), stats });
  }
  if (!inputs.length) return;
  const res = runOracle(d.league.scoring_settings, inputs, (pid) => fantasyPos(d.players[pid], d.positions));
  d.oracle = res;
  const patterns = Object.entries(res.patterns).sort((a, b) => b[1] - a[1]);
  const nonZeroRules = Object.values(d.league.scoring_settings).filter((v) => v !== 0).length;
  cl.add(
    "K",
    "K.oracle",
    "Scoring oracle (preview)",
    res.rate >= 0.99 ? "ok" : "warn",
    `weeks ${oracleWeeks.join(", ")}: ${res.within}/${res.total} rostered player-weeks within ±${res.tolerance} (${pct(res.rate)}; target ≥ 99%); non-zero only ${res.nonZeroWithin}/${res.nonZeroTotal} (${pct(res.nonZeroRate)}); ${Object.keys(res.byKey).length} of this league's ${nonZeroRules} non-zero rules were exercised; ${res.mismatches.length} mismatch(es)${patterns.length ? `: ${patterns.slice(0, 5).map(([k, v]) => `${k} ×${v}`).join("; ")}` : ""}`,
    { url: "https://api.sleeper.app/stats/nfl/{season}/{week}?season_type=regular  vs  /v1/league/{leagueId}/matchups/{week}", status: 200, path: "Σ scoring_settings[k] × stats[k]  vs  players_points[player_id]", sample: Object.fromEntries(Object.entries(res.byPosition).map(([k, v]) => [k, `${v.within}/${v.total}`])) },
    ...res.mismatches.slice(0, 8).map((m) => ({ path: `week ${m.week} roster ${m.rosterId}`, sample: { player: playerLabel(d, m.playerId), sleeper: m.platform, computed: m.computed, diff: m.diff, statLine: m.statLine }, note: m.explainedBy.join("; ") || undefined })),
  );
  if (res.mismatches.length) {
    cl.issue(`Scoring oracle preview: ${res.mismatches.length} of ${res.total} rostered player-weeks differ by more than ${res.tolerance} — evidence: /stats/nfl/{season}/{week} vs /league/{leagueId}/matchups/{week} players_points, weeks ${oracleWeeks.join(", ")} — patterns: ${patterns.map(([k, v]) => `${k} ×${v}`).join("; ")} — options: add position rules for the keys named, or accept (below target only if > 1%).`);
  }
  await saveClean(p, `${d.role}/oracle-preview`, { status: 200, template: "computed" }, { weeks: oracleWeeks, tolerance: res.tolerance, total: res.total, within: res.within, rate: res.rate, nonZeroTotal: res.nonZeroTotal, nonZeroWithin: res.nonZeroWithin, byPosition: res.byPosition, byKey: res.byKey, patterns: res.patterns, mismatches: res.mismatches.map((m) => ({ ...m, player: playerLabel(d, m.playerId) })) }, protectLeagueData, "computed by probe-sleeper from sanitized inputs");
}

/**
 * The oracle again on a few public leagues from the sleeper-codes crawl sample, picked (salted) to
 * cover scoring the fixture league lacks: PPR, TE premium, yardage bonuses, IDP, first downs, long
 * field goals, yards-allowed brackets. When a feature stays unexercised (no rostered player hit it in
 * the sampled weeks), one more league covering it is tried, up to CROSS_ORACLE_MAX leagues. Only
 * aggregates are reported; no fixture of those leagues is written and their IDs are registered with
 * a separate Redactor (console scrubbing) and the watch list.
 *
 * These are strangers' leagues other than the pinned test league, so without --allow-crawl they are
 * read from the HTTP cache only (CLAUDE.md §0.6), the remembered picks are left as they are, and a
 * league the cache lacks counts as "not cached" rather than failed.
 */
async function checkCrossLeagueOracle(d: Data, statsWeeks: StatsWeek[], oracleIds: Redactor, watch: Watchlist, allowCrawl: boolean): Promise<void> {
  const { p } = d;
  const { cl } = p;
  const offline = !allowCrawl;
  const weeks = statsWeeks.filter((s) => s.f.ok).map((s) => s.week);
  const crawlLeagues = readCrawlLeagues();
  if (!crawlLeagues) {
    cl.na("K", "K.oracleCrossLeague", "Scoring oracle, other leagues", `${allowCrawl ? "skipped" : NEEDS_CRAWL}: the probe:sleeper-codes crawl sample (data-local/sleeper-codes, git-ignored) isn't present; run npm run probe:sleeper-codes${allowCrawl ? "" : " -- --allow-crawl"}, then this probe`);
    return;
  }
  if (!weeks.length) {
    cl.na("K", "K.oracleCrossLeague", "Scoring oracle, other leagues", "skipped: no /stats weeks loaded");
    return;
  }
  // Reuse the remembered picks while they still qualify; otherwise pick again with the stored salt.
  let saved: { salt?: string; leagueIds?: string[] } = {};
  try {
    if (existsSync(CROSS_ORACLE_FILE)) saved = JSON.parse(readFileSync(CROSS_ORACLE_FILE, "utf8")) as typeof saved;
  } catch {
    saved = {};
  }
  const salt = typeof saved.salt === "string" && saved.salt ? saved.salt : newSalt();
  const byId = new Map(crawlLeagues.map((l) => [l.leagueId, l]));
  let queue: CrawlLeague[] = (saved.leagueIds ?? []).map((id) => byId.get(id)).filter((l): l is CrawlLeague => !!l && eligibleForOracle(l, weeks));
  if (queue.length < CROSS_ORACLE_MIN) queue = pickOracleLeagues(crawlLeagues, weeks, salt, CROSS_ORACLE_MAX, CROSS_ORACLE_MIN);

  const statsByWeek = new Map(statsWeeks.filter((s) => s.f.ok).map((s) => [s.week, s.stats]));
  const total = { leagues: 0, failed: 0, notCached: 0, partial: 0, total: 0, within: 0, nonZeroTotal: 0, nonZeroWithin: 0 };
  /** Oldest cached copy used (offline runs report how old the evidence is). */
  let oldestCache: number | undefined;
  const noteCache = (f: Fetched<unknown>) => {
    const at = f.res?.cachedAt;
    if (at !== undefined) oldestCache = Math.min(oldestCache ?? at, at);
  };
  // The same leagues' rosters also exercise the §2.3 my-team rule (co-owners are rare in one league).
  const myTeam = { leagues: 0, owners: { total: 0, resolved: 0 }, coOwners: { total: 0, resolved: 0 }, onSeveralRosters: 0 };
  const byKey: Record<string, { exercised: number; within: number }> = {};
  const patterns: Record<string, number> = {};
  const scoredKeys = new Set<string>();
  const tried = new Set<string>();
  const used: string[] = [];
  const exercisedTargets = () => new Set(ORACLE_TARGETS.filter((t) => Object.entries(byKey).some(([k, v]) => t.test(k) && v.exercised > 0)).map((t) => t.name));

  const evaluate = async (l: CrawlLeague): Promise<void> => {
    tried.add(l.leagueId);
    oracleIds.register(l.leagueId, "league-id", `oracle-league-${tried.size}`);
    watch.add(l.leagueId, "league-id");
    const leagueF = await fetchJson<unknown>(p, endpoints.league(l.leagueId), "league", { offline });
    noteCache(leagueF);
    watch.addLeague(leagueF.data);
    const lg = parseOne(LeagueSchema, leagueF.data).value;
    if (!lg) {
      if (leagueF.offlineMiss) total.notCached++;
      else total.failed++;
      return;
    }
    // IDs are scrubbed from console output; names (never printed) are only on the watch list.
    oracleIds.register((lg as Record<string, unknown>).last_author_id, "user-id");
    const rostersF = await fetchJson<unknown>(p, endpoints.rosters(l.leagueId), "league", { offline });
    noteCache(rostersF);
    const rosters = rostersF.ok ? parseArray(RosterSchema, rostersF.data).value : [];
    if (rosters.length) {
      for (const r of rosters) {
        watch.addRoster(r);
        for (const uid of [r.owner_id, ...(r.co_owners ?? [])]) if (uid) oracleIds.register(uid, "user-id");
      }
      const a = auditMyTeamLookup(rosters);
      myTeam.leagues++;
      myTeam.owners.total += a.owners.total;
      myTeam.owners.resolved += a.owners.resolved;
      myTeam.coOwners.total += a.coOwners.total;
      myTeam.coOwners.resolved += a.coOwners.resolved;
      myTeam.onSeveralRosters += a.onSeveralRosters;
    }
    const positions = startablePositions(lg.roster_positions);
    const inputs: OracleWeekInput[] = [];
    let weeksNotCached = 0;
    for (const w of weeks) {
      const f = await fetchJson<unknown>(p, endpoints.matchups(l.leagueId, w), "league", { offline });
      noteCache(f);
      if (f.offlineMiss) weeksNotCached++;
      const rows = f.ok ? parseArray(MatchupSchema, f.data).value : [];
      if (!rows.length) continue;
      inputs.push({ week: w, entries: rows.map((m) => ({ rosterId: m.roster_id, players: m.players ?? [], playersPoints: m.players_points ?? {} })), stats: statsByWeek.get(w) ?? new Map() });
    }
    if (!inputs.length) {
      if (weeksNotCached) total.notCached++;
      else total.failed++;
      return;
    }
    if (weeksNotCached) total.partial++;
    const res = runOracle(lg.scoring_settings, inputs, (pid) => fantasyPos(d.players[pid], positions));
    used.push(l.leagueId);
    total.leagues++;
    total.total += res.total;
    total.within += res.within;
    total.nonZeroTotal += res.nonZeroTotal;
    total.nonZeroWithin += res.nonZeroWithin;
    for (const [k, v] of Object.entries(res.byKey)) {
      const e = (byKey[k] ??= { exercised: 0, within: 0 });
      e.exercised += v.exercised;
      e.within += v.within;
    }
    for (const [k, v] of Object.entries(res.patterns)) patterns[k] = (patterns[k] ?? 0) + v;
    for (const [k, v] of Object.entries(lg.scoring_settings)) if (v !== 0) scoredKeys.add(k);
  };

  for (const l of queue.slice(0, CROSS_ORACLE_MAX)) await evaluate(l);
  // Features still unexercised: try one more league covering them, while the budget lasts.
  while (tried.size < CROSS_ORACLE_MAX) {
    const done = exercisedTargets();
    const wanted = new Set(ORACLE_TARGETS.map((t) => t.name).filter((n) => !done.has(n)));
    if (!wanted.size) break;
    const more = pickOneMore(crawlLeagues, weeks, salt, tried, wanted);
    if (!more) break;
    await evaluate(more);
  }
  // Offline runs leave the remembered picks alone (a cache gap must not shrink them).
  if (allowCrawl) await writeFileAtomic(CROSS_ORACLE_FILE, JSON.stringify({ salt, leagueIds: used, chosenAt: new Date().toISOString() }, null, 2));
  if (!total.leagues && total.notCached) {
    cl.na("K", "K.oracleCrossLeague", "Scoring oracle, other leagues", `${NEEDS_CRAWL}: none of the ${tried.size} picked leagues from the probe:sleeper-codes crawl sample is in the HTTP cache, and without --allow-crawl this probe requests no stranger's league other than the pinned test league`);
    d.crossOracle = { leagues: 0, total: 0, within: 0, byKey: {} };
    return;
  }
  const cacheNote = offline
    ? `; offline (no --allow-crawl): read from cached copies${oldestCache !== undefined ? ` (oldest ${iso(oldestCache)})` : ""}, nothing requested${total.notCached ? `; ${total.notCached} more picked league(s) not in the cache` : ""}${total.partial ? `; ${total.partial} league(s) missing some weeks in the cache` : ""}`
    : "";

  const rate = total.total ? total.within / total.total : 0;
  const targetStats = ORACLE_TARGETS.map((t) => {
    const keys = Object.keys(byKey).filter(t.test);
    const exercised = keys.reduce((s, k) => s + (byKey[k]?.exercised ?? 0), 0);
    const within = keys.reduce((s, k) => s + (byKey[k]?.within ?? 0), 0);
    return { name: t.name, scored: [...scoredKeys].some(t.test), exercised, within };
  });
  const exercised = targetStats.filter((t) => t.exercised > 0);
  const scoredIdle = targetStats.filter((t) => t.scored && t.exercised === 0).map((t) => t.name);
  const notScored = targetStats.filter((t) => !t.scored).map((t) => t.name);
  const targetsFine = exercised.every((t) => t.within / t.exercised >= 0.99) && !scoredIdle.length && !notScored.length;
  const patternList = Object.entries(patterns).sort((a, b) => b[1] - a[1]);
  const topKeys = Object.entries(byKey).sort((a, b) => b[1].exercised - a[1].exercised);
  cl.add(
    "K",
    "K.oracleCrossLeague",
    "Scoring oracle, other leagues",
    total.leagues >= CROSS_ORACLE_MIN && rate >= 0.99 && targetsFine ? "ok" : "warn",
    total.leagues
      ? `${total.leagues} public in-season leagues from the probe:sleeper-codes crawl sample, picked (salted) to cover scoring this league lacks${total.failed ? ` (${total.failed} more couldn't be read)` : ""}; weeks ${weeks.join(", ")}: ${total.within}/${total.total} rostered player-weeks within ±0.05 (${pct(rate)}); non-zero only ${total.nonZeroWithin}/${total.nonZeroTotal}; ${Object.keys(byKey).length} distinct rules exercised; features (player-weeks matched/exercised): ${exercised.map((t) => `${t.name} ${t.within}/${t.exercised}`).join(", ") || "none"}${scoredIdle.length ? `; scored but not hit by any rostered player in these weeks: ${scoredIdle.join(", ")}` : ""}${notScored.length ? `; not scored by the leagues read: ${notScored.join(", ")}` : ""}; ${patternList.length ? `mismatch patterns: ${patternList.slice(0, 5).map(([k, v]) => `${k} ×${v}`).join("; ")}` : "0 mismatches"}${cacheNote}`
      : `none of the ${tried.size} picked crawl leagues could be read${cacheNote}`,
    { url: "https://api.sleeper.app/v1/league/{leagueId}  +  /v1/league/{leagueId}/matchups/{week}  vs  https://api.sleeper.app/stats/nfl/{season}/{week}?season_type=regular", status: 200, path: "Σ scoring_settings[k] × stats[k]  vs  players_points (aggregate over the picked leagues)", sample: Object.fromEntries(topKeys.slice(0, 40).map(([k, v]) => [k, `${v.within}/${v.exercised}`])) },
  );
  if (myTeam.leagues) {
    const fine = myTeam.owners.resolved === myTeam.owners.total && myTeam.coOwners.resolved === myTeam.coOwners.total && myTeam.onSeveralRosters === 0;
    cl.add(
      "D",
      "D.myTeamLookupOther",
      "My-team rule, other leagues",
      fine && myTeam.coOwners.total > 0 ? "ok" : "warn",
      `the §2.3 lookup (owner_id, then co_owners) run for every member of the ${myTeam.leagues} cross-oracle leagues (aggregate only): owner_id ${myTeam.owners.resolved}/${myTeam.owners.total}, co_owners ${myTeam.coOwners.resolved}/${myTeam.coOwners.total} resolve to their own roster${myTeam.coOwners.total ? "" : " (no co-owners there either: that branch is covered by unit tests only)"}; ${myTeam.onSeveralRosters} user(s) on more than one roster`,
      { url: "https://api.sleeper.app/v1/league/{leagueId}/rosters", status: 200, path: "[].owner_id / [].co_owners[]", sample: { leagues: myTeam.leagues, owners: myTeam.owners, coOwners: myTeam.coOwners } },
    );
  }
  if (patternList.length) {
    cl.issue(`Cross-league scoring oracle: ${total.total - total.within} of ${total.total} player-weeks in ${total.leagues} crawled public leagues differ by more than 0.05 — evidence: /stats/nfl/{season}/{week} vs /league/{leagueId}/matchups/{week} players_points, weeks ${weeks.join(", ")} (aggregate only) — patterns: ${patternList.map(([k, v]) => `${k} ×${v}`).join("; ")} — options: add rules for the keys named, or accept if under 1%.`);
  }
  d.crossOracle = { leagues: total.leagues, total: total.total, within: total.within, byKey };
}

// ============================================================================================
// L. NFL schedule
// ============================================================================================

async function checkL(d: Data, proj: Proj): Promise<void> {
  const { p } = d;
  const { cl } = p;
  cl.na("L", "L.documented", "Documented NFL schedule", "Sleeper documents no NFL schedule or bye-week endpoint; the shared probe covers nflverse games.csv and ESPN proTeamSchedules_wl");
  const sch = d.schedule;
  if (!sch || !sch.f.ok || !sch.rows.length) {
    cl.warn("L", "L.undocumented", "Undocumented /schedule", `not usable: ${sch?.f.error ?? "unexpected body"}`, sch ? { url: sch.f.template, status: sch.f.status } : {});
    return;
  }
  const { f, rows } = sch;
  const seen = new Map<string, number>();
  for (const g of rows) {
    if (typeof g.week !== "number") continue;
    const key = `${g.week}|${g.home}|${g.away}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => k.replace(/\|/g, " "));
  const byes = [...sch.teamsByWeek].sort((a, b) => a[0] - b[0]).map(([w, s]) => `${w}:${sch.allTeams.size - s.size}`);
  const next = proj.next;
  const projByeTeams = next ? 32 - new Set(next.rows.filter((r) => r.opponent).map((r) => r.team)).size : undefined;
  const schedBye = next ? sch.allTeams.size - (sch.teamsByWeek.get(next.week)?.size ?? 0) : undefined;
  const byStatus = countBy(rows, (g) => String(g.status ?? "?"));
  const notCanceled = rows.filter((g) => g.status !== "canceled").length;
  await p.saveRaw(`schedule/nfl/regular/${d.season}`, f.data, f.res);
  await saveClean(p, `schedule/nfl/regular/${d.season}`, f, f.data, protectAll, "undocumented endpoint");
  cl.warn(
    "L",
    "L.undocumented",
    "Undocumented /schedule",
    `works but undocumented: ${rows.length} rows (${notCanceled} not canceled; a full season is 272 games), ${sch.teamsByWeek.size} weeks, ${sch.allTeams.size} teams, statuses ${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(", ")}${dupes.length ? `; duplicate rows: ${dupes.join(", ")}` : ""}; teams on bye per week (week:count) ${byes.join(" ")}${next ? `; week ${next.week} byes agree with projections: ${projByeTeams === schedBye ? "yes" : "NO"} (${schedBye} vs ${projByeTeams})` : ""}`,
    { url: f.template, status: f.status, path: "[].{week,home,away,date,status,game_id}", sample: rows[0] ?? null },
  );
}

// ============================================================================================
// M. FantasyCalc match rate
// ============================================================================================

async function checkM(d: Data): Promise<void> {
  const { p, league, num } = d;
  const { cl } = p;
  const counts = slotCounts(league.roster_positions);
  const superflex = (counts.SUPER_FLEX ?? 0) > 0 || (counts.QB ?? 0) >= 2;
  const rec = league.scoring_settings.rec ?? 0;
  const type = num("type");
  const formats: FcFormat[] = [];
  const base = { numQbs: (superflex ? 2 : 1) as 1 | 2, numTeams: nearest(FC_TEAM_SIZES, d.numTeams), ppr: nearest([0, 0.5, 1] as const, rec) };
  if (type === 2) formats.push({ isDynasty: true, ...base });
  else if (type === 1) formats.push({ isDynasty: false, ...base }, { isDynasty: true, ...base });
  else formats.push({ isDynasty: false, ...base });
  const tep = league.scoring_settings.bonus_rec_te ?? 0;
  cl.ok(
    "M",
    "M.format",
    "FantasyCalc format",
    `${formats.map((f) => `isDynasty=${f.isDynasty}`).join(" + ")}, numQbs=${base.numQbs} (${superflex ? "SUPER_FLEX or 2+ QB slots" : "1 QB slot, no SUPER_FLEX"}), numTeams=${base.numTeams} (league ${d.numTeams}), ppr=${base.ppr} (scoring rec ${rec}); no tep parameter (bonus_rec_te ${tep})`,
    ev(d, d.leagueF, "settings.type / roster_positions / scoring_settings.rec / bonus_rec_te", { type, QB: counts.QB ?? 0, SUPER_FLEX: counts.SUPER_FLEX ?? 0, rec, bonus_rec_te: tep }),
  );
  cl.decision(`FantasyCalc format for Sleeper: isDynasty from settings.type (2 → dynasty values; 1 keeper → both redraft and dynasty; else redraft), numQbs = 2 when a SUPER_FLEX slot or 2+ QB slots exist, numTeams = nearest of ${FC_TEAM_SIZES.join("/")}, ppr = nearest of 0/0.5/1 to scoring_settings.rec; no tep parameter is sent here (bonus_rec_te is reported; TE-premium values are the shared probe's to verify).`);
  const rosteredList = [...d.rostered].map((pid) => ({ id: pid, name: playerLabel(d, pid), pos: fantasyPos(d.players[pid], d.positions) }));
  for (const f of formats) {
    let fc: FcEntry[] = [];
    let status = 0;
    let url = "";
    try {
      const r = await getFantasyCalc(f);
      fc = r.data;
      status = r.res.status;
      url = r.res.url;
    } catch (err) {
      cl.fail("M", `M.matchRate.${f.isDynasty ? "dynasty" : "redraft"}`, "FantasyCalc match rate", `FantasyCalc failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const m = matchRate(rosteredList, fc, "sleeperId");
    const missByPos = countBy(m.misses, (x) => x.pos);
    const pickRows = fc.filter((e) => e.player.position === "PICK" || String(e.player.sleeperId ?? "").startsWith("FP_")).length;
    cl.add(
      "M",
      `M.matchRate.${f.isDynasty ? "dynasty" : "redraft"}`,
      `FantasyCalc match rate (${f.isDynasty ? "dynasty" : "redraft"})`,
      m.rate >= 0.98 ? "ok" : "warn",
      `${m.matched}/${m.eligible} rostered QB/RB/WR/TE matched by sleeperId (${pct(m.rate)}; target ≥ 98%); FantasyCalc returned ${fc.length} rows (${fc.length - pickRows} players + ${pickRows} draft picks)${m.misses.length ? `; misses by position: ${Object.entries(missByPos).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}`,
      { url, status, path: "[].player.sleeperId", sample: m.misses.slice(0, 25).map((x) => x.name) },
    );
    if (m.misses.length) d.fcMisses = [...(d.fcMisses ?? []), ...m.misses.map((x) => `${f.isDynasty ? "dynasty" : "redraft"}: ${x.name}`)];
  }
}

// ============================================================================================
// Public-data fixtures (trimmed) + manifest + settings table
// ============================================================================================

async function savePublicSubsets(d: Data, proj: Proj): Promise<void> {
  const { p, players } = d;
  // Players referenced by the league, plus the best free agents per position by projected league points.
  const keep = new Set<string>(d.rostered);
  for (const rows of d.matchups.values()) for (const m of rows) for (const pid of m.players ?? []) keep.add(pid);
  for (const t of d.allTx) for (const pid of [...Object.keys(t.adds ?? {}), ...Object.keys(t.drops ?? {})]) keep.add(pid);
  for (const b of d.draftBundles) for (const pk of b.picks) keep.add(pk.player_id);
  const now = proj.now;
  const faTop: string[] = [];
  if (now) {
    const byPos = new Map<string, Array<{ pid: string; pts: number }>>();
    for (const r of now.rows) {
      if (d.rostered.has(r.player_id) || !hasProjection(r.stats)) continue;
      const pos = fantasyPos(players[r.player_id], d.positions);
      const list = byPos.get(pos) ?? [];
      list.push({ pid: r.player_id, pts: leaguePoints(d.league.scoring_settings, toScoringStats(r.stats, projKind(r))) });
      byPos.set(pos, list);
    }
    for (const pos of d.positions) for (const x of (byPos.get(pos) ?? []).sort((a, b) => b.pts - a.pts).slice(0, FA_PER_POSITION)) faTop.push(x.pid);
  }
  for (const pid of faTop) keep.add(pid);
  if (d.playersF.ok) {
    const subset = Object.fromEntries([...keep].filter((pid) => players[pid]).sort().map((pid) => [pid, players[pid]]));
    await saveClean(p, `${d.role}/players/nfl (subset)`, { status: d.playersF.status, template: "https://api.sleeper.app/v1/players/nfl" }, subset, protectAll, `${Object.keys(subset).length} players: everyone referenced by the league + top ${FA_PER_POSITION} free agents per position by week-${d.currentWeek} league points (real projections only)`);
  }
  for (const w of proj.weeks) {
    if (!w.f.ok) continue;
    await p.saveRaw(`projections/nfl/${d.season}/${w.week}`, w.f.data, w.f.res);
    // Only the current week keeps each row's embedded `player` object (identical in every week; the players subset has it).
    const full = w.week === d.currentWeek;
    const rows = w.rows.filter((r) => keep.has(r.player_id)).map((r) => (full ? r : { ...r, player: undefined }));
    await saveClean(p, `${d.role}/projections/nfl/${d.season}/${w.week} (subset)`, w.f, rows, protectAll, `${rows.length} of ${w.rows.length} rows (league-referenced players + top free agents, ADP-only stub rows included)${full ? "" : "; embedded player objects removed"}`);
  }
  if (d.settingsRows) await saveClean(p, `${d.role}/league/{leagueId}/settings-keys`, { status: 200, template: "computed" }, d.settingsRows, protectLeagueData, "every settings key with value, meaning, confidence and basis (this league's data and probe:sleeper-codes)");
  if (d.keyCoverage) {
    await saveClean(
      p,
      `${d.role}/projection-key-coverage`,
      { status: 200, template: "computed" },
      { note: "For each scoring key used across the probe:sleeper-codes crawl sample (leagues = how many score it): whether Sleeper /projections carries it (projected / alias via the key map) or the proposed treatment (derive / expected-value / rate-model / zero-rare); statsShare = highest non-zero share in the sampled /stats weeks.", aliases: PROJECTION_ALIASES, rows: d.keyCoverage satisfies CoverageRow[] },
      protectAll,
      "computed from public projections/stats and aggregate crawl counts",
    );
  }
  const uid = d.choice.userId;
  const entry = {
    fixturePrefix: `${d.role}/`,
    selection: d.choice.mode,
    leagueId: d.league.league_id,
    season: d.season,
    currentWeek: d.currentWeek,
    lastScoredWeek: d.lastScored,
    numTeams: d.numTeams,
    me: uid ? { userId: uid, rosterId: d.myRoster?.rosterId ?? null, via: d.myRoster?.via ?? null, who: d.choice.mode === "fallback" ? "the fallback's 'me' (not Parker): the member whose league list led to this league" : "Parker" } : null,
    freeAgentsIncluded: faTop.length,
    projectionWeeks: proj.weeks.map((w) => w.week),
    statsWeeks: [d.lastScored - 1, d.lastScored],
    capturedOn: new Date().toISOString().slice(0, 10),
  };
  // One manifest for the folder: the entry for this league role replaces its previous entry; other
  // roles' entries are kept, except the public test league's once Parker's league is probed.
  const previous = readSanitizedFixture(SANITIZED_MANIFEST_LABEL) as { leagues?: Record<string, unknown> } | null;
  const manifest = {
    platform: "sleeper",
    // Parker's league replaces the stranger's test league (whose fixtures are deleted in that case).
    leagues: { ...Object.fromEntries(Object.entries(previous?.leagues ?? {}).filter(([k]) => !(d.role === "parker-league" && k === "public-test-league"))), [d.role]: entry },
    notes: [
      "One entry per probed league; fixture labels start with its fixturePrefix (see index.json for label → file).",
      "Placeholders: owner of roster N = user 2000…0N / Owner N / Team N; co-owners and others are numbered after the last roster.",
      "{leagueId}, {draftId}, {userId} in labels are placeholders; 'me' is Parker only in the parker-league entry.",
    ],
  };
  await saveClean(p, SANITIZED_MANIFEST_LABEL, { status: 200, template: "computed" }, manifest, protectLeagueData, "which placeholder user/roster is 'me' for Phase 1 my-team tests");
}

const SANITIZED_MANIFEST_LABEL = "manifest";

/**
 * Read one of this probe's own sanitized fixtures back by label (placeholders only), from the folder
 * that label is saved to (committed, or git-ignored data-local/ for a stranger's league).
 */
function readSanitizedFixture(label: string): unknown {
  try {
    const dir = sanitizedDirFor("sleeper", label);
    const index = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")) as Record<string, { label: string }>;
    const file = Object.entries(index).find(([, e]) => e.label === label)?.[0];
    return file ? (JSON.parse(readFileSync(path.join(dir, file), "utf8")) as unknown) : null;
  } catch {
    return null;
  }
}

// Extra fields filled in by the checks.
interface Data {
  settingsRows?: ReturnType<typeof describeSettings>;
  projectionUncovered?: string[];
  keyCoverage?: CoverageRow[];
  myRoster?: { rosterId: number; via: string } | null;
  oracle?: OracleResult;
  crossOracle?: { leagues: number; total: number; within: number; byKey: Record<string, { exercised: number; within: number }> };
  fcMisses?: string[];
}
