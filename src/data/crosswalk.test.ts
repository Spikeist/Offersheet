import { beforeAll, describe, expect, it } from "vitest";
import { ID_SOURCE_PRIORITY, playerNameKey, resolverFromData, type CrosswalkData, type PlayerIdCrosswalk } from "./crosswalk";
import { DYNASTYPROCESS_IDS_URL, type DynastyRow } from "./dynastyProcess";
import type { FantasyCalcPlayerIds } from "./fantasyCalcPlayers";
import { loadPlayerIdResolver } from "./load";
import { SLEEPER_PLAYER_POSITIONS, sleeperPlayersUrl, type SleeperPlayerRecord } from "./sleeperPlayers";
import { SLEEPER_TEAM_CODES } from "./teamCodes";
import { fakeHttp, fixtureDynastyRows, fixtureEspnProTeams, fixtureEspnRostered, fixtureFantasyCalcPlayers, fixtureSleeperPlayers, padDynastyCsv, sleeperListsWith } from "./testSupport";
import type { PlayerIdResolver } from "./types";

// Fictional players with made-up ids, except the block on the two real players the same-player
// override fixes (public NFL player records and ids; CLAUDE.md §2.9 asks for a test on them).
const S =(id: string, over: Partial<SleeperPlayerRecord> = {}): SleeperPlayerRecord => ({
  id,
  name: `Player ${id}`,
  position: "WR",
  fantasyPositions: ["WR"],
  team: "DAL",
  injuryStatus: null,
  status: "Active",
  age: 25,
  active: true,
  yearsExp: 3,
  firstName: null,
  lastName: null,
  espnId: null,
  yahooId: null,
  sportradarId: null,
  gsisId: null,
  ...over,
});
const D = (over: Partial<DynastyRow>): DynastyRow => ({ sleeperId: null, espnId: null, yahooId: null, mflId: null, fleaflickerId: null, sportradarId: null, gsisId: null, name: "", position: "WR", team: null, ...over });
const F = (over: Partial<FantasyCalcPlayerIds>): FantasyCalcPlayerIds => ({ fantasyCalcId: "1", name: "", position: "WR", sleeperId: null, espnId: null, mflId: null, fleaflickerId: null, team: null, ...over });

const UUID_A = "0a1b2c3d-0000-4000-8000-00000000aaaa";

function data(over: Partial<CrosswalkData> = {}): CrosswalkData {
  return {
    sleeperPlayers: [
      S("1"),
      S("2", { espnId: "200", yahooId: "2200", gsisId: "00-0000002" }),
      S("3"),
      S("4"),
      S("5"),
      S("6", { active: false }),
      S("7", { espnId: "500" }),
      S("9"),
      S("10", { sportradarId: UUID_A }),
      S("DAL", { name: "Dallas Cowboys", position: "DEF", fantasyPositions: ["DEF"], firstName: "Dallas", lastName: "Cowboys", age: null, yearsExp: null }),
      S("JAX", { name: "Jacksonville Jaguars", position: "DEF", fantasyPositions: ["DEF"], team: "JAX", firstName: "Jacksonville", lastName: "Jaguars" }),
    ],
    dynastyRows: [
      D({ sleeperId: "1", espnId: "100", mflId: "0501", fleaflickerId: "7001", yahooId: "1100", gsisId: "00-0000001" }),
      D({ sleeperId: "4", espnId: "400" }),
      D({ sleeperId: "6", espnId: "500" }),
      D({ sleeperId: "8", espnId: "600" }),
      D({ sleeperId: "9", espnId: "600" }),
      D({ sleeperId: "11", sportradarId: UUID_A }),
    ],
    fantasyCalcPlayers: [F({ sleeperId: "1", espnId: "100", mflId: "0501" }), F({ sleeperId: "3", espnId: "300" }), F({ sleeperId: "5", espnId: "400", fleaflickerId: "7005" })],
    fetchedAt: "2026-09-29T20:15:00.000Z",
    ...over,
  };
}

