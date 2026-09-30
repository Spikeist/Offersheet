import { describe, expect, it } from "vitest";
import { normalizeProjectionStats } from "@/adapters/sleeper/scoringMap";
import type { Pos, ScoringRule } from "@/engine/model";
import { actualPoints, expectedPoints, rateFor } from "@/engine/scoring";
import { readMinFixture } from "@/test-utils/fixtures";
import { ESPN_SCORING_FORMAT } from "./constants";
import { summarizeSlots } from "./normalize";
import { positionOf } from "./positions";
import { ESPN_READINGS, FGMISS_0_39, FGM_0_39, SLEEPER_DEF_ALIASES, SLEEPER_PLAYER_ALIASES, TEAM_RESULT_STAT_IDS, boundsFromLabel, buildEspnScoring, everyFromLabel, keyFor, toCanonicalStats, type EspnReading, type EspnScoringItem } from "./scoringMap";
import { LABELS, PUBLIC, readEspn } from "./test-helpers";

interface Line {
  pos: Pos;
  stats: Record<string, number>;
}
interface RosterFixture {
  teams: Array<{ roster: { entries: Array<{ playerPoolEntry: { player: { defaultPositionId: number; stats: Array<{ statSourceId: number; statSplitTypeId: number; scoringPeriodId: number; stats?: Record<string, number> }> } } }> } }>;
}
interface LeagueFixture {
  settings: { scoringSettings: { scoringItems: EspnScoringItem[] }; rosterSettings: { lineupSlotCounts: Record<string, number> } };
}

/** Parker's full ESPN weekly actual lines (weeks 2–3; every stat id ESPN sends). */
function parkerLines(): Line[] {
  const out: Line[] = [];
  for (const week of [2, 3]) {
    for (const t of readEspn<RosterFixture>(LABELS.roster(week)).teams)
      for (const e of t.roster.entries) {
        const p = e.playerPoolEntry.player;
        const pos = positionOf(p.defaultPositionId).pos;
        const a = p.stats.find((s) => s.statSourceId === 0 && s.statSplitTypeId === 1 && s.scoringPeriodId === week);
        if (pos && a?.stats) out.push({ pos, stats: a.stats });
      }
  }
  return out;
}

const readings = Object.entries(ESPN_READINGS).map(([id, r]) => ({ id: Number(id), r })) as Array<{ id: number; r: EspnReading }>;
const parkerItems = readEspn<LeagueFixture>(LABELS.league).settings.scoringSettings.scoringItems;
const publicLeague = readMinFixture<LeagueFixture>("espn", PUBLIC.group, PUBLIC.league);

describe("ESPN readings table", () => {
  it("covers every statId espn-api knows, and nothing else", () => {
    expect(readings.map((x) => x.id).sort((a, b) => a - b)).toEqual(Object.keys(ESPN_SCORING_FORMAT).map(Number));
  });

  it("takes range bounds and every-N from espn-api's labels, and limits D/ST buckets to D/ST", () => {
    for (const { id, r } of readings) {
      const label = ESPN_SCORING_FORMAT[id]?.label as string;
      if (r.kind === "range") {
        expect(boundsFromLabel(label)).toEqual({ ...(r.min !== undefined ? { min: r.min } : {}), ...(r.max !== undefined ? { max: r.max } : {}) });
        if (typeof r.stat === "string" && (r.stat === "pts_allow" || r.stat === "yds_allow")) expect(r.positions).toEqual(["DEF"]);
      }
      if (r.kind === "every") expect(r.every).toBe(everyFromLabel(label));
    }
    expect(ESPN_READINGS[92]).toMatchObject({ kind: "range", stat: "pts_allow", min: 14, max: 17 });
    expect(ESPN_READINGS[125]).toMatchObject({ kind: "range", stat: "pts_allow", min: 46 });
    expect(ESPN_READINGS[128]).toEqual({ kind: "range", stat: "yds_allow", max: 99, positions: ["DEF"] });
    expect(ESPN_READINGS[17]).toEqual({ kind: "range", stat: "pass_yd", min: 300, max: 399 });
  });

  it("reads FGs made/missed 0–39 as a whole everywhere (so one representative key is exact)", () => {
    for (const bucket of [FGM_0_39, FGMISS_0_39])
      for (const { id, r } of readings) {
        const keys = r.kind === "composite" ? r.keys : r.kind === "stat" || r.kind === "part" || r.kind === "range" || r.kind === "every" ? (["QB", "DEF"] as Pos[]).map((p) => keyFor(r.stat, p)) : [];
        const touched = keys.filter((k) => bucket.includes(k));
        if (touched.length) expect({ id, all: bucket.every((k) => keys.includes(k)) }).toEqual({ id, all: true });
      }
  });
});

