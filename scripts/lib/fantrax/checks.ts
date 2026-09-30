/**
 * Data Checklist items A–M for Fantrax (CLAUDE.md §17), as pure functions of what the probe fetched.
 * Status rules:
 *   ok    verified from a live response
 *   warn  inferred, derived, docs-only, or a gap with a working fallback (the user enters it, §2.8)
 *   fail  the data is truly missing with no fallback
 *   na    not evaluated ("untested: …", rendered ⏸ in the matrix) or genuinely not applicable
 * A check whose source response is missing (endpoint failed, or no league ID) is "untested", never
 * "not exposed": an error body must not be read as an answer.
 */
import type { Evidence, ItemId, Status } from "../checklist";
import { FANTRAX_BASE, isRecord, type FantraxPlayer } from "./api";
import { SKILL, crosswalkMany, onTeamPlayers, pct, type DpIndex, type SleeperIndex } from "./crosswalk";
import { GO_FANTRAX_LEAGUE_INFO_URL, GO_FANTRAX_README_URL, GO_FANTRAX_TREE_URL, ITEM_A_SETTINGS, areaText, documentedParams, type FantraxDocFacts } from "./docs";
import { LEAGUE_ENDPOINTS, countBy, keyPaths, matchupPeriods, rosterItems, rosterLimits, scoringRules, teamsOf, type LeagueEndpoint } from "./league";

export interface CheckSpec {
  item: ItemId;
  key: string;
  title: string;
  status: Status;
  summary: string;
  evidence: Evidence[];
}

export const NO_LEAGUE = "untested: no public league ID (set FANTRAX_LEAGUE_ID to test)";

const TITLES: Record<ItemId, string> = {
  A: "League basics",
  B: "Lineup",
  C: "Scoring rules exposed",
  D: "Teams",
  E: "Rosters",
  F: "Schedule",
  G: "Transactions",
  H: "Free agents",
  I: "Draft pick ownership",
  J: "Projections",
  K: "Completed weeks (oracle)",
  L: "NFL schedule",
  M: "FantasyCalc match rate",
};

export const leagueUrl = (e: LeagueEndpoint) => `${FANTRAX_BASE}${e}?leagueId={leagueId}`;

const spec = (item: ItemId, key: string, title: string, status: Status, summary: string, ...evidence: Evidence[]): CheckSpec => ({ item, key, title, status, summary, evidence });

/** Where each item would come from, per go-fantrax's structs (April 2025). Expectations, not findings. */
const EXPECTED: Record<ItemId, { url?: string; path: string }> = {
  A: { url: leagueUrl("getLeagueInfo"), path: "teamInfo (count, division), matchups[].period" },
  B: { url: leagueUrl("getLeagueInfo"), path: "rosterInfo.positionConstraints.{POS}.maxActive, rosterInfo.maxTotalPlayers / maxTotalActivePlayers / maxTotalReservePlayers" },
  C: { url: leagueUrl("getLeagueInfo"), path: "scoringSystem.scoringCategorySettings[].configs[] {position, scoringCategory, points}" },
  D: { url: leagueUrl("getLeagueInfo"), path: "teamInfo.{teamId} {id, name, division}" },
  E: { url: leagueUrl("getTeamRosters"), path: "rosters.{teamId}.rosterItems[] {id, position, status}" },
  F: { url: leagueUrl("getLeagueInfo"), path: "matchups[].matchupList[] {away, home}; getStandings for W-L-T and points" },
  G: { path: "(no endpoint)" },
  H: { url: leagueUrl("getTeamRosters"), path: "getPlayerIds minus rosters.{teamId}.rosterItems[].id; getLeagueInfo playerInfo.{playerId}.status" },
  I: { url: leagueUrl("getDraftPicks"), path: "(shape undocumented)" },
  J: { path: "(no endpoint)" },
  K: { path: "(no endpoint)" },
  L: { path: "(shared sources)" },
  M: { url: leagueUrl("getTeamRosters"), path: "rosterItems[].id → getPlayerIds sportRadarId / rotowireId → Sleeper id → FantasyCalc player.sleeperId" },
};

