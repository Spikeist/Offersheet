import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sha256 } from "../cache";
import { Redactor, SWID_RE } from "../sanitize";
import { bucketOverlaps, classifyRule, coverRange, groupOf, mergeGroups, parseEspnRange, sleeperBuckets, sleeperThresholds } from "./canonical";
import { cookieHeader, leagueCall, query } from "./client";
import { parseEspnConstants, positionFromEligibleSlots, slotIdForPosition } from "./constants";
import { classifyEspnResponse } from "./errors";
import { freeAgentFilter, sourceHasMarker, transactionsFilter } from "./filters";
import { isDict, isSet, parsePyAssignments, parsePyLiteral } from "./pyliteral";
import { planPrune, pruneFixtures } from "./fixtureIndex";
import { maskIdentityFields, maskOwnMember, registerLeagueIdentities, replaceIdDeep, sweepIds, trimForFixture } from "./sanitize";
import type { ScoringItem } from "./schema";
import { diffPerStat, recompute } from "./scoring";
import { dedupeById, idOverlap, involves } from "./transactions";
import { byeWeeksFromGames, futureSampleWeeks, weekOfInstant, weekWindows, type ProGame } from "./weeks";

const MINI_CONSTANT_PY = `
POSITION_MAP = {
    0: "QB",
    1: "TQB",
    2: "RB",
    3: "RB/WR",
    4: "WR",
    5: "WR/TE",
    6: "TE",
    16: "D/ST",
    17: "K",
    20: "BE",
    21: "IR",
    23: "RB/WR/TE",
    25: "Rookie",
    "QB": 0,
    "FLEX": 23,  # reverse entries
}

PRO_TEAM_MAP = {
    0: "None",
    1: "ATL",
    34: "HOU",
}

PLAYER_STATS_MAP = {
    # Passing Stats
    3: "passingYards",  # PY
    53: "receivingReceptions",
}

SETTINGS_SCORING_FORMAT_MAP = {
    3: {"abbr": "PY", "label": "Passing Yards"},
    53: {"abbr": "REC", "label": "Each reception"},
}

TRANSACTION_TYPES = {
    "WAIVER",
    "DRAFT",
}
`;

describe("python literal parser", () => {
  it("keeps int and string dict keys apart and handles comments, sets and nesting", () => {
    const v = parsePyLiteral(`{0: "QB", "QB": 0, 5: {"a": [1, -2.5, (3,)], "b": None}, 'x' 'y': True,  # c\n}`);
    expect(isDict(v)).toBe(true);
    if (!isDict(v)) return;
    expect(v.entries.map(([k]) => k)).toEqual([0, "QB", 5, "xy"]);
    const nested = v.entries[2]?.[1];
    expect(isDict(nested) && nested.entries[0]?.[1]).toEqual([1, -2.5, [3]]);
    expect(v.entries[3]?.[1]).toBe(true);
    const s = parsePyLiteral(`{"A", "B",}`);
    expect(isSet(s) && s.values).toEqual(["A", "B"]);
  });

  it("parses top-level assignments and reports non-literals instead of throwing", () => {
    const { values, errors } = parsePyAssignments(`A = {1: "x"}\nB = some_call()\nC = [1, 2]\n`);
    expect(Object.keys(values)).toEqual(["A", "C"]);
    expect(Object.keys(errors)).toEqual(["B"]);
  });
});