describe("readings hold on ESPN's own lines (Parker's weeks 2–3, every stat ESPN sends)", () => {
  it("every-N = floor(max(0, raw) / N); range flags = raw within the label's bounds; composites and aliases add up", () => {
    const lines = parkerLines();
    const count = { every: 0, range: 0, composite: 0, alias: 0, whole: 0 };
    for (const l of lines) {
      const canon = toCanonicalStats(l.stats, l.pos);
      const val = (k: string) => canon[k] ?? 0;
      for (const { id, r } of readings) {
        const got = l.stats[String(id)];
        if (got === undefined) continue;
        if (r.kind === "every") {
          expect({ id, v: got }).toEqual({ id, v: Math.floor(Math.max(0, val(keyFor(r.stat, l.pos))) / r.every) });
          count.every++;
        } else if (r.kind === "range" && (!r.positions || r.positions.includes(l.pos))) {
          const x = val(keyFor(r.stat, l.pos));
          expect({ id, v: got }).toEqual({ id, v: (r.min === undefined || x >= r.min) && (r.max === undefined || x <= r.max) ? 1 : 0 });
          count.range++;
        } else if (r.kind === "composite") {
          expect({ id, v: got }).toEqual({ id, v: r.keys.reduce((a, k) => a + val(k), 0) });
          count.composite++;
        } else if (r.kind === "stat" && r.alias) {
          expect({ id, v: got }).toEqual({ id, v: val(keyFor(r.stat, l.pos)) });
          count.alias++;
        }
      }
      const whole = l.stats["94"];
      if (whole !== undefined) {
        expect(whole).toBe((l.stats["103"] ?? 0) + (l.stats["104"] ?? 0));
        count.whole++;
      }
    }
    expect(lines.length).toBeGreaterThan(300);
    expect(count.every).toBeGreaterThan(1000);
    expect(count.range).toBeGreaterThan(100);
    expect(count.composite).toBeGreaterThan(50);
    expect(count.alias).toBeGreaterThan(100);
    expect(count.whole).toBeGreaterThan(0);
  });
});

describe("toCanonicalStats", () => {
  it("keys team D/ST stats apart from players', and never counts an alias twice", () => {
    expect(toCanonicalStats({ 94: 1, 95: 2, 96: 1, 99: 3, 101: 1, 103: 1, 114: 50, 120: 13, 187: 13, 127: 250, 90: 0, 91: 1 }, "DEF")).toEqual({ def_td: 1, int: 2, fum_rec: 1, sack: 3, def_kr_td: 1, def_kr_yd: 50, pts_allow: 13, yds_allow: 250 });
    expect(toCanonicalStats({ 41: 5, 53: 5, 42: 60, 61: 60, 47: 12, 101: 1, 114: 25 }, "WR")).toEqual({ rec: 5, rec_yd: 60, kr_td: 1, kr_yd: 25 });
    expect(toCanonicalStats({ 187: 20 }, "DEF")).toEqual({ pts_allow: 20 });
    expect(toCanonicalStats({ 95: 1, 108: 4 }, "LB")).toEqual({ idp_int: 1, idp_tkl_solo: 4 });
  });

  it("puts FG 0–39 counts on the composite's first key, builds def_td from its parts, and reads games played", () => {
    expect(toCanonicalStats({ 80: 2, 81: 3, 82: 1, 77: 1, 83: 3, 84: 4, 85: 1, 86: 2, 87: 2, 210: 1 }, "K")).toEqual({ fgm_0_19: 2, fgmiss_0_19: 1, fgm_40_49: 1, fgm: 3, fga: 4, fgmiss: 1, xpm: 2, xpa: 2, gp: 1 });
    expect(toCanonicalStats({ 103: 1, 104: 1 }, "DEF")).toEqual({ def_td: 2 });
  });
});