describe("resolverFromData: platform ids → Sleeper ids", () => {
  const r = resolverFromData(data());

  it("follows the Phase 0 source order per id kind", () => {
    expect(ID_SOURCE_PRIORITY.espn).toEqual(["dynastyProcess", "fantasyCalc", "sleeper"]);
    expect(ID_SOURCE_PRIORITY.sportradar).toEqual(["sleeper", "dynastyProcess"]);
    expect(ID_SOURCE_PRIORITY.fantrax).toEqual([]);
    expect(r.canonical("espn", "100")).toBe("1"); // DynastyProcess and FantasyCalc agree: no conflict
    expect(r.conflict("espn", "100")).toBeUndefined();
    expect(r.canonical("espn", "200")).toBe("2"); // only the Sleeper DB knows it
    expect(r.canonical("espn", "300")).toBe("3"); // only FantasyCalc knows it
    expect(r.canonical("mfl", "0501")).toBe("1");
    expect(r.canonical("fleaflicker", "7001")).toBe("1");
    expect(r.canonical("fleaflicker", "7005")).toBe("5");
    expect(r.canonical("yahoo", "1100")).toBe("1");
    expect(r.canonical("yahoo", "2200")).toBe("2");
    expect(r.canonical("gsis", "00-0000002")).toBe("2");
    expect(r.canonical("fantrax", "abc12")).toBeUndefined();
  });

  it("normalizes the id it is asked about", () => {
    expect(r.canonical("espn", " 100 ")).toBe("1");
    expect(r.canonical("espn", "-16025")).toBeUndefined();
    expect(r.canonical("espn", "NA")).toBeUndefined();
    expect(r.canonical("espn", "999")).toBeUndefined();
    expect(r.canonical("sportradar", UUID_A.toUpperCase())).toBe("10");
  });

  it("resolves conflicts between sources by source order, even when a later source offers an active player", () => {
    // DynastyProcess 4 vs FantasyCalc 5, both active → source order.
    expect(r.conflict("espn", "400")).toEqual({
      source: "espn",
      platformId: "400",
      options: [
        { sleeperId: "4", from: ["dynastyProcess"], active: true },
        { sleeperId: "5", from: ["fantasyCalc"], active: true },
      ],
      chosen: "4",
      resolvedBy: "source order",
      withinSource: false,
    });
    expect(r.canonical("espn", "400")).toBe("4");
    // DynastyProcess says 6 (not in Sleeper's active lists), the Sleeper DB says 7 (active) → still DynastyProcess.
    expect(r.canonical("espn", "500")).toBe("6");
    expect(r.conflict("espn", "500")).toMatchObject({ chosen: "6", resolvedBy: "source order", withinSource: false });
    // Sportradar: the Sleeper DB goes first.
    expect(r.conflict("sportradar", UUID_A)).toMatchObject({ chosen: "10", resolvedBy: "source order" });
    expect(r.conflicts()).toHaveLength(4);
  });

  it("uses the active player only to break a tie inside one source", () => {
    // Two DynastyProcess rows share an ESPN id; only 9 is an active Sleeper player → 9, flagged as a duplicate inside one source.
    expect(r.canonical("espn", "600")).toBe("9");
    expect(r.conflict("espn", "600")).toMatchObject({ chosen: "9", withinSource: true, resolvedBy: "active player" });
    // A duplicate inside a LOWER source doesn't beat the top source: DynastyProcess 21 (retired) wins over FantasyCalc's 22/23.
    const lower = resolverFromData(
      data({
        sleeperPlayers: [S("22"), S("23")],
        dynastyRows: [D({ sleeperId: "21", espnId: "900" })],
        fantasyCalcPlayers: [F({ sleeperId: "22", espnId: "900" }), F({ sleeperId: "23", espnId: "900" })],
      }),
    );
    expect(lower.conflict("espn", "900")).toMatchObject({ chosen: "21", resolvedBy: "source order", withinSource: true });
  });

  it("keeps a retired player's old ESPN id on him when FantasyCalc gives it to an active namesake (review DATA-3)", () => {
    // Fictional version of the Phase 1 finding: an old ESPN id that DynastyProcess maps to a retired
    // cornerback, while FantasyCalc gives the same id to an active running back with the same name.
    const namesake = resolverFromData(
      data({
        sleeperPlayers: [S("71222", { name: "Brontis Vellamo", position: "RB", fantasyPositions: ["RB"], team: "KC" })],
        sleeperCompletePositions: ["QB", "RB", "WR", "TE", "K", "P", "DEF", "DL", "LB", "DB"],
        dynastyRows: [D({ sleeperId: "71583", espnId: "95888", name: "Brontis Vellamo", position: "CB", team: "DAL" })],
        fantasyCalcPlayers: [F({ sleeperId: "71222", espnId: "95888", name: "Brontis Vellamo", position: "RB", team: "KC" })],
      }),
    );
    expect(namesake.canonical("espn", "95888")).toBe("71583");
    const conflict = namesake.conflict("espn", "95888");
    expect(conflict).toEqual({
      source: "espn",
      platformId: "95888",
      options: [
        { sleeperId: "71583", from: ["dynastyProcess"], active: false },
        { sleeperId: "71222", from: ["fantasyCalc"], active: true },
      ],
      chosen: "71583",
      resolvedBy: "source order",
      withinSource: false,
    });
    // Through the PlayerIdResolver contract, as adapters see it.
    const asResolver: PlayerIdResolver = namesake;
    expect(asResolver.conflict?.("espn", " 95888 ")).toMatchObject({ chosen: "71583", options: [{ sleeperId: "71583" }, { sleeperId: "71222" }] });
    expect(asResolver.conflict?.("espn", "400")).toBeUndefined();
    // He's the retired cornerback, not the running back.
    expect(namesake.sleeperPlayer("71583")).toMatchObject({ name: "Brontis Vellamo", position: "CB", active: false, team: null });
  });

  it("overrides the top source when it links a Sleeper id that isn't an active player and a lower source's player matches its row (name, position, and team or GSIS id; §2.9)", () => {
    const ALL = ["QB", "RB", "WR", "TE", "K", "P", "DEF", "DL", "LB", "DB"];
    const dup = resolverFromData(
      data({
        sleeperPlayers: [
          S("71558", { name: "Tavish Morrow", position: "QB", fantasyPositions: ["QB"], team: "WAS" }),
          // Sleeper's own data gives the Yahoo id to two records; only 75815 shares the GSIS id.
          S("75816", { name: "Kellan Oduya", position: "CB", fantasyPositions: ["DB"], team: null, yahooId: "91636" }),
          S("75815", { name: "Kellan Oduya", position: "CB", fantasyPositions: ["DB"], team: null, gsisId: "00-0099641", yahooId: "91636" }),
          S("71413", { name: "Rodrick Vale", position: "RB", fantasyPositions: ["RB"], team: null }),
        ],
        sleeperCompletePositions: ALL,
        dynastyRows: [
          // DynastyProcess's rows describe the first two players but carry Sleeper ids that aren't active
          // fantasy players (wrong links; the real cases are in the block below).
          D({ sleeperId: "71376", espnId: "94361994", mflId: "96587", name: "Tavish Morrow", position: "QB", team: "WAS" }),
          D({ sleeperId: "72682", espnId: "93116104", yahooId: "91636", name: "Kellan Oduya", position: "CB", team: null, gsisId: "00-0099641" }),
          // A retired back and a rookie namesake at the same position, no shared team or GSIS id: different people.
          D({ sleeperId: "70258", espnId: "98417", name: "Rodrick Vale", position: "RB", team: null, gsisId: "00-0099437" }),
          // Same name and team but another position: different people.
          D({ sleeperId: "73000", espnId: "97000", name: "Tavish Morrow", position: "TE", team: "WAS" }),
        ],
        fantasyCalcPlayers: [
          F({ sleeperId: "71558", espnId: "94361994", mflId: "96587", name: "Tavish Morrow", position: "QB", team: "WAS" }),
          F({ sleeperId: "71413", espnId: "98417", name: "Rodrick Vale", position: "RB" }),
          F({ sleeperId: "71558", espnId: "97000", name: "Tavish Morrow", position: "QB", team: "WAS" }),
        ],
      }),
    );
    // Same name, position and team.
    expect(dup.canonical("espn", "94361994")).toBe("71558");
    expect(dup.canonical("mfl", "96587")).toBe("71558");
    expect(dup.conflict("espn", "94361994")).toMatchObject({ chosen: "71558", resolvedBy: "same player", sameBy: ["team"], options: [{ sleeperId: "71376", active: false }, { sleeperId: "71558", active: true }] });
    // Same name and position, same GSIS id (no team): picks the record with that GSIS id, not the namesake record 75816.
    expect(dup.canonical("yahoo", "91636")).toBe("75815");
    expect(dup.conflict("yahoo", "91636")).toMatchObject({ resolvedBy: "same player", sameBy: ["gsis"] });
    // Same name and position, nothing else shared: source order keeps the retired player.
    expect(dup.canonical("espn", "98417")).toBe("70258");
    expect(dup.conflict("espn", "98417")?.resolvedBy).toBe("source order");
    expect(dup.conflict("espn", "98417")?.sameBy).toBeUndefined();
    // Same name and team, different position: source order.
    expect(dup.canonical("espn", "97000")).toBe("73000");
    // overrides() lists exactly the "same player" resolutions.
    expect(dup.overrides().map((c) => `${c.source} ${c.platformId}`)).toEqual(["espn 94361994", "mfl 96587", "yahoo 91636", "gsis 00-0099641"]);
    expect(dup.overrides().every((c) => c.resolvedBy === "same player")).toBe(true);
  });

  it("never overrides when the top source's row differs on team and GSIS id, has no fantasy position, or spells the name differently", () => {
    const ALL = ["QB", "RB", "WR", "TE", "K", "P", "DEF", "DL", "LB", "DB"];
    const r2 = resolverFromData(
      data({
        sleeperPlayers: [S("81558", { name: "Tavish Morrow", position: "QB", fantasyPositions: ["QB"], team: "WAS", gsisId: "00-0098001" }), S("81999", { team: "DAL" })],
        sleeperCompletePositions: ALL,
        dynastyRows: [
          // Same name and position, another team and no GSIS id.
          D({ sleeperId: "81376", espnId: "84000001", name: "Tavish Morrow", position: "QB", team: "DAL" }),
          // Same team and GSIS id, but DynastyProcess's position code is unknown ("XX").
          D({ sleeperId: "81377", espnId: "84000002", name: "Tavish Morrow", position: "XX", team: "WAS", gsisId: "00-0098001" }),
          // A different name (nickname) with the same team.
          D({ sleeperId: "81378", espnId: "84000003", name: "Tav Morrow", position: "QB", team: "WAS" }),
        ],
        fantasyCalcPlayers: ["84000001", "84000002", "84000003"].map((espnId) => F({ sleeperId: "81558", espnId, name: "Tavish Morrow", position: "QB", team: "WAS" })),
      }),
    );
    for (const [espnId, top] of [
      ["84000001", "81376"],
      ["84000002", "81377"],
      ["84000003", "81378"],
    ] as const) {
      expect(r2.canonical("espn", espnId), espnId).toBe(top);
      expect(r2.conflict("espn", espnId)?.resolvedBy, espnId).toBe("source order");
    }
    expect(r2.overrides()).toEqual([]);
  });

  it("falls back to source order when the Sleeper DB is unavailable", () => {
    const noSleeper = resolverFromData(data({ sleeperPlayers: null, dynastyRows: [...(data().dynastyRows ?? []), D({ sleeperId: "14", espnId: "1400", name: "Orvald Tensk", position: "WR", team: "DAL" })] }));
    expect(noSleeper.canonical("espn", "500")).toBe("6");
    expect(noSleeper.canonical("espn", "600")).toBe("8");
    expect(noSleeper.canonical("espn", "200")).toBeUndefined();
    expect(noSleeper.canonical("espn", "1400")).toBe("14");
    // A named DynastyProcess row still gives the player's facts, but whether he's active is unknown.
    expect(noSleeper.sleeperPlayer("14")).toEqual({ id: "14", name: "Orvald Tensk", position: "WR", fantasyPositions: ["WR"], team: "DAL", injuryStatus: null, status: null, age: null, active: null, yearsExp: null });
    // DynastyProcess rows without a name give nothing.
    expect(noSleeper.sleeperPlayer("1")).toBeUndefined();
  });

  it("counts mapped ids per kind", () => {
    expect(r.mappedCount("espn")).toBe(6); // 100 200 300 400 500 600
    expect(r.mappedCount("fantrax")).toBe(0);
  });
});

