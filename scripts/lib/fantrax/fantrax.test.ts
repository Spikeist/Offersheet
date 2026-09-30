import { describe, expect, it } from "vitest";
import { Redactor } from "../sanitize";
import { fantraxCacheable, fantraxError, fantraxUrl, idFormat, nflTeamOf, recordKind, type FantraxAdp, type FantraxPlayer } from "./api";
import { leagueChecks, noLeagueChecks, type CheckSpec } from "./checks";
import { buildDpIndex, buildSleeperIndex, crosswalkMany, crosswalkPlayer, normalizeName, onTeamPlayers, summarizeAdp, summarizePlayerIds, topSkillFromAdp } from "./crosswalk";
import { parseLeagueInfoGo, parseReadme, parseTree, structJsonKeys, type FantraxDocFacts } from "./docs";
import { collapsedPath, keyPaths, matchupPeriods, protectLeaguePath, registerLeagueIdentities, rosterItems, rosterLimits, scoringRules, teamsOf } from "./league";

// Made-up records shaped like the live responses (2026-09-29); every name is fictional, no real league data.
const IDS: Record<string, FantraxPlayer> = {
  "0aaa1": { fantraxId: "0aaa1", name: "Vexqual, Oszrin", position: "QB", team: "KC", sportRadarId: "AAAAAAAA-0000-0000-0000-000000000001", rotowireId: 101, statsIncId: 9001 },
  "0bbb2": { fantraxId: "0bbb2", name: "Brumfitz, Ydrel", position: "RB", team: "(N/A)", rotowireId: 102 },
  "0ccc3": { fantraxId: "0ccc3", name: "Qarnoth, Ixtaph", position: "WR", team: "BUF", statsIncId: 9003 },
  "0ddd4": { fantraxId: "0ddd4", name: "Dworkulb, Faxlen", position: "TE", team: "SF", sportRadarId: "aaaaaaaa-0000-0000-0000-000000000004", rotowireId: 104 },
  "0eee5": { fantraxId: "0eee5", name: "Team K, Zorbtown", position: "TK", team: "MIN" },
  "0fff6": { fantraxId: "0fff6", name: "Glimmerax, Plover", position: "Default", team: "(N/A)", rotowireId: 106 },
  "20180#1090": { fantraxId: "20180#1090", name: "Defense/Special Teams", position: "DST", teamName: "Zorbtown Quasars", teamShortName: "ZQS", shortName: "DST" },
};

const SLEEPER = {
  "11": { player_id: "11", full_name: "Oszrin Vexqual", sportradar_id: "aaaaaaaa-0000-0000-0000-000000000001", rotowire_id: 101, position: "QB", team: "KC", active: true },
  "12": { player_id: "12", full_name: "Ydrel Brumfitz", rotowire_id: 102, position: "RB", team: null, active: true },
  // rotowire 104 reused by a different (retired) player: sportradar must win.
  "14": { player_id: "14", full_name: "Faxlen Dworkulb", sportradar_id: "AAAAAAAA-0000-0000-0000-000000000004", position: "TE", team: "SF", active: true },
  "99": { player_id: "99", full_name: "Morvax Dworkulb", rotowire_id: 104, position: "DB", team: null, active: false },
};

const DP_ROWS = [
  { sleeper_id: "13", sportradar_id: "NA", rotowire_id: "NA", stats_id: "9003", name: "Ixtaph Qarnoth" },
  { sleeper_id: "NA", sportradar_id: "NA", rotowire_id: "555", stats_id: "NA", name: "Nobody Quux" },
];