describe("buildEspnScoring on Parker's league (39 rules)", () => {
  const { scoring, warnings } = buildEspnScoring(parkerItems);

  it("maps per-unit rates to canonical keys at ESPN's own rates; team-D/ST keys are D/ST rates, never rates for every position", () => {
    expect(scoring.perStat).toEqual({
      pass_yd: 0.04,
      pass_td: 4,
      pass_2pt: 2,
      pass_int: -2,
      rush_yd: 0.1,
      rush_td: 6,
      rush_2pt: 2,
      rec_yd: 0.1,
      rec_td: 6,
      rec_2pt: 2,
      rec: 0.5,
      fum_rec_td: 6,
      fum_lost: -2,
      fgm_40_49: 3,
      fgm_50_59: 5,
      fgm_60p: 5,
      fgmiss: -2,
      xpm: 1,
      kr_td: 6,
      pr_td: 6,
      idp_def_td: 6,
      def_2pt: 2,
      // Sleeper's key for a player's kick- or punt-return TD (ESPN 101 / 102).
      st_td: 6,
    });
    expect(scoring.byPosition).toEqual({
      DEF: {
        int: 2,
        fum_rec: 2,
        blk_kick: 2,
        safe: 2,
        sack: 1,
        def_kr_td: 6,
        def_pr_td: 6,
        def_td: 6,
        def_st_td: 6,
        def_st_fum_rec: 2,
        // A player key never scores on a D/ST line (it has its own team key).
        kr_td: 0,
        pr_td: 0,
        idp_def_td: 0,
        st_td: 0,
      },
    });
  });

  it("keeps team-only and player-only keys on their own side (review ESPN-2)", () => {
    for (const pos of ["QB", "RB", "WR", "TE", "K"] as const) for (const key of ["sack", "int", "fum_rec", "def_pr_td", "def_kr_td", "def_td", "def_st_td"]) expect({ pos, key, rate: rateFor(scoring, key, pos) }).toEqual({ pos, key, rate: 0 });
    for (const key of ["pr_td", "kr_td", "st_td", "idp_def_td"]) expect({ key, rate: rateFor(scoring, key, "DEF") }).toEqual({ key, rate: 0 });
    expect(rateFor(scoring, "sack", "DEF")).toBe(1);
    expect(rateFor(scoring, "st_td", "WR")).toBe(6);
  });

  it("turns D/ST points-allowed buckets into range rules with ESPN's bounds, and FG 0–39 into a composite", () => {
    const byMin = (a: ScoringRule, b: ScoringRule) => ((a as { min?: number }).min ?? -1) - ((b as { min?: number }).min ?? -1);
    const pa = scoring.rules.filter((r) => r.kind !== "perGame" && r.stat === "pts_allow").sort(byMin);
    expect(pa).toEqual([
      { kind: "range", min: 0, max: 0, stat: "pts_allow", points: 5, positions: ["DEF"] },
      { kind: "range", min: 1, max: 6, stat: "pts_allow", points: 4, positions: ["DEF"] },
      { kind: "range", min: 7, max: 13, stat: "pts_allow", points: 2, positions: ["DEF"] },
      { kind: "range", min: 14, max: 17, stat: "pts_allow", points: 1, positions: ["DEF"] },
      { kind: "range", min: 22, max: 27, stat: "pts_allow", points: -2, positions: ["DEF"] },
      { kind: "range", min: 28, max: 34, stat: "pts_allow", points: -3, positions: ["DEF"] },
      { kind: "range", min: 35, max: 45, stat: "pts_allow", points: -5, positions: ["DEF"] },
      { kind: "threshold", min: 46, stat: "pts_allow", points: -7, positions: ["DEF"] },
    ]);
    expect(scoring.rules).toContainEqual({ kind: "perUnit", stat: { sum: FGM_0_39 }, points: 3 });
    expect(scoring.rules).toHaveLength(9);
  });

  it("lists the two rules with no canonical stat, with warnings naming their JSON paths", () => {
    expect(scoring.unmapped).toEqual([
      { platformKey: "209", label: "1pt Safety", points: 1 },
      { platformKey: "93", label: "Blocked Punt or FG return for TD", points: 6 },
    ]);
    expect(warnings.map((w) => [w.code, w.platformPath])).toEqual([
      ["ESPN_SCORING_UNMAPPED", "settings.scoringSettings.scoringItems[4] (statId 209)"],
      ["ESPN_SCORING_UNMAPPED", "settings.scoringSettings.scoringItems[8] (statId 93)"],
    ]);
  });

  it("drops no rule silently: every scored item is a rate, a rule, or listed as unmapped", () => {
    for (const items of [parkerItems, publicLeague.settings.scoringSettings.scoringItems]) {
      const slots = summarizeSlots(publicLeague.settings.rosterSettings.lineupSlotCounts, []);
      const built = buildEspnScoring(items, items === parkerItems ? { qbSource: "QB" } : slots.scoringCtx).scoring;
      const rateKeys = new Set([...Object.keys(built.perStat), ...Object.values(built.byPosition ?? {}).flatMap((t) => Object.keys(t ?? {}))]);
      const ruleStats = new Set(built.rules.map((r) => (r.kind === "perGame" ? "gp" : JSON.stringify(r.stat))));
      for (const item of items) {
        const scored = item.points !== 0 || Object.values(item.pointsOverrides ?? {}).some((v) => v !== 0);
        if (!scored) continue;
        const r = ESPN_READINGS[item.statId] as EspnReading;
        const where =
          r.kind === "stat" || r.kind === "part"
            ? (["QB", "RB", "WR", "TE", "K", "DEF"] as Pos[]).some((p) => rateKeys.has(keyFor(r.stat, p)))
            : r.kind === "none"
              ? built.unmapped.some((u) => u.platformKey === String(item.statId)) || Object.entries(item.pointsOverrides ?? {}).every(([k, v]) => v === 0 || k === "14")
              : r.kind === "composite"
                ? ruleStats.has(JSON.stringify({ sum: r.keys }))
                : r.kind === "perGame"
                  ? ruleStats.has("gp")
                  : ruleStats.has(JSON.stringify(typeof r.stat === "string" ? r.stat : r.stat.DEF)) || ruleStats.has(JSON.stringify(typeof r.stat === "string" ? r.stat : r.stat.other));
        expect({ statId: item.statId, where }).toEqual({ statId: item.statId, where: true });
      }
    }
  });
});

