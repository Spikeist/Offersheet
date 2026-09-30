/**
 * Phase 0 probe: Fantrax (CLAUDE.md §2.7; stretch goal, public leagues only).
 *
 *   npm run probe:fantrax
 *
 * Always: Fantrax's API docs (go-fantrax README, LeagueInfo struct, repo tree; 7-day docs cache),
 * the league-independent endpoints getPlayerIds and getAdp (shape, counts, ID formats), the
 * Fantrax → Sleeper / DynastyProcess / FantasyCalc crosswalk, and the error convention
 * (getLeagueInfo with an obviously invalid league ID, once). With FANTRAX_LEAGUE_ID set it also
 * reads getLeagueInfo, getTeamRosters, getStandings and getDraftPicks and checks items A–M,
 * including whether scoring rules are exposed. A–M logic: scripts/lib/fantrax/checks.ts.
 */
import { TTL } from "./lib/cache";
import type { Evidence } from "./lib/checklist";
import { fantasyCalcUrl, getFantasyCalc, type FcFormat } from "./lib/fantasycalc";
import { FANTRAX_BASE, NO_ADP, AdpEntry, PlayerIdRecord, TEAM_PLAYER_FORMAT_POSITIONS, fantraxCacheable, fantraxError, fantraxUrl, isRecord, nflTeamOf, recordKind, type FantraxAdp, type FantraxPlayer } from "./lib/fantrax/api";
import { leagueChecks, leagueUrl, noLeagueChecks, docsSummary, type CheckSpec } from "./lib/fantrax/checks";
import { SKILL, buildDpIndex, buildSleeperIndex, crosswalkMany, emptySleeperIndex, onTeamPlayers, pct, realPlayers, summarizeAdp, summarizePlayerIds, topSkillFromAdp, type DpIndex, type SleeperIndex } from "./lib/fantrax/crosswalk";
import { GO_FANTRAX_LEAGUE_INFO_URL, GO_FANTRAX_README_URL, GO_FANTRAX_TREE_URL, areaText, documentedParams, parseLeagueInfoGo, parseReadme, parseTree, type FantraxDocFacts } from "./lib/fantrax/docs";
import { LEAGUE_ENDPOINTS, countBy, protectLeaguePath, registerLeagueIdentities, type LeagueEndpoint } from "./lib/fantrax/league";
import { DP_IDMAP_URL, fantraxPublicCache, fetchDpIdMap } from "./lib/fantrax/sources";
import type { HttpResult, RequestOptions } from "./lib/http";
import { runProbe, type ProbeContext } from "./lib/probe";
import { buildPublicNames, isPlayerName, type PublicNames } from "./lib/public-names";
import { SLEEPER_PLAYERS_URL, getSleeperPlayers } from "./lib/sleeper-players";

const SEASON = 2026;
const INVALID_LEAGUE_ID = "probe-invalid-league-id-000";
/** The most common redraft format; FantasyCalc is fetched at most once per format per day (shared cache). */
const FC_FORMAT: FcFormat = { isDynasty: false, numQbs: 1, numTeams: 12, ppr: 1 };
const SKILL_K = new Set([...SKILL, "K"]);
/** The endpoints CLAUDE.md §2.7 lists, to compare with the documented API. */
const SPEC_ENDPOINTS = ["getLeagueInfo", "getTeamRosters", "getStandings", "getDraftPicks", "getPlayerIds", "getAdp"];

interface Crosswalk {
  sleeper?: SleeperIndex;
  dp?: DpIndex;
  /** Sleeper ids that have a FantasyCalc value in FC_FORMAT. */
  fc?: Set<string>;
  fcFields?: string[];
  fcStatus?: number;
  publicNames?: PublicNames;
  /** QB/RB/WR/TE/K on NFL teams mapped to a Sleeper id (for J). */
  deep?: { matched: number; n: number };
  top?: { matched: number; n: number; byVia: string };
}

/** Sanitized fixtures written this run, and the player names inside them (for the leak-review note). */
interface Saved {
  label: string;
  url?: string;
}

const contentTypeNote = (res: HttpResult) => `served as ${res.contentType || "no content-type"}${/json/i.test(res.contentType) ? "" : "; parse the body as JSON regardless"}`;
const docsCache = (url: string): Pick<RequestOptions, "cache" | "cacheIf"> => ({ cache: { key: `fantrax-docs:${url}`, ttlMs: TTL.docs, namespace: "docs" }, cacheIf: (r) => r.status === 200 });

function applySpecs(p: ProbeContext, specs: CheckSpec[]): void {
  for (const s of specs) p.cl.add(s.item, s.key, s.title, s.status, s.summary, ...s.evidence.map((e) => (e.sample === undefined ? e : { ...e, sample: p.redactor.apply(e.sample) })));
}

// -------------------------------------------------------------------------------------------------
// Fantrax API docs (go-fantrax mirrors Fantrax's beta API docs)