describe("Fantrax API helpers", () => {
  it("classifies ids, team units and NFL teams", () => {
    expect(idFormat("04ca6")).toBe("player");
    expect(idFormat("20180#1090")).toBe("teamUnit");
    expect(idFormat("TM_20090")).toBe("other");
    expect(recordKind("0eee5", { position: "TK" })).toBe("teamPlayerFormat");
    expect(recordKind("0eee6", { position: "TQB" })).toBe("teamPlayerFormat");
    expect(recordKind("0fff6", { position: "Default" })).toBe("player");
    expect(recordKind("20180#1090", { position: "DST" })).toBe("teamUnit");
    expect(nflTeamOf({ team: "(N/A)" })).toBeNull();
    expect(nflTeamOf({ teamShortName: "ZQS" })).toBe("ZQS");
    expect(fantraxUrl("getAdp", { sport: "NFL" })).toBe("https://www.fantrax.com/fxea/general/getAdp?sport=NFL");
  });

  it("detects errors reported as HTTP 200 bodies", () => {
    const live = { error: { onScreen: false, code: "WARNING", message: "Invalid 'leagueId' parameter - league ID: x not found" } };
    expect(fantraxError(live)).toEqual({ path: "error", keys: ["onScreen", "code", "message"], message: live.error.message, code: "WARNING" });
    expect(fantraxError({ error: "boom" })).toMatchObject({ message: "boom" });
    expect(fantraxError({ leagueName: "x", error: null })).toBeNull();
    expect(fantraxError([1, 2])).toBeNull();
  });

  it("never caches HTTP-200 error bodies (F4)", () => {
    expect(fantraxCacheable({ status: 200, isHtml: false, json: { error: { code: "WARNING" } } })).toBe(false);
    expect(fantraxCacheable({ status: 200, isHtml: false, json: undefined })).toBe(false);
    expect(fantraxCacheable({ status: 200, isHtml: true, json: undefined })).toBe(false);
    expect(fantraxCacheable({ status: 503, isHtml: false, json: {} })).toBe(false);
    expect(fantraxCacheable({ status: 200, isHtml: false, json: [{ id: "0aaa1" }] })).toBe(true);
  });
});

describe("summaries", () => {
  it("summarizes getPlayerIds with TK/TQB counted as team units, not players (F5)", () => {
    const s = summarizePlayerIds(IDS);
    expect(s.byKind).toEqual({ player: 5, teamUnit: 1, teamPlayerFormat: 1, other: 0 });
    expect(s.unitCodes).toEqual({ "1090": "DST" });
    expect(s.teamPlayerFormat).toEqual({ positions: { TK: 1 }, withVendorIds: 0, example: "Team K, Zorbtown" });
    expect(s.noNflTeam).toBe(2);
    expect(s.lastCommaFirst).toBe(5);
    expect(s.defaultPosition).toBe(1);
    expect(s.suspectTeamRecords).toBe(0);
    expect(s.fill.all.n).toBe(5);
    expect(s.fill.skillOnTeam).toEqual({ n: 3, sportRadarId: 2, rotowireId: 2, statsIncId: 2, none: 0 });
    // A "Team …" record under a new position code is flagged, not silently counted as a player.
    expect(summarizePlayerIds({ "0ggg7": { fantraxId: "0ggg7", name: "Team P, Zorbtown", position: "TP", team: "MIN" } }).suspectTeamRecords).toBe(1);
  });

  it("summarizes getAdp and joins it to player ids", () => {
    const adp: FantraxAdp[] = [
      { id: "0aaa1", name: "Vexqual, Oszrin", pos: "QB", ADP_PPR: 3, ADP: 4 },
      { id: "0ddd4", name: "Dworkulb, Fax'len", pos: "TE", ADP_PPR: 999 },
      { id: "0eee5", name: "Team K, Zorbtown", pos: "TK", ADP_PPR: 180 },
      { id: "20180", name: "ZQS", tmId: "TM_20180", ADP_PPR: 150 },
      { id: "zzzzz", name: "Ghostly, Quibble", pos: "WR", ADP_PPR: 20 },
    ];
    const s = summarizeAdp(adp, IDS, "1090");
    // "Dworkulb, Fax'len" vs "Dworkulb, Faxlen": differs only by an apostrophe, like the live data.
    expect(s).toMatchObject({ total: 5, players: 3, teamPlayerFormat: 1, teamDefenses: 1, teamJoined: 1, joined: 3, realAdpPpr: 4, unmatchedIds: ["zzzzz"], nameDiffs: 1, nameDiffsNormalized: 0 });
    expect(normalizeName("Chase, Ja'Marr")).toBe(normalizeName("Chase, JaMarr"));
    expect(topSkillFromAdp(adp, IDS).map((p) => p.fantraxId)).toEqual(["0aaa1"]);
    // Team units never count as "players on NFL teams".
    expect(onTeamPlayers(IDS, new Set(["QB", "RB", "WR", "TE", "K", "TK"])).map((p) => p.fantraxId)).toEqual(["0aaa1", "0ccc3", "0ddd4"]);
  });
});