describe("buildEspnScoring on the public test league (TQB league, position-specific rushing, head-coach rules)", () => {
  const slots = summarizeSlots(publicLeague.settings.rosterSettings.lineupSlotCounts, []);
  const { scoring, warnings } = buildEspnScoring(publicLeague.settings.scoringSettings.scoringItems, slots.scoringCtx);

  it("keys pointsOverrides by defaultPositionId as REPLACEMENT rates (TE rushing, TQB → QB)", () => {
    expect(slots.scoringCtx).toEqual({ qbSource: "TQB", bothQbKinds: false, startsHeadCoach: false });
    expect(scoring.perStat.rush_yd).toBeUndefined();
    const { DEF, ...players } = scoring.byPosition ?? {};
    expect(players).toEqual({
      QB: { rush_yd: 0.1, rush_td: 6, rush_2pt: 2 },
      RB: { rush_yd: 0.1, rush_td: 6, rush_2pt: 2 },
      WR: { rush_yd: 0.1, rush_td: 6, rush_2pt: 2 },
      TE: { rush_yd: 0.1, rush_td: 6, rush_2pt: 2 },
    });
    // D/ST return yards: ESPN's base 0.02 for players and a D/ST override of 0.02, on separate keys.
    expect(DEF).toMatchObject({ def_kr_yd: 0.02, def_pr_yd: 0.02, kr_yd: 0, pr_yd: 0 });
    expect(scoring.perStat).toMatchObject({ kr_yd: 0.02, pr_yd: 0.02 });
  });

  it("maps yards-allowed buckets with ESPN's bounds (less than 100 → at most 99; 550+ → threshold)", () => {
    const ya = scoring.rules.filter((r) => r.kind !== "perGame" && r.stat === "yds_allow");
    expect(ya).toContainEqual({ kind: "range", max: 99, stat: "yds_allow", points: 5, positions: ["DEF"] });
    expect(ya).toContainEqual({ kind: "threshold", min: 550, stat: "yds_allow", points: -6, positions: ["DEF"] });
    expect(ya).toHaveLength(7);
  });

  it("skips its head-coach win-margin rules (worth 0 to a head coach, and it starts none): no false 'unmapped' alarm (review ESPN-7)", () => {
    const hcItems = publicLeague.settings.scoringSettings.scoringItems.filter((i) => TEAM_RESULT_STAT_IDS.has(i.statId));
    expect(hcItems.map((i) => i.statId).sort()).toEqual([161, 162, 163, 164, 165, 166]);
    for (const i of hcItems) expect(i.pointsOverrides).toEqual({ 14: 0 });
    expect(scoring.unmapped.map((u) => u.platformKey).sort()).toEqual(["209", "93"]);
    expect(warnings.filter((w) => w.code === "ESPN_HC_UNMAPPED")).toHaveLength(0);
    expect(warnings.filter((w) => w.code === "ESPN_SCORING_UNMAPPED")).toHaveLength(2);
  });
});