describe("espn-api constants", () => {
  const c = parseEspnConstants(MINI_CONSTANT_PY);

  it("parses the tables we need", () => {
    expect(c.parseErrors).toEqual({});
    expect(c.slotNames[23]).toBe("RB/WR/TE");
    expect(c.slotIdsByName.FLEX).toBe(23);
    expect(c.proTeams[34]).toBe("HOU");
    expect(c.playerStats[3]).toBe("passingYards");
    expect(c.scoringFormat[53]).toEqual({ abbr: "REC", label: "Each reception" });
    expect(c.transactionTypes).toEqual(["DRAFT", "WAIVER"]);
  });

  it("derives positions the espn-api way", () => {
    expect(positionFromEligibleSlots([2, 3, 23, 20, 21], c.slotNames)).toBe("RB");
    expect(positionFromEligibleSlots([25, 3, 4, 5, 23, 20, 21], c.slotNames)).toBe("WR");
    expect(positionFromEligibleSlots([5, 6, 23, 20, 21], c.slotNames)).toBe("TE");
    expect(positionFromEligibleSlots([16, 20, 21], c.slotNames, "Bills D/ST")).toBe("D/ST");
    expect(positionFromEligibleSlots([1, 20, 21], c.slotNames, "Bills TQB")).toBe("TQB");
    expect(slotIdForPosition("QB", c)).toBe(0);
    expect(slotIdForPosition("TE", c)).toBe(6);
  });

  it("reports missing required tables", () => {
    expect(Object.keys(parseEspnConstants("X = 1").parseErrors)).toContain("POSITION_MAP");
  });
});

describe("filters and client", () => {
  it("copies espn-api's free_agents() payload", () => {
    expect(freeAgentFilter(50, [0])).toEqual({
      players: {
        filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
        filterSlotIds: { value: [0] },
        limit: 50,
        sortPercOwned: { sortPriority: 1, sortAsc: false },
        sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "STANDARD" },
      },
    });
    expect(transactionsFilter(["WAIVER"])).toEqual({ transactions: { filterType: { value: ["WAIVER"] } } });
  });

  it("finds copied snippets regardless of line wrapping", () => {
    expect(sourceHasMarker('x = {\n    "sortDraftRanks": {\n  "a": 1}', '"sortDraftRanks": {')).toBe(true);
    expect(sourceHasMarker("nothing here", '"sortDraftRanks": {')).toBe(false);
  });

  it("repeats view params, keeps secrets out of templates and builds the cookie header", () => {
    expect(query([["view", "mTeam"], ["view", "mRoster"], ["scoringPeriodId", 3]])).toBe("?view=mTeam&view=mRoster&scoringPeriodId=3");
    const call = leagueCall({ label: "x", season: 2026, leagueId: "123456789", params: [["view", "mSettings"]] });
    expect(call.url).toContain("/leagues/123456789?view=mSettings");
    expect(call.template).toContain("/leagues/{leagueId}?view=mSettings");
    expect(call.template).not.toContain("123456789");
    expect(cookieHeader({ s2: "AB%2FCD", swid: "{X}" })).toBe("espn_s2=AB%2FCD; SWID={X}");
    expect(cookieHeader({ s2: "AB" })).toBeUndefined();
  });
});

describe("ESPN response classifier", () => {
  const season = 2026;
  it("recognises login pages, auth failures and missing leagues", () => {
    expect(classifyEspnResponse({ status: 200, isHtml: true, json: undefined }, { withCookies: true, season }).code).toBe("html-login-page");
    expect(classifyEspnResponse({ status: 401, isHtml: false, json: {} }, { withCookies: false, season }).code).toBe("not-authorized-no-cookies");
    expect(classifyEspnResponse({ status: 401, isHtml: false, json: {} }, { withCookies: true, season }).code).toBe("not-authorized-with-cookies");
    const nf = classifyEspnResponse({ status: 404, isHtml: false, json: { messages: ["Not Found"], details: [{ type: "GENERAL_NOT_FOUND", shortMessage: "Not Found" }] } }, { withCookies: true, season: 2027 });
    expect(nf.code).toBe("not-found");
    expect(nf.detailTypes).toEqual(["GENERAL_NOT_FOUND"]);
    expect(nf.message).toContain("2027");
  });
  it("passes JSON through and flags other statuses", () => {
    expect(classifyEspnResponse({ status: 200, isHtml: false, json: { id: 1 } }, { withCookies: false, season }).ok).toBe(true);
    expect(classifyEspnResponse({ status: 200, isHtml: false, json: undefined }, { withCookies: false, season }).code).toBe("not-json");
    expect(classifyEspnResponse({ status: 429, isHtml: false, json: undefined }, { withCookies: false, season }).code).toBe("rate-limited");
    expect(classifyEspnResponse({ status: 503, isHtml: false, json: undefined }, { withCookies: false, season }).code).toBe("server-error");
  });
});