describe("crosswalk", () => {
  const sleeper = buildSleeperIndex(SLEEPER);
  const dp = buildDpIndex(DP_ROWS);

  it("prefers sportradar, falls back to rotowire, then DynastyProcess stats_id", () => {
    expect(crosswalkPlayer(IDS["0aaa1"]!, sleeper, dp)).toMatchObject({ sleeperId: "11", via: "sleeper.sportradar_id", conflict: false, duplicateKey: false });
    expect(crosswalkPlayer(IDS["0bbb2"]!, sleeper, dp)).toMatchObject({ sleeperId: "12", via: "sleeper.rotowire_id" });
    expect(crosswalkPlayer(IDS["0ccc3"]!, sleeper, dp)).toMatchObject({ sleeperId: "13", via: "dp.stats_id", inDp: true });
  });

  it("treats DynastyProcess 'NA' as missing but still 'in DynastyProcess'", () => {
    expect(dp.byRotowire.get("555")).toEqual([]);
    expect(dp.byRotowire.has("555")).toBe(true);
    expect(dp.bySportradar.size).toBe(0);
  });

  it("flags disagreeing candidates and checks that the kept one matches position and team", () => {
    const r = crosswalkPlayer(IDS["0ddd4"]!, sleeper, dp);
    expect(r).toMatchObject({ sleeperId: "14", via: "sleeper.sportradar_id", conflict: true, duplicateKey: false });
    const four = ["0aaa1", "0bbb2", "0ccc3", "0ddd4"].map((k) => IDS[k]!);
    const s = crosswalkMany(four, sleeper, dp);
    expect(s).toMatchObject({ n: 4, matched: 4, conflicts: 1, conflictsKeptRight: 1, duplicateKeys: 0, ambiguous: 0 });
    expect(s.conflictDetails[0]).toMatchObject({ name: "Dworkulb, Faxlen", kept: { via: "sleeper.sportradar_id", agrees: true }, others: [{ via: "sleeper.rotowire_id", agrees: false, placeholder: false }] });
    // "13" comes from DynastyProcess and isn't in the Sleeper DB, so only 3 matches can be position-checked.
    expect(s.checked).toBe(3);
    expect(s.positionAgrees).toBe(3);
    expect(s.teamAgrees).toBe(3);
    expect(s.sleeperIds).toEqual(["11", "12", "13", "14"]);
  });

  it("keeps every row behind a duplicated vendor id and prefers the real, active, matching one (F13)", () => {
    const sr = "bbbbbbbb-0000-0000-0000-000000000007";
    const player: FantraxPlayer = { fantraxId: "0hhh8", name: "Snorvel, Quattro", position: "CB", team: "(N/A)", sportRadarId: sr, rotowireId: 707 };
    // Placeholder row listed AFTER the real one: last-wins indexing used to keep the placeholder.
    const db = {
      "40": { player_id: "40", full_name: "Quattro Snorvel", sportradar_id: sr, rotowire_id: 707, position: "CB", team: null, active: false },
      "41": { player_id: "41", full_name: "Duplicate Player", sportradar_id: sr, rotowire_id: 707, position: "CB", team: null, active: false },
    };
    const idx = buildSleeperIndex(db);
    expect(idx.bySportradar.get(sr)).toEqual(["40", "41"]);
    expect(idx.info.get("41")?.placeholder).toBe(true);
    const r = crosswalkPlayer(player, idx);
    expect(r).toMatchObject({ sleeperId: "40", duplicateKey: true, conflict: true, ambiguous: false });
    const s = crosswalkMany([player], idx);
    expect(s).toMatchObject({ conflicts: 1, conflictsKeptRight: 1, duplicateKeys: 1, ambiguous: 0 });
    expect(s.conflictDetails[0]?.others).toEqual([
      { via: "sleeper.sportradar_id", agrees: false, placeholder: true },
      { via: "sleeper.rotowire_id", agrees: false, placeholder: true },
    ]);

    // Active beats inactive when both rows are real (a namesake who kept the vendor id).
    const namesake = buildSleeperIndex({
      "50": { player_id: "50", full_name: "Quattro Snorvel", rotowire_id: 808, position: "WR", team: null, active: false },
      "51": { player_id: "51", full_name: "Quattro Snorvel", rotowire_id: 808, position: "CB", team: null, active: true },
    });
    expect(crosswalkPlayer({ ...player, sportRadarId: undefined, rotowireId: 808 }, namesake).sleeperId).toBe("51");

    // Two identical real rows: another method's unique hit breaks the tie; without one it stays ambiguous.
    const twins = buildSleeperIndex({
      "60": { player_id: "60", full_name: "Quattro Snorvel", sportradar_id: sr, position: "CB", team: null, active: true },
      "61": { player_id: "61", full_name: "Quattro Snorvel", sportradar_id: sr, rotowire_id: 707, position: "CB", team: null, active: true },
    });
    expect(crosswalkPlayer(player, twins)).toMatchObject({ sleeperId: "61", ambiguous: false });
    expect(crosswalkPlayer({ ...player, rotowireId: undefined }, twins)).toMatchObject({ sleeperId: "60", ambiguous: true });
    expect(crosswalkMany([{ ...player, rotowireId: undefined }], twins)).toMatchObject({ conflicts: 1, conflictsKeptRight: 0, ambiguous: 1 });
  });
});