describe("the real players the same-player override fixes (Checkpoint 1 answer 2; public records), as the app builds the crosswalk", () => {
  // Minimal copies of the public rows behind the overrides found when the crosswalk was rebuilt from the cached sources
  // (Sleeper lists 2026-09-30, DynastyProcess 2026-09-29): Sleeper records 11558, 5815 and 2110; DynastyProcess rows for
  // Sleeper 11376, 2682 and 2110. Neither case is a stale record of the same person. In Sleeper's full DB, 11376 is
  // Richard Gouraige (OL, so not in the fantasy-position lists; born 1998-10-15, the birthdate on DynastyProcess's "Sam
  // Hartman" row) and 2682 is Christion Jones (WR, inactive): DynastyProcess links both players to another man. (nflverse's
  // 2025 rosters also give Sam Hartman sleeper_id 11376, with ESPN id 4361994 and GSIS id 00-0039677.)
  //
  // Built the way the app builds it (review of Checkpoint 7b's server work: this block once read FantasyCalc's /players
  // rows, which the loader no longer supplies, so it passed on a path the app never takes): src/data/load.ts through
  // loadPlayerIdResolver, from Sleeper's player lists and DynastyProcess's CSV only (FantasyCalc's conditions of 2026-10-05
  // allow only /values/current), every list loaded fully. FantasyCalc's /players rows 11709 (Sam Hartman: sleeperId 11558,
  // ESPN 4361994, MFL 16587) and 8340 ("Christion Jones" with Chris Jones's ESPN and MFL ids) were the lower source behind 2
  // of the 5 overrides; without them those 2 are gone (pinned below), and Chris Jones's 3 rest on the Sleeper DB alone.
  const ALL = ["QB", "RB", "WR", "TE", "K", "P", "DEF", "DL", "LB", "DB"];
  const SLEEPER = sleeperListsWith({
    QB: { "11558": { full_name: "Sam Hartman", position: "QB", fantasy_positions: ["QB"], team: "WAS", active: true, age: 27, years_exp: 2, sportradar_id: "7e65f950-06ee-11ef-82bc-b549600b8321" } },
    // Christian Jones (LB): Sleeper gives him Chris Jones's GSIS id too (DynastyProcess has 00-0031130 for him).
    LB: {
      "2110": { full_name: "Christian Jones", position: "LB", fantasy_positions: ["LB"], team: null, active: true, age: 31, years_exp: 8, espn_id: "17070", yahoo_id: "27839", sportradar_id: "10d49d75-aa4a-4d26-b9b5-c74f4e3c9ac8", gsis_id: "00-0034641" },
    },
    DB: {
      "5815": { full_name: "Chris Jones", position: "CB", fantasy_positions: ["DB"], team: null, active: true, age: 27, years_exp: 4, espn_id: "3116104", yahoo_id: "31636", sportradar_id: "351963c7-bdc1-4966-bed2-845ccddfdfbf", gsis_id: "00-0034641" },
    },
  });
  const DP_CSV = padDynastyCsv(
    "sleeper_id,espn_id,yahoo_id,mfl_id,fleaflicker_id,sportradar_id,gsis_id,name,position,team\n" +
      "11376,4361994,NA,16587,NA,007971f0-f012-11ed-833c-ebfbb713adc7,00-0039677,Sam Hartman,QB,WAS\n" +
      "2682,3116104,31636,14683,NA,351963c7-bdc1-4966-bed2-845ccddfdfbf,00-0034641,Chris Jones,CB,NA\n" +
      "2110,17070,27839,11724,NA,10d49d75-aa4a-4d26-b9b5-c74f4e3c9ac8,00-0031130,Christian Jones,LB,NA\n",
  );
  let real: PlayerIdCrosswalk;
  beforeAll(async () => {
    const { http, calls } = fakeHttp({ ...Object.fromEntries(SLEEPER_PLAYER_POSITIONS.map((p) => [sleeperPlayersUrl(p), { json: SLEEPER[p] }])), [DYNASTYPROCESS_IDS_URL]: { text: DP_CSV } });
    real = await loadPlayerIdResolver({ http, now: new Date("2026-10-05T12:00:00.000Z") });
    // The loader's two sources and nothing else (no FantasyCalc request), every list loaded fully.
    expect(calls.map((c) => c.url).sort()).toEqual([...SLEEPER_PLAYER_POSITIONS.map((p) => sleeperPlayersUrl(p)), DYNASTYPROCESS_IDS_URL].sort());
    expect(real.sources().map((s) => s.name)).toEqual(["Sleeper players", "DynastyProcess player IDs"]);
    expect(real.warnings()).toEqual([]);
  });

  it("maps Chris Jones's ESPN, Yahoo and GSIS ids to his active record 5815: same name, position (CB = DB) and GSIS id; not the LB who shares that GSIS id in Sleeper", () => {
    for (const [kind, id] of [
      ["espn", "3116104"],
      ["yahoo", "31636"],
      ["gsis", "00-0034641"],
    ] as const)
      expect(real.canonical(kind, id), `${kind} ${id}`).toBe("5815");
    expect(real.conflict("espn", "3116104")).toEqual({
      source: "espn",
      platformId: "3116104",
      options: [
        { sleeperId: "2682", from: ["dynastyProcess"], active: false },
        { sleeperId: "5815", from: ["sleeper"], active: true },
      ],
      chosen: "5815",
      resolvedBy: "same player",
      sameBy: ["gsis"],
      withinSource: false,
    });
    expect(real.conflict("yahoo", "31636")).toMatchObject({ options: [{ sleeperId: "2682", from: ["dynastyProcess"] }, { sleeperId: "5815", from: ["sleeper"] }], chosen: "5815", resolvedBy: "same player", sameBy: ["gsis"] });
    expect(real.conflict("gsis", "00-0034641")).toEqual({
      source: "gsis",
      platformId: "00-0034641",
      options: [
        { sleeperId: "2682", from: ["dynastyProcess"], active: false },
        { sleeperId: "2110", from: ["sleeper"], active: true },
        { sleeperId: "5815", from: ["sleeper"], active: true },
      ],
      chosen: "5815",
      resolvedBy: "same player",
      sameBy: ["gsis"],
      withinSource: true,
    });
    // His Sportradar id: the Sleeper DB is the top source there and links 5815 itself (source order, not an override).
    expect(real.conflict("sportradar", "351963c7-bdc1-4966-bed2-845ccddfdfbf")).toMatchObject({ chosen: "5815", resolvedBy: "source order" });
  });

  it("known regression since FantasyCalc's conditions of 2026-10-05 (⚠️ the lead's call: accept, or a pinned link): Sam Hartman's ESPN and MFL ids follow DynastyProcess's wrong link 11376 again, since no source the app reads links his active record, so he reads as not an active player", () => {
    for (const [kind, id] of [
      ["espn", "4361994"],
      ["mfl", "16587"],
    ] as const) {
      expect(real.canonical(kind, id), `${kind} ${id}`).toBe("11376");
      expect(real.conflict(kind, id), `${kind} ${id}`).toBeUndefined();
    }
    expect(real.sleeperPlayer("11376")).toMatchObject({ name: "Sam Hartman", position: "QB", active: false, team: null });
    // His own active record is loaded, but nothing links an ESPN or MFL id to it (Sleeper's record carries no ESPN id).
    expect(real.sleeperPlayer("11558")).toMatchObject({ name: "Sam Hartman", position: "QB", team: "WAS", active: true });
  });

  it("lists exactly Chris Jones's 3 platform ids as overrides (5 while FantasyCalc's /players rows were a source), and nothing else as one", () => {
    expect(real.overrides().map((c) => `${c.source} ${c.platformId} → ${c.chosen}`)).toEqual(["espn 3116104 → 5815", "yahoo 31636 → 5815", "gsis 00-0034641 → 5815"]);
    expect(real.conflicts()).toHaveLength(4); // the 3 overrides + the Sportradar id above
    // Ids the sources agree on stay out of both lists.
    expect(real.canonical("espn", "17070")).toBe("2110");
    expect(real.conflict("espn", "17070")).toBeUndefined();
  });

  it("pins the links the rule can't fix, because no other source contradicts them (Phase 5 MFL IDP and Fleaflicker Sportradar joins, Phase 6 nflverse GSIS joins)", () => {
    // MFL 14683 is Chris Jones, CB (MFL's 2019 player list), but DynastyProcess links it to Christion Jones (as FantasyCalc's
    // /players row did): no conflict, so it stays wrong.
    expect(real.canonical("mfl", "14683")).toBe("2682");
    expect(real.conflict("mfl", "14683")).toBeUndefined();
    // GSIS 00-0039677 is Sam Hartman's (nflverse 2025 rosters); only DynastyProcess links it, to 11376.
    expect(real.canonical("gsis", "00-0039677")).toBe("11376");
    expect(real.conflict("gsis", "00-0039677")).toBeUndefined();
    // The Sportradar id on DynastyProcess's row is disputed: Sleeper's full DB gives it to the lineman
    // (11376), nflverse to Sam Hartman. The crosswalk loads no linemen, so only DynastyProcess links it.
    expect(real.canonical("sportradar", "007971f0-f012-11ed-833c-ebfbb713adc7")).toBe("11376");
    // What those links resolve to: DynastyProcess's own rows, so a "Sam Hartman" and a "Chris Jones" who aren't active players.
    expect(real.sleeperPlayer("11376")).toMatchObject({ name: "Sam Hartman", position: "QB", active: false, team: null });
    expect(real.sleeperPlayer("2682")).toMatchObject({ name: "Chris Jones", position: "CB", fantasyPositions: ["DB"], active: false });
  });

  it("the rule itself (CLAUDE.md §2.9) still fixes Sam Hartman wherever a lower-priority source links his active record, as FantasyCalc's /players row did until 2026-10-05", () => {
    const withLowerSource = resolverFromData({
      sleeperPlayers: [S("11558", { name: "Sam Hartman", position: "QB", fantasyPositions: ["QB"], team: "WAS", age: 27, yearsExp: 2, sportradarId: "7e65f950-06ee-11ef-82bc-b549600b8321" })],
      sleeperCompletePositions: ALL,
      dynastyRows: [D({ sleeperId: "11376", espnId: "4361994", mflId: "16587", sportradarId: "007971f0-f012-11ed-833c-ebfbb713adc7", gsisId: "00-0039677", name: "Sam Hartman", position: "QB", team: "WAS" })],
      fantasyCalcPlayers: [F({ fantasyCalcId: "11709", sleeperId: "11558", espnId: "4361994", mflId: "16587", name: "Sam Hartman", position: "QB", team: "WAS" })],
      fetchedAt: null,
    });
    const options = [
      { sleeperId: "11376", from: ["dynastyProcess"], active: false },
      { sleeperId: "11558", from: ["fantasyCalc"], active: true },
    ];
    expect(withLowerSource.conflict("espn", "4361994")).toEqual({ source: "espn", platformId: "4361994", options, chosen: "11558", resolvedBy: "same player", sameBy: ["team"], withinSource: false });
    expect(withLowerSource.conflict("mfl", "16587")).toEqual({ source: "mfl", platformId: "16587", options, chosen: "11558", resolvedBy: "same player", sameBy: ["team"], withinSource: false });
  });
});