describe("scoring preview", () => {
  // Public test league shape: rushing yards score only through position-keyed overrides.
  const items: ScoringItem[] = [
    { statId: 24, points: 0, pointsOverrides: { "1": 0.1, "2": 0.1, "3": 0.1, "4": 0.1, "15": 0.1 } },
    { statId: 53, points: 0.5, pointsOverrides: null },
    { statId: 95, points: 0, pointsOverrides: { "16": 2 } },
  ];
  it("applies an override for the given key and replaces the base points", () => {
    const te = { "24": 2, "53": 3 };
    expect(recompute(te, items, 4).total).toBeCloseTo(1.7); // TE by position id 4: 0.2 + 1.5
    expect(recompute(te, items, 6).total).toBeCloseTo(1.5); // by TE's slot id 6: no override → base 0
    expect(recompute({ "95": 2 }, items, 16).total).toBe(4);
    expect(recompute({ "95": 2 }, items, 2).total).toBe(0);
  });
  it("can also ADD an override to the base points (the reading ESPN doesn't use)", () => {
    const rec: ScoringItem[] = [{ statId: 53, points: 0.5, pointsOverrides: { "4": 1 } }];
    expect(recompute({ "53": 2 }, rec, 4).total).toBe(2); // replace: 1 × 2
    expect(recompute({ "53": 2 }, rec, 4, "add").total).toBe(3); // add: (0.5 + 1) × 2
    expect(recompute({ "53": 2 }, rec, 2, "add").total).toBe(1); // no override for key 2: base only
  });
  it("diffs per stat against ESPN's appliedStats", () => {
    const ours = recompute({ "24": 2, "53": 3 }, items, 6).perStat;
    expect(diffPerStat(ours, { "24": 0.2, "53": 1.5 })).toEqual([{ statId: 24, ours: 0, espn: 0.2 }]);
  });
});

