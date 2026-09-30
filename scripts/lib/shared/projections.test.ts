import { describe, expect, it } from "vitest";
import {
  asRows,
  byeRows,
  classifyEmptyEspn,
  compareRowSets,
  disagreement,
  espnOffenseScore,
  espnPosition,
  espnSeasonTotals,
  findEntry,
  fitEspnScoring,
  fitSleeperPts,
  flatnessByGroup,
  hasProjection,
  injuryTable,
  isEmptyEntry,
  NON_SCORING_KEY,
  positionGroup,
  scorableStats,
  sleeperStdScore,
  summarizeEspnPool,
  summarizeSleeper,
  topByPts,
  weekShapeSpread,
  type EspnPoolPlayer,
  type SleeperStatRow,
} from "./projections";

const row = (player_id: string, stats: Record<string, number>, extra: Partial<SleeperStatRow> = {}): SleeperStatRow => ({
  player_id,
  week: 4,
  category: "proj",
  company: "rotowire",
  stats,
  team: "KC",
  opponent: "BUF",
  game_id: "g1",
  player: { position: "WR", fantasy_positions: ["WR"], team: "KC" },
  ...extra,
});
const at = (pos: string) => ({ player: { position: pos, fantasy_positions: [pos] } });

describe("Sleeper rows", () => {
  it("summarizes keys, projection vs pts presence, last_modified days and positions", () => {
    const s = summarizeSleeper([
      row("1", { rec: 5, rec_yd: 60, pts_ppr: 11, pts_half_ppr: 8.5, pts_std: 6 }, { last_modified: Date.UTC(2026, 8, 29, 12) }),
      row("2", { adp_dd_ppr: 1000 }, { opponent: null, player: { position: "TE" } }),
      row("3", { idp_tkl_solo: 4 }, { last_modified: Date.UTC(2026, 8, 29, 12), ...at("LB") }),
    ]);
    expect(s).toMatchObject({ rows: 3, distinctPlayers: 3, withProjection: 2, withPtsPpr: 1, projectedWithoutPts: 1, lastModifiedPresent: 2, statsWithoutLastModified: 0, lastModifiedWithoutStats: 0, nullOpponent: 1 });
    expect(s.lastModifiedByDay).toEqual({ "2026-09-29": 2 });
    expect(asRows({ not: "an array" })).toBeNull();
  });

  it("treats points allowed as a stat but default-format points, ranks and participation as not", () => {
    for (const k of ["pts_ppr", "pts_half_ppr", "pts_std", "adp_dd_ppr", "pos_rank_ppr", "gp", "gms_active", "off_snp", "tm_off_snp"]) expect(NON_SCORING_KEY.test(k)).toBe(true);
    for (const k of ["pts_allow", "pts_allow_0", "rec", "idp_sack", "fgm_50p"]) expect(NON_SCORING_KEY.test(k)).toBe(false);
    expect(scorableStats(row("1", { rec: 3, pts_ppr: 3, gp: 1 }))).toEqual([["rec", 3]]);
    expect(hasProjection(row("1", { adp_dd_ppr: 5 }))).toBe(false);
    expect(hasProjection(row("1", { idp_tkl: 3 }))).toBe(true);
    expect(hasProjection(undefined)).toBe(false);
  });

  it("separates re-projections between calls from real differences", () => {
    const a = [row("1", { pts_ppr: 10 }, { last_modified: 2 }), row("2", { pts_ppr: 5 }, { last_modified: 1 }), row("3", { pts_ppr: 1 }, { last_modified: 1 })];
    const b = [row("1", { pts_ppr: 11 }, { last_modified: 1 }), row("2", { pts_ppr: 5 }, { last_modified: 1 }), row("3", { pts_ppr: 2 }, { last_modified: 1 }), row("4", {})];
    expect(compareRowSets(a, b)).toEqual({ onlyA: 0, onlyB: 1, both: 3, sameStats: 1, updatedBetweenCalls: 1, unexplained: 1 });
  });

  it("measures identical projected stat lines per position group", () => {
    const w5 = [row("1", { rec: 5, rec_yd: 60 }), row("2", { idp_tkl: 4 }, at("LB")), row("3", { fgm: 2 }, at("K")), row("4", { adp_dd_ppr: 9 })];
    const w6 = [row("1", { rec: 6, rec_yd: 60 }), row("2", { idp_tkl: 4 }, at("LB")), row("3", { fgm: 2 }, at("K")), row("4", { rec: 1 })];
    expect(flatnessByGroup(w5, w6)).toEqual({ "QB/RB/WR/TE": { both: 1, identical: 0 }, IDP: { both: 1, identical: 1 }, K: { both: 1, identical: 1 } });
    expect(positionGroup("CB")).toBe("IDP");
    expect(positionGroup("DEF")).toBe("DEF");
    expect(positionGroup("OL")).toBe("other");
  });

  it("measures week-to-week spread and the §6 m factor", () => {
    const weeks = [
      [row("1", { pts_ppr: 20 }), row("2", { pts_ppr: 10 }), row("3", { pts_ppr: 8 })],
      [row("1", { pts_ppr: 25 }), row("2", { pts_ppr: 10 })],
      [row("1", { pts_ppr: 15 }), row("2", { pts_ppr: 10 }), row("3", { pts_ppr: 9 })],
    ];
    const s = weekShapeSpread(weeks, () => true);
    expect(s).toMatchObject({ players: 2, identicalAll: 1, mNotOne: 1 });
    expect(s.medianMaxOverMin).toBe(1.667);
  });

  it("tabulates injury statuses with a relevance control and next-vs-later ratios", () => {
    const now = new Map([["h1", row("h1", { rec: 5, pts_ppr: 10 })]]);
    const next = new Map([
      ["h1", row("h1", { rec: 5, pts_ppr: 10 })],
      ["o1", row("o1", { rec: 4, pts_ppr: 9 })],
    ]);
    const later = [
      new Map([
        ["h1", row("h1", { rec: 5, pts_ppr: 10 })],
        ["o1", row("o1", { rec: 5, pts_ppr: 10 })],
        ["i1", row("i1", { rec: 3, pts_ppr: 6 })],
      ]),
    ];
    const t = injuryTable(
      [
        { id: "h1", status: "healthy" },
        { id: "o1", status: "Out" },
        { id: "i1", status: "IR" },
        { id: "i2", status: "IR" },
      ],
      now,
      next,
      later,
    );
    expect(t.healthy).toMatchObject({ players: 1, now: 1, next: 1, projectedLater: 1, projectedLaterAndNow: 1, medianNextOverLater: 1 });
    expect(t.Out).toMatchObject({ players: 1, now: 0, projectedLater: 1, projectedLaterAndNow: 0, medianNextOverLater: 0.9 });
    expect(t.IR).toMatchObject({ players: 2, now: 0, next: 0, projectedLater: 1, medianNextOverLater: null, ratioPlayers: 0 });
  });

  it("describes bye-week rows (present, no projection, null opponent) and orders by pts", () => {
    const rows = [row("1", { adp_dd_ppr: 1000 }, { opponent: null, game_id: null }), row("2", { pts_ppr: 9, rec: 3 }, { team: "BUF" }), row("3", { pts_ppr: 12, rec: 4 }, { team: "BUF" })];
    expect(byeRows(rows, ["KC"])).toMatchObject({ rows: 1, onlyNonScoringStats: 1, withProjection: 0, withPts: 0, nullOpponent: 1, nullGameId: 1, defRows: 0 });
    expect(topByPts(rows, 2).map((r) => r.player_id)).toEqual(["3", "2"]);
  });

  it("reproduces Sleeper's default pts_* with standard rules (INT −1) and takes other INT values", () => {
    const qb = { pass_yd: 250, pass_td: 2, pass_int: 1, rush_yd: 20, fum_lost: 1 };
    expect(sleeperStdScore(qb, 1)).toBeCloseTo(10 + 8 - 1 + 2 - 2, 9);
    expect(sleeperStdScore(qb, 1, -2)).toBeCloseTo(10 + 8 - 2 + 2 - 2, 9);
    const wr = { rec: 6, rec_yd: 80, rec_td: 1 };
    const rows = [row("1", { ...wr, pts_ppr: 20, pts_half_ppr: 17, pts_std: 14 }), row("2", { ...wr, st_td: 1, pts_ppr: 26, pts_half_ppr: 23, pts_std: 20 })];
    const fits = fitSleeperPts(rows);
    expect(fits.map((f) => [f.field, f.compared, f.within005])).toEqual([
      ["pts_ppr", 2, 1],
      ["pts_half_ppr", 2, 1],
      ["pts_std", 2, 1],
    ]);
    expect(fits[0]?.misfitKeys.some((k) => k.startsWith("st_td"))).toBe(true);
  });
});