async function readDocs(p: ProbeContext): Promise<FantraxDocFacts> {
  const facts: FantraxDocFacts = {};
  const get = async (url: string, label: string, headers?: Record<string, string>): Promise<HttpResult | string> => {
    try {
      const res = await p.timed(label, () => p.request(url, { ...docsCache(url), headers, label }));
      return res.status === 200 ? res : `HTTP ${res.status}`;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };
  const readme = await get(GO_FANTRAX_README_URL, "go-fantrax README");
  if (typeof readme !== "string") facts.readme = { ...parseReadme(readme.text), url: GO_FANTRAX_README_URL, status: readme.status };
  const li = await get(GO_FANTRAX_LEAGUE_INFO_URL, "go-fantrax league_info.go");
  if (typeof li !== "string") {
    const parsed = parseLeagueInfoGo(li.text);
    if (parsed.keys.length) facts.leagueInfo = { ...parsed, url: GO_FANTRAX_LEAGUE_INFO_URL, status: li.status };
  }
  const tree = await get(GO_FANTRAX_TREE_URL, "go-fantrax repo tree", { Accept: "application/vnd.github+json" });
  if (typeof tree !== "string") {
    const parsed = parseTree(tree.json);
    if (parsed) facts.tree = { ...parsed, url: GO_FANTRAX_TREE_URL, status: tree.status };
  }

  const sum = docsSummary(facts);
  const cached = (r: HttpResult | string) => (typeof r !== "string" && r.fromCache ? "7-day docs cache" : undefined);
  if (facts.readme && sum.readme)
    p.cl.ok("DOCS", "DOCS.readme", "Documented endpoints (go-fantrax README)", sum.readme, {
      url: GO_FANTRAX_README_URL,
      status: facts.readme.status,
      path: "### <section> → - URL: …/fxea/general/<endpoint>, - `<param>`",
      sample: facts.readme.sections.map((s) => `${s.endpoint ?? "?"}(${s.params.join(",")})`),
      note: cached(readme),
    });
  else p.cl.warn("DOCS", "DOCS.readme", "Documented endpoints (go-fantrax README)", `not read: ${typeof readme === "string" ? readme : "no endpoints found"}`, { url: GO_FANTRAX_README_URL });
  if (facts.leagueInfo && sum.leagueInfo)
    p.cl.ok("DOCS", "DOCS.leagueInfo", "getLeagueInfo response struct (go-fantrax)", sum.leagueInfo, { url: GO_FANTRAX_LEAGUE_INFO_URL, status: facts.leagueInfo.status, path: "type LeagueInfo struct json tags", sample: facts.leagueInfo.keys, note: cached(li) });
  else p.cl.warn("DOCS", "DOCS.leagueInfo", "getLeagueInfo response struct (go-fantrax)", `not read: ${typeof li === "string" ? li : "no LeagueInfo struct found"}`, { url: GO_FANTRAX_LEAGUE_INFO_URL });
  if (facts.tree && sum.tree)
    p.cl.ok("DOCS", "DOCS.tree", "Where go-fantrax reads transactions", sum.tree, { url: GO_FANTRAX_TREE_URL, status: facts.tree.status, path: "tree[].path matching /transaction|trade/", sample: facts.tree.transactionFiles, note: cached(tree) });
  else p.cl.warn("DOCS", "DOCS.tree", "Where go-fantrax reads transactions", `not read: ${typeof tree === "string" ? tree : "no tree in the response"}`, { url: GO_FANTRAX_TREE_URL });
  return facts;
}

// -------------------------------------------------------------------------------------------------
// getPlayerIds

async function checkPlayerIds(p: ProbeContext): Promise<{ ids: Record<string, FantraxPlayer>; res?: HttpResult }> {
  const url = fantraxUrl("getPlayerIds", { sport: "NFL" });
  const safe = p.safeUrl(url);
  const res = await p.timed("getPlayerIds", () => p.request(url, { cache: fantraxPublicCache(url), cacheIf: fantraxCacheable, timeoutMs: 120_000, label: "Fantrax getPlayerIds NFL" }));
  const err = fantraxError(res.json);
  if (!res.ok || !isRecord(res.json) || err) {
    const why = err ? `error object at ${err.path}: ${err.message ?? err.keys.join(",")}` : `HTTP ${res.status}${res.isHtml ? " (HTML page)" : ""}, body is not a JSON object`;
    p.cl.fail("API", "API.playerIds", "getPlayerIds?sport=NFL", why, { url: safe, status: res.status, sample: { contentType: res.contentType } });
    return { ids: {} };
  }
  await p.saveRaw("getPlayerIds?sport=NFL", res.json, res);

  // Parse record by record so one odd entry can't hide the rest; collect the raw field names too.
  const ids: Record<string, FantraxPlayer> = {};
  const bad: string[] = [];
  const fields = { player: new Set<string>(), unit: new Set<string>() };
  for (const [key, v] of Object.entries(res.json)) {
    const r = PlayerIdRecord.safeParse(v);
    if (r.success) ids[key] = r.data;
    else bad.push(`${key}: ${r.error.issues.map((i) => i.path.join(".") || "(root)").join(",")}`);
    if (isRecord(v)) for (const k of Object.keys(v)) (/#/.test(key) ? fields.unit : fields.player).add(k);
  }
  const s = summarizePlayerIds(ids);
  const players = s.byKind.player;
  const tpf = s.byKind.teamPlayerFormat;
  const example = Object.values(ids).find((x) => x.name === "Mahomes, Patrick") ?? Object.values(ids).find((x) => SKILL.has(x.position) && nflTeamOf(x));
  const unitExample = Object.entries(ids).find(([k, x]) => recordKind(k, x) === "teamUnit" && x.position === "DST")?.[1];
  const tpfExample = Object.entries(ids).find(([k, x]) => recordKind(k, x) === "teamPlayerFormat")?.[1];
  const base: Evidence = { url: safe, status: res.status };
  const shape = "{fantraxId} → {fantraxId, name, team, position, sportRadarId?, rotowireId?, statsIncId?}";

  const summary = `${s.total} records: ${players} players + ${tpf} team K/QB units with player-format ids (TK/TQB) + ${s.byKind.teamUnit} '#' team units${s.byKind.other ? ` + ${s.byKind.other} other` : ""}; ${contentTypeNote(res)}${res.fromCache ? " (24 h cache)" : ""}`;
  const parsedNote = bad.length ? `${bad.length} records failed the schema, e.g. ${bad.slice(0, 3).join("; ")}` : "every record matched the schema";
  p.cl.add("API", "API.playerIds", "getPlayerIds?sport=NFL", bad.length ? "warn" : "ok", summary, { ...base, path: shape, sample: example, note: parsedNote });

  const unitText = Object.entries(s.unitCodes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, pos]) => `${code}=${pos}`)
    .join(", ");
  const tpfPositions = Object.entries(s.teamPlayerFormat.positions).map(([pos, n]) => `${pos} ${n}`);
  const idSummary =
    `players: 5 lowercase base-36 chars (${example?.fantraxId ?? "?"}); team units: "<teamId>#<unitCode>" (${unitText}), plus ${tpf} team units that use player-format ids (${tpfPositions.join(", ") || "none"}; e.g. "${s.teamPlayerFormat.example ?? "?"}"; ${s.teamPlayerFormat.withVendorIds} with a vendor id): classify by position as well as by id; ` +
    `${s.keyMismatches ? `${s.keyMismatches} keys differ from fantraxId` : "every key equals its fantraxId"}${s.suspectTeamRecords ? `; ${s.suspectTeamRecords} other player-format records are named "Team …" without vendor ids (a new team-level position?)` : ""}`;
  const idEvidence: Evidence[] = [
    { ...base, path: "keys of the root object; {fantraxId}.fantraxId", sample: unitExample, note: `'#' unit fields: ${[...fields.unit].join(", ")}; player fields: ${[...fields.player].join(", ")}` },
    { path: "TK/TQB records (player-format ids)", sample: tpfExample },
  ];
  p.cl.add("API", "API.playerIds.idFormat", "Fantrax player ID format", s.keyMismatches || s.byKind.other || s.suspectTeamRecords ? "warn" : "ok", idSummary, ...idEvidence);

  const f = s.fill.skillOnTeam;
  const a = s.fill.all;
  p.cl.ok(
    "API",
    "API.playerIds.vendorIds",
    "Vendor IDs for crosswalks",
    `QB/RB/WR/TE on NFL teams (${f.n}): sportRadarId ${pct(f.sportRadarId, f.n)}, rotowireId ${pct(f.rotowireId, f.n)}, statsIncId ${pct(f.statsIncId, f.n)}, none ${f.none}; all ${a.n} players (team units excluded): ${pct(a.sportRadarId, a.n)} / ${pct(a.rotowireId, a.n)} / ${pct(a.statsIncId, a.n)}`,
    { ...base, path: "{fantraxId}.sportRadarId (GUID) / .rotowireId (int) / .statsIncId (int)", sample: example && { sportRadarId: example.sportRadarId, rotowireId: example.rotowireId, statsIncId: example.statsIncId } },
  );

  const topPositions = Object.entries(s.positions)
    .sort(([, x], [, y]) => y - x)
    .map(([pos, n]) => `${pos} ${n}`)
    .join(", ");
  const teamValues = new Set(realPlayers(ids).map((x) => x.team ?? "(none)"));
  const abbrevs = [...teamValues].filter((t) => /^[A-Z]{2,3}$/.test(t));
  const otherTeams = [...teamValues].filter((t) => !/^[A-Z]{2,3}$/.test(t) && t !== "(N/A)");
  const statusLike = [...fields.player].filter((k) => /injur|status|age|birth|bye/i.test(k));
  p.cl.ok(
    "API",
    "API.playerIds.fields",
    "Player fields",
    `name is "Last, First" for ${s.lastCommaFirst} of ${players} players; team is one of ${abbrevs.length} NFL abbreviations or "(N/A)" (${s.noNflTeam} players)${otherTeams.length ? ` or ${otherTeams.length} other values (${otherTeams.slice(0, 3).join(", ")})` : ""}; ${s.defaultPosition} players have position "Default"; ${statusLike.length ? `status-like fields: ${statusLike.join(", ")}` : "no injury, status, age or bye field"} (player fields: ${[...fields.player].join(", ")})`,
    { ...base, path: "{fantraxId}.name / .team / .position", sample: topPositions, note: `team-unit positions: ${Object.values(s.unitCodes).join(", ")} ('#' ids) and ${Object.keys(s.teamPlayerFormat.positions).join(", ") || "none"} (player-format ids)` },
  );
  return { ids, res };
}