// A made-up league in the shape of go-fantrax's structs; every name is fictional.
const LEAGUE_ID = "zq9leagueidxx";
const INFO = {
  leagueName: "Zorblax Imaginary League",
  teamInfo: {
    t0am1xyz0000abcd: { id: "t0am1xyz0000abcd", name: "Quxwell Vortigaunts", division: "Division Quuxmoor" },
    t0am2xyz0000abcd: { id: "t0am2xyz0000abcd", name: "Plimbo Zanthrax Crew", division: "Division Quuxmoor" },
  },
  matchups: [
    { period: 2, matchupList: [{ away: { id: "t0am1xyz0000abcd", name: "Quxwell Vortigaunts", shortName: "QV" }, home: { id: "t0am2xyz0000abcd", name: "Plimbo Zanthrax Crew", shortName: "PZC" } }] },
    { period: 1, matchupList: [{ away: { id: "t0am2xyz0000abcd", name: "Plimbo Zanthrax Crew", shortName: "PZC" }, home: { id: "t0am1xyz0000abcd", name: "Quxwell Vortigaunts", shortName: "QV" } }] },
  ],
  rosterInfo: { positionConstraints: { QB: { maxActive: 1 }, RB: { maxActive: 2 } }, maxTotalPlayers: 16, maxTotalActivePlayers: 9, maxTotalReservePlayers: 7 },
  playerInfo: { "0aaa1": { eligiblePos: "QB", status: "T" } },
  scoringSystem: {
    type: "POINTS",
    scoringCategorySettings: [
      {
        group: { code: "PASSING", name: "Passing", id: "1", shortName: "Pass" },
        configs: [
          { position: { code: "ALL", name: "All", id: "0", shortName: "All" }, scoringCategory: { code: "PYD", name: "Passing Yards", id: "10", shortName: "PYd" }, points: 0.04 },
          { position: { code: "TE", name: "Tight End", id: "5", shortName: "TE" }, scoringCategory: { code: "REC", name: "Receptions", id: "20", shortName: "Rec" }, points: 1.5 },
        ],
      },
    ],
  },
  // Not documented, but possible: a draft order naming teams and owners must be sanitized (F7).
  draftSettings: { draftType: "SNAKE", draftOrder: [{ teamName: "Quxwell Vortigaunts", ownerName: "Zorblax Quintavious" }] },
  poolSettings: { duplicatePlayerType: "NONE", playerSourceType: "ALL" },
  commissionerName: "Zorblax Quintavious",
};
const ROSTERS = {
  period: 4,
  rosters: {
    t0am1xyz0000abcd: {
      teamName: "Quxwell Vortigaunts",
      rosterItems: [
        { id: "0aaa1", position: "QB", status: "ACTIVE" },
        { id: "0bbb2", position: "RB", status: "INJURED_RESERVE", ownerName: "Frobnitz Kwellbar" },
      ],
    },
  },
};