// -------------------------------------------------------------------------------------------------
// Items that don't depend on a league: C's open question (no league), G, J, K from the docs; L.

function endpointList(f: FantraxDocFacts): string {
  const r = f.readme;
  return r ? `README${r.currentAsOf ? ` (current as of ${r.currentAsOf})` : ""} documents ${r.endpoints.join(", ")}` : "Fantrax API docs not read this run";
}

function readmeEvidence(f: FantraxDocFacts, note?: string): Evidence {
  return { url: f.readme?.url ?? GO_FANTRAX_README_URL, status: f.readme?.status, path: "### sections → - URL: …/fxea/general/<endpoint>", sample: f.readme?.endpoints, note };
}

export function transactionsCheck(f: FantraxDocFacts): CheckSpec {
  const title = TITLES.G;
  if (!f.readme) return spec("G", "G.transactions", title, "na", "untested: Fantrax API docs not read this run, and the public API has no endpoint the probe could call", { url: GO_FANTRAX_README_URL });
  const listed = f.readme.endpoints.filter((e) => /transaction|trade/i.test(e));
  if (listed.length) return spec("G", "G.transactions", title, "warn", `the docs list ${listed.join(", ")}, but this probe doesn't call it yet`, readmeEvidence(f));
  const tree = f.tree;
  const treeText = tree
    ? tree.publicTransactionFiles.length
      ? `; go-fantrax has transaction code among its root-level public-API bindings (${tree.publicTransactionFiles.join(", ")}): check it`
      : `; go-fantrax's transaction code is all outside its root-level public-API bindings (${areaText(tree)}; e.g. ${tree.transactionFiles.find((x) => /get_transactions/.test(x)) ?? tree.transactionFiles[0] ?? "none"}), i.e. in the logged-in client`
    : "";
  return spec(
    "G",
    "G.transactions",
    title,
    "warn",
    `no transactions endpoint in the documented public API (${endpointList(f)})${treeText}; docs only, not probed live. Effect: the acceptance features a (activity) and hist (§11) can't be computed for Fantrax, so they'd default to 0 / unused`,
    readmeEvidence(f),
    ...(tree ? [{ url: GO_FANTRAX_TREE_URL, status: tree.status, path: "tree[].path matching /transaction|trade/", sample: tree.transactionFiles.slice(0, 6) }] : []),
  );
}

export function projectionsCheck(f: FantraxDocFacts, crosswalk?: { matched: number; n: number }): CheckSpec {
  const title = TITLES.J;
  const xw = crosswalk ? `the ID crosswalk maps ${crosswalk.matched}/${crosswalk.n} (${pct(crosswalk.matched, crosswalk.n)}) QB/RB/WR/TE/K on NFL teams to Sleeper ids (API.idmap.sleeper)` : "the ID crosswalk wasn't measured this run";
  if (!f.readme) return spec("J", "J.projections", title, "warn", `Fantrax API docs not read this run; fallback: Sleeper projections × league scoring (§6), and ${xw}`, { url: GO_FANTRAX_README_URL });
  const listed = f.readme.endpoints.filter((e) => /proj/i.test(e));
  if (listed.length) return spec("J", "J.projections", title, "warn", `the docs list ${listed.join(", ")}; not probed yet. Fallback: Sleeper projections × league scoring (§6); ${xw}`, readmeEvidence(f));
  return spec("J", "J.projections", title, "warn", `no projections endpoint in the documented public API (${endpointList(f)}); docs only. Fallback: Sleeper projections × league scoring (§6), and ${xw}`, readmeEvidence(f));
}