describe("ESPN sanitizing", () => {
  // Built at run time so the repo-wide leak check doesn't see SWID-shaped literals in this file.
  const guid = (c: string) => `{${c.repeat(8)}-1111-2222-3333-444444444444}`;
  const MY = guid("A");
  const OTHER = guid("B");
  const league = {
    id: 123456789,
    settings: { name: "Xylophant Yurt League", scheduleSettings: { divisions: [{ id: 0, name: "Blorptown Division" }] } },
    status: { creationInfo: { source: OTHER }, lastUpdateInfo: { source: "0123456789abcdef0123456789abcdef" } },
    teams: [
      { id: 3, name: "Zorblax Zephyrs", abbrev: "ZZX", owners: [MY], primaryOwner: MY, logo: "https://x.example/a.png", roster: { entries: [{ playerPoolEntry: { player: { fullName: "Zorblax Quintavious", firstName: "Zorblax" } } }] } },
      { id: 5, name: "Quintavious Quokkas", abbrev: "QQK", owners: [OTHER] },
    ],
    members: [
      { id: MY, displayName: "snorfblat77", firstName: "Parker", lastName: "Vandersnoot", notificationSettings: [{ id: "abc" }] },
      { id: OTHER, displayName: "quokkafan88", firstName: "Zorblax", lastName: "Plimbottom" },
    ],
    transactions: [{ memberId: OTHER, items: [{ playerId: 1 }] }],
  };

  it("registers identities with stable placeholders and keeps player names", () => {
    const r = new Redactor("espn-test");
    r.register(MY, "swid");
    const { ownLabel } = registerLeagueIdentities(r, league, { mySwid: MY, keepOwnWords: ["Parker"] });
    expect(ownLabel).toBe("3");
    const body = maskIdentityFields(maskOwnMember(trimForFixture(league), MY, ownLabel));
    const clean = r.apply(body, { protect: (p) => p.includes("player") });
    expect(clean.teams[0]?.name).toBe("Team 3");
    expect(clean.teams[0]?.abbrev).toBe("T3");
    expect(clean.teams[0]?.owners[0]).toBe("{00000000-0000-4000-8000-000000000001}");
    expect(clean.members[0]).toEqual({ id: "{00000000-0000-4000-8000-000000000001}", displayName: "Owner 3", firstName: "First 3", lastName: "Last 3" });
    expect(clean.members[1]?.firstName).toBe("First 5");
    expect(clean.teams[0]?.logo).toBe("https://example.invalid/logo/3.png");
    expect(clean.teams[0]?.roster?.entries[0]?.playerPoolEntry.player).toEqual({ fullName: "Zorblax Quintavious", firstName: "Zorblax" });
    expect(clean.transactions[0]?.memberId).toMatch(SWID_RE);
    expect(clean.settings.name).toBe("League 1");
    expect(clean.settings.scheduleSettings.divisions[0]?.name).toBe("Division 0");
    expect(clean.status.lastUpdateInfo.source).toBe("id-1");
    expect("notificationSettings" in (clean.members[0] ?? {})).toBe(false);
    expect(r.findLeaks(clean, { protect: (p) => p.includes("player") })).toEqual([]);
    // The user's own first name stays readable in report text; leaguemates' names don't.
    expect(r.scrubText("Parker's league vs Quintavious Quokkas")).toBe("Parker's league vs Team 5");
  });

  it("never registers a placeholder as a new SWID (manifest regression)", () => {
    const r = new Redactor("espn-test");
    r.register(MY, "swid");
    sweepIds(r, { mySwid: "{00000000-0000-4000-8000-000000000001}", other: OTHER });
    expect(r.placeholderOf("{00000000-0000-4000-8000-000000000001}")).toBeUndefined();
    expect(r.placeholderOf(OTHER)).toBe("{00000000-0000-4000-8000-000000000002}");
  });

  it("replaces a public id without touching longer numbers", () => {
    expect(replaceIdDeep({ id: 899513, n: 18995130, s: "leagues/899513/x", [String(899513)]: 1 }, "899513", 100002)).toEqual({ id: 100002, n: 18995130, s: "leagues/100002/x", "100002": 1 });
  });

  it("trims analyst text from player objects only", () => {
    const t = trimForFixture({ player: { fullName: "A", seasonOutlook: "long text", stats: [] }, seasonOutlook: "kept" });
    expect(t).toEqual({ player: { fullName: "A", stats: [] }, seasonOutlook: "kept" });
  });

  it("drops which app a member used from activity messages (privacy)", () => {
    const t = trimForFixture({ topics: [{ clientAddress: null, messages: [{ creationInfo: { source: "x", platform: "app-ios", clientAddress: "1.2.3.4" }, lastUpdateInfo: { platform: "web" }, platform: "kept" }] }] });
    expect(t).toEqual({ topics: [{ messages: [{ creationInfo: { source: "x" }, lastUpdateInfo: {}, platform: "kept" }] }] });
  });

  it("replaces numeric names by path and never registers them (report numbers stay intact)", () => {
    const r = new Redactor("espn-test");
    const lg = {
      settings: { name: "Xylophant Yurt League" },
      teams: [{ id: 7, name: "Zorblax Zephyrs", abbrev: "123", owners: [OTHER] }],
      members: [{ id: OTHER, displayName: "4040", firstName: "Zorblax", lastName: "Plimbottom" }],
    };
    expect(registerLeagueIdentities(r, lg).numericNames).toBe(2);
    expect(r.placeholderOf("123")).toBeUndefined();
    expect(r.placeholderOf("4040")).toBeUndefined();
    expect(r.scrubText("123 roster entries, 100.0% within 0.05; 4040 rows")).toBe("123 roster entries, 100.0% within 0.05; 4040 rows");
    const masked = maskIdentityFields(lg);
    expect(masked.teams[0]).toMatchObject({ name: "Team 7", abbrev: "T7" });
    expect(masked.members[0]).toMatchObject({ displayName: "Owner 7", firstName: "First 7", lastName: "Last 7" });
    expect(masked.settings.name).toBe("Xylophant Yurt League"); // non-numeric league names go through the Redactor
    expect(maskIdentityFields({ settings: { name: "2026" } }).settings.name).toBe("League (numeric name)");
    expect(maskIdentityFields([1, 2])).toEqual([1, 2]);
  });
});