/** Sanitized fixture: public player data only, trimmed to what adapters and tests need (ADP players, fantasy positions on NFL teams, team units). */
async function saveTrimmedPlayerIds(p: ProbeContext, ids: Record<string, FantraxPlayer>, adp: FantraxAdp[], res: HttpResult, saved: Saved[]): Promise<string[]> {
  const inAdp = new Set(adp.map((e) => e.id));
  const keep = Object.fromEntries(Object.entries(ids).filter(([key, x]) => recordKind(key, x) !== "player" || inAdp.has(key) || (SKILL_K.has(x.position) && nflTeamOf(x) !== null)));
  const label = "getPlayerIds?sport=NFL (trimmed: ADP players, QB/RB/WR/TE/K on NFL teams, team units)";
  await p.saveSanitized(label, keep, res);
  saved.push({ label, url: p.safeUrl(res.url) });
  return Object.entries(keep)
    .filter(([key, x]) => recordKind(key, x) === "player")
    .map(([, x]) => x.name);
}

// -------------------------------------------------------------------------------------------------
// getAdp

async function checkAdp(p: ProbeContext, ids: Record<string, FantraxPlayer>, facts: FantraxDocFacts, saved: Saved[]): Promise<{ adp: FantraxAdp[]; names: string[] }> {
  const url = fantraxUrl("getAdp", { sport: "NFL" });
  const safe = p.safeUrl(url);
  const res = await p.timed("getAdp", () => p.request(url, { cache: fantraxPublicCache(url), cacheIf: fantraxCacheable, timeoutMs: 120_000, label: "Fantrax getAdp NFL" }));
  const err = fantraxError(res.json);
  if (!res.ok || !Array.isArray(res.json) || err) {
    const why = err ? `error object at ${err.path}: ${err.message ?? err.keys.join(",")}` : `HTTP ${res.status}, body is not a JSON array`;
    p.cl.fail("API", "API.adp", "getAdp?sport=NFL", why, { url: safe, status: res.status, sample: { contentType: res.contentType } });
    return { adp: [], names: [] };
  }
  await p.saveRaw("getAdp?sport=NFL", res.json, res);
  const adp: FantraxAdp[] = [];
  let bad = 0;
  for (const v of res.json) {
    const r = AdpEntry.safeParse(v);
    if (r.success) adp.push(r.data);
    else bad++;
  }
  const dstCode = Object.entries(summarizePlayerIds(ids).unitCodes).find(([, pos]) => pos === "DST")?.[0];
  const s = summarizeAdp(adp, ids, dstCode);
  const top = [...adp].filter((e) => e.ADP_PPR !== undefined && e.ADP_PPR < NO_ADP).sort((x, y) => (x.ADP_PPR ?? NO_ADP) - (y.ADP_PPR ?? NO_ADP));
  const base: Evidence = { url: safe, status: res.status };
  const params = documentedParams(facts.readme, "getAdp");
  p.cl.add(
    "API",
    "API.adp",
    "getAdp?sport=NFL",
    bad ? "warn" : "ok",
    `${s.total} entries (${s.players} players + ${s.teamPlayerFormat} TK/TQB team units + ${s.teamDefenses} team defenses); ADP_PPR on ${s.withAdpPpr} (${s.realAdpPpr} real), ADP on ${s.withAdp} (${s.realAdp} real; ${NO_ADP} = none); order: ${s.order}; ${contentTypeNote(res)}${bad ? `; ${bad} entries failed the schema` : ""}`,
    {
      ...base,
      path: "[] {id, name, pos, ADP_PPR, ADP} (team defenses: {id, tmId, name}, no pos)",
      sample: top.slice(0, 3),
      note: `only sport=NFL sent; the call returned this many entries${params ? ` (documented params: ${params.join(", ")})` : ""}`,
    },
    { path: "[] with tmId", sample: adp.find((e) => e.tmId) },
  );
  const withIds = s.total - s.teamDefenses;
  const joinSummary = `players and TK/TQB units: ${s.joined}/${withIds} ids are getPlayerIds keys; team defenses: ${s.teamJoined}/${s.teamDefenses} match "<id>#${dstCode ?? "?"}" (DST unit)`;
  const joinEv: Evidence = { ...base, path: '[].id → getPlayerIds key; [].tmId "TM_<id>"', sample: s.unmatchedIds.slice(0, 5), note: "sample = unmatched ids" };
  p.cl.add("API", "API.adp.join", "ADP ids join to getPlayerIds", s.unmatchedIds.length ? "warn" : "ok", joinSummary, joinEv);
  const nameSummary = `${s.nameDiffs} of ${s.joined} joined entries are spelled differently than in getPlayerIds (${s.nameDiffsNormalized} still differ after ignoring case and punctuation, e.g. apostrophes): join on id, never on name`;
  // Punctuation-only differences are harmless once we join on id; real spelling differences would matter for manual import matching.
  p.cl.add("API", "API.adp.names", "ADP names vs player-ID names", s.nameDiffsNormalized ? "warn" : "ok", nameSummary, { ...base, path: "[].name vs getPlayerIds {id}.name", sample: s.nameDiffExamples });
  await p.saveSanitized("getAdp?sport=NFL", res.json, res);
  saved.push({ label: "getAdp?sport=NFL", url: safe });
  const names = adp.filter((e) => !e.tmId && e.pos !== undefined && !TEAM_PLAYER_FORMAT_POSITIONS.has(e.pos)).map((e) => e.name);
  return { adp, names };
}

