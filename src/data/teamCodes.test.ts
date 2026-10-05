import { describe, expect, it } from "vitest";
import { buildTeamCodeIndex, cleanTeamCode, deriveTeamAliases, SLEEPER_TEAM_CODES, STATIC_DEFENSE_IDS, STATIC_TEAM_ALIASES, TEAM_ALIAS_MIN_SUPPORT, type TeamCodeObservation } from "./teamCodes";
import { fixtureDynastyRows, fixtureEspnProTeams, fixtureNflverseGames, fixtureSleeperPlayers } from "./testSupport";

describe("team codes (synthetic)", () => {
  const sleeperCodes = ["DAL", "JAX", "LAR", "LV", "WAS", "KC"];

  it("cleans codes and treats free-agent markers as no team", () => {
    expect(cleanTeamCode(" wsh ")).toBe("WSH");
    for (const v of ["FA", "FA*", "", "NA", null, undefined]) expect(cleanTeamCode(v)).toBeNull();
  });

  it("maps static aliases only onto known Sleeper codes", () => {
    const idx = buildTeamCodeIndex({ sleeperCodes });
    expect(idx.toSleeper("WSH")).toBe("WAS");
    expect(idx.toSleeper("wsh")).toBe("WAS");
    expect(idx.toSleeper("LA")).toBe("LAR");
    expect(idx.toSleeper("OAK")).toBe("LV");
    expect(idx.toSleeper("DAL")).toBe("DAL");
    expect(idx.toSleeper("FA")).toBeUndefined();
    expect(idx.toSleeper("XYZ")).toBeUndefined();
    // Without the target in the loaded codes, an alias isn't trusted.
    expect(buildTeamCodeIndex({ sleeperCodes: ["DAL"] }).toSleeper("WSH")).toBeUndefined();
  });

  it("derives an alias only from a strict majority with enough support", () => {
    const teamOfPlayer = new Map([
      ["1", "JAX"],
      ["2", "JAX"],
      ["3", "JAX"],
      ["4", "DAL"],
      ["5", "KC"],
      ["6", "KC"],
    ]);
    const obs = (code: string, ids: string[]): TeamCodeObservation[] => ids.map((sleeperId) => ({ source: "Test", code, sleeperId }));
    const derived = deriveTeamAliases([...obs("JAC", ["1", "2", "3", "4"]), ...obs("KCC", ["5", "6"]), ...obs("OLD", ["99"]), ...obs("DAL", ["4"])], new Set(sleeperCodes), teamOfPlayer);
    expect(derived).toEqual([{ code: "JAC", to: "JAX", support: 3, voters: 4, sources: ["Test"] }]);
    expect(TEAM_ALIAS_MIN_SUPPORT).toBe(3); // KCC had 2 votes: below the minimum
  });

  it("matches team nicknames and full names, with or without a D/ST suffix", () => {
    const idx = buildTeamCodeIndex({ sleeperCodes, teamNames: [{ code: "WAS", location: "Washington", nickname: "Commanders" }] });
    expect(idx.toSleeper("Commanders")).toBe("WAS");
    expect(idx.toSleeper("Commanders D/ST")).toBe("WAS");
    expect(idx.toSleeper("washington commanders")).toBe("WAS");
    expect(idx.toSleeper("Washington")).toBeUndefined(); // a location alone can be ambiguous (New York, Los Angeles)
  });
});