describe("league responses", () => {
  it("registers identities so the sanitized copy has placeholders only", () => {
    const r = new Redactor("fantrax-test");
    registerLeagueIdentities(r, LEAGUE_ID, [INFO, ROSTERS]);
    const clean = r.apply({ INFO, ROSTERS }, { protect: protectLeaguePath });
    const text = JSON.stringify(clean);
    for (const secret of ["Zorblax Imaginary League", "Quxwell Vortigaunts", "Plimbo Zanthrax Crew", "t0am1xyz0000abcd", "Zorblax Quintavious", "Division Quuxmoor", "Frobnitz Kwellbar", LEAGUE_ID]) expect(text).not.toContain(secret);
    expect(clean.INFO.matchups[0]?.matchupList[0]?.away.shortName).toMatch(/^T\d+$/);
    // Scoring and player sections keep their names: they describe stats and players, not people.
    expect(text).toContain("Passing Yards");
    expect(text).toContain("Tight End");
    expect(r.findLeaks(clean, { protect: protectLeaguePath })).toEqual([]);
  });

  it("protects player/scoring sections except identity keys; draftSettings and poolSettings aren't protected (F7)", () => {
    expect(protectLeaguePath(["scoringSystem", "scoringCategorySettings", 0, "group", "name"])).toBe(true);
    expect(protectLeaguePath(["rosters", "t0am1", "rosterItems", 1, "ownerName"])).toBe(false);
    expect(protectLeaguePath(["playerInfo", "0aaa1", "teamName"])).toBe(false);
    expect(protectLeaguePath(["playerInfo", "0aaa1", "teamId"])).toBe(false);
    expect(protectLeaguePath(["draftSettings", "draftOrder", 0, "teamName"])).toBe(false);
    expect(protectLeaguePath(["poolSettings", "playerSourceType"])).toBe(false);
  });

  it("extracts scoring, roster limits, teams, matchups and rosters", () => {
    expect(scoringRules(INFO)).toEqual({
      type: "POINTS",
      rules: [
        { group: "PASSING", position: "ALL", category: "PYD", categoryName: "Passing Yards", points: 0.04 },
        { group: "PASSING", position: "TE", category: "REC", categoryName: "Receptions", points: 1.5 },
      ],
    });
    expect(scoringRules({ leagueName: "x" })).toBeNull();
    expect(rosterLimits(INFO)).toEqual({ maxActiveByPos: { QB: 1, RB: 2 }, maxTotalPlayers: 16, maxTotalActivePlayers: 9, maxTotalReservePlayers: 7 });
    expect(teamsOf(INFO).map((t) => t.id)).toEqual(["t0am1xyz0000abcd", "t0am2xyz0000abcd"]);
    expect(matchupPeriods(INFO)).toEqual({ periods: [1, 2], games: 2 });
    expect(rosterItems(ROSTERS)).toEqual({
      period: 4,
      teams: 1,
      items: [
        { teamId: "t0am1xyz0000abcd", id: "0aaa1", position: "QB", status: "ACTIVE" },
        { teamId: "t0am1xyz0000abcd", id: "0bbb2", position: "RB", status: "INJURED_RESERVE" },
      ],
    });
  });

  it("reports key paths with ids collapsed", () => {
    expect(keyPaths(ROSTERS, /status/)).toEqual(["rosters.{id}.rosterItems[].status"]);
    expect(keyPaths(INFO, /^status$/)).toEqual(["playerInfo.{playerId}.status"]);
    expect(collapsedPath(["matchups", 0, "matchupList", 3, "away"])).toBe("matchups[].matchupList[].away");
  });
});

// Trimmed copies of the three docs files the probe reads (go-fantrax, April 2025).
const README = [
  "# Fantrax API Bindings for Go",
  "It is current as of documentation provided from Fantrax in April 2025.",
  "## Endpoints",
  "### Retrieve Player IDs",
  "- URL: `https://www.fantrax.com/fxea/general/getPlayerIds?sport=NFL`",
  "- Request Parameters:",
  "  - `sport` (required) - one of NFL, MLB",
  "### Retrieve Player Info",
  "- URL: `https://www.fantrax.com/fxea/general/getAdp`",
  "- Request Parameters:",
  "  - `sport` (required)",
  "  - `position` (optional)",
  "  - `limit` (optional)",
  "### Retrieve League List",
  "- URL: `https://www.fantrax.com/fxea/general/getLeagues`",
  "- Request Parameters:",
  "  - `userSecretId` (required) – the Secret ID shown on the Fantrax User Profile screen",
  "### Retrieve League Info",
  "- URL: `https://www.fantrax.com/fxea/general/getLeagueInfo?leagueId=[LeagueID]`",
  "### Retrieve Standings",
  "Retrieve the current standings of the league. Individual stats are not yet included, but will be in a future release.",
  "- URL: `https://www.fantrax.com/fxea/general/getStandings?leagueId=[LeagueID]`",
  "## Example Usage",
  "_, err = client.GetDraftResults(leagueId)",
].join("\n");
const LEAGUE_INFO_GO = [
  "type LeagueInfo struct {",
  '\tLeagueName     string          `json:"leagueName"`',
  '\tMatchups       []MatchupPeriod `json:"matchups"`',
  '\tScoringSystem  ScoringSystem   `json:"scoringSystem"`',
  '\tTeamInfo       map[string]TeamInfo `json:"teamInfo"`',
  "}",
  "type ScoringCategories struct {",
  '\tHITTING  map[string]map[string]string `json:"HITTING"`',
  "}",
  "type ScoringConfig struct {",
  '\tPosition        Position        `json:"position"`',
  '\tScoringCategory ScoringCategory `json:"scoringCategory"`',
  '\tPoints          float64         `json:"points"`',
  "}",
  "type TeamInfo struct {",
  '\tDivision string `json:"division"`',
  '\tName     string `json:"name"`',
  "}",
  "type RosterInfo struct {",
  '\tMaxTotalPlayers int `json:"maxTotalPlayers"`',
  "}",
].join("\n");
const TREE = {
  tree: [
    { type: "blob", path: "league_info.go" },
    { type: "blob", path: "auth_client/get_transactions.go" },
    { type: "blob", path: "auth_client/commissioner_trade.go" },
    { type: "blob", path: "models/transaction.go" },
    { type: "tree", path: "auth_client" },
  ],
};

