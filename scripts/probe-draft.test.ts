import { describe, expect, it } from "vitest";
import type { SleeperStatRow } from "./lib/shared/projections";
import {
  agreementOf,
  averageRanks,
  countByPosition,
  csvSummary,
  espnUnnamed,
  ffcPosition,
  hasProjectedStats,
  isMflTeamUnit,
  mdTable,
  parseFfc,
  parseMflAav,
  parseMflAdp,
  realSleeperAdp,
  sleeperAdpKeyCounts,
  sleeperName,
  spanRows,
  spearman,
  utcStamp,
  type AdpEntry,
} from "./probe-draft";

const row = (id: string, stats: Record<string, number>, extra: Partial<SleeperStatRow> = {}): SleeperStatRow => ({ player_id: id, stats, ...extra }) as SleeperStatRow;

describe("Sleeper ADP fields", () => {
  it("reads 999 and non-positive values as no ADP", () => {
    expect(realSleeperAdp(1.4)).toBe(true);
    expect(realSleeperAdp(998.9)).toBe(true);
    expect(realSleeperAdp(999)).toBe(false);
    expect(realSleeperAdp(0)).toBe(false);
    expect(realSleeperAdp(Number.NaN)).toBe(false);
    expect(realSleeperAdp("3")).toBe(false);
  });

  it("counts each adp_* key's rows and real values, leaving pos_adp_* out", () => {
    const counts = sleeperAdpKeyCounts([row("1", { adp_ppr: 2, adp_std: 999, pos_adp_ppr: 1 }), row("2", { adp_ppr: 1.5, adp_std: 999 }), row("3", { pts_ppr: 10 })]);
    expect(counts).toEqual([
      { key: "adp_ppr", rows: 2, real: 2, best: 1.5 },
      { key: "adp_std", rows: 2, real: 0, best: null },
    ]);
  });

  it("tells projected stats from ADP-only rows", () => {
    expect(hasProjectedStats(row("1", { adp_ppr: 3, pts_ppr: 100, gp: 18, pos_rank_ppr: 2 }))).toBe(false);
    expect(hasProjectedStats(row("1", { adp_ppr: 3, rush_yd: 900 }))).toBe(true);
  });

  it("counts rows by position, largest first", () => {
    const rows = [row("1", {}, { player: { position: "WR" } } as Partial<SleeperStatRow>), row("2", {}, { player: { position: "WR" } } as Partial<SleeperStatRow>), row("3", {}, { player: { position: "QB" } } as Partial<SleeperStatRow>)];
    expect(Object.keys(countByPosition(rows))[0]).toBe("WR");
  });

  it("names a row from its player, else its id", () => {
    expect(sleeperName(row("9", {}, { player: { first_name: "Puka", last_name: "Nacua" } } as Partial<SleeperStatRow>))).toBe("Puka Nacua");
    expect(sleeperName(row("9", {}))).toBe("9");
  });
});