// -------------------------------------------------------------------------------------------------
// Crosswalk: Fantrax → Sleeper / DynastyProcess / FantasyCalc

const dupCount = (m: Map<string, string[]>) => [...m.values()].filter((l) => l.length > 1).length;

async function checkCrosswalk(p: ProbeContext, ids: Record<string, FantraxPlayer>, adp: FantraxAdp[]): Promise<Crosswalk> {
  const cw: Crosswalk = {};
  const top = topSkillFromAdp(adp, ids);
  const deep = onTeamPlayers(ids, SKILL_K);

  try {
    const { data } = await p.timed("Sleeper players DB", () => getSleeperPlayers());
    cw.sleeper = buildSleeperIndex(data);
    cw.publicNames = buildPublicNames(data);
  } catch (err) {
    p.cl.fail("API", "API.idmap.sleeper", "Fantrax → Sleeper IDs", `Sleeper players DB unavailable: ${err instanceof Error ? err.message : String(err)}`, { url: SLEEPER_PLAYERS_URL });
  }
  try {
    const { rows, res } = await p.timed("DynastyProcess ID map", () => fetchDpIdMap());
    if (rows.length) cw.dp = buildDpIndex(rows);
    else p.cl.fail("API", "API.idmap.dynastyprocess", "DynastyProcess crosswalk", `no rows (HTTP ${res.status})`, { url: DP_IDMAP_URL, status: res.status });
  } catch (err) {
    p.cl.fail("API", "API.idmap.dynastyprocess", "DynastyProcess crosswalk", `ID map unavailable: ${err instanceof Error ? err.message : String(err)}`, { url: DP_IDMAP_URL });
  }
  if (!top.length) {
    p.cl.fail("API", "API.idmap.sleeper", "Fantrax → Sleeper IDs", "no top-ADP players to test (getAdp or getPlayerIds failed)");
    return cw;
  }

  if (cw.dp) {
    const fantraxCols = cw.dp.columns.filter((c) => /fantrax|ftx/i.test(c));
    const dpOnly = crosswalkMany(top, emptySleeperIndex(), cw.dp);
    const summary = `${fantraxCols.length ? `has ${fantraxCols.join(", ")}` : `no Fantrax column (${cw.dp.columns.length} columns checked)`}; joinable through the vendor IDs: of ${top.length} top-ADP QB/RB/WR/TE, ${dpOnly.inDp} (${pct(dpOnly.inDp, top.length)}) are in DynastyProcess and ${dpOnly.dpWithSleeper}/${top.length} (${pct(dpOnly.dpWithSleeper, top.length)}) get a sleeper_id through it`;
    p.cl.ok("API", "API.idmap.dynastyprocess", "DynastyProcess crosswalk", summary, {
      url: DP_IDMAP_URL,
      status: 200,
      path: "db_playerids.csv header; join sportRadarId→sportradar_id, rotowireId→rotowire_id, statsIncId→stats_id",
      sample: cw.dp.columns.filter((c) => /_id$/.test(c)),
      note: `vendor ids on more than one row: sportradar_id ${dupCount(cw.dp.bySportradar)}, rotowire_id ${dupCount(cw.dp.byRotowire)}, stats_id ${dupCount(cw.dp.byStats)}`,
    });
  }

  if (cw.sleeper) {
    const t = crosswalkMany(top, cw.sleeper, cw.dp);
    const d = crosswalkMany(deep, cw.sleeper, cw.dp);
    const union = [...new Map([...top, ...deep].map((x) => [x.fantraxId, x])).values()];
    const u = crosswalkMany(union, cw.sleeper, cw.dp);
    const via = Object.entries(t.byVia)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ");
    cw.deep = { matched: d.matched, n: d.n };
    cw.top = { matched: t.matched, n: t.n, byVia: via };
    const conflictText = u.conflicts
      ? `${u.conflicts} players had more than one candidate id (${u.duplicateKeys} through a vendor id on several rows); the kept id is the only plausible one (real row, position + team agree) in ${u.conflictsKeptRight} of them${u.ambiguous ? `; ${u.ambiguous} stayed a tie` : ""}`
      : "no disagreeing candidates";
    const summary =
      `top-ADP QB/RB/WR/TE: ${t.matched}/${t.n} (${pct(t.matched, t.n)}) mapped to a Sleeper id (first hit: ${via}); all QB/RB/WR/TE/K on NFL teams: ${d.matched}/${d.n} (${pct(d.matched, d.n)}); ` +
      `sanity check on ${u.checked} matches: Sleeper position agrees ${pct(u.positionAgrees, u.checked)}, NFL team ${pct(u.teamAgrees, u.checked)}; ${conflictText}`;
    const ev: Evidence[] = [
      { url: SLEEPER_PLAYERS_URL, status: 200, path: "Sleeper players DB {id}.sportradar_id / .rotowire_id", sample: "Fantrax sportRadarId = Sleeper sportradar_id; Fantrax rotowireId = Sleeper rotowire_id" },
      {
        path: "conflicts (kept = most plausible candidate)",
        sample: u.conflictDetails.slice(0, 5),
        note: `Sleeper ids on more than one row: sportradar_id ${dupCount(cw.sleeper.bySportradar)}, rotowire_id ${dupCount(cw.sleeper.byRotowire)} ("Duplicate Player" / "Player Invalid" rows and true duplicates); every candidate is kept and ranked`,
      },
      { path: "misses (top-ADP, then deep)", sample: [...t.misses.slice(0, 5), ...d.misses.slice(0, 5)] },
      {
        path: "position/team disagreements (sample)",
        sample: u.disagreements.slice(0, 6),
        note: `${u.positionOnlyDiffs} position only, ${u.teamOnlyDiffs} NFL team only, ${u.bothDiffs} both; the vendor id names the same person either way, so lineup eligibility must come from the league platform, not Sleeper`,
      },
    ];
    const clean = t.rate >= 0.98 && d.rate >= 0.95 && u.conflictsKeptRight === u.conflicts && u.ambiguous === 0 && u.positionAgrees / Math.max(1, u.checked) >= 0.99;
    p.cl.add("API", "API.idmap.sleeper", "Fantrax → Sleeper IDs", clean ? "ok" : "warn", summary, ...ev);

    try {
      const { data: fc, res } = await p.timed("FantasyCalc", () => getFantasyCalc(FC_FORMAT));
      cw.fc = new Set(fc.map((e) => e.player.sleeperId).filter((v): v is string => typeof v === "string" && v !== ""));
      cw.fcStatus = res.status;
      const fields = [...new Set(fc.flatMap((e) => Object.keys(e.player)))];
      cw.fcFields = fields;
      const fantraxFields = fields.filter((f) => /fantrax/i.test(f));
      // Reverse coverage: can every player FantasyCalc values be reached from some Fantrax id?
      const reachable = new Set(crosswalkMany(realPlayers(ids), cw.sleeper, cw.dp).sleeperIds);
      const fcReached = fc.filter((e) => reachable.has(String(e.player.sleeperId ?? ""))).length;
      const top200 = t.sleeperIds.slice(0, 200);
      const inFc = top200.filter((id) => cw.fc?.has(id)).length;
      // Why are some top-200 players missing? Injured/inactive per Sleeper, and where the rest rank by Fantrax ADP.
      const missing = top200.map((id, i) => ({ id, rank: i + 1 })).filter((x) => !cw.fc?.has(x.id));
      const isHurt = (id: string) => {
        const i = cw.sleeper?.info.get(id);
        return i?.status === "Inactive" || ["IR", "Out", "PUP", "Sus", "NA"].includes(i?.injury ?? "");
      };
      const hurt = missing.filter((x) => isHurt(x.id)).length;
      const healthyRanks = missing.filter((x) => !isHurt(x.id)).map((x) => x.rank);
      const rankText = healthyRanks.length ? `the other ${healthyRanks.length} rank #${Math.min(...healthyRanks)}–#${Math.max(...healthyRanks)} among Fantrax-ADP QB/RB/WR/TE` : "none of the others are missing";
      const byPos = Object.entries(countBy(fc, (e) => e.player.position))
        .map(([k, n]) => `${k} ${n}`)
        .join(", ");
      const fcSummary =
        `${fantraxFields.length ? `has ${fantraxFields.join(", ")}` : "no Fantrax id in FantasyCalc"}; joining on sleeperId reaches ${fcReached}/${fc.length} (${pct(fcReached, fc.length)}) of the players FantasyCalc values. ` +
        `This redraft format lists ${fc.length} players (${byPos}), so ${inFc}/${top200.length} of the top-200 Fantrax-ADP QB/RB/WR/TE have a value (${hurt} of the ${missing.length} without one are injured or inactive per Sleeper; ${rankText}); uncovered players get config.valueFloor (§9)`;
      const fcEv: Evidence = { url: fantasyCalcUrl(FC_FORMAT), status: res.status, path: "[].player.sleeperId", sample: fields.filter((x) => /id$/i.test(x)), note: "Trade values: FantasyCalc (https://fantasycalc.com); non-commercial, ≤ 1 fetch per format per day" };
      p.cl.add("API", "API.idmap.fantasycalc", "Fantrax → FantasyCalc (via Sleeper id)", fcReached / Math.max(1, fc.length) >= 0.98 ? "ok" : "warn", fcSummary, fcEv);
      if (inFc / Math.max(1, top200.length) < 0.98) {
        p.cl.issue(
          `FantasyCalc coverage (not Fantrax-specific) — ${fantasyCalcUrl(FC_FORMAT)} HTTP ${res.status} — [].player has ${fc.length} entries (${byPos}); ${missing.length} of the top-200 Fantrax-ADP QB/RB/WR/TE have no value (${hurt} injured or inactive per Sleeper; ${rankText}) — ` +
            "options: (a) treat uncovered players as config.valueFloor and measure item M only on covered starters, (b) fall back to dynasty values for redraft players missing from the redraft list, (c) keep the ≥ 98% target and report misses.",
        );
      }
      if (!fantraxFields.length && cw.dp && !cw.dp.columns.some((c) => /fantrax|ftx/i.test(c))) {
        p.cl.issue(
          `§2.9's crosswalk sources can't map Fantrax players — FantasyCalc ${fantasyCalcUrl(FC_FORMAT)} HTTP ${res.status}: [].player fields ${fields.filter((x) => /id$/i.test(x)).join(", ")} (no Fantrax id); DynastyProcess ${DP_IDMAP_URL}: ${cw.dp.columns.length} columns, none for Fantrax — ` +
            `what works is getPlayerIds' vendor ids: ${t.matched}/${t.n} top-ADP QB/RB/WR/TE and ${d.matched}/${d.n} QB/RB/WR/TE/K on NFL teams map to a Sleeper id (${via}) — ` +
            "options: (a) the Phase 5 Fantrax adapter uses this vendor-id route (sportRadarId first, rotowireId fallback, duplicates ranked; scripts/lib/fantrax/crosswalk.ts); (b) name matching (rejected: getAdp and getPlayerIds already disagree on spellings).",
        );
      }
    } catch (err) {
      p.cl.warn("API", "API.idmap.fantasycalc", "Fantrax → FantasyCalc (via Sleeper id)", `FantasyCalc unavailable: ${err instanceof Error ? err.message : String(err)}`, { url: fantasyCalcUrl(FC_FORMAT) });
    }
  }
  return cw;
}