function docFacts(): FantraxDocFacts {
  return {
    readme: { ...parseReadme(README), url: "readme", status: 200 },
    leagueInfo: { ...parseLeagueInfoGo(LEAGUE_INFO_GO), url: "league_info.go", status: 200 },
    tree: { ...parseTree(TREE)!, url: "tree", status: 200 },
  };
}

describe("docs parsers", () => {
  it("reads endpoints, parameters and dates from the README", () => {
    const r = parseReadme(README);
    expect(r.currentAsOf).toBe("April 2025");
    expect(r.endpoints).toEqual(["getPlayerIds", "getAdp", "getLeagues", "getLeagueInfo", "getStandings"]);
    expect(r.sections.find((s) => s.endpoint === "getAdp")?.params).toEqual(["sport", "position", "limit"]);
    expect(r.sections.find((s) => s.endpoint === "getLeagues")?.params).toEqual(["userSecretId"]);
    expect(r.sections.find((s) => s.endpoint === "getStandings")?.text).toMatch(/Individual stats are not yet included/);
    expect(r.goMethods).toEqual(["GetDraftResults"]);
  });

  it("reads Go struct json tags and the repo tree", () => {
    expect(structJsonKeys(LEAGUE_INFO_GO, "LeagueInfo")).toEqual(["leagueName", "matchups", "scoringSystem", "teamInfo"]);
    const li = parseLeagueInfoGo(LEAGUE_INFO_GO);
    expect(li).toMatchObject({ settingsKeys: [], scoringConfigFields: ["position", "scoringCategory", "points"], scoringCategoryGroups: ["HITTING"], teamInfoFields: ["division", "name"], rosterInfoFields: ["maxTotalPlayers"] });
    // A shared model file isn't public-API code: only root-level files are go-fantrax's public bindings.
    expect(parseTree(TREE)).toEqual({
      transactionFiles: ["auth_client/get_transactions.go", "auth_client/commissioner_trade.go", "models/transaction.go"],
      byArea: { auth_client: 2, models: 1 },
      publicTransactionFiles: [],
    });
    expect(parseTree({ tree: [{ type: "blob", path: "transactions.go" }] })?.publicTransactionFiles).toEqual(["transactions.go"]);
    expect(parseTree({ message: "rate limited" })).toBeNull();
  });
});

/** Same rule as scripts/lib/matrix.ts: an n/a summary with one of these words renders "⏸ untested". */
const UNTESTED = /awaiting|skipped|not tested|untested|no public league/i;
const byItem = (specs: CheckSpec[]) => new Map(specs.map((s) => [s.item, s]));