export function completedWeeksCheck(f: FantraxDocFacts): CheckSpec {
  const title = TITLES.K;
  if (!f.readme) return spec("K", "K.completed", title, "na", "untested: Fantrax API docs not read this run", { url: GO_FANTRAX_README_URL });
  const standings = f.readme.sections.find((s) => s.endpoint === "getStandings");
  const noIndividual = standings ? /individual stats are not yet included/i.test(standings.text) : false;
  const statsEndpoints = f.readme.endpoints.filter((e) => /stat|score|point/i.test(e));
  return spec(
    "K",
    "K.completed",
    title,
    "warn",
    `no per-player weekly stats or points in the documented public API (${endpointList(f)}${statsEndpoints.length ? `; check ${statsEndpoints.join(", ")}` : ""})${noIndividual ? '; the getStandings section says "Individual stats are not yet included"' : ""}; docs only, not probed live. Effect: the scoring oracle (§5) can't run for Fantrax; team totals from getStandings are the only league-scored numbers`,
    // Section text only: headings are free text that could collide with a leaguemate's registered words.
    { ...readmeEvidence(f), sample: standings ? { endpoint: standings.endpoint, text: standings.text } : f.readme.endpoints },
  );
}

export function nflScheduleCheck(): CheckSpec {
  return spec("L", "L.nflSchedule", TITLES.L, "na", "not applicable: the NFL schedule and byes come from the shared sources (probe-shared), not from Fantrax", { path: EXPECTED.L.path });
}

function scoringOpenQuestion(f: FantraxDocFacts): CheckSpec {
  const li = f.leagueInfo;
  const docs = li
    ? li.keys.includes("scoringSystem")
      ? `go-fantrax's LeagueInfo struct declares scoringSystem with configs {${li.scoringConfigFields.join(", ")}}, so probably yes${li.scoringCategoryGroups.length ? `, but that struct was modelled on another sport (scoringCategories groups: ${li.scoringCategoryGroups.join(", ")})` : ""}`
      : `go-fantrax's LeagueInfo struct has no scoringSystem key (keys: ${li.keys.join(", ")}), so possibly not`
    : "go-fantrax's LeagueInfo struct not read this run";
  return spec(
    "C",
    "C.rules",
    TITLES.C,
    "warn",
    `open question (§2.7), untested: no public league ID to check whether getLeagueInfo exposes a league's scoring rules. ${docs}. If they aren't exposed, the user picks a scoring preset (§2.7, §2.8)`,
    { url: EXPECTED.C.url, path: EXPECTED.C.path },
    ...(li ? [{ url: li.url, status: li.status, path: "type LeagueInfo / ScoringConfig struct json tags", sample: { LeagueInfo: li.keys, ScoringConfig: li.scoringConfigFields } }] : []),
  );
}

/** Items A–M when no FANTRAX_LEAGUE_ID is set. */
export function noLeagueChecks(f: FantraxDocFacts, crosswalk?: { matched: number; n: number }): CheckSpec[] {
  const out: CheckSpec[] = [];
  const li = f.leagueInfo;
  const note = (id: ItemId): string | undefined => {
    if (id === "A" && li) return `expected per go-fantrax: getLeagueInfo keys ${li.keys.join(", ")}; ${li.settingsKeys.length ? `settings-like keys: ${li.settingsKeys.join(", ")}` : "none for playoffs, trade deadline, league type or median games"}`;
    if (id === "B" && li) return `expected per go-fantrax: rosterInfo {${li.rosterInfoFields.join(", ")}}`;
    if (id === "D") {
      const getLeagues = f.readme?.endpoints.includes("getLeagues") ? `; 'my team' via getLeagues (params: ${documentedParams(f.readme, "getLeagues")?.join(", ") || "?"}) or the user's pick` : "";
      return li ? `expected per go-fantrax: TeamInfo {${li.teamInfoFields.join(", ")}}${getLeagues}` : getLeagues.replace(/^; /, "") || undefined;
    }
    if (id === "M") return "a league-free proxy is measured in API.idmap.fantasycalc";
    return undefined;
  };
  for (const id of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"] as const) {
    if (id === "C") out.push(scoringOpenQuestion(f));
    else if (id === "G") out.push(transactionsCheck(f));
    else if (id === "J") out.push(projectionsCheck(f, crosswalk));
    else if (id === "K") out.push(completedWeeksCheck(f));
    else if (id === "L") out.push(nflScheduleCheck());
    else {
      const n = note(id);
      out.push(spec(id, `${id}.league`, TITLES[id], "na", NO_LEAGUE, { url: EXPECTED[id].url, path: `expected: ${EXPECTED[id].path}`, note: n }));
    }
  }
  return out;
}