// -------------------------------------------------------------------------------------------------
// Error convention

async function checkErrors(p: ProbeContext, saved: Saved[]): Promise<void> {
  const url = fantraxUrl("getLeagueInfo", { leagueId: INVALID_LEAGUE_ID });
  const safe = p.safeUrl(url);
  let res: HttpResult;
  try {
    // Once, no retries; the 10-minute league cache keeps repeated runs from calling again. The
    // default cacheIf keeps this (expected) HTTP-200 error body; data calls use fantraxCacheable.
    res = await p.timed("getLeagueInfo (invalid id)", () => p.request(url, { retries: 0, cache: p.leagueCache(url), label: "Fantrax getLeagueInfo (invalid league id)" }));
  } catch (err) {
    p.cl.fail("API", "API.errors", "Error convention (invalid league ID)", `request failed: ${err instanceof Error ? err.message : String(err)}`, { url: safe });
    return;
  }
  const body = res.json ?? res.text;
  await p.saveRaw(`getLeagueInfo?leagueId=${INVALID_LEAGUE_ID}`, body, res);
  const label = `getLeagueInfo?leagueId=${INVALID_LEAGUE_ID} (error convention)`;
  await p.saveSanitized(label, body, res, undefined, res.json === undefined ? ".txt" : undefined);
  saved.push({ label, url: safe });
  const err = fantraxError(res.json);
  const topKeys = isRecord(res.json) ? Object.keys(res.json) : [Array.isArray(res.json) ? "(array)" : res.json === undefined ? "(not JSON)" : typeof res.json];
  const ev: Evidence = { url: safe, status: res.status, path: err ? `${err.path} {${err.keys.join(", ")}}` : "(root)", sample: err ? { code: err.code, message: err.message } : { topLevelKeys: topKeys }, note: `content-type ${res.contentType || "(none)"}` };
  if (res.status === 200 && err) p.cl.ok("API", "API.errors", "Error convention (invalid league ID)", `confirmed: HTTP 200 (${res.contentType || "no content-type"}) with an error object at "${err.path}"; check the body, not the status`, ev);
  else if (err) p.cl.warn("API", "API.errors", "Error convention (invalid league ID)", `HTTP ${res.status} (not 200) with an error object at "${err.path}"`, ev);
  else p.cl.warn("API", "API.errors", "Error convention (invalid league ID)", `HTTP ${res.status} without a top-level error field (keys: ${topKeys.join(", ")}); §2.7's "200 + error object" not seen`, ev);
}