describe("resolverFromData: players, defenses and sources", () => {
  const r = resolverFromData(data());

  it("returns the public SleeperPlayerLite view only", () => {
    expect(r.sleeperPlayer("2")).toEqual({ id: "2", name: "Player 2", position: "WR", fantasyPositions: ["WR"], team: "DAL", injuryStatus: null, status: "Active", age: 25, active: true, yearsExp: 3 });
    expect(r.sleeperPlayer("nope")).toBeUndefined();
  });

  describe("DynastyProcess fallback for players missing from Sleeper's active lists (review DATA-1)", () => {
    const ALL = ["QB", "RB", "WR", "TE", "K", "P", "DEF", "DL", "LB", "DB"];
    const retiredRow = D({ sleeperId: "12", name: "Quillon Farbreaker", position: "PK", team: "DAL" });
    const build = (complete: string[] | undefined) => resolverFromData(data({ dynastyRows: [...(data().dynastyRows ?? []), retiredRow], ...(complete ? { sleeperCompletePositions: complete } : {}) }));

    it("calls him not active, with no team, only when every Sleeper player list loaded fully", () => {
      expect(build(ALL).sleeperPlayer("12")).toEqual({ id: "12", name: "Quillon Farbreaker", position: "K", fantasyPositions: ["K"], team: null, injuryStatus: null, status: null, age: null, active: false, yearsExp: null });
      // DEF holds no players, so the player lists are enough.
      expect(build(ALL.filter((p) => p !== "DEF")).sleeperPlayer("12")?.active).toBe(false);
    });

    it("leaves his status unknown (and keeps DynastyProcess's team) when any player list failed, was partial or stale", () => {
      // His own position's list (K) loaded, but a player can sit in another list than DynastyProcess says (DL/LB, WR/TE…).
      for (const missing of ["WR", "LB", "K"]) {
        expect(build(ALL.filter((p) => p !== missing)).sleeperPlayer("12"), missing).toMatchObject({ active: null, team: "DAL", name: "Quillon Farbreaker" });
      }
      // Not told which lists loaded: never claim "retired".
      expect(build(undefined).sleeperPlayer("12")).toMatchObject({ active: null, team: "DAL" });
      expect(build([]).sleeperPlayer("12")?.active).toBeNull();
    });

    it("never overrides an active Sleeper record, and skips positions DynastyProcess doesn't map", () => {
      expect(build(ALL).sleeperPlayer("1")?.active).toBe(true);
      expect(build(undefined).sleeperPlayer("1")?.active).toBe(true);
      // Offensive linemen and "XX" stay unknown.
      const ol = resolverFromData(data({ dynastyRows: [D({ sleeperId: "13", name: "Brontis Vell", position: "OT" })], sleeperCompletePositions: ALL }));
      expect(ol.sleeperPlayer("13")).toBeUndefined();
    });
  });

  it("gives Sleeper DEF ids for codes, aliases and nicknames", () => {
    expect(r.defenseId("DAL")).toBe("DAL");
    expect(r.defenseId("Cowboys")).toBe("DAL");
    expect(r.defenseId("Jaguars D/ST")).toBe("JAX");
    expect(r.defenseId("FA")).toBeUndefined();
    expect(r.defenseId("ZZZ")).toBeUndefined();
  });

  it("derives aliases from DynastyProcess rows (≥ 3 agreeing players)", () => {
    const withJac = resolverFromData(
      data({
        sleeperPlayers: [S("21", { team: "JAX" }), S("22", { team: "JAX" }), S("23", { team: "JAX" }), S("24", { team: "DAL" })],
        dynastyRows: ["21", "22", "23"].map((id) => D({ sleeperId: id, team: "JAC" })),
      }),
    );
    expect(withJac.defenseId("JAC")).toBe("JAX");
    expect(withJac.teamAliases()).toEqual([{ code: "JAC", to: "JAX", support: 3, voters: 3, sources: ["DynastyProcess"] }]);
  });

  it("uses FantasyCalc's team codes when the Sleeper DB is unavailable", () => {
    const fcOnly = resolverFromData(data({ sleeperPlayers: null, fantasyCalcPlayers: [F({ sleeperId: "1", team: "WAS" }), F({ sleeperId: "2", team: "LAR" })] }));
    expect(fcOnly.defenseId("WSH")).toBe("WAS");
    expect(fcOnly.defenseId("LA")).toBe("LAR");
  });

  it("maps all 32 ESPN team abbreviations with DynastyProcess alone (Sleeper's codes seeded; review DATA-6)", () => {
    const dpOnly = resolverFromData({ sleeperPlayers: null, dynastyRows: fixtureDynastyRows(), fantasyCalcPlayers: null });
    const espnTeams = fixtureEspnProTeams();
    expect(espnTeams).toHaveLength(32);
    const mapped = new Set(espnTeams.map((t) => dpOnly.defenseId(t.abbrev)));
    expect(mapped).toEqual(new Set(SLEEPER_TEAM_CODES));
    expect(dpOnly.defenseId("WSH")).toBe("WAS");
    expect(dpOnly.defenseId("ZZZ")).toBeUndefined();
    // FantasyCalc's codes, when it loaded, still take precedence over the seed.
    const fcOnly = resolverFromData({ sleeperPlayers: null, dynastyRows: null, fantasyCalcPlayers: [F({ sleeperId: "1", team: "DAL" })] });
    expect(fcOnly.defenseId("DAL")).toBe("DAL");
    expect(fcOnly.defenseId("KC")).toBeUndefined();
  });

  it("reports source status, timestamps and warnings", () => {
    expect(r.sources()).toEqual([
      { name: "Sleeper players", fetchedAt: "2026-09-29T20:15:00.000Z" },
      { name: "DynastyProcess player IDs", fetchedAt: "2026-09-29T20:15:00.000Z" },
      { name: "FantasyCalc players", fetchedAt: "2026-09-29T20:15:00.000Z" },
    ]);
    expect(r.warnings()).toEqual([]);
    const degraded = resolverFromData(
      data({
        fantasyCalcPlayers: null,
        fetchedAt: { sleeper: null, dynastyProcess: "2026-09-29T20:14:21.038Z" },
        fromCache: { sleeper: true },
        notes: { fantasyCalc: "FantasyCalc players: HTTP 503", sleeper: "the P list could not be loaded (HTTP 500)" },
      }),
    );
    expect(degraded.status()).toEqual([
      { key: "sleeper", name: "Sleeper players", available: true, rows: 11, fetchedAt: null, fromCache: true, note: "the P list could not be loaded (HTTP 500)" },
      { key: "dynastyProcess", name: "DynastyProcess player IDs", available: true, rows: 6, fetchedAt: "2026-09-29T20:14:21.038Z", fromCache: false },
      { key: "fantasyCalc", name: "FantasyCalc players", available: false, rows: 0, fetchedAt: null, fromCache: false, note: "FantasyCalc players: HTTP 503" },
    ]);
    expect(degraded.warnings().map((w) => w.code)).toEqual(["ID_SOURCE_PARTIAL", "ID_SOURCE_UNAVAILABLE"]);
    expect(degraded.warnings()[1]?.message).toBe("FantasyCalc players could not be loaded (FantasyCalc players: HTTP 503), so some players may keep platform ids instead of Sleeper ids.");
    // Without the Sleeper DB the Import Report says what that costs (not just platform ids).
    const noSleeper = resolverFromData(data({ sleeperPlayers: null, notes: { sleeper: "Sleeper players (QB): HTTP 503" } }));
    expect(noSleeper.warnings()).toEqual([
      { code: "ID_SOURCE_UNAVAILABLE", message: "Sleeper players could not be loaded (Sleeper players (QB): HTTP 503), so some player details (such as age) may be missing, and retired players can't be told apart from active ones." },
    ]);
  });
});

