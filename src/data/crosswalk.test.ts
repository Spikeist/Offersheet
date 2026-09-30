import { describe, expect, it } from "vitest";
import { ID_SOURCE_PRIORITY, playerNameKey, resolverFromData, type CrosswalkData } from "./crosswalk";
import type { DynastyRow } from "./dynastyProcess";
import type { FantasyCalcPlayerIds } from "./fantasyCalcPlayers";
import type { SleeperPlayerRecord } from "./sleeperPlayers";
import { SLEEPER_TEAM_CODES } from "./teamCodes";
import { fixtureDynastyRows, fixtureEspnProTeams, fixtureEspnRostered, fixtureFantasyCalcPlayers, fixtureSleeperPlayers } from "./testSupport";
import type { PlayerIdResolver } from "./types";

// Fictional players throughout; ids are made up.
const S = (id: string, over: Partial<SleeperPlayerRecord> = {}): SleeperPlayerRecord => ({
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

  it("takes the active record when the top source links a stale Sleeper id of the SAME person (same name, position and team, or GSIS id)", () => {
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
          // Sleeper has two records for each of the first two players; DynastyProcess links the stale one.
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
    expect(dup.conflict("espn", "94361994")).toMatchObject({ chosen: "71558", resolvedBy: "same player", options: [{ sleeperId: "71376", active: false }, { sleeperId: "71558", active: true }] });
    // Same name and position, same GSIS id (no team): picks the record with that GSIS id, not the namesake record 75816.
    expect(dup.canonical("yahoo", "91636")).toBe("75815");
    expect(dup.conflict("yahoo", "91636")?.resolvedBy).toBe("same player");
    // Same name and position, nothing else shared: source order keeps the retired player.
    expect(dup.canonical("espn", "98417")).toBe("70258");
    expect(dup.conflict("espn", "98417")?.resolvedBy).toBe("source order");
    // Same name and team, different position: source order.
    expect(dup.canonical("espn", "97000")).toBe("73000");
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
    expect(r.matchByName({ name: "Vexmund Orr", position: "TE", team: null })).toBe("34");
    expect(r.matchByName({ name: "Vexmund Orr", position: "TE", team: "FA" })).toBe("34"); // ESPN's free-agent "team"
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