describe("team codes (committed fixtures)", () => {
  const players = fixtureSleeperPlayers();
  const sleeperCodes = new Set(players.flatMap((p) => (p.team ? [p.team] : [])));
  const teamOfPlayer = new Map(players.flatMap((p): [string, string][] => (p.team ? [[p.id, p.team]] : [])));
  const dpObservations = fixtureDynastyRows().flatMap((r): TeamCodeObservation[] => (r.sleeperId && r.team ? [{ source: "DynastyProcess", code: r.team, sleeperId: r.sleeperId }] : []));
  const defRows = players.filter((p) => p.position === "DEF");
  const index = buildTeamCodeIndex({ sleeperCodes, teamNames: defRows.map((p) => ({ code: p.id, location: p.firstName, nickname: p.lastName })), observations: dpObservations, teamOfPlayer });

  it("the Sleeper fixtures carry all 32 Sleeper team codes", () => {
    expect(sleeperCodes.size).toBe(32);
  });

  it("SLEEPER_TEAM_CODES (the seed when no Sleeper or FantasyCalc data loaded) is exactly Sleeper's codes and DEF ids", () => {
    expect(SLEEPER_TEAM_CODES).toHaveLength(32);
    expect(new Set(SLEEPER_TEAM_CODES)).toEqual(sleeperCodes);
    // Sleeper's DEF id is its team code: every committed DEF row is in the list, with team === id.
    expect(defRows.length).toBeGreaterThan(0);
    for (const d of defRows) {
      expect(SLEEPER_TEAM_CODES).toContain(d.id);
      expect(d.team).toBe(d.id);
    }
  });

  it("derives DynastyProcess's MFL-style codes from the data (no hand-typed pairs)", () => {
    expect(Object.fromEntries(index.derived.map((d) => [d.code, d.to]))).toEqual({ GBP: "GB", JAC: "JAX", KCC: "KC", LVR: "LV", NEP: "NE", NOS: "NO", SFO: "SF", TBB: "TB" });
    // Every team code DynastyProcess uses for these players now resolves.
    for (const o of dpObservations) expect(sleeperCodes.has(index.toSleeper(o.code ?? "") ?? "")).toBe(true);
  });

  it("ESPN and nflverse codes land on the same Sleeper code (games joined on the ESPN event id)", () => {
    const espnTeams = fixtureEspnProTeams();
    const nflByEvent = new Map(fixtureNflverseGames().flatMap((g) => (g.espnEventId ? [[g.espnEventId, g] as const] : [])));
    const espnToNfl = new Map<number, Set<string>>();
    for (const t of espnTeams)
      for (const games of Object.values(t.proGamesByScoringPeriod ?? {}))
        for (const g of games) {
          const n = nflByEvent.get(String(g.id));
          if (!n) continue;
          for (const [espnTeam, code] of [
            [g.homeProTeamId, n.homeTeam],
            [g.awayProTeamId, n.awayTeam],
          ] as const)
            espnToNfl.set(espnTeam, (espnToNfl.get(espnTeam) ?? new Set<string>()).add(code));
        }
    expect(espnTeams).toHaveLength(32);
    const resolved = new Set<string>();
    const pairs: Record<string, string> = {};
    for (const t of espnTeams) {
      const nfl = [...(espnToNfl.get(t.id) ?? [])];
      expect(nfl).toHaveLength(1);
      const nflCode = nfl[0] as string;
      if (nflCode !== t.abbrev) pairs[t.abbrev] = nflCode;
      const viaEspn = index.toSleeper(t.abbrev);
      expect(viaEspn).toBeDefined();
      expect(index.toSleeper(nflCode)).toBe(viaEspn);
      resolved.add(viaEspn as string);
    }
    expect(resolved).toEqual(sleeperCodes); // a bijection onto Sleeper's 32 codes
    // The data behind the two hand-typed current aliases: ESPN WSH = nflverse WAS, ESPN LAR = nflverse LA.
    expect(pairs).toEqual({ WSH: "WAS", LAR: "LA" });
    expect(STATIC_TEAM_ALIASES.WSH).toBe("WAS");
    expect(index.toSleeper("LA")).toBe("LAR");
  });

  it("STATIC_DEFENSE_IDS (a model build's team codes without the crosswalk; final review F3) maps every ESPN abbreviation as the crosswalk built from the data does", () => {
    const espnTeams = fixtureEspnProTeams();
    expect(espnTeams).toHaveLength(32);
    for (const t of espnTeams) {
      for (const code of [t.abbrev, t.abbrev.toLowerCase(), ` ${t.abbrev} `]) expect(STATIC_DEFENSE_IDS.defenseId(code), code).toBe(index.toSleeper(code));
      expect(STATIC_DEFENSE_IDS.defenseId(t.abbrev)).toBeDefined();
    }
    expect(STATIC_DEFENSE_IDS.defenseId("WSH")).toBe("WAS");
    expect(STATIC_DEFENSE_IDS.defenseId("FA")).toBeUndefined();
  });

  it("ESPN team nicknames match Sleeper's DEF rows", () => {
    expect(defRows.length).toBeGreaterThanOrEqual(6); // the fixtures keep 6 DEF rows per week
    const espnByCode = new Map(fixtureEspnProTeams().map((t) => [index.toSleeper(t.abbrev), t]));
    for (const d of defRows) {
      const espn = espnByCode.get(d.id);
      expect(espn).toBeDefined();
      expect(index.toSleeper(espn?.name ?? "")).toBe(d.id);
      expect(index.toSleeper(`${espn?.name ?? ""} D/ST`)).toBe(d.id);
      expect(index.toSleeper(`${espn?.location ?? ""} ${espn?.name ?? ""}`)).toBe(d.id);
    }
  });
});