// -------------------------------------------------------------------------------------------------
// Committed fixtures: public data only (explains check:leaks soft hits in them)

function checkFixtures(p: ProbeContext, saved: Saved[], names: string[], publicNames: PublicNames | undefined): void {
  const leagueFixtures = saved.filter((s) => s.label.includes("{leagueId}"));
  const publicFixtures = saved.filter((s) => !s.label.includes("{leagueId}"));
  const withLeagueParam = publicFixtures.filter((s) => /leagueId=/.test(`${s.label} ${s.url ?? ""}`) && !`${s.label} ${s.url ?? ""}`.includes(INVALID_LEAGUE_ID));
  const unique = [...new Set(names)];
  const unrecognized = publicNames ? unique.filter((n) => !isPlayerName(n, publicNames)).length : undefined;
  const namesText =
    unrecognized === undefined
      ? "Sleeper players DB unavailable, so name recognition wasn't measured"
      : `${unrecognized} of ${unique.length} player names in them aren't spelled as in Sleeper's DB (or the player isn't in it), so check:leaks' NFL-name discount can't recognize them: a real-name soft hit it lists in these files is a word inside a public player's name, not a leaguemate`;
  const summary = `${publicFixtures.length} sanitized fixtures from league-independent public endpoints (no league ID or credentials sent; the error-convention call uses the made-up ID ${INVALID_LEAGUE_ID})${leagueFixtures.length ? ` + ${leagueFixtures.length} league fixtures (placeholders only)` : ""}; ${namesText}`;
  const ev: Evidence = { path: "fixtures/sanitized/fantrax/index.json labels", sample: saved.map((s) => s.label) };
  if (withLeagueParam.length) p.cl.fail("FIX", "FIX.public", "Committed fixtures: public data only", `${withLeagueParam.length} public-endpoint fixtures carry a league ID in their label or URL`, ev);
  else p.cl.ok("FIX", "FIX.public", "Committed fixtures: public data only", summary, ev);
}