describe("A–M checks", () => {
  it("without a league: untested items read as untested, C is an open question, L is not applicable (F1)", () => {
    const specs = noLeagueChecks(docFacts(), { matched: 797, n: 797 });
    expect(specs.map((s) => s.item)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"]);
    const m = byItem(specs);
    for (const id of ["A", "B", "D", "E", "F", "H", "I", "M"] as const) {
      expect(m.get(id)?.status).toBe("na");
      expect(m.get(id)?.summary).toMatch(UNTESTED);
      expect(m.get(id)?.evidence[0]?.path).toBeTruthy();
    }
    expect(m.get("C")).toMatchObject({ status: "warn" });
    expect(m.get("C")?.summary).toMatch(/open question \(§2\.7\), untested/);
    expect(m.get("C")?.summary).toMatch(/probably yes/);
    expect(m.get("L")?.status).toBe("na");
    expect(m.get("L")?.summary).not.toMatch(UNTESTED);
    for (const id of ["G", "J", "K"] as const) expect(m.get(id)?.status).toBe("warn");
    expect(m.get("G")?.summary).toMatch(/no transactions endpoint.*auth_client/);
    expect(m.get("J")?.summary).toMatch(/797\/797/);
    expect(m.get("K")?.summary).toMatch(/Individual stats are not yet included/);
    expect(m.get("D")?.evidence[0]?.note).toMatch(/getLeagues \(params: userSecretId\)/);
  });

  it("without docs, docs-based items say untested instead of asserting (F1)", () => {
    const m = byItem(noLeagueChecks({}));
    expect(m.get("G")).toMatchObject({ status: "na" });
    expect(m.get("G")?.summary).toMatch(UNTESTED);
    expect(m.get("K")?.summary).toMatch(UNTESTED);
    expect(m.get("C")?.summary).toMatch(/not read this run/);
  });

  it("when every league endpoint fails, nothing is reported as 'not exposed' (F2)", () => {
    const why = "HTTP 200 with an error object: Invalid 'leagueId' parameter - league ID: [REDACTED] not found";
    const specs = leagueChecks({
      docs: {},
      failures: { getLeagueInfo: why, getTeamRosters: why, getStandings: why, getDraftPicks: why },
      ids: IDS,
      facts: docFacts(),
      fcUrl: "https://api.fantasycalc.com/values/current?isDynasty=false",
      crosswalk: { matched: 3, n: 3 },
    });
    for (const s of specs) {
      expect(s.summary).not.toMatch(/not exposed|no scoringSystem|derivable/);
      if (["G", "J", "K"].includes(s.item)) expect(s.status).toBe("warn");
      else if (s.item === "D" && s.key === "D.myTeam") expect(s.status).toBe("warn");
      else {
        expect(s.status, s.key).toBe("na");
        if (s.item !== "L") expect(s.summary, s.key).toMatch(/^untested: .*unavailable/);
      }
    }
    expect(specs.find((s) => s.key === "C.rules")?.summary).toMatch(/§2\.7's question stays open/);
    expect(specs.find((s) => s.key === "H.freeAgents")?.summary).toMatch(/getTeamRosters unavailable/);
    expect(specs.find((s) => s.key === "M.matchRate")?.summary).toMatch(/getTeamRosters unavailable/);
  });

  it("with a loaded league: scoring answered, gaps are warn with a fallback, free agents derived", () => {
    const specs = leagueChecks({
      docs: { getLeagueInfo: INFO, getTeamRosters: ROSTERS, getStandings: { standings: [{ teamId: "t0am1xyz0000abcd", win: 1, loss: 0 }] } },
      failures: { getDraftPicks: "HTTP 500, no JSON body" },
      ids: IDS,
      facts: docFacts(),
      fcUrl: "https://api.fantasycalc.com/values/current?isDynasty=false",
    });
    const k = new Map(specs.map((s) => [s.key, s]));
    expect(k.get("C.rules")).toMatchObject({ status: "ok" });
    expect(k.get("C.rules")?.summary).toMatch(/^yes: 2 rules/);
    expect(k.get("A.numTeams")).toMatchObject({ status: "ok", summary: "2 teams" });
    expect(k.get("A.playoffs")?.status).toBe("warn");
    expect(k.get("A.playoffs")?.summary).toMatch(/probably not exposed; fallback: the user enters playoff settings/);
    expect(k.get("F.records")?.summary).toMatch(/candidate fields found/);
    expect(k.get("H.freeAgents")?.summary).toMatch(/^derivable: 2 QB\/RB\/WR\/TE\/K on NFL teams are not rostered/);
    expect(k.get("I.picks")).toMatchObject({ status: "na" });
    expect(k.get("I.picks")?.summary).toMatch(/^untested: getDraftPicks unavailable \(HTTP 500/);
    // No Sleeper DB / FantasyCalc passed: M is untested, not a failure.
    expect(k.get("M.matchRate")?.summary).toMatch(/^untested: .*FantasyCalc values unavailable/);
  });
});