describe("head-coach team-result rules (statIds 155–174)", () => {
  const item = (statId: number, points: number, pointsOverrides?: Record<string, number>): EspnScoringItem => ({ statId, points, ...(pointsOverrides ? { pointsOverrides } : {}) });

  it("are listed as unmapped (one warning each) only when the league starts a head coach and the HC value isn't 0", () => {
    const items = [item(161, 10, { 14: 0 }), item(155, 0, { 14: 5 }), item(172, -3)];
    const withHc = buildEspnScoring(items, { qbSource: "QB", startsHeadCoach: true });
    expect(withHc.scoring.unmapped).toEqual([
      { platformKey: "155", label: "Team Win (head coach)", points: 5 },
      { platformKey: "172", label: "25+ point Loss Margin (head coach)", points: -3 },
    ]);
    expect(withHc.warnings.map((w) => [w.code, w.platformPath])).toEqual([
      ["ESPN_SCORING_UNMAPPED", "settings.scoringSettings.scoringItems[1] (statId 155)"],
      ["ESPN_SCORING_UNMAPPED", "settings.scoringSettings.scoringItems[2] (statId 172)"],
    ]);
    // No head coach in the lineup: nobody can score them, so they're skipped.
    const noHc = buildEspnScoring(items, { qbSource: "QB" });
    expect(noHc.scoring).toEqual({ perStat: {}, rules: [], unmapped: [] });
    expect(noHc.warnings).toEqual([]);
  });
});

