/**
 * Phase 0 probe: MyFantasyLeague (CLAUDE.md §2.6, §17 Data Checklist A–M).
 *
 *   npm run probe:mfl                        league data cached 10 min (CLAUDE.md §2.10)
 *   npx tsx scripts/probe-mfl.ts --reuse     reuse cached league data for 24 h (development)
 *   npx tsx scripts/probe-mfl.ts --shapes    also print the shape of every response (no values)
 *
 * League: MFL_LEAGUE_ID from .env.local (MFL_USERNAME / MFL_PASSWORD only for private leagues);
 * otherwise a public test league found once with TYPE=leagueSearch (see lib/mfl/search.ts).
 * About 30 MFL requests on a cold run, paced ≥ 1.2 s apart by lib/http.ts, never retried (MFL asks
 * clients not to retry). Every claim in the report is computed from this run's data or the docs text.
 */
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { DAY, TTL, credentialScope } from "./lib/cache";
import { FC_TEAM_SIZES, getFantasyCalc, matchRate, nearest, type FcFormat } from "./lib/fantasycalc";
import { SANITIZED_DIR } from "./lib/fixtures";
import { getJson, request } from "./lib/http";
import { runProbe, type ProbeContext } from "./lib/probe";
import { describeShape, formatShape } from "./lib/shape";
import { getSleeperPlayers } from "./lib/sleeper-players";
import { MflClient, MflThrottledError, MFL_API_HOST, MFL_DOCS, mflLogin, type MflCall } from "./lib/mfl/client";
import { ageAt, compareWeekList, idList, nextKickoffWeek, parseAddDrop, parseTradeSide, returnWeek, txWeek, weekOf, type Kickoffs } from "./lib/mfl/derive";
import { docHas, documentedTransTypes, htmlToText, typeAccess, typeBlock } from "./lib/mfl/docs";
import { pruneSanitized, synthesizeSearchSample, trimLeagueHistory, homeUrlPrefixes } from "./lib/mfl/fixture";
import { LEAGUE_HOST_PLACEHOLDER, redactFranchiseFields, redactUnknownLeagueFields, registerFreeText, registerLeagueHost, registerLeagueIdentities } from "./lib/mfl/identities";
import { asArray, at, isRecord, num, text } from "./lib/mfl/json";
import { convertRosterLimits, convertStarters } from "./lib/mfl/lineup";
import { buildCrosswalk, projectionAgreement, runOracle, type Crosswalk, type MflPlayerIds, type OracleResult, type ProjectionPair } from "./lib/mfl/oracle";
import { MFL_POS, toInjury, toNflTeam, toPos } from "./lib/mfl/positions";
import { compileFor, parseRules, scoreStats, type Compiled } from "./lib/mfl/rules";
import { MFL_EVENTS } from "./lib/mfl/scoringMap";
import { findTestLeague, hostFromHomeUrl, loadChosen, loadSearchCapture, parseSearch, saveChosen, searchRawKey, type ChosenLeague } from "./lib/mfl/search";
import { addToWatchlist } from "./lib/mfl/watchlist";

const YEAR = 2026;
const REUSE = process.argv.includes("--reuse");
const SHAPES = process.argv.includes("--shapes");
const DP_IDMAP_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";
const FC_PLAYERS_URL = "https://api.fantasycalc.com/players";
const sleeperStatsUrl = (w: number) => `https://api.sleeper.app/stats/nfl/${YEAR}/${w}?season_type=regular`;
/** Sleeper weekly projections for one position (undocumented; same URL and cache key as the shared probe, "projections:<url>"). */
const sleeperProjectionsUrl = (w: number, position: string) => `https://api.sleeper.app/projections/nfl/${YEAR}/${w}?season_type=regular&position=${position}`;
const fetchSleeperProjections = (w: number, position: string) => {
  const url = sleeperProjectionsUrl(w, position);
  return request(url, { cache: { key: `projections:${url}`, ttlMs: TTL.projections, namespace: "projections" }, label: `Sleeper projections ${w} ${position}`, timeoutMs: 180_000 });
};
/** Public, league-independent TYPEs: no identities to register; saved with every path protected. */
const PUBLIC_CALLS: ReadonlySet<string> = new Set(["allRules", "players", "injuries", "nflSchedule", "byes", "status"]);
const OFFENSE = ["QB", "RB", "WR", "TE"];
/** J.agreement: ignore pairs where either projection is this small (ratios of tiny numbers are noise). */
const AGREEMENT_MIN_POINTS = 3;

type Params = Record<string, string | number | undefined>;
type LeagueType = "dynasty" | "keeper" | "redraft";
const arr = (v: unknown, p: string): unknown[] => asArray(at(v, p) as unknown[]);
const str = (v: unknown, p: string): string | undefined => text(at(v, p));
const team = (id: string | undefined) => (id ? `Team ${Number(id)}` : "?");
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");
const countBy = <T>(xs: T[], key: (x: T) => string | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const x of xs) {
    const k = key(x) ?? "(none)";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};