describe("matchByName (fallback)", () => {
  const r = resolverFromData(
    data({
      sleeperPlayers: [
        S("31", { name: "Zorblax Quintavious", position: "K", fantasyPositions: ["K"], team: "GB" }),
        S("32", { name: "Quillon Thrasp", position: "RB", fantasyPositions: ["RB"], team: "WAS" }),
        S("33", { name: "Quillon Thrasp", position: "RB", fantasyPositions: ["RB"], team: "WAS" }),
        S("34", { name: "Vexmund Orr", position: "TE", fantasyPositions: ["TE"], team: null }),
        S("35", { name: "Dray Kallisto", position: "QB", fantasyPositions: ["QB"], team: "NE", active: false }),
      ],
    }),
  );

  it("returns the only active player with that name, position and team", () => {
    expect(r.matchByName({ name: "Zorblax Quintavious", position: "K", team: "GB" })).toBe("31");
    expect(r.matchByName({ name: "Zorblax Quintavious Jr.", position: "k", team: "gb" })).toBe("31");
  });

  it("never matches a player with no NFL team, even when exactly one active player fits (Checkpoint 1 answer 1: name + position + NFL team)", () => {
    // 34 is the only active TE with this name, and he's a free agent too: still no match.
    expect(r.matchByName({ name: "Vexmund Orr", position: "TE", team: null })).toBeUndefined();
    expect(r.matchByName({ name: "Vexmund Orr", position: "TE", team: "FA" })).toBeUndefined(); // ESPN's free-agent "team"
    expect(r.matchByName({ name: "Vexmund Orr", position: "TE", team: "" })).toBeUndefined();
    expect(r.matchByName({ name: "Zorblax Quintavious", position: "K", team: null })).toBeUndefined();
    expect(r.matchByName({ name: "Zorblax Quintavious", position: "", team: "GB" })).toBeUndefined();
  });

  it("refuses ambiguous, mismatched or inactive candidates", () => {
    expect(r.matchByName({ name: "Quillon Thrasp", position: "RB", team: "WSH" })).toBeUndefined(); // two candidates
    expect(r.matchByName({ name: "Zorblax Quintavious", position: "K", team: "DAL" })).toBeUndefined();
    expect(r.matchByName({ name: "Zorblax Quintavious", position: "P", team: "GB" })).toBeUndefined();
    expect(r.matchByName({ name: "Vexmund Orr", position: "TE", team: "DAL" })).toBeUndefined();
    expect(r.matchByName({ name: "Dray Kallisto", position: "QB", team: "NE" })).toBeUndefined();
    expect(r.matchByName({ name: "Zorblax Quintavious", position: "K", team: "XYZ" })).toBeUndefined();
  });

  it("compares names on letters only, without accents or suffixes", () => {
    expect(playerNameKey("Zörblax Quintavious III")).toBe("zorblaxquintavious");
    expect(playerNameKey("D'Vexmund O'Orr Sr.")).toBe("dvexmundoorr");
  });
});