// -------------------------------------------------------------------------------------------------
// Items A–M for a real league (FANTRAX_LEAGUE_ID set)

export interface LeagueCheckInput {
  /** Parsed bodies of the league endpoints that answered without an error object. */
  docs: Partial<Record<LeagueEndpoint, unknown>>;
  /** Why each failed endpoint is missing (HTTP status, error message). */
  failures: Partial<Record<LeagueEndpoint, string>>;
  /** getPlayerIds (empty when it failed). */
  ids: Record<string, FantraxPlayer>;
  facts: FantraxDocFacts;
  sleeper?: SleeperIndex;
  dp?: DpIndex;
  /** Sleeper ids with a FantasyCalc value in the probed format. */
  fc?: Set<string>;
  fcUrl: string;
  crosswalk?: { matched: number; n: number };
}

export function leagueChecks(input: LeagueCheckInput): CheckSpec[] {
  const { docs, failures, ids, facts } = input;
  const out: CheckSpec[] = [];
  const add = (s: CheckSpec) => out.push(s);
  const haveIds = Object.keys(ids).length > 0;

  /** Null when every endpoint is available, else the "untested" reason. */
  const missing = (...eps: LeagueEndpoint[]): string | null => {
    const gone = eps.filter((e) => docs[e] === undefined);
    return gone.length ? gone.map((e) => `${e} unavailable (${failures[e] ?? "not fetched"})`).join("; ") : null;
  };
  const untested = (item: ItemId, key: string, title: string, why: string, e: LeagueEndpoint) => spec(item, key, title, "na", `untested: ${why}; not evaluated`, { url: leagueUrl(e) });

  /** "Is it exposed?" by key name. Missing sources → untested; no matching key → a gap with a fallback (warn). */
  const exposed = (item: ItemId, key: string, title: string, re: RegExp, what: string, fallback: string, where: LeagueEndpoint[] = ["getLeagueInfo"]): CheckSpec => {
    const loaded = where.filter((e) => docs[e] !== undefined);
    const first = where[0] ?? "getLeagueInfo";
    if (!loaded.length) return untested(item, key, title, missing(...where) ?? "no source", first);
    const gone = missing(...where);
    const partial = gone ? ` (${gone})` : "";
    const paths = loaded.flatMap((e) => keyPaths(docs[e], re).map((x) => `${e}: ${x}`));
    const url = leagueUrl(loaded[0] ?? first);
    if (paths.length) return spec(item, key, title, "warn", `${what}: candidate fields found; meaning not verified${partial}`, { url, path: paths.join(" | ") });
    return spec(item, key, title, "warn", `${what}: no key matching ${re} in ${loaded.join(", ")}, so probably not exposed${partial}; fallback: ${fallback}`, { url, path: `no key matching ${re}` });
  };

  const info = docs.getLeagueInfo;
  const infoUrl = leagueUrl("getLeagueInfo");
  const noInfo = missing("getLeagueInfo");

  // A. League basics
  const teams = teamsOf(info);
  const ro = rosterItems(docs.getTeamRosters);
  if (noInfo) add(untested("A", "A.numTeams", "Number of teams", noInfo, "getLeagueInfo"));
  else if (teams.length) add(spec("A", "A.numTeams", "Number of teams", "ok", `${teams.length} teams`, { url: infoUrl, path: "teamInfo.{teamId}", sample: teams.length }));
  else if (ro.teams) add(spec("A", "A.numTeams", "Number of teams", "warn", `no teamInfo in getLeagueInfo; ${ro.teams} teams derived from getTeamRosters`, { url: leagueUrl("getTeamRosters"), path: "rosters.{teamId}" }));
  else add(spec("A", "A.numTeams", "Number of teams", "fail", "no teamInfo in getLeagueInfo and no teams in getTeamRosters", { url: infoUrl, path: "teamInfo" }));
  const mp = matchupPeriods(info);
  if (noInfo) add(untested("A", "A.regularSeasonWeeks", "Regular-season weeks", noInfo, "getLeagueInfo"));
  else if (mp.periods.length) add(spec("A", "A.regularSeasonWeeks", "Regular-season weeks", "warn", `matchup periods ${mp.periods[0]}–${mp.periods[mp.periods.length - 1]} (${mp.periods.length} periods, ${mp.games} games); period = NFL week is inferred`, { url: infoUrl, path: "matchups[].period", sample: mp.periods }));
  else add(spec("A", "A.regularSeasonWeeks", "Regular-season weeks", "warn", "no matchups[] in getLeagueInfo (points-only league, or not exposed); fallback: the user enters the regular-season weeks (§2.8)", { url: infoUrl, path: "matchups[]" }));
  add(exposed("A", "A.season", "Season", /season|year/i, "season", "the season the user asked for"));
  add(exposed("A", "A.playoffs", "Playoff start week, teams, byes", /playoff/i, "playoff settings", "the user enters playoff settings (§2.8)"));
  add(exposed("A", "A.tradeDeadline", "Trade deadline and review", /trade|veto|deadline/i, "trade settings", "the user enters the deadline and review type (§2.8)"));
  add(exposed("A", "A.leagueType", "League type (redraft/keeper/dynasty)", /keeper|dynasty|leaguetype/i, "league type", "the user picks redraft / keeper / dynasty"));
  add(exposed("A", "A.medianGame", "Median game / points-only", /median|allplay|pointsonly/i, "median / points-only flags", "the user sets them (§2.8)"));
  if (noInfo) add(untested("A", "A.divisions", "Divisions", noInfo, "getLeagueInfo"));
  else {
    const divisions = new Set(teams.map((t) => t.division).filter(Boolean));
    if (divisions.size) add(spec("A", "A.divisions", "Divisions", "ok", `${divisions.size} divisions`, { url: infoUrl, path: "teamInfo.{teamId}.division" }));
    else add(spec("A", "A.divisions", "Divisions", "warn", "no division values (none, or not exposed)", { url: infoUrl, path: "teamInfo.{teamId}.division" }));
  }

  // B. Lineup
  if (noInfo) add(untested("B", "B.slots", "Starting slots", noInfo, "getLeagueInfo"));
  else {
    const limits = rosterLimits(info);
    if (limits && Object.keys(limits.maxActiveByPos).length) {
      add(spec("B", "B.slots", "Starting slots", "warn", `max active per position: ${Object.entries(limits.maxActiveByPos).map(([pos, n]) => `${pos} ${n}`).join(", ")}; how FLEX-style slots appear is not verified`, { url: infoUrl, path: "rosterInfo.positionConstraints.{POS}.maxActive", sample: limits.maxActiveByPos }));
      add(spec("B", "B.sizes", "Roster sizes", "ok", `total ${limits.maxTotalPlayers ?? "?"}, active ${limits.maxTotalActivePlayers ?? "?"}, reserve ${limits.maxTotalReservePlayers ?? "?"}`, { url: infoUrl, path: "rosterInfo.maxTotalPlayers / maxTotalActivePlayers / maxTotalReservePlayers" }));
    } else add(spec("B", "B.slots", "Starting slots", "warn", "no rosterInfo.positionConstraints in getLeagueInfo; fallback: the user enters lineup slots (§2.8)", { url: infoUrl, path: "rosterInfo", sample: keyPaths(info, /roster|position/i) }));
  }
  add(exposed("B", "B.irTaxi", "IR / taxi slots", /injured|reserve|minors|taxi/i, "IR / taxi", "the user enters IR / taxi sizes (§2.8)"));

  // C. Scoring — the open question in §2.7
  if (noInfo) add(untested("C", "C.rules", TITLES.C, `${noInfo}: §2.7's question stays open`, "getLeagueInfo"));
  else {
    const scoring = scoringRules(info);
    if (scoring && scoring.rules.length) {
      const positions = [...new Set(scoring.rules.map((r) => r.position ?? "(all)"))];
      add(spec("C", "C.rules", TITLES.C, "ok", `yes: ${scoring.rules.length} rules (type ${scoring.type ?? "?"}), positions ${positions.join(", ")}`, { url: infoUrl, path: "scoringSystem.scoringCategorySettings[].configs[] {scoringCategory.code, position.code, points}", sample: scoring.rules.slice(0, 8) }));
      add(spec("C", "C.mapping", "Scoring keys → canonical", "warn", `${new Set(scoring.rules.map((r) => r.category)).size} distinct Fantrax category codes need a scoringMap.ts (Phase 5)`, { path: "scoringCategory.code", sample: [...new Set(scoring.rules.map((r) => `${r.category}${r.categoryName ? ` (${r.categoryName})` : ""}`))].slice(0, 12) }));
    } else if (scoring) add(spec("C", "C.rules", TITLES.C, "warn", `scoringSystem present but no configs (type ${scoring.type ?? "?"}); fallback: the user picks a scoring preset (§2.7)`, { url: infoUrl, path: "scoringSystem.scoringCategorySettings[].configs[]", sample: keyPaths(info, /scor/i) }));
    else add(spec("C", "C.rules", TITLES.C, "warn", "answer to §2.7: no scoringSystem in this league's getLeagueInfo, so scoring rules aren't exposed; fallback: the user picks a scoring preset (§2.7, §2.8)", { url: infoUrl, path: "scoringSystem", sample: keyPaths(info, /scor/i) }));
  }

  // D. Teams
  if (noInfo) add(untested("D", "D.teams", "Team IDs and names", noInfo, "getLeagueInfo"));
  else if (teams.length) add(spec("D", "D.teams", "Team IDs and names", "ok", `${teams.length} teams with ids and names`, { url: infoUrl, path: "teamInfo.{teamId} {id, name, division}", sample: teams.slice(0, 2) }));
  else add(spec("D", "D.teams", "Team IDs and names", "warn", "no teamInfo in getLeagueInfo", { url: infoUrl, path: "teamInfo" }));
  add(exposed("D", "D.owners", "Owner display names", /owner|manager/i, "owner names", "show team names only", [...LEAGUE_ENDPOINTS]));
  const getLeagues = facts.readme?.endpoints.includes("getLeagues");
  add(
    spec(
      "D",
      "D.myTeam",
      "Which team is Parker's",
      "warn",
      getLeagues
        ? `not knowable from the league endpoints; the docs' getLeagues needs ${documentedParams(facts.readme, "getLeagues")?.join(", ") || "a user secret"} (a new per-user secret), otherwise the user picks their team`
        : "not knowable from the league endpoints; the user picks their team (Fantrax docs not read this run)",
      { url: `${FANTRAX_BASE}getLeagues?userSecretId={secret}`, path: "(docs)" },
    ),
  );

  // E. Rosters
  const noRosters = missing("getTeamRosters");
  const rostered = ro.items.map((it) => ids[it.id]).filter((x): x is FantraxPlayer => Boolean(x));
  if (noRosters) add(untested("E", "E.rosters", "Rosters", noRosters, "getTeamRosters"));
  else if (ro.items.length) {
    add(spec("E", "E.rosters", "Rosters", "ok", `${ro.items.length} players on ${ro.teams} teams (period ${ro.period ?? "?"}); statuses ${JSON.stringify(countBy(ro.items, (i) => i.status))}`, { url: leagueUrl("getTeamRosters"), path: "rosters.{teamId}.rosterItems[] {id, position, status}", sample: ro.items.slice(0, 2).map((i) => ({ id: i.id, position: i.position, status: i.status })) }));
    const injuryPaths = [...keyPaths(docs.getTeamRosters, /injur/i), ...keyPaths(info, /injur/i)];
    add(
      spec(
        "E",
        "E.playerInfo",
        "Position, NFL team, injury",
        "warn",
        `${haveIds ? `${rostered.length}/${ro.items.length} roster ids found in getPlayerIds (name, NFL team, vendor ids)` : "getPlayerIds unavailable, so roster ids can't be resolved"}; ${injuryPaths.length ? `injury-like fields: ${injuryPaths.join(", ")} (meaning unverified)` : "no injury field in getTeamRosters or getLeagueInfo"}`,
        { url: leagueUrl("getTeamRosters"), path: "rosterItems[].id → getPlayerIds" },
      ),
    );
  } else add(spec("E", "E.rosters", "Rosters", "warn", "no rosterItems (league not drafted yet, or not exposed)", { url: leagueUrl("getTeamRosters"), path: "rosters.{teamId}.rosterItems[]" }));

  // F. Schedule
  if (noInfo) add(untested("F", "F.matchups", "Fantasy matchups", noInfo, "getLeagueInfo"));
  else if (mp.games) add(spec("F", "F.matchups", "Fantasy matchups", "ok", `${mp.games} games over ${mp.periods.length} periods`, { url: infoUrl, path: "matchups[].matchupList[] {away.id, home.id}" }));
  else add(spec("F", "F.matchups", "Fantasy matchups", "warn", "no matchupList entries (points-only league, or not exposed)", { url: infoUrl, path: "matchups[].matchupList[]" }));
  add(exposed("F", "F.records", "W-L-T and points for/against", /win|loss|tie|points|pts/i, "standings numbers", "compute records from weekly results", ["getStandings"]));

  // G. Transactions (docs)
  add(transactionsCheck(facts));

  // H. Free agents
  const noH = noRosters ?? (haveIds ? null : "getPlayerIds unavailable");
  if (noH) add(untested("H", "H.freeAgents", "Free agents", noH, "getTeamRosters"));
  else {
    const rosteredIds = new Set(ro.items.map((i) => i.id));
    const fa = onTeamPlayers(ids, new Set([...SKILL, "K"])).filter((x) => !rosteredIds.has(x.fantraxId));
    const statuses = isRecord(info) && isRecord(info.playerInfo) ? countBy(Object.values(info.playerInfo), (v) => (isRecord(v) && typeof v.status === "string" ? v.status : undefined)) : null;
    add(
      spec("H", "H.freeAgents", "Free agents", "warn", `derivable: ${fa.length} QB/RB/WR/TE/K on NFL teams are not rostered${statuses ? `; playerInfo statuses ${JSON.stringify(statuses)} (meaning unverified)` : noInfo ? `; ${noInfo}` : ""}`, {
        url: leagueUrl("getTeamRosters"),
        path: "getPlayerIds minus rosterItems; getLeagueInfo playerInfo.{playerId}.status",
      }),
    );
  }

  // I. Draft picks
  const noPicks = missing("getDraftPicks");
  if (noPicks) add(untested("I", "I.picks", TITLES.I, noPicks, "getDraftPicks"));
  else {
    const picksPaths = keyPaths(docs.getDraftPicks, /round|pick|season|year|owner/i);
    if (picksPaths.length) add(spec("I", "I.picks", TITLES.I, "warn", "getDraftPicks answered; pick fields found, meaning not verified", { url: leagueUrl("getDraftPicks"), path: picksPaths.join(" | ") }));
    else add(spec("I", "I.picks", TITLES.I, "warn", "getDraftPicks has no pick fields (redraft league, or not exposed)", { url: leagueUrl("getDraftPicks") }));
  }

  // J, K (docs), L (shared)
  add(projectionsCheck(facts, input.crosswalk));
  add(completedWeeksCheck(facts));
  add(nflScheduleCheck());

  // M. FantasyCalc match rate for rostered QB/RB/WR/TE
  const noM = noRosters ?? (haveIds ? null : "getPlayerIds unavailable") ?? (input.sleeper && input.fc ? null : "Sleeper players DB or FantasyCalc values unavailable this run");
  if (noM) add(untested("M", "M.matchRate", TITLES.M, noM, "getTeamRosters"));
  else {
    const skillRostered = rostered.filter((x) => SKILL.has(x.position));
    if (!skillRostered.length) add(spec("M", "M.matchRate", TITLES.M, "na", "untested: no rostered QB/RB/WR/TE (league not drafted yet)", { url: leagueUrl("getTeamRosters") }));
    else {
      const r = crosswalkMany(skillRostered, input.sleeper ?? { bySportradar: new Map(), byRotowire: new Map(), info: new Map() }, input.dp);
      const valued = r.sleeperIds.filter((id) => input.fc?.has(id)).length;
      const rate = valued / skillRostered.length;
      const summary = `${valued}/${skillRostered.length} (${pct(valued, skillRostered.length)}) rostered QB/RB/WR/TE have a FantasyCalc value (${input.fcUrl.split("?")[1] ?? ""}); Sleeper id found for ${r.matched}, so ${r.matched - valued} misses are FantasyCalc coverage and ${skillRostered.length - r.matched} are crosswalk misses`;
      const ev: Evidence = { url: input.fcUrl, path: EXPECTED.M.path, sample: r.misses.slice(0, 8), note: "Trade values: FantasyCalc (fantasycalc.com)" };
      add(spec("M", "M.matchRate", TITLES.M, rate >= 0.98 ? "ok" : "warn", summary, ev));
    }
  }
  return out;
}