/** Sorted union of the keys of a list of records. */
const keySet = (items: unknown[]): string[] => [...new Set(items.flatMap((i) => (isRecord(i) ? Object.keys(i) : [])))].sort();
const topBy = (m: Map<string, number>, n = 3) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
const hostOf = (u: string | undefined): string | undefined => {
  try {
    return u ? new URL(u).host.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
};

runProbe("mfl", async (p) => {
  const { cl } = p;
  const leagueTtl = REUSE ? DAY : TTL.league;
  const projTtl = REUSE ? DAY : TTL.projections;

  // ── Credentials (a login is the only MFL request that may come before the docs) ─────────────────
  const envLeague = p.env("MFL_LEAGUE_ID");
  const username = p.env("MFL_USERNAME");
  const password = p.env("MFL_PASSWORD");
  let scope = "public";
  let cookie: string | undefined;
  if (envLeague && username && password) {
    cookie = await mflLogin(YEAR, username, password);
    scope = credentialScope(username, password);
    cl.decision("MFL login: POST https://api.myfantasyleague.com/2026/login (USERNAME, PASSWORD, XML=1) → MFL_USER_ID cookie ('+', '/', '=' URL-escaped as api_info suggests), kept in memory only and scrubbed from output; private data cached under a credential-hash key.");
  }
  const c = new MflClient(YEAR, scope, cookie);

  // ── Docs: what MFL says, checked against the live pages (paced and counted like every MFL call) ──
  const docs = await readDocs(c);

  // ── League choice ────────────────────────────────────────────────────────────────────────────────
  let chosen: ChosenLeague | undefined;
  let source: string;
  let envProbe: MflCall | undefined;
  if (envLeague) {
    p.redactor.register(envLeague, "league-id");
    // The api host either answers or redirects; the client follows redirects by hand with the cookie.
    envProbe = await c.export("league", { L: envLeague }, { ttlMs: leagueTtl, namespace: "league-mfl", label: "MFL league (api host)" });
    const leagueHost = hostOf(str(envProbe.json, "league.baseURL")) ?? MFL_API_HOST;
    // The hop was templated before the league host was known: relabel it if it went there.
    const lastHop = envProbe.redirects[envProbe.redirects.length - 1];
    if (lastHop && hostOf(envProbe.res.url) === leagueHost) lastHop.to = "{leagueHost}";
    chosen = { id: envLeague, host: leagueHost, chosenAt: new Date().toISOString(), method: "MFL_LEAGUE_ID from .env.local" };
    source = "MFL_LEAGUE_ID in .env.local";
  } else {
    chosen = await loadChosen();
    if (!chosen) {
      const found = await findTestLeague(c, async (call) => {
        await p.saveRaw(searchRawKey(YEAR), call.rawJson ?? call.res.text, call.res);
      });
      for (const l of found.log) console.log(`  candidate ${l.n}: teams=${l.franchises} ir=${l.irSlots} taxi=${l.taxiSlots} games=${l.games ?? "-"} statuses=${JSON.stringify(l.statuses ?? {})} → ${l.verdict}`);
      // Every league looked at goes on the git-ignored watch list for check:leaks (never printed).
      await addToWatchlist(found.examined.flatMap((h) => [
        { value: h.id, category: "league-id" as const },
        { value: h.name, category: "league-name" as const },
      ]));
      chosen = found.chosen;
      if (chosen) await saveChosen(chosen);
    }
    source = "public test league (MFL_LEAGUE_ID is blank)";
  }
  if (!chosen) {
    cl.fail("A", "A.league", "Test league", "no qualifying public league found via leagueSearch; fill in MFL_LEAGUE_ID in .env.local");
    return;
  }
  const L = chosen.id;
  const host = chosen.host;
  p.redactor.register(L, "league-id");
  registerLeagueHost(p.redactor, host);
  c.leagueHost = host;

  // ── Fetch everything once (sequential; lib/http.ts paces all MFL hosts as one bucket) ────────────
  const status = await safe(c.file(`/fflnetdynamic${YEAR}/mfl_status.json`, { ttlMs: TTL.league, namespace: "mfl-public", label: "MFL mfl_status.json" }));
  const curWeek = num(at(status?.json, "mfl_status.weeks.CurrentWeek")) ?? 4;
  const doneWeek = num(at(status?.json, "mfl_status.weeks.CompletedWeek")) ?? curWeek - 1;

  const get = async (name: string, type: string, params: Params, where: "league" | "api", ttlMs: number): Promise<MflCall | undefined> => {
    const call = await safe(c.export(type, where === "league" ? { L, ...params } : params, { host: where === "league" ? host : MFL_API_HOST, ttlMs, namespace: where === "league" ? "league-mfl" : "mfl-public", label: `MFL ${type}` }));
    if (!call) {
      cl.issue(`${type}: not requested — MFL returned 429 earlier in this run (cool-down)`);
      return undefined;
    }
    await p.saveRaw(`mfl:${L}:${name}`, call.rawJson ?? call.res.text, call.res);
    if (SHAPES) console.log(`--- ${name}\n${formatShape(describeShape(call.json, 7))}`);
    return call;
  };
  // The same league request on the api host shows whether MFL redirects it to the league's host.
  const leagueApi = envProbe ?? (await safe(c.export("league", { L }, { ttlMs: leagueTtl, namespace: "league-mfl", label: "MFL league (api host)" })));
  if (leagueApi) await p.saveRaw(`mfl:${L}:league@api`, leagueApi.rawJson ?? leagueApi.res.text, leagueApi.res);
  const leagueCall = await get("league", "league", {}, "league", leagueTtl);
  if (!leagueCall?.json || leagueCall.error) {
    cl.fail("A", "A.league", "League export", `TYPE=league failed: ${leagueCall?.error ?? `HTTP ${leagueCall?.res.status}`}`, { url: leagueCall?.template, status: leagueCall?.res.status });
    return;
  }
  if (!envLeague) await addToWatchlist([{ value: L, category: "league-id" }, { value: text(at(leagueCall.rawJson, "league.name")), category: "league-name" }]);
  const lg = at(leagueCall.json, "league");
  const endWeek = num(at(lg, "endWeek")) ?? 17;
  // Playoff rounds first: the last fantasy week comes from the championship bracket, not endWeek.
  const brackets = await get("playoffBrackets", "playoffBrackets", {}, "league", leagueTtl);
  const bracketId = str(arr(brackets?.json, "playoffBrackets.playoffBracket")[0], "id");
  const bracket = bracketId ? await get(`playoffBracket.${bracketId}`, "playoffBracket", { BRACKET_ID: bracketId }, "league", leagueTtl) : undefined;
  const roundWeeks = arr(bracket?.json, "playoffBracket.playoffRound")
    .map((r) => num(at(r, "week")))
    .filter((w): w is number => w !== undefined);
  const lastWeek = roundWeeks.length ? Math.max(...roundWeeks) : endWeek;
  const txWeekChecked = Math.max(1, doneWeek - 1);
  const calls = {
    league: leagueCall,
    rules: await get("rules", "rules", {}, "league", leagueTtl),
    rosters: await get("rosters", "rosters", {}, "league", leagueTtl),
    standings: await get("leagueStandings", "leagueStandings", { COLUMN_NAMES: 1, ALL: 1 }, "league", leagueTtl),
    schedule: await get("schedule", "schedule", {}, "league", leagueTtl),
    transactions: await get("transactions", "transactions", { TRANS_TYPE: "*" }, "league", leagueTtl),
    transactionsWeek: await get(`transactions.w${txWeekChecked}`, "transactions", { TRANS_TYPE: "*", W: txWeekChecked }, "league", leagueTtl),
    futurePicks: await get("futureDraftPicks", "futureDraftPicks", {}, "league", leagueTtl),
    draftResults: await get("draftResults", "draftResults", {}, "league", leagueTtl),
    freeAgents: await get("freeAgents", "freeAgents", {}, "league", leagueTtl),
    projNow: await get(`projectedScores.w${curWeek}`, "projectedScores", { W: curWeek }, "league", projTtl),
    projNext: await get(`projectedScores.w${curWeek + 1}`, "projectedScores", { W: curWeek + 1 }, "league", projTtl),
    projLast: await get(`projectedScores.w${lastWeek}`, "projectedScores", { W: lastWeek }, "league", projTtl),
    scoresLast: await get(`playerScores.w${doneWeek}`, "playerScores", { W: doneWeek }, "league", leagueTtl),
    scoresPrev: await get(`playerScores.w${doneWeek - 1}`, "playerScores", { W: doneWeek - 1 }, "league", leagueTtl),
    weekly: await get("weeklyResults.ytd", "weeklyResults", { W: "YTD" }, "league", leagueTtl),
    live: await get(`liveScoring.w${curWeek}`, "liveScoring", { W: curWeek, DETAILS: 1 }, "league", leagueTtl),
    brackets,
    bracket,
    tradeBait: await get("tradeBait", "tradeBait", { INCLUDE_DRAFT_PICKS: 1 }, "league", leagueTtl),
    standingsAlias: await get("standings(undocumented)", "standings", {}, "league", leagueTtl),
    calendar: await get(cookie ? "calendar" : "calendar(guest)", "calendar", {}, "league", leagueTtl),
    allRules: await get("allRules", "allRules", {}, "api", TTL.docs),
    players: await get("players", "players", { DETAILS: 1 }, "api", TTL.sleeperPlayers),
    injuries: await get("injuries", "injuries", {}, "api", projTtl),
    nflSchedule: await get("nflSchedule", "nflSchedule", { W: "ALL" }, "api", TTL.nflSchedule),
    byes: await get("nflByeWeeks", "nflByeWeeks", {}, "api", TTL.nflSchedule),
  };
  if (status) await p.saveRaw("mfl_status", status.rawJson, status.res);
  // Rostered ids missing from the global player DB are league-specific custom players (commissioner-
  // created, e.g. college prospects); only TYPE=players with L= returns them.
  const globalIds = new Set(arr(calls.players?.json, "players.player").map((x) => str(x, "id")));
  const customIds = [...new Set(arr(calls.rosters?.json, "rosters.franchise").flatMap((f) => arr(f, "player").map((pl) => str(pl, "id") ?? "")))].filter((id) => id && !globalIds.has(id)).sort();
  const custom = customIds.length ? await get("players.custom", "players", { PLAYERS: customIds.join(","), DETAILS: 1 }, "league", TTL.sleeperPlayers) : undefined;
  for (const pl of arr(custom?.json, "players.player")) p.redactor.register(str(pl, "name"), "free-text", (n) => `Custom player ${n}`);

  // ── Identities first (CLAUDE.md §0.6), then sanitized fixtures ───────────────────────────────────
  const franchiseIds = registerLeagueIdentities(p.redactor, calls.league.json);
  if (leagueApi?.json) registerLeagueIdentities(p.redactor, leagueApi.json);
  // With a login, unknown league-level fields may be personal: register and replace them by path.
  const leagueKeysRedacted = new Set<string>();
  const franchiseKeysRedacted = new Set<string>();
  const shapeLeague = (json: unknown): unknown => {
    let out = trimLeagueHistory(json, YEAR).json;
    const fr = redactFranchiseFields(out);
    fr.keys.forEach((k) => franchiseKeysRedacted.add(k));
    out = fr.json;
    if (c.hasCookie) {
      const lf = redactUnknownLeagueFields(p.redactor, out);
      lf.keys.forEach((k) => leagueKeysRedacted.add(k));
      out = lf.json;
    }
    return out;
  };
  const shapedLeague = shapeLeague(calls.league.json);
  const shapedLeagueApi = leagueApi?.json ? shapeLeague(leagueApi.json) : undefined;
  let freeText = 0;
  for (const [name, call] of Object.entries(calls)) {
    if (!call || PUBLIC_CALLS.has(name)) continue;
    const extra = name.startsWith("bracket") ? ["name"] : name === "calendar" && c.hasCookie ? ["name", "title", "subject"] : [];
    freeText += registerFreeText(p.redactor, call.json, extra);
  }
  const playerIds = new Set(arr(calls.players?.json, "players.player").map((x) => str(x, "id")));
  const collisions = p.redactor.entries().filter((e) => e.category === "league-id" && playerIds.has(e.raw));
  if (collisions.length) cl.issue(`a league ID equals ${collisions.length} MFL player ID(s); those player IDs are replaced in sanitized fixtures`);

  const rosterEntries = arr(calls.rosters?.json, "rosters.franchise").flatMap((f) => asArray(at(f, "player") as unknown[]).map((pl) => ({ franchise: str(f, "id") ?? "", id: str(pl, "id") ?? "", status: str(pl, "status") ?? "" })));
  const keepPlayers = new Set<string>([
    ...rosterEntries.map((r) => r.id),
    ...arr(calls.projNow?.json, "projectedScores.playerScore").map((x) => str(x, "id") ?? ""),
    ...arr(calls.scoresLast?.json, "playerScores.playerScore").map((x) => str(x, "id") ?? ""),
    ...arr(calls.scoresPrev?.json, "playerScores.playerScore").map((x) => str(x, "id") ?? ""),
  ]);
  const saved: string[] = [];
  const everything = { ...calls, leagueApi, status, custom };
  for (const [name, call] of Object.entries(everything)) {
    if (!call?.json) continue;
    let body = call.json;
    if (name === "players") {
      const kept = arr(call.json, "players.player").filter((x) => keepPlayers.has(str(x, "id") ?? ""));
      body = { players: { timestamp: str(call.json, "players.timestamp"), player: kept }, note: `trimmed to the ${kept.length} players referenced by the league fixtures` };
    } else if (name === "league") body = { ...(shapedLeague as object), note: `league.history trimmed to ${YEAR} (earlier seasons dropped: they help identify a league)` };
    else if (name === "leagueApi") body = { ...(shapedLeagueApi as object), note: `league.history trimmed to ${YEAR} (earlier seasons dropped: they help identify a league)` };
    const label = name === "status" ? `mfl/fflnetdynamic${YEAR}/mfl_status.json` : `${call.template.replace(/^https:\/\/[^/]+\//, "mfl/")}${name === "leagueApi" ? " (api host)" : ""}`;
    saved.push(await p.saveSanitized(label, body, call.res, PUBLIC_CALLS.has(name) ? { protect: () => true } : undefined));
  }
  // The leagueSearch sample is synthesized from the key names of the (git-ignored) capture only.
  const capture = await loadSearchCapture(YEAR);
  if (capture) {
    const url = `https://${MFL_API_HOST}/${YEAR}/export?TYPE=leagueSearch&SEARCH={term}&JSON=1`;
    saved.push(await p.saveSanitized(`mfl/${YEAR}/export?TYPE=leagueSearch&SEARCH={term} (synthesized sample)`, synthesizeSearchSample(capture.json, YEAR), { url, status: capture.status, contentType: capture.contentType }));
  }
  // Remove fixtures this run no longer writes (relabelled or dropped), but only after a complete run.
  const complete = !c.throttled && Object.values(everything).every((call) => call === undefined || call.json !== undefined);
  const prune = complete ? await pruneSanitized(path.join(SANITIZED_DIR, "mfl"), saved) : undefined;

  // ── Checks ───────────────────────────────────────────────────────────────────────────────────────
  const kick = kickoffs(calls.nflSchedule?.json);
  const ctx: Ctx = { p, c, calls, lg, L, host, curWeek, doneWeek, endWeek, lastWeek, roundWeeks, bracketId, txWeekChecked, rosterEntries, franchiseIds, status, leagueApi, docs, custom, customIds, kick, capture, chosen };
  docsChecks(ctx);
  const leagueType = checkA(ctx);
  checkB(ctx);
  const compiled = checkC(ctx);
  checkD(ctx);
  const players = checkE(ctx);
  checkF(ctx);
  checkG(ctx);
  checkH(ctx);
  checkI(ctx);
  const xw = await loadCrosswalk(ctx, players);
  await checkJ(ctx, players, compiled, xw);
  await checkK(ctx, compiled, players, xw);
  checkL(ctx);
  await checkM(ctx, compiled, players, leagueType);
  extras(ctx, freeText, { saved: saved.length, prune, complete, leagueKeysRedacted: [...leagueKeysRedacted], franchiseKeysRedacted: [...franchiseKeysRedacted] });
  decisionsAndQuestions(ctx, leagueType);

  const nTeams = num(at(lg, "franchises.count"));
  cl.meta.leagues = [
    {
      label: envLeague ? "Parker's MFL league" : "public MFL test league",
      access: cookie ? "private, MFL login cookie" : "public, no login",
      source,
      notes: envLeague ? undefined : `a public, in-season ${nTeams ?? "?"}-team ${leagueType} league found once via TYPE=leagueSearch; how it was picked (a random salt and the candidate log) stays in the git-ignored fixtures/raw/mfl/test-league.json`,
    },
  ];
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface Docs {
  general: string;
  reference: string;
  urls: { general: string; reference: string };
}

interface Ctx {
  p: ProbeContext;
  c: MflClient;
  calls: Record<string, MflCall | undefined> & { league: MflCall };
  lg: unknown;
  L: string;
  host: string;
  curWeek: number;
  doneWeek: number;
  endWeek: number;
  /** Last fantasy playoff week: the championship bracket's final round (endWeek as a fallback). */
  lastWeek: number;
  roundWeeks: number[];
  bracketId: string | undefined;
  /** Week whose TYPE=transactions&W= list is compared with the timestamp-derived weeks. */
  txWeekChecked: number;
  rosterEntries: Array<{ franchise: string; id: string; status: string }>;
  franchiseIds: string[];
  status: MflCall | undefined;
  leagueApi: MflCall | undefined;
  docs: Docs;
  /** TYPE=players L=… PLAYERS=… for rostered ids that aren't in the global player DB. */
  custom: MflCall | undefined;
  customIds: string[];
  kick: Kickoffs;
  capture: Awaited<ReturnType<typeof loadSearchCapture>>;
  chosen: ChosenLeague;
}

interface PlayerRow {
  id: string;
  name: string;
  position: string;
  team: string;
  raw: Record<string, unknown>;
  /** League-specific custom player (not in MFL's global DB; name is commissioner text). */
  custom?: boolean;
}

interface XwalkData {
  xw: Crosswalk;
  dpRows: Array<Record<string, string>>;
  dpStatus: number;
}

async function safe<T>(x: Promise<T>): Promise<T | undefined> {
  try {
    return await x;
  } catch (err) {
    if (err instanceof MflThrottledError) return undefined;
    throw err;
  }
}

function ev(call: MflCall | undefined, path: string, sample: unknown, note?: string) {
  return { url: call?.template, status: call?.res.status, path, sample, note };
}

function kickoffs(nflSchedule: unknown): Kickoffs {
  const out: Kickoffs = new Map();
  for (const w of arr(nflSchedule, "fullNflSchedule.nflSchedule")) {
    const week = num(at(w, "week"));
    if (week === undefined) continue;
    out.set(week, arr(w, "matchup").map((m) => num(at(m, "kickoff")) ?? 0).filter((k) => k > 0));
  }
  return out;
}

async function readDocs(c: MflClient): Promise<Docs> {
  const g = await c.page(MFL_DOCS.general);
  const r = await c.page(MFL_DOCS.reference);
  return { general: htmlToText(g.text), reference: htmlToText(r.text), urls: { general: MFL_DOCS.general, reference: MFL_DOCS.reference } };
}

function docsChecks(x: Ctx): void {
  const { cl } = x.p;
  const all = `${x.docs.general}\n${x.docs.reference}`;
  const phrase = (key: string, title: string, phrases: string[], summary: string) => {
    const missing = phrases.filter((ph) => !docHas(all, ph));
    const ok = missing.length === 0;
    cl.add("DOCS", key, title, ok ? "ok" : "warn", ok ? summary : `${summary} — phrase(s) not found on the page now: ${missing.join(" | ")}`, { url: key === "DOCS.types" || key === "DOCS.search" ? x.docs.urls.reference : x.docs.urls.general, sample: phrases[0] });
  };
  phrase("DOCS.format", "Export URL format", ["protocol://host/year/command?args", "the JSON argument should be set to 0 or 1"], "https://{host}/{year}/export?TYPE={type}&L={leagueId}&JSON=1; XML is the default");
  phrase("DOCS.hosts", "Hosts and redirects", ["if you send a request to the wrong host, the system will normally redirect", "if the request does not take a league parameter (L=), it must be sent to the host api"], "league requests belong on the league's wwwNN host (api.* normally redirects there, 'may be delayed … or denied' under load); non-league requests must use api.myfantasyleague.com");
  phrase("DOCS.rate", "Rate limits", ["Wait one second between making requests", "If a request fails, don't retry", 'Throttled requests will return a 429 "Too Many Requests"'], "unpublished per-IP limits; wait ≥ 1 s between requests; don't retry failures; 429 = throttled");
  phrase("DOCS.client", "API client registration", ["Registered clients will have higher limits, about 2.5X", "Pass the User-Agent you chose in the Client Registration on all API requests"], "registering (MFL account + SMS validation) gives ~2.5× the limits; then send the registered User-Agent");
  phrase("DOCS.auth", "Login and private leagues", ["Data from leagues that are marked as PRIVATE are no longer accessible by users not in the league", "Cookie: MFL_USER_ID=cookie_value", "APIKEY"], "private leagues need the owner's MFL_USER_ID cookie (POST /login) or the owner's APIKEY query parameter (export only)");
  phrase("DOCS.cookie", "Login cookie encoding", ["the cookie value is a Base64 string", "you may need to explicitly URL-escape these symbols"], "the MFL_USER_ID value is Base64 and may hold '+', '/', '='; the client URL-escapes exactly those three before sending it back");
  phrase("DOCS.rawStats", "Raw NFL stats", ["We can not and will not under any circumstance make raw NFL player stats available"], "MFL never exposes raw stats (licensing) — the scoring oracle must use Sleeper or nflverse stats");
  phrase("DOCS.terms", "Terms of use", ["Harvesting league and/or user data", "Accessing the API via Javascript from web pages outside the myfantasyleague.com domain"], "forbidden: harvesting league/user data, overloading the service, browser JavaScript calls from other domains (so all MFL calls must be server-side)");
  phrase("DOCS.search", "leagueSearch parameters", ["Must be at least 3 characters long", "4 or 5-digit number to return the league with this id"], "SEARCH (≥ 3 chars, name match) or ID (4–5 digits), not both; YEAR optional");
  const types = ["league", "rules", "rosters", "players", "injuries", "allRules", "nflSchedule", "nflByeWeeks", "liveScoring", "leagueSearch", "leagueStandings", "schedule", "weeklyResults", "playerScores", "projectedScores", "transactions", "freeAgents", "futureDraftPicks", "draftResults", "playoffBrackets", "tradeBait", "calendar", "pendingTrades", "assets", "myleagues", "standings"];
  const access = Object.fromEntries(types.map((t) => [t, typeAccess(x.docs.reference, t)]));
  const n = (a: string) => Object.values(access).filter((v) => v === a).length;
  cl.ok("DOCS", "DOCS.types", "Access note per TYPE (docs)", `${n("no access note")} with no access note (not the same as public: the general page says private leagues are closed to non-members), ${n("private leagues: owners only")} "Private league access restricted to league owners", ${n("owners only")} "Access restricted to league owners"; "standings" is ${access.standings}`, { url: x.docs.urls.reference, sample: access });
}

/** A.* League basics. Returns the league type the signals point to (for the FantasyCalc format). */
function checkA(x: Ctx): LeagueType {
  const { cl } = x.p;
  const { calls, lg } = x;
  const st = at(x.status?.json, "mfl_status.weeks");
  const history = arr(lg, "history.league");
  const earlier = history.some((h) => (num(at(h, "year")) ?? YEAR) < YEAR);
  cl.ok("A", "A.season", "Season", `${YEAR} (URL year); mfl_status.year=${str(x.status?.json, "mfl_status.year")}; league.history ${earlier ? "has earlier seasons too (years not reported: they help identify a league)" : "lists only this season"}`, ev(x.status, "mfl_status.year", str(x.status?.json, "mfl_status.year")), ev(calls.league, "league.history.league[].year", earlier ? "(earlier seasons present; withheld)" : [String(YEAR)]));
  const weeks = isRecord(st) ? Object.fromEntries(Object.entries(st).map(([k, v]) => [k, text(v)])) : {};
  const byKickoff = weekOf(Math.floor(Date.now() / 1000), x.kick);
  const agrees = byKickoff === x.curWeek;
  cl.add("A", "A.currentWeek", "Current week", isRecord(st) && agrees ? "ok" : "warn", `CurrentWeek=${x.curWeek}, CompletedWeek=${x.doneWeek}; the NFL week from this run's TYPE=nflSchedule kickoff times is ${byKickoff ?? "?"} (${agrees ? "agrees" : "DISAGREES"}); rosters[].week=${str(arr(calls.rosters?.json, "rosters.franchise")[0], "week")}`, { url: `https://api.myfantasyleague.com/fflnetdynamic${YEAR}/mfl_status.json`, status: x.status?.res.status, path: "mfl_status.weeks", sample: weeks }, ev(calls.nflSchedule, "fullNflSchedule.nflSchedule[].matchup[].kickoff (first week whose last game hasn't ended)", byKickoff));
  const n = num(at(lg, "franchises.count"));
  cl.add("A", "A.numTeams", "Number of teams", n ? "ok" : "fail", `${n} franchises`, ev(calls.league, "league.franchises.count", n));
  const start = num(at(lg, "startWeek"));
  const lastReg = num(at(lg, "lastRegularSeasonWeek"));
  const schedWeeks = arr(calls.schedule?.json, "schedule.weeklySchedule")
    .filter((w) => arr(w, "matchup").length > 0)
    .map((w) => num(at(w, "week")));
  cl.add("A", "A.regularSeason", "Regular-season weeks", start && lastReg ? "ok" : "fail", `weeks ${start}–${lastReg}; the fantasy schedule has matchups in weeks ${schedWeeks[0]}–${schedWeeks[schedWeeks.length - 1]} (${schedWeeks.length} weeks)`, ev(calls.league, "league.startWeek / league.lastRegularSeasonWeek", { startWeek: start, lastRegularSeasonWeek: lastReg }), ev(calls.schedule, "schedule.weeklySchedule[].matchup", `${schedWeeks.length} weeks with matchups`));
  const br = arr(calls.brackets?.json, "playoffBrackets.playoffBracket").map((b) => ({ id: str(b, "id"), startWeek: num(at(b, "startWeek")), teams: num(at(b, "teamsInvolved")), firstWeekGames: num(at(b, "startWeekGames")) }));
  const main = br[0];
  const games = arr(calls.bracket?.json, "playoffBracket.playoffRound").map((r) => ({ week: str(r, "week"), games: arr(r, "playoffGame").length }));
  const endLater = x.roundWeeks.length > 0 && x.lastWeek < x.endWeek;
  cl.add("A", "A.playoffStart", "Playoff start week and playoff weeks", main?.startWeek ? "ok" : "warn", `bracket starts week ${main?.startWeek} (lastRegularSeasonWeek+1 = ${(lastReg ?? 0) + 1}); bracket ${x.bracketId} rounds are played in weeks ${x.roundWeeks.join(", ") || "?"}, so the last fantasy week is ${x.lastWeek}; league.endWeek=${x.endWeek}${endLater ? " (later than the final — endWeek alone isn't the fantasy final)" : ""}`, ev(calls.brackets, "playoffBrackets.playoffBracket[].startWeek", br.map((b) => b.startWeek)), ev(calls.bracket, "playoffBracket.playoffRound[].week", x.roundWeeks), ev(calls.league, "league.endWeek", x.endWeek));
  if (endLater) cl.issue(`MFL league.endWeek (${x.endWeek}) is not the last fantasy week: championship bracket ${x.bracketId}'s rounds are weeks ${x.roundWeeks.join("/")} — evidence A.playoffStart (GET https://{leagueHost}/${YEAR}/export?TYPE=playoffBracket&L={leagueId}&BRACKET_ID=${x.bracketId}&JSON=1 → HTTP ${calls.bracket?.res.status}, playoffBracket.playoffRound[].week) — options: derive LeagueSettings.playoffWeeks from TYPE=playoffBracket rounds (recommended); fall back to lastRegularSeasonWeek+1 … endWeek only when no bracket exists.`);
  const byes = main?.teams !== undefined && main.firstWeekGames !== undefined ? main.teams - 2 * main.firstWeekGames : undefined;
  cl.warn("A", "A.playoffTeams", "Playoff teams and byes", `${br.length} bracket(s); bracket ${main?.id}: ${main?.teams} teams, ${main?.firstWeekGames} games in its first week → ${byes} bye(s)${games.length ? `; rounds by week ${JSON.stringify(games)}` : ""}. Which bracket is the championship is inferred (lowest id; names are commissioner text)`, ev(calls.brackets, "playoffBrackets.playoffBracket[] {id,startWeek,teamsInvolved,startWeekGames}", br), ev(calls.bracket, "playoffBracket.playoffRound[].week / playoffGame[]", games.length ? games : "(no rounds listed)"));

  // Trade deadline and review: what a guest sees, what the docs say an owner could see, and the fallback.
  const cal = calls.calendar;
  const calAccess = typeAccess(x.docs.reference, "calendar");
  const calendarHasTrade = docHas(x.docs.reference, '"TRADE" (for trade deadline)');
  const tradeKeys = Object.keys(isRecord(lg) ? lg : {}).filter((k) => /trade/i.test(k));
  const tradeEvent = cal && !cal.error ? findTradeEvent(cal.json) : undefined;
  if (tradeEvent) cl.ok("A", "A.tradeDeadline", "Trade deadline", `TYPE=calendar (owner login) has a TRADE event: ${JSON.stringify(tradeEvent)}`, ev(cal, "calendar … TRADE event", tradeEvent));
  else
    cl.warn(
      "A",
      "A.tradeDeadline",
      "Trade deadline",
      `TYPE=league has no deadline field (trade-related keys: ${JSON.stringify(tradeKeys)}); TYPE=calendar (${calAccess} per api_info) ${cal?.error ? `returned "${cal.error}"` : cal ? "answered but holds no TRADE event" : "was not requested"} ${x.c.hasCookie ? "with the login cookie" : "as a guest"}; owner login: ${calendarHasTrade ? 'the calendarEvent import docs list EVENT_TYPE "TRADE" (for trade deadline), so TYPE=calendar should carry the deadline' : "the docs no longer mention a TRADE calendar event"}${x.c.hasCookie ? "" : " — untested (no MFL login in .env.local)"}. Fallback: the Import Report asks the user`,
      ev(calls.league, "league.* keys matching /trade/i", tradeKeys),
      ev(cal, "error (HTTP 200 error body)", cal?.error ?? (cal?.json ? Object.keys(cal.json as object) : cal?.res.status)),
      { url: x.docs.urls.reference, path: "calendarEvent → EVENT_TYPE", sample: calendarHasTrade ? '"TRADE" (for trade deadline)' : "(phrase not found)" },
    );
  const trades = arr(calls.transactions?.json, "transactions.transaction").filter((t) => str(t, "type") === "TRADE");
  const byCommish = countBy(trades, (t) => str(t, "by_commish") ?? "(absent)");
  const pendingCommish = docHas(x.docs.reference, "Pass in '0000' to get trades pending commissioner action");
  cl.warn(
    "A",
    "A.tradeReview",
    "Trade review / veto",
    `no trade-approval or veto setting in TYPE=league (guest) and none documented for any TYPE; ${pendingCommish ? `api_info shows commissioner review exists only indirectly (pendingTrades, ${typeAccess(x.docs.reference, "pendingTrades")}: "Pass in '0000' to get trades pending commissioner action")` : "the docs no longer mention trades pending commissioner action"}. This season's trades carry by_commish ${JSON.stringify(byCommish)} — meaning unverified (commissioner-entered or commissioner-approved); a candidate review signal to test with an owner login. Fallback: the Import Report asks the user`,
    ev(calls.league, "league.* (no review/veto field)", tradeKeys),
    ev(calls.transactions, "transactions.transaction[type=TRADE].by_commish", byCommish),
    { url: x.docs.urls.reference, path: "pendingTrades → FRANCHISE_ID", sample: pendingCommish ? "Pass in '0000' to get trades pending commissioner action" : "(phrase not found)" },
  );
  cl.issue(`Trade deadline and trade review/veto aren't readable as a guest (A.tradeDeadline, A.tradeReview): TYPE=league has only ${JSON.stringify(tradeKeys)}; TYPE=calendar is "${calAccess}" in api_info and answers a guest with HTTP ${cal?.res.status} + error "${cal?.error ?? "?"}"${calendarHasTrade ? '; the calendarEvent import docs name EVENT_TYPE "TRADE" (for trade deadline)' : ""}. Options: (a) ask the user on the Import Report (works for every MFL league); (b) with an owner login, read the deadline from TYPE=calendar and test whether by_commish or pendingTrades FRANCHISE_ID=0000 reveal commissioner review — untested.`);

  const fp = arr(calls.futurePicks?.json, "futureDraftPicks.franchise").flatMap((f) => arr(f, "futureDraftPick"));
  const keeperFields = Object.keys(isRecord(lg) ? lg : {}).filter((k) => /keep/i.test(k));
  const signals = {
    futureDraftPicks: fp.length,
    taxiSquad: str(lg, "taxiSquad"),
    draftPlayerPool: str(lg, "draftPlayerPool"),
    loadRosters: str(lg, "loadRosters"),
    usesContractYear: str(lg, "usesContractYear"),
    usesSalaries: str(lg, "usesSalaries"),
    earlierSeasons: earlier,
    keeperFields,
  };
  const dynasty = fp.length > 0 || (num(at(lg, "taxiSquad")) ?? 0) > 0;
  const leagueType: LeagueType = dynasty ? "dynasty" : keeperFields.length ? "keeper" : "redraft";
  cl.warn("A", "A.leagueType", "League type", `no explicit redraft/keeper/dynasty field; the signals point to ${leagueType} (future picks: ${fp.length}${fp.length ? ` for ${[...new Set(fp.map((f) => str(f, "year")))].sort().join("/")}` : ""}, taxi slots: ${str(lg, "taxiSquad") ?? 0}, keeper fields: ${keeperFields.length}) — inferred (rule: future picks or a taxi squad → dynasty; keeper fields → keeper; else redraft), the user should confirm`, ev(calls.league, "league.{taxiSquad,draftPlayerPool,loadRosters,usesContractYear,usesSalaries,history}", signals), ev(calls.futurePicks, "futureDraftPicks.franchise[].futureDraftPick[]", `${fp.length} picks`));
  cl.add("A", "A.pointsOnly", "Head-to-head vs points-only", str(lg, "h2h") ? "ok" : "warn", `h2h=${str(lg, "h2h")}${str(lg, "h2h") === "YES" ? " → head-to-head" : ""}; the schedule lists matchups in ${schedWeeks.length} weeks`, ev(calls.league, "league.h2h", str(lg, "h2h")));
  const cols = arr(calls.standings?.json, "leagueStandings.column_names.column").map((c) => str(c, "id"));
  cl.warn("A", "A.medianGame", "Median game", `no median/all-play setting in TYPE=league; standings columns ${JSON.stringify(cols)} have no median record — assume off, unverified (no league with a median game was checked)`, ev(calls.standings, "leagueStandings.column_names.column[].id", cols));
  const divs = arr(lg, "divisions.division");
  const fr = arr(lg, "franchises.franchise");
  cl.add("A", "A.divisions", "Divisions", "ok", divs.length ? `${divs.length} divisions; every franchise has a division id (${fr.filter((f) => str(f, "division")).length}/${fr.length}); names sanitized` : "none (league.divisions absent)", ev(calls.league, "league.divisions.division[].id / league.franchises.franchise[].division", countBy(fr, (f) => str(f, "division"))));
  cl.ok("A", "A.tiebreakers", "Standings tiebreakers", `standingsSort=${str(lg, "standingsSort")} (usable for playoff seeding); game tiebreaker setting "${str(lg, "tiebreaker") ?? "(absent)"}" (meaning unverified)`, ev(calls.league, "league.standingsSort / league.tiebreaker", { standingsSort: str(lg, "standingsSort"), tiebreaker: str(lg, "tiebreaker") }));
  const waiver = str(lg, "currentWaiverType");
  cl.ok("A", "A.faab", "Waivers / FAAB", `currentWaiverType=${waiver}${str(lg, "bbidSeasonLimit") ? `, FAAB budget ${str(lg, "bbidSeasonLimit")}` : " (no blind-bid budget → no FAAB)"}`, ev(calls.league, "league.currentWaiverType / league.bbidSeasonLimit", { currentWaiverType: waiver, bbidSeasonLimit: str(lg, "bbidSeasonLimit") ?? null }));
  return leagueType;
}

/** A record anywhere in a calendar body that names a TRADE event (shape unverified: owners only). */
function findTradeEvent(json: unknown): unknown {
  let hit: unknown;
  const visit = (v: unknown) => {
    if (hit !== undefined) return;
    if (Array.isArray(v)) v.forEach(visit);
    else if (isRecord(v)) {
      if (Object.values(v).some((x) => text(x) === "TRADE")) hit = Object.fromEntries(Object.entries(v).filter(([, x]) => typeof text(x) === "string" && /^\d+$|^[A-Z_]+$/.test(text(x) as string)));
      else Object.values(v).forEach(visit);
    }
  };
  visit(json);
  return hit;
}

function checkB(x: Ctx): void {
  const { cl } = x.p;
  const { calls, lg } = x;
  const starters = at(lg, "starters");
  const conv = convertStarters(starters);
  const raw = { count: str(starters, "count"), idp_starters: str(starters, "idp_starters"), position: arr(starters, "position").map((e) => `${str(e, "name")} ${str(e, "limit")}`) };
  cl.add("B", "B.starters", "Starting slots", conv.unsupported.length ? "warn" : "ok", `${raw.count} starters from per-position ranges: ${raw.position.join(", ")}${raw.idp_starters ? ` (idp_starters=${raw.idp_starters})` : ""}`, ev(calls.league, "league.starters.{count,idp_starters,position[].{name,limit}}", raw));
  if (!conv.exact)
    cl.issue(`MFL lineups are a starter total plus a min–max range per position, not slots. This league (${raw.position.join(", ")}; ${raw.count} starters${raw.idp_starters ? `, ${raw.idp_starters} of them IDP` : ""}) can't be expressed exactly as SlotDef[] — ${conv.notes.filter((n) => !n.startsWith("starters.idp")).join("; ")} (evidence B.flex). Options: (a) add optional per-position starter caps (min/max) to LeagueSettings and solve lineups with a flow network that honours them; (b) approximate with SlotDefs and warn on the Import Report.`);
  cl.add("B", "B.flex", "Flex / SUPER_FLEX / IDP flex", conv.exact ? "ok" : "warn", `converted: ${conv.lineup.map((s) => `${s.slot}×${s.count}`).join(", ")}${conv.exact ? " (exact)" : ` — NOT exact: ${conv.notes.filter((n) => !n.startsWith("starters.idp")).join("; ")}`}`, { path: "derived from league.starters", sample: { lineup: conv.lineup, starterCaps: conv.starterCaps, pools: conv.pools } }, { note: conv.notes.find((n) => n.startsWith("starters.idp")) });
  const rosterSize = num(at(lg, "rosterSize"));
  const ir = num(at(lg, "injuredReserve"));
  const taxi = num(at(lg, "taxiSquad"));
  const count = num(at(starters, "count")) ?? 0;
  const perTeam = new Map<string, { active: number; ir: number; taxi: number }>();
  for (const r of x.rosterEntries) {
    const t = perTeam.get(r.franchise) ?? { active: 0, ir: 0, taxi: 0 };
    if (r.status === "INJURED_RESERVE") t.ir++;
    else if (r.status === "TAXI_SQUAD") t.taxi++;
    else t.active++;
    perTeam.set(r.franchise, t);
  }
  const maxActive = Math.max(0, ...[...perTeam.values()].map((t) => t.active));
  const maxTotal = Math.max(0, ...[...perTeam.values()].map((t) => t.active + t.ir + t.taxi));
  const confirmed = rosterSize !== undefined && maxTotal > rosterSize && maxActive <= rosterSize;
  cl.add("B", "B.roster", "Max roster size and bench", confirmed ? "ok" : "warn", `rosterSize=${rosterSize} → bench ${rosterSize !== undefined ? rosterSize - count : "?"} after ${count} starters; largest active roster ${maxActive}, largest incl. IR/taxi ${maxTotal} — ${confirmed ? "confirms rosterSize excludes IR/taxi" : "can't yet confirm rosterSize excludes IR/taxi (no team is over it when they're counted)"}`, ev(calls.league, "league.rosterSize", rosterSize), ev(calls.rosters, "rosters.franchise[].player[].status (per team)", { maxActive, maxTotal }));
  cl.add("B", "B.ir", "IR slots", ir !== undefined ? "ok" : "fail", `${ir} IR slots; ${x.rosterEntries.filter((r) => r.status === "INJURED_RESERVE").length} players on IR now`, ev(calls.league, "league.injuredReserve", ir));
  cl.add("B", "B.taxi", "Taxi slots", taxi !== undefined ? "ok" : "fail", `${taxi} taxi slots; ${x.rosterEntries.filter((r) => r.status === "TAXI_SQUAD").length} players on taxi now`, ev(calls.league, "league.taxiSquad", taxi));
  const limits = convertRosterLimits(at(lg, "rosterLimits"));
  const hasLimits = Object.keys(limits.max).length > 0;
  const minsAboveZero = Object.entries(limits.min).filter(([, v]) => (v ?? 0) > 0);
  cl.add("B", "B.positionLimits", "Position limits", hasLimits ? "ok" : "na", hasLimits ? `max per position ${JSON.stringify(limits.max)}; MFL also sets minimums ${JSON.stringify(limits.min)} (the model has no field for minimums)` : "league.rosterLimits absent (no position limits)", ev(calls.league, "league.rosterLimits.position[].{name,limit}", arr(lg, "rosterLimits.position").map((e) => `${str(e, "name")} ${str(e, "limit")}`)));
  if (minsAboveZero.length)
    cl.issue(`MFL roster limits carry minimums as well as maximums (${minsAboveZero.map(([k, v]) => `${k} ≥ ${v}`).join(", ")}) but CLAUDE.md §4 positionLimits holds maximums only — evidence B.positionLimits (GET https://{leagueHost}/${YEAR}/export?TYPE=league&L={leagueId}&JSON=1 → HTTP ${calls.league.res.status}, league.rosterLimits.position[].limit) — options: (a) add optional positionMinimums and make auto-drops respect them; (b) ignore minimums (a trade could leave a roster illegal on MFL) and warn on the trade card.`);
  const startersNames = arr(starters, "position").map((e) => str(e, "name") ?? "?");
  const slotCount = (pred: (e: string) => boolean) => conv.lineup.filter((s) => s.eligible.some(pred)).reduce((a, s) => a + s.count, 0);
  cl.add("B", "B.kDefIdp", "K, DEF and IDP slots", "ok", `K: ${slotCount((e) => e === "K")}, DEF: ${slotCount((e) => e === "DEF")}, IDP: ${slotCount((e) => ["DL", "LB", "DB"].includes(e))} starter spot(s)${conv.unsupported.length ? `; unsupported: ${conv.unsupported.join(", ")}` : ""}`, { path: "league.starters.position[].name", sample: startersNames, note: `MFL → model positions: ${Object.entries(MFL_POS).map(([k, v]) => `${k}→${v}`).join(", ")}` });
}

function checkC(x: Ctx): Map<string, Compiled> {
  const { cl } = x.p;
  const { calls } = x;
  const { rules, problems } = parseRules(calls.rules?.json);
  const groups = arr(calls.rules?.json, "rules.positionRules");
  const singleRuleGroups = groups.filter((g) => isRecord(at(g, "rule"))).length;
  cl.add("C", "C.rules", "Scoring rules", rules.length ? "ok" : "fail", `${rules.length} rules in ${groups.length} position groups (${groups.map((g) => str(g, "positions")).join("; ")})${singleRuleGroups ? `; ${singleRuleGroups} group(s) hold a single rule as an object, not an array (MFL JSON quirk)` : ""}${problems.length ? `; parse problems: ${problems.join("; ")}` : ""}`, ev(calls.rules, "rules.positionRules[].{positions, rule[].{event.$t, range.$t, points.$t}}", rules.slice(0, 3).map((r) => `${r.positions.join("|")}: ${r.event} ${r.rangeRaw} ${r.pointsRaw}`)));
  const kinds = countBy(rules, (r) => r.points.kind);
  const formula = rules.filter((r) => r.points.kind === "formula").map((r) => `${r.positions.join("|")}: ${r.event} ${r.rangeRaw} "${r.pointsRaw}" thresholdPoints=${r.extra.thresholdPoints}`);
  cl.add("C", "C.pointsFormats", "Points formats", kinds.unknown ? "warn" : "ok", `"*N" per unit: ${kinds.each ?? 0}; "a/b" stepped every-b: ${kinds.every ?? 0}; flat "N": ${kinds.flat ?? 0}; formula (thresholdPoints): ${kinds.formula ?? 0}; unparsed: ${kinds.unknown ?? 0}`, ev(calls.rules, "rules.positionRules[].rule[].points.$t (+ thresholdPoints.$t)", formula.length ? formula : kinds));

  const mflPositions = [...new Set(rules.flatMap((r) => r.positions))].sort();
  const compiled = new Map<string, Compiled>();
  for (const pos of mflPositions) compiled.set(pos, compileFor(rules, pos));
  const rate = (pos: string, key: string) => compiled.get(pos)?.rates[key];
  const table = (keys: string[], positions = OFFENSE) => Object.fromEntries(keys.map((k) => [k, Object.fromEntries(positions.filter((p) => compiled.has(p)).map((p) => [p, rate(p, k) ?? 0]))]));
  const offense = OFFENSE.filter((p) => compiled.has(p));
  const rec = table(["rec"]);
  const recVals = offense.map((p) => rate(p, "rec") ?? 0);
  const tePremium = compiled.has("TE") && (rate("TE", "rec") ?? 0) > Math.max(...offense.filter((p) => p !== "TE").map((p) => rate(p, "rec") ?? 0));
  // Positions covered by more than one rule group: where MFL's "overlapping groups add up" matters.
  const groupsPerPos = countBy(
    groups.flatMap((g) => [...new Set((str(g, "positions") ?? "").split("|").filter(Boolean))]),
    (pos) => pos,
  );
  const overlapping = Object.entries(groupsPerPos).filter(([, n]) => n > 1).map(([pos]) => pos);
  cl.add("C", "C.receptions", "Receptions (incl. position-specific)", offense.length ? "ok" : "na", `points per reception by position ${JSON.stringify(rec.rec)}${tePremium ? " → TE premium" : ""}; the compiler adds rules from overlapping position groups (MFL Scoring Rules Setup help) — ${overlapping.length ? `exercised here for ${overlapping.join(", ")}` : "untested here: every position is in exactly one rule group in this league"}`, ev(calls.rules, "CC rules per position group", recVals));
  if (!overlapping.length)
    cl.issue(`The rule compiler adds up rules from overlapping MFL position groups (e.g. "QB|RB|WR|TE" plus "TE"), as MFL's scoring help describes, but this league has no overlapping groups (C.receptions), so the 100% oracle does not validate that path — options: re-run the oracle on an MFL league with overlapping groups in Phase 5 before relying on it.`);
  cl.add("C", "C.passing", "Passing", offense.length ? "ok" : "na", `QB: ${JSON.stringify(table(["pass_yd", "pass_td", "pass_int", "pass_2pt", "pass_td_40p", "pass_td_50p"], ["QB"]))}`, { path: "compiled from PY, PS/#P, IN, P2", sample: compiled.get("QB")?.mapped.filter((m) => ["PY", "PS", "#P", "IN", "P2"].includes(m.event)).map((m) => `${m.event} ${m.range} ${m.points} ${m.note}`) });
  cl.add("C", "C.rushRec", "Rushing and receiving", offense.length ? "ok" : "na", JSON.stringify(table(["rush_yd", "rush_td", "rec_yd", "rec_td", "rush_2pt", "rec_2pt"])), { path: "compiled from RY, RS/#R, CY, RC/#C, R2, C2" });
  cl.add("C", "C.turnovers", "Interceptions and fumbles", offense.length ? "ok" : "na", JSON.stringify(table(["pass_int", "fum_lost", "fum"])), { path: "compiled from IN, FL/FLO, FU" });
  const fd = offense.some((p) => ["pass_fd", "rush_fd", "rec_fd"].some((k) => rate(p, k)));
  cl.add("C", "C.firstDowns", "First downs", "ok", fd ? JSON.stringify(table(["pass_fd", "rush_fd", "rec_fd"])) : "not scored in this league (MFL codes FD, 1P, 1R, 1C map to pass_fd/rush_fd/rec_fd)", { path: "FD / 1P / 1R / 1C rules" });
  const bonuses = [...compiled.values()].flatMap((cmp) => cmp.bonuses.map((b) => `${cmp.mflPos}: ${b.stat} ≥ ${b.threshold} → ${b.points}`));
  cl.add("C", "C.bonuses", "Bonuses", "ok", bonuses.length ? `${bonuses.length} threshold bonuses` : "no yardage/threshold bonuses in this league (flat-range rules would become stat ≥ threshold bonuses)", { path: "flat-points rules on per-game totals", sample: bonuses });
  const k = compiled.get("PK");
  cl.add("C", "C.kickers", "Kickers", k ? "ok" : "na", k ? `PK rates ${JSON.stringify(k.rates)}` : "no PK rules", { path: "FG / MG / EP / EM / #F / #M rules (PK group)", sample: k ? [...k.mapped, ...k.approx].map((m) => `${m.event} ${m.range} ${m.points} ${m.note}`) : undefined });
  const def = compiled.get("Def");
  cl.add("C", "C.defense", "Team defense (DEF)", def ? "ok" : "na", def ? `Def rates ${JSON.stringify(def.rates)}` : "no team-defense rules or starter in this league (TPA/TYA map to Sleeper pts_allow_*/yds_allow_* buckets)", { path: "Def group" });
  const idpPos = ["DT", "DE", "LB", "CB", "S"].filter((p) => compiled.has(p));
  const idpTable = Object.fromEntries(idpPos.map((p) => [p, compiled.get(p)?.rates]));
  const dtDe = JSON.stringify(compiled.get("DT")?.rates) === JSON.stringify(compiled.get("DE")?.rates);
  const cbS = JSON.stringify(compiled.get("CB")?.rates) === JSON.stringify(compiled.get("S")?.rates);
  cl.add("C", "C.idp", "IDP", idpPos.length ? (dtDe && cbS ? "ok" : "warn") : "na", idpPos.length ? `rates per MFL position ${JSON.stringify(idpTable)}; DT=DE ${dtDe}, CB=S ${cbS} (the model's DL/DB can't hold different rates)` : "no IDP rules", { path: "IDP groups", sample: idpTable });
  const all = [...compiled.values()];
  const mapped = all.reduce((s, cmp) => s + cmp.mapped.length, 0);
  const approx = all.flatMap((cmp) => cmp.approx.map((a) => `${cmp.mflPos}: ${a.event} ${a.range} ${a.points} ${a.note}`));
  const unmapped = all.flatMap((cmp) => cmp.unmapped.map((u) => `${cmp.mflPos}: ${u.event} ${u.range} ${u.points} — ${u.note}`));
  const total = mapped + approx.length + unmapped.length;
  cl.add("C", "C.mapping", "Rules → Sleeper stat keys", unmapped.length ? "warn" : approx.length ? "warn" : "ok", `per position × rule: ${mapped} exact, ${approx.length} approximate, ${unmapped.length} unmapped of ${total}`, { path: "compiled", sample: { approximate: approx, unmapped } });
  const allCodes = arr(calls.allRules?.json, "allRules.rule").map((r) => str(r, "abbreviation") ?? "");
  const known = allCodes.filter((code) => MFL_EVENTS[code]);
  const unknown = arr(calls.allRules?.json, "allRules.rule")
    .filter((r) => !MFL_EVENTS[str(r, "abbreviation") ?? ""])
    .map((r) => `${str(r, "abbreviation")} (${str(r, "shortDescription")})`);
  cl.warn("C", "C.allRules", "All MFL rule codes vs the map", `${known.length} of ${allCodes.length} MFL rule codes have a Sleeper key in lib/mfl/scoringMap.ts; the other ${unknown.length} would be reported as unmapped (list in the evidence)`, ev(calls.allRules, "allRules.rule[].abbreviation", unknown));
  const tiered = all.flatMap((cmp) => cmp.unmapped).filter((u) => /tiered or formula/.test(u.note)).length;
  const stepped = all.flatMap((cmp) => cmp.approx).filter((a) => /stepped/.test(a.note)).length;
  const formulaOk = all.flatMap((cmp) => cmp.mapped).filter((m) => /formula:/.test(m.points)).length;
  cl.issue(`MFL range rules don't all fit the Scoring model: per-unit rates that apply only inside a range (tiered), stepped "a/b" awards (floor — "1 pt every 10 yds" gives 12 for 128 yds) and formula rules (thresholdPoints). This league: ${tiered} tiered/formula rule-position pair(s) unmapped, ${stepped} stepped pair(s) approximated as linear, ${formulaOk} formula pair(s) that still compile exactly (evidence C.mapping). Options: (a) extend Scoring with generic range rules {stat, min, max, kind: each|every|flat|formula, points, per} evaluated as expected values like bonuses; (b) approximate and list them in scoring.unmapped.`);
  const listed = rules.map((r) => `${r.positions.join("|")}: ${r.event} ${r.rangeRaw} ${r.pointsRaw}${r.extra.thresholdPoints ? ` [thresholdPoints ${r.extra.thresholdPoints}]` : ""}`);
  cl.ok("C", "C.list", "Every rule (positions: code range points)", `${listed.length} rules; full list in the evidence (JSON output)`, ev(calls.rules, "rules.positionRules[].rule[]", listed));
  return compiled;
}

function checkD(x: Ctx): void {
  const { cl } = x.p;
  const { calls, lg } = x;
  const fr = arr(lg, "franchises.franchise");
  const keys = keySet(fr);
  cl.add("D", "D.ids", "Team IDs", fr.length ? "ok" : "fail", `${fr.length} franchises with ids ${fr.map((f) => str(f, "id")).join(", ")} (${[...new Set(fr.map((f) => (str(f, "id") ?? "").length))].join("/")}-digit strings)`, ev(calls.league, "league.franchises.franchise[].id", fr.map((f) => str(f, "id"))));
  cl.ok("D", "D.names", "Team names", `${fr.filter((f) => str(f, "name")).length}/${fr.length} have a name (sanitized to "Team N"); abbrev on ${fr.filter((f) => str(f, "abbrev")).length}, logo/icon on ${fr.filter((f) => str(f, "logo") || str(f, "icon")).length}`, ev(calls.league, "league.franchises.franchise[].name", fr.map((f) => team(str(f, "id")))));
  const owners = fr.filter((f) => str(f, "owner_name")).length;
  const personal = docHas(x.docs.reference, "Personal user information, like name and email addresses only returned to league owners");
  cl.add("D", "D.owners", "Owner display names", owners ? "ok" : "warn", owners ? `${owners}/${fr.length} owner names (sanitized)` : `not returned to a guest (franchise fields: ${keys.join(", ")})${personal ? '; api_info: "Personal user information, like name and email addresses only returned to league owners" — an owner login would show them' : ""}`, ev(calls.league, "league.franchises.franchise[].owner_name", owners ? "present" : "absent"));
  if (!owners)
    cl.issue(`Owner display names aren't returned to a guest (§17 D): league.franchises.franchise[] has only ${JSON.stringify(keys)} — evidence D.owners (GET https://{leagueHost}/${YEAR}/export?TYPE=league&L={leagueId}&JSON=1 → HTTP ${calls.league.res.status}) — options: (a) with an owner login, read owner_name (untested); (b) show team names only on the Import Report and trade cards for public MFL leagues.`);
  const myleagues = typeBlock(x.docs.reference, "myleagues", true) ?? "";
  const documentsFranchise = /franchise_id/i.test(myleagues);
  cl.warn("D", "D.myTeam", "Which team is the user's", `${x.c.hasCookie ? "logged in: " : "test league, no login: the user would pick a team. "}With an owner login, TYPE=myleagues lists the user's leagues (api_info: "${myleagues.split("\n")[0]?.trim() ?? "?"}"); ${documentsFranchise ? "its row documents franchise_id" : "api_info does not document a franchise_id field there — that it carries the user's franchise_id is community knowledge, unverified"} (untested here: no MFL account in .env.local)`, { url: "https://api.myfantasyleague.com/2026/export?TYPE=myleagues&JSON=1", path: "leagues.league[].franchise_id (not in api_info; unverified)" });
}

function checkE(x: Ctx): Map<string, PlayerRow> {
  const { cl } = x.p;
  const { calls } = x;
  const players = new Map<string, PlayerRow>();
  for (const pl of arr(calls.players?.json, "players.player")) {
    const id = str(pl, "id");
    if (id && isRecord(pl)) players.set(id, { id, name: str(pl, "name") ?? "", position: str(pl, "position") ?? "", team: str(pl, "team") ?? "", raw: pl });
  }
  for (const pl of arr(x.custom?.json, "players.player")) {
    const id = str(pl, "id");
    if (id && isRecord(pl) && !players.has(id)) players.set(id, { id, name: "(custom player)", position: str(pl, "position") ?? "", team: str(pl, "team") ?? "", raw: pl, custom: true });
  }
  const statuses = countBy(x.rosterEntries, (r) => r.status);
  cl.add("E", "E.rosters", "Every player on every team", x.rosterEntries.length ? "ok" : "fail", `${x.rosterEntries.length} roster entries across ${new Set(x.rosterEntries.map((r) => r.franchise)).size} teams; status codes ${JSON.stringify(statuses)}`, ev(calls.rosters, "rosters.franchise[].player[].{id,status}", statuses));
  const rostered = x.rosterEntries.map((r) => players.get(r.id));
  const inGlobal = rostered.filter((pl) => pl && !pl.custom).length;
  const customRows = rostered.filter((pl) => pl?.custom);
  const missing = x.rosterEntries.length - inGlobal - customRows.length;
  const posCounts = countBy(rostered, (pl) => pl?.position);
  const unsupported = Object.keys(posCounts).filter((pos) => !toPos(pos));
  cl.add("E", "E.position", "Position", missing === 0 && !unsupported.length ? "ok" : "warn", `${inGlobal}/${x.rosterEntries.length} rostered ids are in the global TYPE=players DB; positions ${JSON.stringify(posCounts)}${unsupported.length ? `; unsupported: ${unsupported.join(", ")}` : ""}${missing ? `; ${missing} ids unknown` : ""}`, ev(calls.players, "players.player[].position", posCounts));
  if (x.customIds.length) {
    const cStatus = countBy(
      x.rosterEntries.filter((r) => x.customIds.includes(r.id)),
      (r) => r.status,
    );
    const lens = [...new Set(x.customIds.map((id) => id.length))].join("/");
    cl.warn("E", "E.customPlayers", "League-specific custom players", `${customRows.length} rostered ids aren't in MFL's player DB: ${x.customIds.length} distinct ${lens}-digit ids from ${x.customIds[0]} to ${x.customIds[x.customIds.length - 1]} (leading zeros kept); TYPE=players with L= returns them (positions ${JSON.stringify(countBy(customRows, (pl) => pl?.position))}, team ${[...new Set(customRows.map((pl) => pl?.team))].join("/")}, roster status ${JSON.stringify(cStatus)}) — commissioner-created (likely college prospects). No projections, crosswalk or FantasyCalc value; names are commissioner text, sanitized`, ev(x.custom, "players.player[].{id,name,position,team,status} (L= only)", x.customIds));
  }
  const teams = countBy(rostered, (pl) => pl?.team);
  const unknownTeams = Object.keys(teams).filter((t) => toNflTeam(t) === undefined && t !== "(none)");
  cl.add("E", "E.nflTeam", "NFL team", unknownTeams.length ? "warn" : "ok", `MFL's own codes (${Object.keys(teams).filter((t) => toNflTeam(t) !== t && toNflTeam(t)).map((t) => `${t}→${toNflTeam(t)}`).join(", ")}); FA = no team${unknownTeams.length ? `; unknown codes ${unknownTeams.join(", ")}` : ""}`, ev(calls.players, "players.player[].team", Object.keys(teams).length));
  const injuries = arr(calls.injuries?.json, "injuries.injury");
  const byId = new Map(injuries.map((i) => [str(i, "id") ?? "", i]));
  const rosteredInjured = x.rosterEntries.filter((r) => byId.has(r.id));
  const inj = countBy(rosteredInjured, (r) => str(byId.get(r.id), "status"));
  const unmappedInj = Object.keys(inj).filter((s) => toInjury(s) === undefined);
  const withReturn = rosteredInjured.filter((r) => returnWeek(str(byId.get(r.id), "exp_return"), x.kick) !== undefined).length;
  const withDate = rosteredInjured.filter((r) => str(byId.get(r.id), "exp_return")).length;
  const sample = rosteredInjured.slice(0, 3).map((r) => ({ player: players.get(r.id)?.name, status: str(byId.get(r.id), "status"), exp_return: str(byId.get(r.id), "exp_return"), returnWeek: returnWeek(str(byId.get(r.id), "exp_return"), x.kick) }));
  cl.add("E", "E.injury", "Injury status (and return week)", unmappedInj.length ? "warn" : "ok", `TYPE=injuries (week ${str(calls.injuries?.json, "injuries.week")}): ${rosteredInjured.length} rostered players listed, statuses ${JSON.stringify(inj)}; ${withDate} have an exp_return date, which gives a ${YEAR} NFL week for ${withReturn} (via kickoff times; the rest fall after the season)${unmappedInj.length ? `; unmapped statuses ${unmappedInj.join(", ")}` : ""}`, ev(calls.injuries, "injuries.injury[].{id,status,details,exp_return}", sample));
  if (withDate)
    cl.issue(`MFL gives expected return dates: ${withDate} of ${rosteredInjured.length} rostered injured players have injuries.injury[].exp_return, ${withReturn} of them inside the ${YEAR} season — CLAUDE.md §6 assumes platforms rarely give a return week and falls back to fixed injury tables (evidence E.injury, GET https://api.myfantasyleague.com/${YEAR}/export?TYPE=injuries&JSON=1 → HTTP ${calls.injuries?.res.status}) — options: (a) use exp_return as injuryReturnWeek for MFL leagues (recommended; the date → week mapping uses NFL kickoff times); (b) ignore it and keep the §6 defaults.`);
  const allIds = [...players.values()].filter((pl) => !pl.custom);
  const idLens = countBy(allIds, (pl) => `${pl.id.length}-digit`);
  const defIds = allIds.filter((pl) => pl.position === "Def").map((pl) => pl.id).sort();
  const withLeadingZero = allIds.filter((pl) => pl.id.startsWith("0")).length;
  cl.ok("E", "E.platformId", "Platform player ID", `MFL ids are digit strings (${JSON.stringify(idLens)}; ${withLeadingZero} start with 0, so keep them as strings${defIds.length ? `, e.g. team DEF ${defIds[0]}–${defIds[defIds.length - 1]}` : ""}); TYPE=players DETAILS=1 also gives the other-site ids counted in the evidence — ${arr(calls.players?.json, "players.player").some((pl) => str(pl, "sleeper_id")) ? "including" : "but no"} sleeper_id`, ev(calls.players, "players.player[].{id,espn_id,rotowire_id,sportsdata_id,stats_id,…}", Object.fromEntries(["espn_id", "rotowire_id", "sportsdata_id", "stats_id", "fleaflicker_id", "cbs_id", "nfl_id", "sleeper_id"].map((k) => [k, arr(calls.players?.json, "players.player").filter((pl) => str(pl, k)).length]))));
  const now = Date.UTC(2026, 8, 29) / 1000;
  const ages = rostered.map((pl) => ageAt(str(pl?.raw, "birthdate"), now)).filter((a): a is number => a !== undefined);
  const withBirthdate = rostered.filter((pl) => pl && !pl.custom && ageAt(str(pl.raw, "birthdate"), now) !== undefined);
  cl.ok("E", "E.age", "Age", `birthdate is a unix timestamp; age derivable for ${ages.length}/${rostered.length} rostered players${customRows.length ? ` (custom players with a birthdate: ${customRows.filter((pl) => ageAt(str(pl?.raw, "birthdate"), now) !== undefined).length}/${customRows.length})` : ""}`, ev(calls.players, "players.player[].birthdate", withBirthdate.slice(0, 2).map((pl) => ({ player: pl?.name, birthdate: str(pl?.raw, "birthdate"), age: ageAt(str(pl?.raw, "birthdate"), now) }))));
  return players;
}

function checkF(x: Ctx): void {
  const { cl } = x.p;
  const { calls, lg } = x;
  const weeks = arr(calls.schedule?.json, "schedule.weeklySchedule");
  const remaining = weeks.filter((w) => (num(at(w, "week")) ?? 0) >= x.curWeek && arr(w, "matchup").length > 0).map((w) => num(at(w, "week")));
  const perWeek = weeks.map((w) => arr(w, "matchup").length);
  const lastReg = num(at(lg, "lastRegularSeasonWeek")) ?? 0;
  const afterReg = weeks.filter((w) => (num(at(w, "week")) ?? 0) > lastReg);
  const afterRegMatchups = afterReg.reduce<number>((s, w) => s + arr(w, "matchup").length, 0);
  const franchiseKeys = keySet(weeks.flatMap((w) => arr(w, "matchup").flatMap((m) => arr(m, "franchise"))));
  cl.add("F", "F.matchups", "Fantasy matchups for remaining regular-season weeks", remaining.length ? "ok" : "fail", `weeks ${remaining.join(",")} each have ${Math.max(...perWeek)} matchups (franchise fields ${franchiseKeys.join(", ")}); the ${afterReg.length} listed weeks after week ${lastReg} hold ${afterRegMatchups} matchups, so playoff games come from TYPE=playoffBracket`, ev(calls.schedule, "schedule.weeklySchedule[].matchup[].franchise[]", { weeksWithMatchups: perWeek.filter(Boolean).length, weeksListed: weeks.length }));
  const st = arr(calls.standings?.json, "leagueStandings.franchise");
  const rec = st.map((f) => ({ team: team(str(f, "id")), w: num(at(f, "h2hw")), l: num(at(f, "h2hl")), t: num(at(f, "h2ht")), pf: num(at(f, "pf")), pa: num(at(f, "pa")) }));
  // Cross-check the standings against the completed weeks of the schedule.
  const tally = new Map<string, { w: number; l: number; t: number; pf: number }>();
  for (const w of weeks) {
    if ((num(at(w, "week")) ?? 99) > x.doneWeek) continue;
    for (const m of arr(w, "matchup"))
      for (const f of arr(m, "franchise")) {
        const id = team(str(f, "id"));
        const tt = tally.get(id) ?? { w: 0, l: 0, t: 0, pf: 0 };
        const res = str(f, "result");
        if (res === "W") tt.w++;
        else if (res === "L") tt.l++;
        else if (res === "T") tt.t++;
        tt.pf += num(at(f, "score")) ?? 0;
        tally.set(id, tt);
      }
  }
  const agree = rec.filter((r) => {
    const t = tally.get(r.team);
    return t && t.w === r.w && t.l === r.l && t.t === r.t && Math.abs(t.pf - (r.pf ?? 0)) < 0.01;
  }).length;
  cl.add("F", "F.records", "Current W-L-T and points for/against", agree === rec.length ? "ok" : "warn", `leagueStandings gives ${keySet(st).filter((k) => k !== "id").join(", ")}; W-L-T and pf match the completed schedule weeks for ${agree}/${rec.length} teams`, ev(calls.standings, "leagueStandings.franchise[].{h2hw,h2hl,h2ht,pf,pa}", rec.slice(0, 2)));
  const future = weeks.filter((w) => (num(at(w, "week")) ?? 0) > x.doneWeek).flatMap((w) => arr(w, "matchup").flatMap((m) => arr(m, "franchise").map((f) => str(f, "result"))));
  const fakeTies = future.filter((r) => r === "T").length;
  cl.add("F", "F.futureResult", "Unplayed weeks' result field", fakeTies ? "warn" : "ok", fakeTies ? `unplayed matchups carry result "T" (${fakeTies} franchise-weeks) — a tie only counts when the week is completed (CompletedWeek) or has scores` : "no result on unplayed weeks", ev(calls.schedule, `schedule.weeklySchedule[week>${x.doneWeek}].matchup[].franchise[].result`, countBy(future, (r) => r)));
  if (fakeTies)
    cl.issue(`TYPE=schedule marks unplayed matchups as ties: ${fakeTies} franchise-weeks after CompletedWeek ${x.doneWeek} carry result "T" (F.futureResult; GET https://{leagueHost}/${YEAR}/export?TYPE=schedule&L={leagueId}&JSON=1 → HTTP ${calls.schedule?.res.status}) — options: count results only for weeks ≤ mfl_status CompletedWeek (recommended; the probe's standings cross-check does this and matches ${agree}/${rec.length} teams).`);
}

function checkG(x: Ctx): void {
  const { cl } = x.p;
  const { calls } = x;
  const tx = arr(calls.transactions?.json, "transactions.transaction");
  const ts = (t: unknown) => num(at(t, "timestamp")) ?? 0;
  const wk = (t: unknown) => txWeek(ts(t), x.kick);
  const label = (w: number | undefined) => (w === 0 ? "preseason" : String(w ?? "unknown"));
  const types = countBy(tx, (t) => str(t, "type"));
  const trades = tx.filter((t) => str(t, "type") === "TRADE");
  const tradeRows = trades.map((t) => {
    const a = parseTradeSide(str(t, "franchise1_gave_up"));
    const b = parseTradeSide(str(t, "franchise2_gave_up"));
    return { week: label(wk(t)), teams: [team(str(t, "franchise")), team(str(t, "franchise2"))], gave: [a, b].map((s) => ({ players: s.players.length, futurePicks: s.futurePicks.map((f) => `${f.year} R${f.round} (orig ${team(f.originalFranchise)})`), currentPicks: s.currentPicks.length, blindBid: s.blindBid, unknown: s.unknown })) };
  });
  const hasWeekField = tx.some((t) => isRecord(t) && "week" in t);
  cl.add("G", "G.trades", "This season's trades", "ok", `${trades.length} trades (fields ${keySet(trades).join(", ")}); *_gave_up lists parse into player ids, FP_ future picks, DP_ current picks and BB_ blind-bid dollars (format from the tradeBait docs); ${hasWeekField ? "a week field is present" : "no week field, so the week is derived from the unix timestamp and NFL kickoff times"}`, ev(calls.transactions, "transactions.transaction[type=TRADE].{franchise,franchise2,franchise1_gave_up,franchise2_gave_up,timestamp}", tradeRows));
  const moves = new Map<string, { adds: number; drops: number }>();
  const bump = (fid: string | undefined, adds: number, drops: number) => {
    const k = team(fid);
    const m = moves.get(k) ?? { adds: 0, drops: 0 };
    m.adds += adds;
    m.drops += drops;
    moves.set(k, m);
  };
  for (const t of tx) {
    const type = str(t, "type") ?? "";
    if (type === "FREE_AGENT" || type === "BBID_WAIVER") {
      const ad = parseAddDrop(str(t, "transaction"));
      bump(str(t, "franchise"), ad.added.length, ad.dropped.length);
    } else if (type === "WAIVER") bump(str(t, "franchise"), idList(str(t, "added")).length, idList(str(t, "dropped")).length);
  }
  const fieldsByType = Object.fromEntries(Object.keys(types).sort().map((type) => [type, keySet(tx.filter((t) => str(t, "type") === type)).filter((k) => !["type", "timestamp", "franchise"].includes(k))]));
  cl.ok("G", "G.addDrop", "Add/drop counts per team", `transaction types ${JSON.stringify(types)}; fields per type (besides type/timestamp/franchise) ${JSON.stringify(fieldsByType)}; adds/drops counted from FREE_AGENT/BBID_WAIVER "transaction" strings and WAIVER added/dropped`, ev(calls.transactions, "transactions.transaction[].{type,franchise,transaction|added|dropped,timestamp}", Object.fromEntries([...moves].sort())));
  const documented = documentedTransTypes(x.docs.reference);
  const undocumented = Object.keys(types).filter((t) => documented.length && !documented.includes(t)).sort();
  if (undocumented.length || !hasWeekField)
    cl.issue(`MFL transactions ${hasWeekField ? "" : "have no week field (unix timestamps only) "}${undocumented.length ? `${hasWeekField ? "" : "and "}include types the TRANS_TYPE docs don't list (${undocumented.map((t) => `${t} ×${types[t]}`).join(", ")}; documented: ${documented.join(", ")})` : ""} — evidence G.addDrop / G.week (GET https://{leagueHost}/${YEAR}/export?TYPE=transactions&L={leagueId}&TRANS_TYPE=*&JSON=1 → HTTP ${calls.transactions?.res.status}) — options: derive the week as MFL's W= filter does (the next week to kick off; lib/mfl/derive.ts nextKickoffWeek, checked against MFL in G.week) and keep moves before the first kickoff apart as preseason (txWeek); treat unknown types as non-roster events and list them in the Import Report warnings.`);
  // MFL's own week (checked against its W= list) and the activity week (preseason kept apart).
  const mflWk = (t: unknown) => nextKickoffWeek(ts(t), x.kick);
  const weeks = countBy(tx, (t) => label(wk(t)));
  const mflWeek = arr(calls.transactionsWeek?.json, "transactions.transaction");
  const cmp = compareWeekList(tx, mflWeek, x.txWeekChecked, mflWk);
  const matches = cmp.mfl > 0 && cmp.both === cmp.mfl && cmp.onlyOurs === 0;
  const lastGameRule = tx.filter((t) => weekOf(ts(t), x.kick) !== mflWk(t)).length;
  cl.add(
    "G",
    "G.week",
    "Transaction week",
    matches ? "ok" : "warn",
    `no week field; rule tested: a move belongs to the next week to kick off (after week n−1's first kickoff, before week n's). MFL's own TYPE=transactions&W=${x.txWeekChecked} lists ${cmp.mfl} moves; the rule gives ${cmp.ours}; ${cmp.both} in both${Object.keys(cmp.onlyMflByOurWeek).length ? `; only in MFL's list, by our week: ${JSON.stringify(cmp.onlyMflByOurWeek)}` : ""}${cmp.onlyOurs ? `; only in ours: ${cmp.onlyOurs}` : ""}${matches ? " — identical, so the rule reproduces MFL's weeks" : " — they differ: MFL's week boundaries are not the rule's"}. A "last game ended" rule would file ${lastGameRule} of ${tx.length} moves in another week. Activity weeks (moves before the first kickoff kept apart as preseason; MFL files those under W=1): ${JSON.stringify(weeks)}`,
    ev(calls.transactions, "transactions.transaction[].timestamp → activity week", weeks),
    ev(calls.transactionsWeek, `transactions.transaction[] (W=${x.txWeekChecked}) vs the rule`, { mfl: cmp.mfl, rule: cmp.ours, both: cmp.both }),
  );
}

function checkH(x: Ctx): void {
  const { cl } = x.p;
  const fa = arr(x.calls.freeAgents?.json, "freeAgents.leagueUnit.player");
  const statusDoc = docHas(x.docs.reference, "If set to 'freeagent', returns only players that are fantasy league free agents");
  cl.add("H", "H.freeAgents", "Available players", fa.length ? "ok" : "warn", `TYPE=freeAgents lists ${fa.length} players (statuses ${JSON.stringify(countBy(fa, (pl) => str(pl, "status")))}; ${typeAccess(x.docs.reference, "freeAgents")}); also derivable as TYPE=players minus rostered${statusDoc ? "; api_info: projectedScores/playerScores take STATUS=freeagent" : ""}`, ev(x.calls.freeAgents, "freeAgents.leagueUnit.player[].{id,status}", fa.length));
}

function checkI(x: Ctx): void {
  const { cl } = x.p;
  const { calls } = x;
  const fr = arr(calls.futurePicks?.json, "futureDraftPicks.franchise");
  const picks = fr.flatMap((f) => arr(f, "futureDraftPick").map((pk) => ({ owner: str(f, "id"), orig: str(pk, "originalPickFor"), year: str(pk, "year"), round: str(pk, "round") })));
  const traded = picks.filter((pk) => pk.owner !== pk.orig);
  cl.add("I", "I.future", "Future pick ownership", picks.length ? "ok" : "warn", `${picks.length} picks: years ${JSON.stringify(countBy(picks, (pk) => pk.year))}, rounds ${JSON.stringify(countBy(picks, (pk) => pk.round))}; ${traded.length} held by a team other than the original (owner = franchise id, original = originalPickFor)`, ev(calls.futurePicks, "futureDraftPicks.franchise[].futureDraftPick[].{year,round,originalPickFor}", traded.slice(0, 3).map((pk) => ({ ...pk, owner: team(pk.owner), orig: team(pk.orig) }))));
  const dr = arr(calls.draftResults?.json, "draftResults.draftUnit.draftPick");
  const loads = arr(calls.transactions?.json, "transactions.transaction").filter((t) => str(t, "type") === "LOAD_ROSTERS").length;
  cl.add("I", "I.current", "Current-year draft", dr.length ? "ok" : "warn", dr.length ? `${dr.length} picks in draftResults` : `draftResults has no picks for ${YEAR} (draftType ${str(calls.draftResults?.json, "draftResults.draftUnit.draftType")}; ${loads} LOAD_ROSTERS transactions suggest the commissioner loaded rosters). Traded current-year picks would appear as DP_<round-1>_<pick-1> in trades (api_info, tradeBait)`, ev(calls.draftResults, "draftResults.draftUnit.{draftType,draftPick[]}", dr.length));
}

async function loadCrosswalk(x: Ctx, players: Map<string, PlayerRow>): Promise<XwalkData> {
  const dpRes = await request(DP_IDMAP_URL, { cache: { key: `idmap:${DP_IDMAP_URL}`, ttlMs: TTL.idMap, namespace: "idmap" }, label: "DynastyProcess db_playerids.csv", timeoutMs: 180_000 });
  const dpRows = dpRes.ok ? (parseCsv(dpRes.text, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }) as Array<Record<string, string>>) : [];
  const sleeper = await getSleeperPlayers();
  // Custom (league-specific) ids reuse numbers from MFL's global space, so they must never be crosswalked.
  const mflIds: MflPlayerIds[] = [...players.values()].filter((pl) => !pl.custom).map((pl) => ({ id: pl.id, name: pl.name, position: pl.position, espn_id: str(pl.raw, "espn_id"), rotowire_id: str(pl.raw, "rotowire_id"), sportsdata_id: str(pl.raw, "sportsdata_id"), stats_id: str(pl.raw, "stats_id") }));
  const xw = buildCrosswalk(mflIds, dpRows, Object.values(sleeper.data));
  const rostered = x.rosterEntries.map((r) => ({ mflId: r.id, mflPos: players.get(r.id)?.position ?? "?" }));
  const global = rostered.filter((r) => !players.get(r.mflId)?.custom);
  const via = countBy(global, (r) => xw.sleeperOf.get(r.mflId)?.via ?? "none");
  const byPos = countBy(
    global.filter((r) => !xw.sleeperOf.has(r.mflId)),
    (r) => r.mflPos,
  );
  const xok = global.filter((r) => xw.sleeperOf.has(r.mflId)).length;
  const dpCustomHits = dpRows.filter((r) => x.customIds.includes(r.mfl_id ?? "")).length;
  x.p.cl.add("X", "X.crosswalk", "MFL id → Sleeper id (canonical id) for rostered players", xok / Math.max(1, global.length) >= 0.98 ? "ok" : "warn", `${xok}/${global.length} rostered players from MFL's player DB (${pct(xok, global.length)}) via ${JSON.stringify(via)}${Object.keys(byPos).length ? `; unmatched by position ${JSON.stringify(byPos)}` : ""}; ${rostered.length - global.length} custom players have no crosswalk by design${dpCustomHits ? ` — their ids collide with MFL's global id space: DynastyProcess maps ${dpCustomHits} of them (as mfl_id) to other, real players, so custom ids must never be joined` : ""}. Where DynastyProcess and an ID join both answer, they agree: ${JSON.stringify(xw.agreement)}`, { url: DP_IDMAP_URL, status: dpRes.status, path: "db_playerids.csv mfl_id→sleeper_id; Sleeper players DB espn_id/sportradar_id/rotowire_id/stats_id", sample: via });
  x.p.cl.issue(`MFL has no Sleeper ids (TYPE=players DETAILS=1 carries no sleeper_id): canonical ids need the DynastyProcess crosswalk (mfl_id→sleeper_id) plus ID joins through the Sleeper players DB — ${xok}/${global.length} rostered players matched (X.crosswalk)${x.customIds.length ? `; league-specific custom player ids (${x.customIds.length} here) come back only from TYPE=players with L=${dpCustomHits ? ` and ${dpCustomHits} of them collide with DynastyProcess rows for other players` : ""}, so they must never be crosswalked` : ""} — options: (a) DynastyProcess first, then Sleeper-DB ID joins (implemented in lib/mfl/oracle.ts); (b) treat custom players as league-only players with no projections or market value.`);
  return { xw, dpRows, dpStatus: dpRes.status };
}

async function checkJ(x: Ctx, players: Map<string, PlayerRow>, compiled: Map<string, Compiled>, xd: XwalkData): Promise<void> {
  const { cl } = x.p;
  const { calls } = x;
  const proj = (call: MflCall | undefined) => {
    const m = new Map<string, number>();
    let empty = 0;
    for (const e of arr(call?.json, "projectedScores.playerScore")) {
      const id = str(e, "id");
      const s = num(at(e, "score"));
      if (!id || s === undefined) empty++;
      else m.set(id, s);
    }
    return { m, empty, week: str(call?.json, "projectedScores.week") };
  };
  const now = proj(calls.projNow);
  const next = proj(calls.projNext);
  const last = proj(calls.projLast);
  const rostered = x.rosterEntries.map((r) => r.id);
  const offense = rostered.filter((id) => OFFENSE.includes(players.get(id)?.position ?? ""));
  const cover = (m: Map<string, number>, ids: string[]) => ids.filter((id) => m.has(id)).length;
  const statusOf = new Map(x.rosterEntries.map((r) => [r.id, players.get(r.id)?.custom ? "CUSTOM" : r.status]));
  const noProj = countBy(
    offense.filter((id) => !now.m.has(id)),
    (id) => statusOf.get(id),
  );
  const leagueScoredDoc = docHas(x.docs.reference, "calculate the expected fantasy points, using that league's scoring system");
  cl.add("J", "J.current", "Current-week projections (league-scored)", now.m.size ? "ok" : "fail", `W=${now.week}: ${now.m.size} players; rostered covered ${cover(now.m, rostered)}/${rostered.length}, rostered QB/RB/WR/TE ${cover(now.m, offense)}/${offense.length} (no projection, by roster status: ${JSON.stringify(noProj)})${leagueScoredDoc ? `. api_info: "calculate the expected fantasy points, using that league's scoring system … raw stats that fantasysharks.com projects" (checked against Sleeper in J.agreement)` : ""}${now.empty ? `; ${now.empty} empty {"id":"","score":""} row(s) to skip` : ""}`, ev(calls.projNow, "projectedScores.playerScore[].{id,score} (top 3)", topBy(now.m)));
  const same = [...last.m].filter(([id, s]) => now.m.get(id) === s).length;
  cl.add("J", "J.future", "Future-week projections", next.m.size && last.m.size ? "ok" : "fail", `W=${next.week}: ${next.m.size} players (rostered ${cover(next.m, rostered)}/${rostered.length}); W=${last.week} (the last fantasy playoff week — bracket ${x.bracketId}'s final): ${last.m.size} players (rostered ${cover(last.m, rostered)}/${rostered.length}); ${same}/${last.m.size} week-${last.week} values equal week ${now.week}'s (so far weeks are not simple copies)`, ev(calls.projNext, "projectedScores.playerScore[] (W=next)", next.m.size), ev(calls.projLast, "projectedScores.playerScore[] (W=last fantasy week)", last.m.size));
  const byes = new Map(arr(calls.byes?.json, "nflByeWeeks.team").map((t) => [str(t, "id") ?? "", num(at(t, "bye_week"))]));
  const nextWeek = Number(next.week);
  const onBye = rostered.filter((id) => byes.get(players.get(id)?.team ?? "") === nextWeek);
  const byeProj = onBye.filter((id) => (next.m.get(id) ?? 0) > 0).length;
  cl.add("J", "J.byes", "Bye weeks in projections", byeProj === 0 ? "ok" : "warn", `${onBye.length} rostered players are on bye in week ${nextWeek}; ${byeProj} of them have a projection > 0 there (${onBye.filter((id) => !next.m.has(id)).length} absent)`, ev(calls.projNext, "projectedScores.playerScore[] for teams on bye", { onBye: onBye.length, projectedAboveZero: byeProj }));

  // J.agreement: MFL's league-scored projection vs Sleeper's stat projection × this league's rules (§6).
  const week = Number(now.week) || x.curWeek;
  const sleeperRows = new Map<string, Record<string, number>>();
  const statuses: Record<string, number> = {};
  for (const pos of OFFENSE) {
    const res = await fetchSleeperProjections(week, pos);
    statuses[pos] = res.status;
    for (const row of Array.isArray(res.json) ? (res.json as Array<{ player_id?: string; stats?: Record<string, number> }>) : []) if (row.player_id && row.stats) sleeperRows.set(row.player_id, row.stats);
  }
  const pairs: ProjectionPair[] = [];
  for (const id of new Set(offense)) {
    const pl = players.get(id);
    const sid = xd.xw.sleeperOf.get(id)?.sleeperId;
    const c = compiled.get(pl?.position ?? "");
    const stats = sid ? sleeperRows.get(sid) : undefined;
    const mfl = now.m.get(id);
    if (!pl || pl.custom || !c || !stats || mfl === undefined) continue;
    pairs.push({ mflId: id, mflPos: pl.position, mfl, ours: Math.round(scoreStats(c, stats) * 1000) / 1000, halfPpr: stats.pts_half_ppr });
  }
  const ag = projectionAgreement(pairs, AGREEMENT_MIN_POINTS);
  const byPos = Object.fromEntries(Object.entries(ag.byPos).map(([pos, g]) => [pos, { n: g.n, medianRatio: g.medianRatio, disagreeOver40pct: g.disagree, medianVsHalfPpr: g.medianHalfPpr }]));
  const te = ag.byPos.TE?.medianHalfPpr;
  const wr = ag.byPos.WR?.medianHalfPpr;
  const recRates = { TE: compiled.get("TE")?.rates.rec ?? 0, WR: compiled.get("WR")?.rates.rec ?? 0 };
  const teSignal = te !== undefined && wr !== undefined ? `median MFL ÷ Sleeper pts_half_ppr is ${te} for TE vs ${wr} for WR${recRates.TE > recRates.WR ? ` — with this league's TE premium (TE ${recRates.TE} vs WR ${recRates.WR} per catch) a higher TE ratio is what league-scored projections should show${te > wr ? " (it is)" : " (it is NOT)"}` : ""}` : "no pts_half_ppr reference";
  const off = ag.overall.n ? Math.abs(ag.overall.medianRatio - 1) : Infinity;
  const gap = ag.overall.n ? `${Math.round(Math.abs(1 - ag.overall.medianRatio) * 100)}% ${ag.overall.medianRatio < 1 ? "below" : "above"}` : "?";
  cl.add(
    "J",
    "J.agreement",
    "MFL projections vs Sleeper stats × league rules (CLAUDE.md §6)",
    ag.overall.n && off <= 0.1 ? "ok" : "warn",
    `week ${week}, rostered QB/RB/WR/TE with both projections > ${AGREEMENT_MIN_POINTS} pts: n=${ag.overall.n} of ${pairs.length} pairs; median MFL ÷ ours = ${ag.overall.medianRatio} (MFL runs ${gap} Sleeper × league rules); ${ag.overall.disagree}/${ag.overall.n} differ by more than 40% (MFL ÷ ours outside 0.6–1.4; §6 logs these). By position: ${JSON.stringify(byPos)}. League-scored check: ${teSignal}`,
    ev(calls.projNow, "projectedScores.playerScore[].score", ag.overall.n),
    { url: sleeperProjectionsUrl(week, "{position}"), status: Object.values(statuses).every((s) => s === 200) ? 200 : Math.max(...Object.values(statuses)), path: "[].stats × compiled MFL rules (lib/mfl/rules.ts scoreStats); [].stats.pts_half_ppr", sample: byPos },
  );
  if (!ag.overall.n || off > 0.1)
    cl.issue(`MFL's league-scored projections and Sleeper's stat projections × this league's rules disagree systematically: median MFL ÷ Sleeper×rules = ${ag.overall.medianRatio} in week ${week} (n=${ag.overall.n}; ${ag.overall.disagree} players differ by > 40%) — evidence J.agreement (GET https://{leagueHost}/${YEAR}/export?TYPE=projectedScores&L={leagueId}&W=${week}&JSON=1 → HTTP ${calls.projNow?.res.status}; GET ${sleeperProjectionsUrl(week, "{position}")} → HTTP ${Math.max(...Object.values(statuses))}). §6 averages the two sources for MFL leagues, which shifts MFL players' base rates by about half that gap and logs every > 40% disagreement — options: (a) average as specified and log the disagreements; (b) rescale MFL projections to Sleeper's level (or tune a per-source weight) in the Phase 6 backtest before averaging; (c) use Sleeper × league rules only, like the other platforms.`);
}

async function checkK(x: Ctx, compiled: Map<string, Compiled>, players: Map<string, PlayerRow>, xd: XwalkData): Promise<void> {
  const { cl } = x.p;
  const { calls } = x;
  const scores = (call: MflCall | undefined) => new Map(arr(call?.json, "playerScores.playerScore").map((e) => [str(e, "id") ?? "", num(at(e, "score")) ?? 0] as const));
  const last = scores(calls.scoresLast);
  const prev = scores(calls.scoresPrev);
  const rostered = x.rosterEntries.map((r) => r.id);
  cl.ok("K", "K.leagueScored", "League-scored points for completed weeks", `playerScores W=${x.doneWeek}: ${last.size} players, W=${x.doneWeek - 1}: ${prev.size} (rostered and free agents: fields ${keySet(arr(calls.scoresLast?.json, "playerScores.playerScore")).join(", ")}); rostered with a score in week ${x.doneWeek}: ${rostered.filter((id) => last.has(id)).length}/${rostered.length}`, ev(calls.scoresLast, "playerScores.playerScore[].{id,score} (top 3)", topBy(last)));
  const wk = arr(calls.weekly?.json, "allWeeklyResults.weeklyResults").find((w) => num(at(w, "week")) === x.doneWeek);
  const fromWeekly = new Map(arr(wk, "matchup").flatMap((m) => arr(m, "franchise").flatMap((f) => arr(f, "player").map((pl) => [str(pl, "id") ?? "", num(at(pl, "score"))] as const))));
  const both = [...fromWeekly].filter(([id, s]) => s !== undefined && last.has(id));
  const agree = both.filter(([id, s]) => Math.abs((s ?? 0) - (last.get(id) ?? 0)) < 0.001).length;
  const weeklyFranchises = arr(calls.weekly?.json, "allWeeklyResults.weeklyResults").flatMap((w) => arr(w, "matchup").flatMap((m) => arr(m, "franchise")));
  const withOptimal = weeklyFranchises.filter((f) => str(f, "optimal") !== undefined).length;
  const playerKeys = keySet(weeklyFranchises.flatMap((f) => arr(f, "player")));
  cl.add("K", "K.weeklyResults", "Per-starter results (weeklyResults)", agree === both.length ? "ok" : "warn", `weeklyResults W=YTD: per franchise-week the players (fields ${playerKeys.join(", ")}); ${withOptimal} franchise-weeks also carry optimal/opt_pts (the best possible lineup); week ${x.doneWeek}: ${agree}/${both.length} player scores equal playerScores`, ev(calls.weekly, "allWeeklyResults.weeklyResults[].matchup[].franchise[].player[]", { compared: both.length, equal: agree }));
  const result = await oracle(x, compiled, players, xd, new Map([[x.doneWeek, last], [x.doneWeek - 1, prev]]));
  // Raw stats: MFL has none (licensing); the oracle's Sleeper stats join is the working workaround.
  const noRaw = docHas(x.docs.general, "We can not and will not under any circumstance make raw NFL player stats available");
  cl.warn("K", "K.rawStats", "Raw stats", `MFL publishes no raw stats${noRaw ? ' (api_info: "We can not and will not under any circumstance make raw NFL player stats available")' : ""}; workaround in use: Sleeper's /stats endpoint joined through DynastyProcess mfl_id→sleeper_id (+ Sleeper-DB ID joins) — it covers the oracle: ${result.within}/${result.compared} rostered player-weeks within 0.05 (K.oracle)`, { url: x.docs.urls.general, path: "no raw-stats TYPE in the Request Reference", sample: noRaw ? "We can not and will not under any circumstance make raw NFL player stats available" : "(phrase not found)" }, { url: sleeperStatsUrl(x.doneWeek), path: "[].stats (Sleeper, joined by crosswalk)", sample: `${result.within}/${result.compared}` });
  cl.issue(`MFL never publishes raw stats (K.rawStats; api_info), so the §5 scoring oracle for MFL recomputes playerScores from Sleeper's undocumented /stats endpoint joined by the crosswalk: ${result.within}/${result.compared} rostered player-weeks within 0.05 in weeks ${x.doneWeek - 1}–${x.doneWeek} (K.oracle; skipped ${JSON.stringify(result.skipped)}) — options: keep Sleeper stats as the MFL oracle source (recommended while the endpoint works); fall back to nflverse weekly stats if it breaks.`);
}

async function oracle(x: Ctx, compiled: Map<string, Compiled>, players: Map<string, PlayerRow>, xd: XwalkData, mflScores: Map<number, Map<string, number>>): Promise<OracleResult> {
  const { cl } = x.p;
  const rostered = x.rosterEntries.map((r) => ({ mflId: r.id, mflPos: players.get(r.id)?.position ?? "?" }));
  const weeks = [...mflScores.keys()].sort((a, b) => a - b);
  const stats = new Map<number, Map<string, Record<string, number>>>();
  for (const w of weeks) {
    const url = sleeperStatsUrl(w);
    const res = await request(url, { cache: { key: `stats:${url}`, ttlMs: TTL.projections, namespace: "stats" }, label: `Sleeper stats week ${w}`, timeoutMs: 180_000 });
    const rows = Array.isArray(res.json) ? (res.json as Array<{ player_id?: string; stats?: Record<string, number> }>) : [];
    stats.set(w, new Map(rows.filter((r) => r.player_id && r.stats).map((r) => [r.player_id as string, r.stats as Record<string, number>])));
  }
  const { result } = runOracle({ weeks, players: rostered, mflScores, sleeperStats: stats, compiled, xwalk: xd.xw });
  const byGroup: Record<string, string> = {};
  for (const [pos, b] of Object.entries(result.byPos).sort()) byGroup[pos] = `${b.within}/${b.compared} (${pct(b.within, b.compared)})`;
  const worst = result.worst.map((r) => ({ week: r.week, player: players.get(r.mflId)?.name, pos: r.mflPos, mfl: r.mfl, sleeperStats: r.ours, diff: r.diff }));
  cl.add("K", "K.oracle", "Scoring oracle dry run (MFL points vs Sleeper stats × mapped rules)", result.rate >= 0.99 ? "ok" : "warn", `weeks ${weeks.join(", ")}: ${result.within}/${result.compared} rostered player-weeks within 0.05 (${pct(result.within, result.compared)}; target ≥ 99%). By position: ${JSON.stringify(byGroup)}. Skipped: ${JSON.stringify(result.skipped)}`, { url: sleeperStatsUrl(weeks[0] ?? 3), path: "playerScores (MFL) vs Sleeper stats[] × compiled rules", sample: worst });
  return result;
}

function checkL(x: Ctx): void {
  const { cl } = x.p;
  const { calls } = x;
  const byes = arr(calls.byes?.json, "nflByeWeeks.team");
  cl.add("L", "L.byes", "Bye weeks", byes.length === 32 ? "ok" : "warn", `TYPE=nflByeWeeks: ${byes.length} teams, bye weeks ${[...new Set(byes.map((t) => num(at(t, "bye_week"))))].sort((a, b) => (a ?? 0) - (b ?? 0)).join(",")} (MFL team codes)`, ev(calls.byes, "nflByeWeeks.team[].{id,bye_week}", byes.slice(0, 3).map((t) => `${str(t, "id")}=${str(t, "bye_week")}`)));
  const weeks = arr(calls.nflSchedule?.json, "fullNflSchedule.nflSchedule");
  const matchups = weeks.flatMap((w) => arr(w, "matchup"));
  const games = matchups.length;
  const regWeeks = weeks.filter((w) => arr(w, "matchup").length > 0).length;
  cl.add("L", "L.schedule", "NFL schedule", games === 272 ? "ok" : "warn", `TYPE=nflSchedule W=ALL: ${games} games over ${regWeeks} weeks (${weeks.length} weeks listed); game fields ${keySet(matchups).join(", ")}, team fields ${keySet(matchups.flatMap((m) => arr(m, "team"))).join(", ")}`, ev(calls.nflSchedule, "fullNflSchedule.nflSchedule[].matchup[].{kickoff,team[]}", { games, weeks: regWeeks }));
}

async function checkM(x: Ctx, compiled: Map<string, Compiled>, players: Map<string, PlayerRow>, leagueType: LeagueType): Promise<void> {
  const { cl } = x.p;
  const qbMax = convertStarters(at(x.lg, "starters")).starterCaps.QB ?? 1;
  const ppr = nearest([0, 0.5, 1] as const, compiled.get("WR")?.rates.rec ?? compiled.get("RB")?.rates.rec ?? 0);
  // Dynasty values for dynasty leagues; redraft values for redraft and keeper (perception, §9/§11).
  const format: FcFormat = { isDynasty: leagueType === "dynasty", numQbs: qbMax >= 2 ? 2 : 1, numTeams: nearest(FC_TEAM_SIZES, x.franchiseIds.length), ppr };
  let fc;
  try {
    fc = await getFantasyCalc(format);
  } catch (err) {
    cl.fail("M", "M.matchRate", "FantasyCalc match rate", `FantasyCalc request failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const rostered = x.rosterEntries.filter((r) => !players.get(r.id)?.custom).map((r) => ({ id: r.id, name: players.get(r.id)?.name ?? "?", pos: players.get(r.id)?.position ?? "?" }));
  const customSkill = x.rosterEntries.filter((r) => players.get(r.id)?.custom && OFFENSE.includes(players.get(r.id)?.position ?? "")).length;
  const m = matchRate(rostered, fc.data, "mflId");
  // Classify misses against FantasyCalc's full player list (same cache key as the shared probe).
  let allFc: Array<{ mflId?: unknown; name?: string }> = [];
  try {
    allFc = (await getJson<Array<{ mflId?: unknown; name?: string }>>(FC_PLAYERS_URL, { cache: { key: `fantasycalc:${FC_PLAYERS_URL}`, ttlMs: TTL.fantasyCalc, namespace: "fantasycalc" }, label: "FantasyCalc /players" })).data;
  } catch {
    // classification is optional
  }
  const known = new Set(allFc.map((f) => String(f.mflId ?? "")));
  const noValue = m.misses.filter((pl) => known.has(pl.id));
  const unknownId = m.misses.filter((pl) => !known.has(pl.id));
  const idLevel = m.matched + noValue.length;
  const summary = `value rows: ${m.matched}/${m.eligible} = ${pct(m.matched, m.eligible)} (target ≥ 98%); ID level (value rows + /players): ${idLevel}/${m.eligible} = ${pct(idLevel, m.eligible)}${customSkill ? `, not counting ${customSkill} custom players` : ""}; misses: ${m.misses.map((pl) => `${pl.name} (${pl.pos})`).join(", ") || "none"}${allFc.length ? `. In FantasyCalc's /players list by mflId: ${noValue.length} of ${m.misses.length} (so they just have no value in this format → valueFloor); unknown there: ${unknownId.length}` : ""}`;
  cl.add("M", "M.matchRate", "FantasyCalc match rate (rostered QB/RB/WR/TE by mflId)", m.rate >= 0.98 ? "ok" : "warn", summary, { url: fc.res.url, status: fc.res.status, path: "[].player.mflId", sample: m.misses.slice(0, 20) }, { url: FC_PLAYERS_URL, path: "[].mflId (misses found)", sample: noValue.map((pl) => pl.name) });
  if (m.rate < 0.98)
    cl.issue(`§17 M target missed for this MFL league: ${m.matched}/${m.eligible} = ${pct(m.matched, m.eligible)} of rostered QB/RB/WR/TE have a FantasyCalc value row by mflId (target ≥ 98%); ${noValue.length} of the ${m.misses.length} misses are in FantasyCalc's /players list, i.e. they exist but have no value in this format (${fc.res.url.split("?")[1]}) — evidence M.matchRate — options: (a) count ID-level coverage (${pct(idLevel, m.eligible)}) and give value-less players config.valueFloor (as §9 already says); (b) keep the 98% target on value rows and accept deep-bench misses.`);
  cl.decision(`FantasyCalc format for this league: isDynasty=${format.isDynasty} (assumed from the A.leagueType signals: ${leagueType}), numQbs=${format.numQbs} (QB range allows ${qbMax} starters), numTeams=${format.numTeams}, ppr=${ppr}; the TE premium (TE ${compiled.get("TE")?.rates.rec ?? "?"} per catch) is not passed — the tep parameter is still unverified (shared probe).`);
}

function extras(x: Ctx, freeText: number, fx: { saved: number; prune?: { removed: string[]; mismatched: string[] }; complete: boolean; leagueKeysRedacted: string[]; franchiseKeysRedacted: string[] }): void {
  const { cl } = x.p;
  const { calls } = x;
  const alias = calls.standingsAlias;
  const aliasKeys = Object.keys(isRecord(alias?.json) ? alias.json : {});
  const standingsDoc = typeAccess(x.docs.reference, "standings");
  cl.add("X", "X.standingsAlias", "TYPE=standings (in CLAUDE.md §2.6)", alias?.json && !alias.error ? "warn" : "fail", `api_info: ${standingsDoc}; the server answers it like leagueStandings (${JSON.stringify(aliasKeys)}) — use the documented TYPE=leagueStandings`, ev(alias, "(root)", aliasKeys));
  if (standingsDoc === "not documented")
    cl.issue(`CLAUDE.md §2.6 lists TYPE=standings, but api_info?STATE=details doesn't document it; the live server still answers it (HTTP ${alias?.res.status}, root keys ${JSON.stringify(aliasKeys)}) — evidence X.standingsAlias (GET https://{leagueHost}/${YEAR}/export?TYPE=standings&L={leagueId}&JSON=1) — options: use the documented TYPE=leagueStandings (recommended); keep "standings" only as an undocumented alias.`);

  // Redirects: what the api host did with a league request this run, and what league-host calls did.
  const hops = x.leagueApi?.redirects ?? [];
  const leagueHostHops = Object.entries(calls).filter(([, c]) => c?.template.includes("{leagueHost}") && c.redirects.length).length;
  cl.ok("X", "X.redirect", "api host vs league host", `league request to api.myfantasyleague.com: ${hops.length ? `redirected ${hops.map((h) => `HTTP ${h.status} → ${h.to}`).join(", ")} (followed by hand; a login cookie would be re-attached)` : `answered HTTP ${x.leagueApi?.res.status} itself (no redirect this run)`}; ${leagueHostHops} of the league-host requests were redirected. The probe sends league requests to the league's host (league.baseURL / leagueSearch homeURL), as the docs ask; redirects are followed manually and only to https *.myfantasyleague.com`, { url: x.leagueApi?.template, status: x.leagueApi?.res.status, path: "redirect hops (hosts templated)", sample: hops.length ? hops : "none" });
  cl.issue(`CLAUDE.md §2.6 says "Follow redirects to the league's wwwNN host", but (1) api_info warns a wrong-host redirect "may be delayed, or if the system is under too much stress, it may be denied", (2) this run's api-host league request ${hops.length ? `was redirected (${hops.map((h) => `HTTP ${h.status}`).join(", ")})` : `was answered directly (HTTP ${x.leagueApi?.res.status}, no redirect)`}, and (3) Node's fetch drops the Cookie header on a cross-host redirect, so a private league would silently answer as a guest — evidence X.redirect, DOCS.hosts — options: (a) send league requests to league.baseURL's host (implemented); (b) follow redirects by hand, re-attaching the cookie only for https *.myfantasyleague.com (implemented in lib/mfl/client.ts; offline-tested, untested live: no MFL login).`);

  // leagueSearch homeURL quirk: computed from the (git-ignored) search capture, if one exists.
  if (x.capture) {
    const prefixes = homeUrlPrefixes(x.capture.json);
    const total = Object.values(prefixes).reduce((s, n) => s + n, 0);
    const colonless = prefixes["https//"] ?? 0;
    const hits = parseSearch(x.capture.json);
    const chosenHit = hits.find((h) => h.id === x.L);
    const baseHost = hostOf(str(x.calls.league.json, "league.baseURL"));
    cl.add("X", "X.homeUrl", "leagueSearch homeURL quirk", colonless ? "ok" : "warn", `in the leagueSearch capture of ${x.capture.captured ?? "?"} (git-ignored): ${pct(colonless, total)} of homeURLs start "https//" (no colon) — parse the host leniently (lib/mfl/search.ts hostFromHomeUrl); ${hostFromHomeUrl(`https//${LEAGUE_HOST_PLACEHOLDER}/`) ? "the lenient parser handles it" : "PARSER FAILS"}${chosenHit ? `; the chosen league's homeURL host ${chosenHit.host === baseHost ? "equals" : "DIFFERS from"} its league.baseURL host` : ""}`, { url: `https://api.myfantasyleague.com/${YEAR}/export?TYPE=leagueSearch&SEARCH={term}&JSON=1`, status: x.capture.status, path: "leagues.league[].homeURL (scheme prefix counts)", sample: Object.fromEntries(Object.entries(prefixes).map(([k, n]) => [k, pct(n, total)])) });
  } else cl.na("X", "X.homeUrl", "leagueSearch homeURL quirk", "untested this run: no leagueSearch capture (MFL_LEAGUE_ID is set, so no search ran)");

  // Owner view: with a login, does TYPE=league return owner-only fields?
  if (x.c.hasCookie) {
    const fr = arr(x.lg, "franchises.franchise");
    const ownerFields = ["owner_name", "email", "phone", "cell", "username"].filter((k) => fr.some((f) => str(f, k)));
    cl.add("X", "X.ownerView", "Logged-in response has owner-only fields", ownerFields.length ? "ok" : "warn", ownerFields.length ? `owner-only franchise fields present: ${ownerFields.join(", ")} (values sanitized)` : "the login cookie was sent but TYPE=league shows no owner-only field — the cookie may not have been accepted (check the escaping, or the account isn't in this league)", ev(calls.league, "league.franchises.franchise[] owner-only keys", ownerFields));
  } else cl.na("X", "X.ownerView", "Logged-in response has owner-only fields", `untested: no MFL login this run (${x.p.env("MFL_LEAGUE_ID") ? "MFL_USERNAME / MFL_PASSWORD blank" : "MFL_LEAGUE_ID blank; a login is only used with it"})`);

  const tb = arr(calls.tradeBait?.json, "tradeBaits.tradeBait");
  cl.ok("X", "X.tradeBait", "Trade bait (bonus for Phase 4)", `${tb.length} franchises list trade bait (fields ${keySet(tb).join(", ")}; inExchangeFor is free text, sanitized) — a candidate acceptance signal for Phase 4`, ev(calls.tradeBait, "tradeBaits.tradeBait[].{franchise_id,willGiveUp,inExchangeFor,timestamp}", tb.length));
  const live = arr(calls.live?.json, "liveScoring.matchup");
  const liveFranchises = live.flatMap((m) => arr(m, "franchise"));
  cl.ok("X", "X.liveScoring", "Live scoring", `W=${x.curWeek}: ${live.length} matchups; franchise fields ${keySet(liveFranchises).join(", ")}; api_info gives liveScoring no access note — for a private league the general rule applies ("Data from leagues that are marked as PRIVATE are no longer accessible by users not in the league")`, ev(calls.live, "liveScoring.matchup[].franchise[].players.player[]", live.length));

  const log = x.c.log;
  const liveReqs = log.filter((e) => !e.fromCache).length;
  const failed = Object.entries(calls)
    .filter(([, c]) => c && (c.error || !c.res.ok))
    .map(([name, c]) => `${name}: ${c?.error ?? `HTTP ${c?.res.status}`}`);
  const expectedFail = (f: string) => f.startsWith("calendar") && !x.c.hasCookie;
  cl.add("X", "X.requests", "Requests", failed.filter((f) => !expectedFail(f)).length ? "warn" : "ok", `${log.length} MFL requests this run (${liveReqs} live, ${log.length - liveReqs} from cache; by kind ${JSON.stringify(countBy(log, (e) => e.kind))}); retries: 0 on every MFL request; ${x.c.throttled ? "HIT 429 — stopped early" : "no 429"}; ${freeText} free-text values registered for redaction${failed.length ? `; errors: ${failed.join("; ")}` : ""}`, { path: "MflClient.log", sample: countBy(log, (e) => `${e.kind} HTTP ${e.status}${e.fromCache ? " (cache)" : ""}`) });
  const errorBody = calls.calendar?.error && calls.calendar.res.status === 200;
  if (errorBody)
    cl.issue(`MFL reports errors as HTTP 200 with an "error" object (like §2.7 says for Fantrax; §2.6 doesn't mention it): TYPE=calendar as a guest → HTTP 200, body error "${calls.calendar?.error}" — evidence A.tradeDeadline — options: treat any MFL body with an "error" key as a failure and never cache it (implemented in lib/mfl/client.ts).`);

  // Old labels may hold values that are no longer allowed in reports (e.g. a search term): print only
  // the TYPE and week of each removed fixture.
  const describe = (label: string) => `${/TYPE=(\w+)/.exec(label)?.[1] ?? "file"}${/[?&]W=(\w+)/.exec(label) ? ` W=${/[?&]W=(\w+)/.exec(label)?.[1]}` : ""}${/synthesized/.test(label) ? " (synthesized sample)" : ""}`;
  cl.add("X", "X.fixtures", "Sanitized fixtures", fx.prune?.mismatched.length ? "warn" : "ok", `${fx.saved} fixtures written; ${fx.prune ? `${fx.prune.removed.length} stale fixture(s) removed${fx.prune.removed.length ? ` (${fx.prune.removed.map(describe).join("; ")})` : ""}; ${fx.prune.mismatched.length ? `file name ≠ sha256(label) for ${fx.prune.mismatched.length}` : "every index entry's file name = sha256(label)"}` : "stale-fixture pruning skipped (incomplete run)"}; privacy shaping: league host → ${LEAGUE_HOST_PLACEHOLDER}, league.history cut to ${YEAR}, leagueSearch sample synthesized (ids from 90001)${fx.franchiseKeysRedacted.length ? `; franchise fields replaced by path: ${fx.franchiseKeysRedacted.join(", ")}` : ""}${fx.leagueKeysRedacted.length ? `; unknown league fields replaced by path (login): ${fx.leagueKeysRedacted.join(", ")}` : ""}`, { path: "fixtures/sanitized/mfl/index.json" });
}

function decisionsAndQuestions(x: Ctx, leagueType: LeagueType): void {
  const { cl } = x.p;
  const oncePerDay = docHas(x.docs.reference, "no more than once per day");
  cl.decision("League requests go to the league's own host (league.baseURL for MFL_LEAGUE_ID, the search hit's homeURL for the test league); non-league TYPEs to api.myfantasyleague.com — as api_info asks. Redirects are followed by hand (redirect: \"manual\") and only to https *.myfantasyleague.com, so a login cookie survives an api → wwwNN hop.");
  cl.decision("Pacing: every *.myfantasyleague.com request (api host, league hosts, docs pages, redirect hops) shares one bucket in lib/http.ts, ≥ 1.2 s apart; retries: 0 on every MFL request; one 429 stops further MFL calls for the run (api_info: \"If a request fails, don't retry\").");
  cl.decision(`Cache: league data 10 min, league-scored projections 6 h, players DB 24 h${oncePerDay ? ' (api_info: "no more than once per day")' : ""}, allRules 7 days, docs pages 7 days (HTML cached on purpose), NFL schedule/byes 7 days, injuries 6 h, the leagueSearch result 24 h plus the saved test-league choice; MFL HTTP-200 error bodies are never cached.`);
  cl.decision("Private leagues: log in with MFL_USERNAME/MFL_PASSWORD via POST and send the MFL_USER_ID cookie; the APIKEY alternative is not used because it travels in the URL query string.");
  if (!x.p.env("MFL_LEAGUE_ID"))
    cl.decision(`Test league (MFL_LEAGUE_ID blank): one public TYPE=leagueSearch, then a few candidates in a random order keyed by a salt that lives only in the git-ignored choice file, until a public, in-season 10–12 team league with IR and taxi slots in use (this one: ${leagueType}); the IDs and names of the leagues looked at go to the git-ignored watch list for check:leaks.`);
  cl.decision("MFL responses are put in canonical order (sorted keys; id-keyed arrays sorted — lib/mfl/canonical.ts) before identities are registered and fixtures saved, so placeholders and committed fixtures stay stable run to run; fixtures/raw keeps MFL's exact bytes.");
  cl.decision("Scoring semantics taken from MFL's Scoring Rules Setup help: *N per unit, a/b stepped every-b, plain N flat award in range, thresholdPoints = formula scoring; rules in overlapping position groups add up. lib/mfl/rules.ts compiles them to Sleeper-key rates + stat ≥ threshold bonuses and reports what doesn't fit.");
  cl.issue(`CLAUDE.md §0.9 says to back off exponentially on 429/5xx, but api_info says "If a request fails, don't retry" and "Wait one second between making requests" (DOCS.rate) — the probe follows MFL for MFL hosts (no retries; a 429 stops MFL calls for the run) — options: (a) keep MFL's rule as a documented exception to §0.9 (recommended); (b) allow one delayed retry on 5xx only.`);
  cl.question("Do you have an MFL league? If so, fill in MFL_LEAGUE_ID (and MFL_USERNAME + MFL_PASSWORD if it's private) in .env.local.");
  cl.question("Should we register an MFL API client (needs your MFL account and an SMS code) for ~2.5× higher rate limits before launch? Not needed for development.");
  cl.question("MFL lineups use min–max ranges per position: OK to add optional per-position starter caps to LeagueSettings (Phase 5) instead of approximating with flex slots?");
  cl.question("OK to follow MFL's own \"don't retry\" rule for MFL hosts as an exception to §0.9's exponential backoff?");
}