describe("canonical (Sleeper) keys", () => {
  it("parses ESPN range labels", () => {
    expect(parseEspnRange("14-17 points allowed")).toEqual({ lo: 14, hi: 17 });
    expect(parseEspnRange("D/ST 46+ points allowed")).toEqual({ lo: 46, hi: null });
    expect(parseEspnRange("Less than 100 total yards allowed")).toEqual({ lo: 0, hi: 99 });
    expect(parseEspnRange("0 points allowed")).toEqual({ lo: 0, hi: 0 });
    expect(parseEspnRange("FG Made (0-39 yards)")).toEqual({ lo: 0, hi: 39 });
    expect(parseEspnRange("Points Allowed")).toBeUndefined();
  });
  it("reads Sleeper bucket and threshold names", () => {
    expect(sleeperBuckets("pts_allow").map((b) => [b.key, b.lo, b.hi])).toEqual([
      ["pts_allow_0", 0, 0],
      ["pts_allow_1_6", 1, 6],
      ["pts_allow_7_13", 7, 13],
      ["pts_allow_14_20", 14, 20],
      ["pts_allow_21_27", 21, 27],
      ["pts_allow_28_34", 28, 34],
      ["pts_allow_35p", 35, null],
    ]);
    expect(sleeperThresholds("bonus_rush_yd").get(200)).toBe("bonus_rush_yd_200");
    expect(bucketOverlaps(sleeperBuckets("yds_allow"))).toEqual(["yds_allow_0_100/yds_allow_100_199 share 100"]);
  });
  it("covers a range exactly or not at all", () => {
    const fgm = sleeperBuckets("fgm");
    expect(coverRange({ lo: 0, hi: 39 }, fgm)).toEqual(["fgm_0_19", "fgm_20_29", "fgm_30_39"]);
    expect(coverRange({ lo: 50, hi: null }, fgm)).toEqual(["fgm_50p"]);
    expect(coverRange({ lo: 50, hi: 59 }, fgm)).toEqual(["fgm_50_59"]);
    expect(coverRange({ lo: 14, hi: 17 }, sleeperBuckets("pts_allow"))).toBeUndefined();
    expect(coverRange({ lo: 35, hi: 45 }, sleeperBuckets("pts_allow"))).toBeUndefined();
    expect(coverRange({ lo: 0, hi: 99 }, sleeperBuckets("yds_allow"))).toBeUndefined();
  });
  it("classifies ESPN rules", () => {
    expect(classifyRule(92, "PA14", "14-17 points allowed")).toMatchObject({ kind: "range", family: "pts_allow", raw: "pts_allow" });
    expect(classifyRule(123, "PA28", "28-34 points allowed")).toMatchObject({ kind: "exact", keys: ["pts_allow_28_34"] });
    expect(classifyRule(89, "PA0", "0 points allowed")).toMatchObject({ kind: "exact", keys: ["pts_allow_0"] });
    expect(classifyRule(80, "FG0", "FG Made (0-39 yards)")).toMatchObject({ kind: "sum", keys: ["fgm_0_19", "fgm_20_29", "fgm_30_39"] });
    expect(classifyRule(37, "RY100", "100-199 yard rushing game")).toMatchObject({ kind: "difference", keys: ["bonus_rush_yd_100", "bonus_rush_yd_200"] });
    expect(classifyRule(38, "RY200", "200+ yard rushing game")).toMatchObject({ kind: "exact", keys: ["bonus_rush_yd_200"] });
    expect(classifyRule(5, "PY5", "Every 5 passing yards")).toMatchObject({ kind: "derived", raw: "pass_yd" });
    expect(classifyRule(114, "KR", "Kickoff Return Yards")).toMatchObject({ kind: "split", keys: ["kr_yd", "def_kr_yd"], missing: [] });
    expect(classifyRule(120, "PTSA", "Points Allowed")).toMatchObject({ kind: "exact", keys: ["pts_allow"] });
    expect(classifyRule(161, "WM25", "25+ point Win Margin").kind).toBe("none");
    expect(classifyRule(209, "1PSF", "1pt Safety").kind).toBe("none");
    expect(classifyRule(36, "RTD50", "50+ yard TD rush bonus")).toMatchObject({ kind: "exact", missing: ["rush_td_50p"] });
    expect(classifyRule(59, "YAC", "Receiving Yards After Catch").kind).toBe("unknown");
  });
  it("finds rules that share a Sleeper key and whether one rate reproduces them", () => {
    const rules = [classifyRule(103, "INTTD", "Interception Return TD"), classifyRule(104, "FRTD", "Fumble Return TD")];
    expect(mergeGroups(rules, [{ statId: 103, points: 0, pointsOverrides: { "16": 6 } }, { statId: 104, points: 0, pointsOverrides: { "16": 6 } }])).toEqual([{ key: "def_td", statIds: [103, 104], equalRates: true }]);
    expect(mergeGroups(rules, [{ statId: 103, points: 0, pointsOverrides: { "16": 6 } }, { statId: 104, points: 0, pointsOverrides: { "16": 4 } }])[0]?.equalRates).toBe(false);
    expect(groupOf("range")).toBe("derivedRule");
    expect(groupOf("exact", true)).toBe("derivedRule");
    expect(groupOf("sum")).toBe("severalKeys");
    expect(groupOf("split")).toBe("oneToOne");
    expect(groupOf("unknown")).toBe("noKey");
  });
});