describe("rank agreement", () => {
  it("averages tied ranks", () => {
    expect(averageRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it("is 1 for the same order, -1 for the reverse, null without spread or pairs", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(spearman([1, 2], [1, 2])).toBeNull();
  });

  it("matches two lists by canonical id within each list's first `top`", () => {
    const e = (canonical: string | undefined, adp: number): AdpEntry => ({ sourceId: `s${adp}`, canonical, name: "x", pos: "WR", team: null, adp });
    const a = { label: "A", entries: [e("1", 1), e("2", 2), e("3", 3), e(undefined, 4), e("5", 5)] };
    const b = { label: "B", entries: [e("1", 2), e("2", 1), e("3", 3), e("5", 9)] };
    const ag = agreementOf(a, b, 4);
    expect(ag.common).toBe(3); // "5" is past A's first 4
    expect(ag.medianGap).toBe(1);
    expect(ag.rho).toBeCloseTo(0.5);
  });
});

describe("source parsers", () => {
  it("reads Fantasy Football Calculator lists, and refuses other bodies", () => {
    const list = parseFfc({ status: "Success", meta: { teams: 12 }, players: [{ player_id: 2749, name: "Ja'Marr Chase", position: "WR", team: "CIN", adp: 1.5, stdev: 0.8, high: 1, low: 5, times_drafted: 1800 }] });
    expect(list?.players[0]).toMatchObject({ player_id: "2749", adp: 1.5, stdev: 0.8 });
    expect(parseFfc({ error: "nope" })).toBeNull();
    expect(ffcPosition("PK")).toBe("K");
    expect(ffcPosition("dst")).toBe("DEF");
    expect(ffcPosition("wr")).toBe("WR");
  });

  it("reads MFL's adp export (strings as numbers, a single player as a list, seconds as ms)", () => {
    const adp = parseMflAdp({ adp: { timestamp: "1792447589", totalDrafts: "716", totalPicks: "9", player: { id: "16162", averagePick: "2.14", minPick: "1", maxPick: "34", draftsSelectedIn: "683", rank: "1" } } });
    expect(adp).toMatchObject({ totalDrafts: 716, updatedMs: 1792447589000 });
    expect(adp?.players).toEqual([{ id: "16162", averagePick: 2.14, minPick: 1, maxPick: 34, draftsSelectedIn: 683, rank: 1, fields: ["averagePick", "draftsSelectedIn", "id", "maxPick", "minPick", "rank"] }]);
    expect(parseMflAdp({ adp: { timestamp: "1", totalDrafts: "0", totalPicks: "0" } })?.players).toEqual([]);
    expect(parseMflAdp({ error: { $t: "bad" } })).toBeNull();
    expect(parseMflAav({ aav: { player: [{ id: "1", averageValue: "30.1" }] } })?.players[0]).toMatchObject({ id: "1", averageValue: 30.1 });
  });

  it("tells MFL's team units and ESPN's team units by their ids", () => {
    expect(isMflTeamUnit("0532")).toBe(true);
    expect(isMflTeamUnit("16162")).toBe(false);
    expect(espnUnnamed(-16007)).toMatch(/D\/ST \(ESPN id -16007\)$/);
    expect(espnUnnamed(-15002)).toMatch(/team QB/);
    expect(espnUnnamed(4241389)).toBe("ESPN player 4241389");
    expect(espnUnnamed(undefined)).toBe("ESPN player ?");
  });

  it("summarizes a CSV's header, rows and a column's values", () => {
    const s = csvSummary('player,pos,"scrape_date"\nA,WR,2026-10-16\r\nB,RB,2026-10-16\n', ["scrape_date", "missing"]);
    expect(s).toEqual({ header: ["player", "pos", "scrape_date"], rows: 2, values: { scrape_date: ["2026-10-16"] } });
  });
});

describe("the season row's span", () => {
  it("sums each player's weekly points from the current week, after it, and over every week", () => {
    const season = [row("1", { pts_ppr: 300 }), row("2", { pts_ppr: 50 })];
    const weeks = new Map([
      [5, [row("1", { pts_ppr: 20 }), row("2", { pts_ppr: 5 })]],
      [6, [row("1", { pts_ppr: 18 })]],
      [7, [row("1", { pts_ppr: 22 })]],
    ]);
    expect(spanRows(season, weeks, 6, 100)).toEqual([{ id: "1", name: "1", season: 300, rest: 40, after: 22, all: 60 }]);
  });
});

describe("output helpers", () => {
  it("writes a markdown table with dashes for blanks and escaped pipes", () => {
    expect(mdTable(["a", "b"], [["x|y", null]])).toEqual(["| a | b |", "|---|---|", "| x\\|y | — |"]);
  });

  it("stamps UTC times", () => {
    expect(utcStamp(Date.UTC(2026, 9, 19, 7, 42))).toBe("2026-10-19 07:42 UTC");
    expect(utcStamp(null)).toBe("—");
  });
});