/** Evidence notes for the Fantrax docs themselves (used by the probe's DOCS.* checks). */
export function docsSummary(f: FantraxDocFacts): { readme?: string; leagueInfo?: string; tree?: string } {
  const r = f.readme;
  const li = f.leagueInfo;
  const t = f.tree;
  const adpParams = documentedParams(r, "getAdp");
  return {
    readme: r
      ? `${endpointList(f)}${adpParams?.length ? `; getAdp params: ${adpParams.join(", ")}` : ""}${r.goMethods.length ? `; Go example methods: ${r.goMethods.join(", ")}` : ""}`
      : undefined,
    leagueInfo: li
      ? `LeagueInfo keys: ${li.keys.join(", ")}; ${li.settingsKeys.length ? `settings-like keys: ${li.settingsKeys.join(", ")}` : `none matches ${ITEM_A_SETTINGS} (no playoff, trade-deadline, league-type or median settings)`}; ScoringConfig {${li.scoringConfigFields.join(", ")}}${li.scoringCategoryGroups.length ? `; ScoringCategories groups: ${li.scoringCategoryGroups.join(", ")}` : ""}`
      : undefined,
    tree: t ? `${t.transactionFiles.length} transaction/trade source files (${areaText(t) || "none"}); ${t.publicTransactionFiles.length} among the root-level public-API bindings` : undefined,
  };
}

export const DOC_URLS = { readme: GO_FANTRAX_README_URL, leagueInfo: GO_FANTRAX_LEAGUE_INFO_URL, tree: GO_FANTRAX_TREE_URL };