describe("ESPN pool", () => {
  const stat = (src: number, split: number, season: number, period: number, stats: Record<string, number>, appliedTotal: number) => ({ statSourceId: src, statSplitTypeId: split, seasonId: season, scoringPeriodId: period, stats, appliedTotal });
  const wr: EspnPoolPlayer = {
    id: 1,
    status: "WAIVERS",
    player: {
      id: 1,
      fullName: "Zorblax Quintavious",
      eligibleSlots: [3, 4, 5, 23, 7, 20, 21],
      proTeamId: 12,
      injuryStatus: "ACTIVE",
      stats: [stat(1, 1, 2026, 4, { "53": 5, "42": 70, "43": 0.5 }, 15), stat(1, 1, 2026, 6, {}, 0), stat(1, 1, 2026, 7, {}, 0), stat(0, 1, 2026, 1, { "53": 2, "42": 20 }, 4), stat(1, 0, 2026, 0, { "53": 80 }, 250), stat(1, 1, 2025, 3, { "53": 1 }, 1)],
    },
  };
  const dst: EspnPoolPlayer = { id: -16026, player: { id: -16026, fullName: "Seahawks D/ST", eligibleSlots: [16, 20, 21], proTeamId: 26, stats: [stat(1, 1, 2026, 11, { "99": 3 }, 5.8)] } };

  it("derives positions the way espn-api does (D/ST via the name)", () => {
    expect(espnPosition(wr)).toBe("WR");
    expect(espnPosition(dst)).toBe("D/ST");
    expect(espnPosition({ player: { fullName: "X", eligibleSlots: [25, 0, 7] } })).toBe("QB");
    expect(espnPosition({ player: { fullName: "X", eligibleSlots: [] } })).toBe("?");
  });

  it("finds entries and summarizes weeks, previous-season weeks and applied totals", () => {
    expect(findEntry(wr, 1, 1, 2026, 4)?.appliedTotal).toBe(15);
    expect(findEntry(wr, 1, 1, 2026, 5)).toBeUndefined();
    expect(isEmptyEntry(findEntry(wr, 1, 1, 2026, 6))).toBe(true);
    expect(isEmptyEntry(findEntry(wr, 1, 1, 2026, 4))).toBe(false);
    const s = summarizeEspnPool([wr, dst], 2026);
    expect(s).toMatchObject({ players: 2, entries: 7, withAppliedTotal: 7, projectedWeeks: { "4": 1, "6": 1, "7": 1, "11": 1 }, projectedWeeksPrev: { "3": 1 }, actualWeeks: { "1": 1 } });
    expect(s.byPosition).toEqual({ WR: 1, "D/ST": 1 });
  });

  it("classifies empty entries (bye vs not projected) and checks each position's own bye week", () => {
    const byes = new Map([
      [12, 6],
      [26, 11],
    ]);
    const r = classifyEmptyEspn([wr, dst], 2026, 4, 18, (id) => (id === undefined ? undefined : byes.get(id)));
    expect(r.total).toBe(2);
    expect(r.byClass).toEqual({ "bye week": 1, "not projected (ACTIVE)": 1 });
    expect(r.byeWeekByPosition).toEqual({ WR: { players: 1, withEntry: 1, nonZero: 0 }, "D/ST": { players: 1, withEntry: 1, nonZero: 1 } });
    expect(r.activeNotProjectedSample).toEqual(["Zorblax Quintavious (1 weeks)"]);
  });

  it("compares split 0 / 2 totals with weekly sums", () => {
    const p: EspnPoolPlayer = {
      id: 2,
      player: {
        fullName: "Quillon Vandersnoot",
        eligibleSlots: [2],
        stats: [stat(0, 1, 2026, 1, {}, 10), stat(0, 1, 2026, 2, {}, 12), stat(1, 1, 2026, 1, {}, 9), stat(1, 1, 2026, 3, {}, 11), stat(1, 1, 2026, 4, {}, 13), stat(1, 0, 2026, 0, {}, 24), stat(0, 0, 2026, 0, {}, 22), stat(1, 2, 2026, 0, {}, 99)],
      },
    };
    const dstUnit: EspnPoolPlayer = { id: -16001, player: { fullName: "Falcons D/ST", eligibleSlots: [16], stats: [stat(1, 1, 2026, 3, {}, 7), stat(1, 1, 2026, 4, {}, 6), stat(1, 0, 2026, 0, {}, 20)] } };
    const t = espnSeasonTotals([p, dstUnit], 2026, 3, 4);
    expect(t.projected0).toMatchObject({ compared: 1, matches: { restOfSeason: 1, fullSeason: 0 }, excluded: 1, excludedMatches: 0 });
    expect(t.actual0).toMatchObject({ compared: 1, matches: { completedWeeks: 1 } });
    expect(t.projected2).toMatchObject({ compared: 1, periods: { "0": 1 }, matches: { restOfSeason: 0, afterCurrentWeek: 0, actualPlusRestOfSeason: 0, projectedSplit0: 0 } });
  });

  it("infers the reception and interception values from appliedTotal", () => {
    expect(espnOffenseScore({ "53": 5, "42": 70, "43": 0.5 }, 1)).toBeCloseTo(15, 9);
    const qbLine = stat(1, 1, 2026, 5, { "3": 250, "4": 2, "20": 1 }, 16);
    const fits = fitEspnScoring([...(wr.player?.stats ?? []).filter((s) => s.statSplitTypeId === 1), qbLine]);
    const best = [...fits].sort((a, b) => b.within005 - a.within005)[0];
    expect(best).toMatchObject({ perReception: 1, intPts: -2, compared: 4, within005: 4, withIntCompared: 1, withIntWithin005: 1 });
    expect(fits.find((f) => f.intPts === -1)?.withIntWithin005).toBe(0);
  });
});

describe("source disagreement", () => {
  it("counts both 40% readings and one-sided zeros", () => {
    const d = disagreement([
      { name: "a", a: 10, b: 10 },
      { name: "b", a: 10, b: 5 },
      { name: "c", a: 10, b: 6.5 },
      { name: "d", a: 0, b: 8 },
    ]);
    expect(d).toMatchObject({ compared: 3, oneZero: 1, overOfLarger: 1, overOfSmaller: 2 });
    expect(d.samples[0]).toEqual({ name: "b", a: 10, b: 5 });
  });
});