// -------------------------------------------------------------------------------------------------
// Spec comparisons that need only the docs

function docIssues(p: ProbeContext, facts: FantraxDocFacts, leagueTested: boolean): void {
  const r = facts.readme;
  if (r) {
    const extra = r.endpoints.filter((e) => !SPEC_ENDPOINTS.includes(e));
    const notDocumented = SPEC_ENDPOINTS.filter((e) => !r.endpoints.includes(e));
    const tx = r.endpoints.filter((e) => /transaction|trade/i.test(e));
    const txTree = facts.tree
      ? facts.tree.publicTransactionFiles.length
        ? `; but go-fantrax's root-level public bindings mention transactions (${facts.tree.publicTransactionFiles.join(", ")})`
        : `; go-fantrax's transaction code is all outside its root-level public-API bindings (${areaText(facts.tree)})`
      : "";
    if (extra.length || notDocumented.length || !tx.length) {
      p.cl.issue(
        `§2.7's Fantrax endpoint list vs the documented API — ${GO_FANTRAX_README_URL} HTTP ${r.status}${r.currentAsOf ? ` (current as of ${r.currentAsOf})` : ""}: ${r.endpoints.join(", ")} — ` +
          `${extra.length ? `not in §2.7: ${extra.map((e) => `${e}(${documentedParams(r, e)?.join(", ") ?? ""})`).join(", ")}${extra.includes("getLeagues") ? " (a per-user secret; the only documented way to find the user's own team)" : ""}; ` : ""}` +
          `${notDocumented.length ? `in §2.7 but not documented: ${notDocumented.join(", ")}; ` : ""}` +
          `${tx.length ? "" : `no transactions endpoint${txTree}, so item G is unavailable for Fantrax`} (docs only, not probed live) — ` +
          "options: (a) 'my team': the user picks their team (no new secret); (b) accept userSecretId as a Phase 5 session-only credential (§3) to list the user's leagues and teams; (c) item G: the acceptance model's activity (a) and hist features default to 0 / unused for Fantrax.",
      );
    }
  }
  if (!leagueTested) {
    const li = facts.leagueInfo;
    p.cl.issue(
      `§2.7's open question (are scoring rules exposed?) is unanswered: no public Fantrax league to test — ${leagueUrl("getLeagueInfo")} — ${
        li ? `go-fantrax's LeagueInfo struct (${li.url} HTTP ${li.status}) ${li.keys.includes("scoringSystem") ? `declares scoringSystem with configs {${li.scoringConfigFields.join(", ")}}` : "has no scoringSystem key"}` : "Fantrax docs not read this run"
      } — options: (a) Parker supplies a public Fantrax NFL league ID (FANTRAX_LEAGUE_ID) and the probe answers it; (b) keep Fantrax a stretch goal with preset scoring (§2.8) until verified.`,
    );
  }
}

// -------------------------------------------------------------------------------------------------
// League (only when FANTRAX_LEAGUE_ID is set)

async function checkLeague(p: ProbeContext, leagueId: string, ids: Record<string, FantraxPlayer>, cw: Crosswalk, facts: FantraxDocFacts, saved: Saved[]): Promise<void> {
  const tmpl = (e: LeagueEndpoint) => `${FANTRAX_BASE}${e}?leagueId={leagueId}`;
  const docs: Partial<Record<LeagueEndpoint, unknown>> = {};
  const failures: Partial<Record<LeagueEndpoint, string>> = {};
  const responses: Partial<Record<LeagueEndpoint, HttpResult>> = {};

  // Fetch everything first and register identities before any line that could echo them is printed.
  for (const e of LEAGUE_ENDPOINTS) {
    const url = fantraxUrl(e, { leagueId });
    try {
      // Never cache an HTTP-200 error body (a private league or a typo would stick for 10 minutes).
      const res = await p.timed(e, () => p.request(url, { cache: p.leagueCache(url), cacheIf: fantraxCacheable, label: `Fantrax ${e} (league)` }));
      responses[e] = res;
      if (res.json !== undefined) await p.saveRaw(`${e}?leagueId=${leagueId}`, res.json, res);
      const err = fantraxError(res.json);
      if (!res.ok || res.json === undefined) failures[e] = `HTTP ${res.status}${res.isHtml ? " (HTML page)" : ""}, no JSON body`;
      else if (err) failures[e] = `HTTP ${res.status} with an error object: ${err.message ?? err.keys.join(",")}`;
      else docs[e] = res.json;
    } catch (err) {
      failures[e] = err instanceof Error ? err.message : String(err);
    }
  }
  registerLeagueIdentities(p.redactor, leagueId, Object.values(docs));

  for (const e of LEAGUE_ENDPOINTS) {
    const why = failures[e];
    if (why !== undefined) {
      p.cl.fail("LEAGUE", `LEAGUE.${e}`, `${e} (league)`, why, { url: tmpl(e), status: responses[e]?.status });
      p.cl.issue(`Fantrax ${e} failed — ${tmpl(e)} HTTP ${responses[e]?.status ?? "n/a"} — ${why} — options: check that the league is public (Fantrax's API reads public leagues only) and the ID is right.`);
      continue;
    }
    const label = `${e}?leagueId={leagueId}`;
    try {
      await p.saveSanitized(label, docs[e], { url: tmpl(e), status: responses[e]?.status, contentType: responses[e]?.contentType }, { protect: protectLeaguePath });
      saved.push({ label, url: tmpl(e) });
      p.cl.ok("LEAGUE", `LEAGUE.${e}`, `${e} (league)`, `HTTP ${responses[e]?.status}; saved raw + sanitized`, { url: tmpl(e), status: responses[e]?.status });
    } catch (err) {
      p.cl.fail("LEAGUE", `LEAGUE.${e}`, `${e} (league)`, `sanitized copy refused: ${err instanceof Error ? err.message : String(err)}`, { url: tmpl(e) });
    }
  }
  applySpecs(p, leagueChecks({ docs, failures, ids, facts, sleeper: cw.sleeper, dp: cw.dp, fc: cw.fc, fcUrl: fantasyCalcUrl(FC_FORMAT), crosswalk: cw.deep }));
}