describe("Sleeper-keyed lines under ESPN scoring (Parker's league)", () => {
  const { scoring } = buildEspnScoring(parkerItems);

  it("scores normalizeProjectionStats() rows: a D/ST return TD once, a WR's return TD at ESPN's 6, a K's 50+ FG as 50–59 (review ESPN-2 / ENG-5)", () => {
    // Raw Sleeper projection rows (Phase 0 shapes): a D/ST projects its return TD three ways, a player projects it as pr_td.
    const def = normalizeProjectionStats({ pr_td: 0.05, def_pr_td: 0.05, st_td: 0.05, sack: 2.5, int: 1, pts_allow: 21 }, "DEF");
    const wr = normalizeProjectionStats({ rec: 5, rec_yd: 60, pr_td: 0.05 }, "WR");
    const k = normalizeProjectionStats({ fgm_50p: 0.4 }, "K");
    expect(def).toEqual({ def_st_td: 0.05, sack: 2.5, int: 1, pts_allow: 21 });
    expect(wr).toMatchObject({ st_td: 0.05 });
    expect(k).toEqual({ fgm_50p: 0.4, fgm_50_59: 0.4 });
    const perUnit = (line: Record<string, number>, pos: Pos) => Object.entries(line).reduce((sum, [key, v]) => sum + rateFor(scoring, key, pos) * v, 0);
    expect(perUnit(def, "DEF")).toBeCloseTo(0.05 * 6 + 2.5 * 1 + 1 * 2, 9);
    expect(perUnit(wr, "WR")).toBeCloseTo(5 * 0.5 + 60 * 0.1 + 0.05 * 6, 9);
    expect(perUnit(k, "K")).toBeCloseTo(0.4 * 5, 9);
    // The same rows' points through the engine (the D/ST bucket rules add their expected value).
    expect(expectedPoints(wr, "WR", scoring)).toBeCloseTo(5 * 0.5 + 60 * 0.1 + 0.05 * 6, 9);
    expect(expectedPoints(k, "K", scoring)).toBeCloseTo(2, 9);
  });

  it("scores a Sleeper /stats line with a player's return TD like ESPN's own line", () => {
    const espnLine = toCanonicalStats({ 42: 40, 53: 3, 102: 1 }, "WR");
    expect(espnLine).toEqual({ rec_yd: 40, rec: 3, pr_td: 1 });
    expect(actualPoints({ rec_yd: 40, rec: 3, st_td: 1 }, "WR", scoring)).toBeCloseTo(actualPoints(espnLine, "WR", scoring), 9);
  });

  it("gives a position ESPN doesn't pay a 0 rate for an alias or a split key, not another position's rate", () => {
    const item = (statId: number, points: number, pointsOverrides?: Record<string, number>): EspnScoringItem => ({ statId, points, ...(pointsOverrides ? { pointsOverrides } : {}) });
    // Kickers (defaultPositionId 5) get 0 for return TDs and defensive TDs; everyone else 6.
    const { scoring: s } = buildEspnScoring([item(101, 6, { 5: 0 }), item(102, 6, { 5: 0 }), item(103, 6, { 5: 0 }), item(104, 6, { 5: 0 })]);
    for (const key of ["kr_td", "pr_td", "st_td", "idp_def_td"]) {
      expect({ key, WR: rateFor(s, key, "WR"), K: rateFor(s, key, "K") }).toEqual({ key, WR: 6, K: 0 });
    }
  });

  it("warns when ESPN scores players' kick- and punt-return TDs differently (Sleeper counts both as st_td)", () => {
    const item = (statId: number, points: number, pointsOverrides?: Record<string, number>): EspnScoringItem => ({ statId, points, ...(pointsOverrides ? { pointsOverrides } : {}) });
    const built = buildEspnScoring([item(101, 6, { 16: 6 }), item(102, 4, { 16: 6 })]);
    expect(built.scoring.perStat.st_td).toBe(6);
    expect(built.warnings.map((w) => w.code)).toEqual(["ESPN_SCORING_SHARED_KEY"]);
    expect(built.warnings[0]?.message).toMatch(/players' kick-return and punt-return TDs/);
  });
});

describe("D/ST buckets tile the points- and yards-allowed line (review ENG-4)", () => {
  /** Every bucket of a family at 1 point for D/ST: the expected points must be 1 whatever the projection. */
  const tiling = (statIds: number[]) => buildEspnScoring(statIds.map((statId) => ({ statId, points: 0, pointsOverrides: { 16: 1 } }))).scoring;

  it("ESPN's two points-allowed bucket sets (0 closed at the bottom, 46+ open) and its yards-allowed buckets", () => {
    const sets: Array<{ ids: number[]; stat: string; mus: number[] }> = [
      { ids: [89, 90, 91, 92, 121, 122, 123, 124, 125], stat: "pts_allow", mus: [0, 0.5, 3, 7, 10, 13.5, 17, 21, 30, 45.5, 60] },
      { ids: [188, 189, 190, 191, 192, 193, 194, 195, 196], stat: "pts_allow", mus: [0, 2, 10, 20, 50] },
      { ids: [128, 129, 130, 131, 132, 133, 134, 135, 136], stat: "yds_allow", mus: [40, 99.5, 150, 325, 420, 549.5, 700] },
    ];
    for (const { ids, stat, mus } of sets) {
      const scoring = tiling(ids);
      expect(scoring.rules).toHaveLength(9);
      for (const mu of mus) expect({ ids: ids[0], mu, ev: Math.round(expectedPoints({ [stat]: mu }, "DEF", scoring) * 1e6) / 1e6 }).toEqual({ ids: ids[0], mu, ev: 1 });
      // An actual game lands in exactly one bucket.
      for (const x of [0, 1, 6, 7, 13, 14, 17, 18, 21, 22, 27, 28, 34, 35, 45, 46, 99, 100, 199, 200, 299, 300, 349, 350, 549, 550]) expect({ x, points: actualPoints({ gp: 1, [stat]: x }, "DEF", scoring) }).toEqual({ x, points: 1 });
    }
  });
});

describe("buildEspnScoring edge cases", () => {
  const item = (statId: number, points: number, pointsOverrides?: Record<string, number>): EspnScoringItem => ({ statId, points, ...(pointsOverrides ? { pointsOverrides } : {}) });

  it("a TE premium is a byPosition replacement rate; two ESPN reception stats add up as ESPN adds them", () => {
    expect(buildEspnScoring([item(53, 0.5, { 4: 1 })]).scoring).toEqual({ perStat: { rec: 0.5 }, byPosition: { TE: { rec: 1 } }, rules: [], unmapped: [] });
    expect(buildEspnScoring([item(53, 0.5), item(41, 0.5)]).scoring.perStat).toEqual({ rec: 1 });
  });

  it("every-N, yardage-game, games-played and team/player split rules become the matching rule kinds", () => {
    const { scoring } = buildEspnScoring([item(5, 1), item(17, 3), item(18, 5), item(210, 2), item(110, 1, { 16: 0 }), item(128, 0, { 16: 5 })]);
    expect(scoring.rules).toEqual([
      { kind: "stepped", stat: "pass_yd", every: 5, points: 1 },
      { kind: "range", min: 300, max: 399, stat: "pass_yd", points: 3 },
      { kind: "threshold", min: 400, stat: "pass_yd", points: 5 },
      { kind: "perGame", points: 2 },
      { kind: "stepped", stat: "idp_tkl", every: 3, points: 1, positions: ["QB", "RB", "WR", "TE", "K", "P", "DL", "LB", "DB"] },
      { kind: "range", max: 99, stat: "yds_allow", points: 5, positions: ["DEF"] },
    ]);
  });

  it("approximates unequal INT-return / fumble-return TD rates with a warning", () => {
    const { scoring, warnings } = buildEspnScoring([item(103, 0, { 16: 6 }), item(104, 0, { 16: 4 })]);
    expect(scoring.byPosition?.DEF?.def_td).toBe(6);
    expect(scoring.perStat.def_td).toBeUndefined();
    expect(warnings.map((w) => w.code)).toEqual(["ESPN_SCORING_SHARED_KEY"]);
  });

  it("warns on unknown stat ids, reverse items and positions we merge; a head-coach rule worth 0 to a head coach is skipped", () => {
    const { scoring, warnings } = buildEspnScoring([{ statId: 999, points: 3 }, { ...item(53, 1), isReverseItem: true }, item(161, 10, { 14: 0 }), item(99, 1, { 9: 2 })]);
    expect(scoring.unmapped).toEqual([{ platformKey: "999", label: "ESPN stat 999", points: 3 }]);
    expect(warnings.map((w) => w.code).sort()).toEqual(["ESPN_SCORING_OVERRIDE_CONFLICT", "ESPN_SCORING_REVERSE_ITEM", "ESPN_SCORING_UNKNOWN_STAT"]);
  });

  it("uses the QB or TQB rate for Pos QB as the lineup dictates, warning only when both are started", () => {
    const rush = item(24, 0, { 1: 0.1, 15: 0.2 });
    expect(buildEspnScoring([rush], { qbSource: "TQB" }).scoring.byPosition?.QB?.rush_yd).toBe(0.2);
    expect(buildEspnScoring([rush], { qbSource: "QB" }).scoring.byPosition?.QB?.rush_yd).toBe(0.1);
    expect(buildEspnScoring([rush], { qbSource: "QB", bothQbKinds: true }).warnings.map((w) => w.code)).toEqual(["ESPN_SCORING_OVERRIDE_CONFLICT"]);
  });

  it("gives Sleeper's special-teams keys ESPN's rates: D/ST (def_st_*) and players (st_td)", () => {
    expect(SLEEPER_DEF_ALIASES.map((a) => a.key)).toEqual(["def_st_td", "def_st_fum_rec", "def_st_ff"]);
    expect(SLEEPER_PLAYER_ALIASES.map((a) => a.key)).toEqual(["st_td"]);
    const same = buildEspnScoring([item(101, 6, { 16: 6 }), item(102, 6, { 16: 6 }), item(96, 0, { 16: 2 }), item(106, 0, { 16: 1 })]);
    expect(same.scoring.byPosition?.DEF).toMatchObject({ def_st_td: 6, def_st_fum_rec: 2, def_st_ff: 1, st_td: 0 });
    expect(same.scoring.perStat).toMatchObject({ st_td: 6 });
    expect(same.warnings).toEqual([]);
    expect(buildEspnScoring([item(101, 0, { 16: 6 }), item(102, 0, { 16: 4 })]).warnings.map((w) => w.code)).toEqual(["ESPN_SCORING_SHARED_KEY"]);
    // Kick returns scored, punt returns not: Sleeper's merged key can only get one rate, so say so.
    expect(buildEspnScoring([item(101, 0, { 16: 6 })]).warnings.map((w) => w.code)).toEqual(["ESPN_SCORING_SHARED_KEY"]);
  });
});