describe("Parker's ESPN league on committed fixtures (Phase 1 coverage target: ≥ 98% of QB/RB/WR/TE)", () => {
  const r = resolverFromData({ sleeperPlayers: fixtureSleeperPlayers(), dynastyRows: fixtureDynastyRows(), fantasyCalcPlayers: fixtureFantasyCalcPlayers(), fetchedAt: null });
  const espnTeams = fixtureEspnProTeams();
  const abbrevOf = new Map(espnTeams.map((t) => [t.id, t.abbrev]));
  const rostered = fixtureEspnRostered();
  const resolve = (p: (typeof rostered)[number]) => (p.pos === "D/ST" ? r.defenseId(abbrevOf.get(p.proTeamId) ?? "") : r.canonical("espn", p.espnId));

  it("maps rostered QB/RB/WR/TE to Sleeper ids", () => {
    const skill = rostered.filter((p) => ["QB", "RB", "WR", "TE"].includes(p.pos));
    const misses = skill.filter((p) => !resolve(p)).map((p) => `${p.name} (${p.pos})`);
    expect(skill.length).toBeGreaterThan(100);
    expect(1 - misses.length / skill.length, `misses: ${misses.join(", ")}`).toBeGreaterThanOrEqual(0.98);
  });

  it("maps every rostered D/ST through defenseId(ESPN abbreviation)", () => {
    const dst = rostered.filter((p) => p.pos === "D/ST");
    expect(dst.length).toBeGreaterThan(0);
    for (const p of dst) expect(resolve(p), `proTeamId ${p.proTeamId}`).toMatch(/^[A-Z]{2,3}$/);
  });

  it("agrees with ESPN on team and position wherever a Sleeper record is loaded", () => {
    const sleeperPos: Record<string, string> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", "D/ST": "DEF" };
    let compared = 0;
    for (const p of rostered) {
      const sid = resolve(p);
      const sp = sid ? r.sleeperPlayer(sid) : undefined;
      if (sp?.active !== true) continue; // DynastyProcess fallbacks are checked below
      compared++;
      expect(sp.team, `${p.name} team`).toBe(r.defenseId(abbrevOf.get(p.proTeamId) ?? ""));
      const pos = sleeperPos[p.pos] ?? p.pos;
      expect(sp.position === pos || sp.fantasyPositions.includes(pos), `${p.name} position`).toBe(true);
    }
    expect(compared).toBeGreaterThan(100);
  });

  it("never labels a rostered player retired when the Sleeper lists are only partly loaded (the committed subset)", () => {
    // The committed Sleeper records are a subset of the lists, like a load where some lists failed:
    // rostered players missing from it fall back to DynastyProcess with an UNKNOWN status.
    const fallbacks = rostered.flatMap((p) => {
      const sid = resolve(p);
      const sp = sid ? r.sleeperPlayer(sid) : undefined;
      return sp && sp.active !== true ? [{ p, sp }] : [];
    });
    expect(fallbacks.length).toBeGreaterThan(0);
    for (const { p, sp } of fallbacks) {
      expect(sp.active, p.name).toBeNull();
      expect(sp.team, `${p.name} team`).toBe(r.defenseId(abbrevOf.get(p.proTeamId) ?? "")); // DynastyProcess's team, which is current here
    }
  });
});