void runProbe("fantrax", async (p) => {
  const leagueId = p.env("FANTRAX_LEAGUE_ID");
  p.cl.meta.leagues = [
    leagueId
      ? { label: "Parker's Fantrax league", access: "public league (no login)", source: "FANTRAX_LEAGUE_ID" }
      : { label: "none: FANTRAX_LEAGUE_ID blank", access: "league-independent endpoints only", source: "getPlayerIds, getAdp, and one invalid-ID getLeagueInfo call" },
  ];
  p.cl.meta.season = SEASON;
  const saved: Saved[] = [];

  const facts = await readDocs(p);
  const { ids, res: idsRes } = await checkPlayerIds(p);
  const { adp, names: adpNames } = await checkAdp(p, ids, facts, saved);
  const idNames = idsRes ? await saveTrimmedPlayerIds(p, ids, adp, idsRes, saved) : [];
  const cw = await checkCrosswalk(p, ids, adp);
  await checkErrors(p, saved);
  docIssues(p, facts, Boolean(leagueId));

  p.cl.decision(
    `Fantrax → canonical IDs: match on sportRadarId (Sleeper sportradar_id), then rotowireId (Sleeper rotowire_id), then DynastyProcess sportradar_id / rotowire_id / stats_id (= Fantrax statsIncId). A vendor id can sit on several rows, so every candidate is kept and the most plausible one wins (real row, active, position + NFL team agree). Never match on names: getAdp and getPlayerIds spell some names differently (API.adp.names).`,
  );
  p.cl.decision(
    `getPlayerIds records are classified by position as well as by id (recordKind): TK/TQB ("Team K, <city>", "Team QB, <city>") use 5-char player ids but are team units, so they are counted and crosswalked apart from players (API.playerIds.idFormat).`,
  );
  p.cl.decision(
    `Fantrax bodies are parsed as JSON whatever the Content-Type (${idsRes ? `getPlayerIds arrived as ${idsRes.contentType || "no content-type"}` : "see API.adp / API.errors"}), and every body is checked for an error field before use, since errors can come back as HTTP 200 (API.errors).`,
  );
  p.cl.decision(
    "Caching: getPlayerIds and getAdp 24 h like other player lists, league calls 10 min, docs 7 days. A Fantrax response is cached only when it is a JSON body without an error object (fantraxCacheable), so a transient HTTP-200 error is never replayed; the invalid-ID getLeagueInfo check runs once per run with no retries and keeps its expected error body in the 10-minute league cache.",
  );
  p.cl.decision("Fantrax's API docs are read from pmurley/go-fantrax (README, league_info.go, repo tree; 7-day docs cache), so docs-based statements in this report (DOCS.*, G, J, K, C) are computed from those files each run.");

  if (!leagueId) {
    applySpecs(p, noLeagueChecks(facts, cw.deep));
    p.cl.decision("Did not look for a public Fantrax league: CLAUDE.md §17 says to skip Fantrax unless someone has a public league ID.");
    p.cl.question("Do you know any public Fantrax NFL league ID we could test with (FANTRAX_LEAGUE_ID)? If not, Fantrax stays a stretch goal.");
  } else await checkLeague(p, leagueId, ids, cw, facts, saved);

  checkFixtures(p, saved, [...adpNames, ...idNames], cw.publicNames);
});