describe("fixture index pruning", () => {
  it("drops labels no longer produced and reports misnamed, missing and unindexed files", () => {
    const a = "league/{leagueId}/view=mDraftDetail";
    const b = "league/{leagueId}/view=retired";
    const index = { [`${sha256(a)}.json`]: { label: a }, [`${sha256(b)}.json`]: { label: b }, "deadbeef.json": { label: "misnamed" } };
    const plan = planPrune(index, new Set([a, "misnamed"]), [`${sha256(a)}.json`, `${sha256(b)}.json`, "orphan.json", "index.json"]);
    expect(plan.removed).toEqual([`${sha256(b)}.json`]);
    expect(Object.keys(plan.keep)).toEqual([`${sha256(a)}.json`, "deadbeef.json"]);
    expect(plan.misnamed).toEqual(["misnamed"]);
    expect(plan.missingFiles).toEqual(["misnamed"]);
    expect(plan.unindexed).toEqual(["orphan.json"]);
  });

  it("applies the plan without touching subfolders or non-fixture files, and skips a folder without an index", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "espn-prune-"));
    try {
      expect(await pruneFixtures(path.join(dir, "missing"), new Set())).toEqual({ removed: [], misnamed: [], unindexed: [], missingFiles: [] });
      const keep = "league/{leagueId}/view=mSettings";
      const stale = "public-league/{publicLeagueId}/view=mSettings";
      for (const l of [keep, stale]) writeFileSync(path.join(dir, `${sha256(l)}.json`), "{}");
      writeFileSync(path.join(dir, `${sha256("orphan")}.json`), "{}");
      writeFileSync(path.join(dir, "notes.txt"), "x");
      mkdirSync(path.join(dir, "min"));
      writeFileSync(path.join(dir, "index.json"), JSON.stringify({ [`${sha256(keep)}.json`]: { label: keep }, [`${sha256(stale)}.json`]: { label: stale } }));
      const out = await pruneFixtures(dir, new Set([keep]));
      expect(out.removed).toEqual([stale]);
      expect(out.unindexed).toEqual([`${sha256("orphan")}.json`]);
      expect(readdirSync(dir).sort()).toEqual([`${sha256(keep)}.json`, "index.json", "min", "notes.txt"].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("NFL week windows", () => {
  const day = 86_400_000;
  const t0 = Date.UTC(2026, 8, 10, 0, 20); // Thu kickoff, week 1
  const game = (d: number, h: number, a: number): ProGame => ({ date: t0 + d * day, homeProTeamId: h, awayProTeamId: a });
  const teams: Array<{ id: number; proGamesByScoringPeriod: Record<string, ProGame[]> }> = [
    { id: 1, proGamesByScoringPeriod: { "1": [game(0, 1, 2)], "2": [game(7, 1, 3)] } },
    { id: 2, proGamesByScoringPeriod: { "1": [game(0, 1, 2)], "2": [game(11, 2, 3)] } },
    { id: 3, proGamesByScoringPeriod: { "2": [game(7, 1, 3), game(11, 2, 3)] } },
  ];
  const w = weekWindows(teams);

  it("builds windows from each week's kickoffs", () => {
    expect(w.map((x) => [x.week, x.games])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });
  it("puts an instant after Monday night into the coming week", () => {
    expect(weekOfInstant(t0 + 2 * day, w)).toEqual({ week: 2, phase: "before-kickoff" });
    expect(weekOfInstant(t0 + 9 * day, w)).toEqual({ week: 2, phase: "during" });
    expect(weekOfInstant(t0 + 30 * day, w)).toEqual({ week: null, phase: "after-season" });
  });
  it("derives bye weeks from missing games", () => {
    expect(byeWeeksFromGames(teams[2]?.proGamesByScoringPeriod, 2)).toEqual([1]);
  });
  it("samples next week, the last regular-season week and the last playoff week", () => {
    const matchupPeriods = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [String(i + 1), [i + 1]]));
    const at = (latestScoringPeriod: number) => futureSampleWeeks({ latestScoringPeriod, finalScoringPeriod: 17, matchupPeriodCount: 14, matchupPeriods }).map((x) => x.week);
    expect(at(4)).toEqual([5, 14, 17]);
    expect(at(14)).toEqual([15, 17]);
    expect(at(17)).toEqual([]);
  });
});

describe("transactions", () => {
  const tx = (id: string, teamId: number, legs: Array<[number, number]> = [], teamActions?: Record<string, string>) => ({ id, teamId, items: legs.map(([fromTeamId, toTeamId]) => ({ playerId: 1, type: "TRADE", fromTeamId, toTeamId })), teamActions });
  it("dedupes rows that several period requests return", () => {
    const a = [tx("x", 1), tx("y", 2)];
    const b = [tx("y", 2), tx("z", 3)];
    const d = dedupeById([a, b]);
    expect(d.rows).toBe(4);
    expect(d.unique.map((t) => t.id)).toEqual(["x", "y", "z"]);
    const o = idOverlap(a, b);
    expect(o.shared).toBe(1);
    expect(o.onlyA.map((t) => t.id)).toEqual(["x"]);
    expect(o.onlyB.map((t) => t.id)).toEqual(["z"]);
  });
  it("tells whether a row involves a team", () => {
    expect(involves(tx("a", 3), 3)).toBe(true);
    expect(involves(tx("b", 9, [[3, 9]]), 3)).toBe(true);
    expect(involves(tx("c", 9, [], { "3": "ACCEPTED" }), 3)).toBe(true);
    expect(involves(tx("d", 9, [[8, 9]]), 3)).toBe(false);
    expect(involves(tx("e", 3), undefined)).toBe(false);
  });
});
