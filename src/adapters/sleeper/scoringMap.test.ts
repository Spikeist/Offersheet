import { describe, expect, it } from "vitest";
import type { Pos, ScoringRule } from "@/engine/model";
import { actualPoints, expectedPoints, ruleApplies, rulePoints } from "@/engine/scoring";
import { readMinFixture } from "@/test-utils/fixtures";
import { sleeperPos } from "./normalize";
import { bracketBounds, IDP_BONUS_THRESHOLDS, KNOWN_BONUS_TIERS, KNOWN_BRACKET_KEYS, mapSleeperScoring, normalizeProjectionStats } from "./scoringMap";

const ruleOf = (settings: Record<string, number>, key: string): ScoringRule => {
  const { scoring, mapping } = mapSleeperScoring(settings);
  const i = mapping.filter((m) => m.as === "rule").findIndex((m) => m.key === key);
  if (i < 0) throw new Error(`no rule for ${key}`);
  return scoring.rules[i] as ScoringRule;
};

describe("mapSleeperScoring: per-unit keys", () => {
  it("keeps non-zero plain keys as perStat rates and drops zeros", () => {
    const { scoring, mapping } = mapSleeperScoring({ rec: 0.5, pass_td: 4, rush_fd: 0, bonus_rec_te: 0.5, bonus_rush_td_qb: 1, fum_rec_td: 6 });
    expect(scoring.perStat).toEqual({ rec: 0.5, pass_td: 4, bonus_rec_te: 0.5, bonus_rush_td_qb: 1, fum_rec_td: 6 });
    expect(scoring.rules).toEqual([]);
    expect(scoring.byPosition).toBeUndefined();
    expect(scoring.unmapped).toEqual([]);
    expect(mapping.every((m) => m.as === "perStat")).toBe(true);
  });

  it("TE premium (bonus_rec_te) stays a per-unit key: /stats and /projections both carry it", () => {
    const { scoring } = mapSleeperScoring({ rec: 1, bonus_rec_te: 0.5 });
    // A TE's line carries bonus_rec_te = rec (181/181 TE rows in Phase 1's check).
    expect(actualPoints({ gp: 1, rec: 6, bonus_rec_te: 6 }, "TE", scoring)).toBeCloseTo(9, 10);
    expect(actualPoints({ gp: 1, rec: 6 }, "WR", scoring)).toBeCloseTo(6, 10);
  });

  it("warns about non-numeric values instead of dropping them silently", () => {
    const { scoring, warnings } = mapSleeperScoring({ rec: 1, pass_td: "4" as unknown as number });
    expect(scoring.perStat).toEqual({ rec: 1 });
    expect(warnings).toEqual([expect.objectContaining({ code: "SCORING_VALUE_NOT_NUMBER", platformPath: "scoring_settings.pass_td" })]);
  });
});

describe("mapSleeperScoring: bonus tiers", () => {
  it("turns yardage bonuses into exclusive tiers: lower tier = bounded range, top tier = threshold", () => {
    const s = { bonus_pass_yd_300: 2, bonus_pass_yd_400: 4, bonus_rec_yd_100: 3, bonus_rec_yd_200: 5 };
    expect(ruleOf(s, "bonus_pass_yd_300")).toEqual({ kind: "range", stat: "pass_yd", min: 300, max: 399, points: 2 });
    expect(ruleOf(s, "bonus_pass_yd_400")).toEqual({ kind: "threshold", stat: "pass_yd", min: 400, points: 4 });
    expect(ruleOf(s, "bonus_rec_yd_100")).toEqual({ kind: "range", stat: "rec_yd", min: 100, max: 199, points: 3 });
    const { scoring } = mapSleeperScoring(s);
    expect(scoring.perStat).toEqual({}); // flags never become per-unit rates
    // A 410-yard game earns only the 400 tier (Sleeper: bonus_pass_yd_400 = 1, bonus_pass_yd_300 absent).
    expect(actualPoints({ gp: 1, pass_yd: 410, bonus_pass_yd_400: 1 }, "QB", scoring)).toBe(4);
    expect(actualPoints({ gp: 1, pass_yd: 399, bonus_pass_yd_300: 1 }, "QB", scoring)).toBe(2);
  });

  it("keeps the tiers exclusive even when the league scores only the lower one", () => {
    // /stats flags are league-independent: a 410-yard game never carries bonus_pass_yd_300.
    expect(ruleOf({ bonus_pass_yd_300: 3 }, "bonus_pass_yd_300")).toEqual({ kind: "range", stat: "pass_yd", min: 300, max: 399, points: 3 });
  });

  it("splits a family on a new tier found in the league's keys (zero-valued keys count)", () => {
    const s = { bonus_pass_yd_300: 1, bonus_pass_yd_400: 2, bonus_pass_yd_500: 0 };
    expect(ruleOf(s, "bonus_pass_yd_400")).toEqual({ kind: "range", stat: "pass_yd", min: 400, max: 499, points: 2 });
  });

  it("rush+rec yards is a composite stat; single-tier bonuses and IDP bonuses are thresholds", () => {
    const s = { bonus_rush_rec_yd_100: 1, bonus_rush_rec_yd_200: 5, bonus_pass_cmp_25: 3, bonus_rush_att_20: 1, bonus_sack_2p: 6, bonus_tkl_10p: 2, idp_pass_def_3p: 10 };
    expect(ruleOf(s, "bonus_rush_rec_yd_100")).toEqual({ kind: "range", stat: { sum: ["rush_yd", "rec_yd"] }, min: 100, max: 199, points: 1 });
    expect(ruleOf(s, "bonus_pass_cmp_25")).toEqual({ kind: "threshold", stat: "pass_cmp", min: 25, points: 3 });
    expect(ruleOf(s, "bonus_rush_att_20")).toEqual({ kind: "threshold", stat: "rush_att", min: 20, points: 1 });
    expect(ruleOf(s, "bonus_sack_2p")).toEqual({ kind: "threshold", stat: "idp_sack", min: 2, points: 6 });
    expect(ruleOf(s, "bonus_tkl_10p")).toEqual({ kind: "threshold", stat: "idp_tkl", min: 10, points: 2 });
    expect(ruleOf(s, "idp_pass_def_3p")).toEqual({ kind: "threshold", stat: "idp_pass_def", min: 3, points: 10 });
    const { scoring } = mapSleeperScoring(s);
    // 194 rush + 19 rec = 213: only the 200 tier (as Sleeper flagged that week-3 game).
    expect(actualPoints({ gp: 1, rush_yd: 194, rec_yd: 19, rush_att: 22 }, "RB", scoring)).toBe(5 + 1);
    expect(actualPoints({ gp: 1, idp_sack: 1.5, idp_tkl: 9 }, "LB", scoring)).toBe(0);
    expect(actualPoints({ gp: 1, idp_sack: 2.5, idp_tkl: 10, idp_pass_def: 3 }, "LB", scoring)).toBe(18);
  });
});

describe("mapSleeperScoring: D/ST brackets", () => {
  it("reads bracket bounds from the key names, non-overlapping and open at both ends", () => {
    const b = bracketBounds([]);
    expect(b.get("pts_allow_0")).toEqual({ key: "pts_allow_0", stat: "pts_allow", max: 0 });
    expect(b.get("pts_allow_1_6")).toMatchObject({ min: 1, max: 6 });
    expect(b.get("pts_allow_28_34")).toMatchObject({ min: 28, max: 34 });
    expect(b.get("pts_allow_35p")).toEqual({ key: "pts_allow_35p", stat: "pts_allow", min: 35 });
    // yds_allow_0_100 overlaps yds_allow_100_199 at 100 by name: read as 0–99.
    expect(b.get("yds_allow_0_100")).toEqual({ key: "yds_allow_0_100", stat: "yds_allow", max: 99 });
    expect(b.get("yds_allow_100_199")).toMatchObject({ min: 100, max: 199 });
    expect(b.get("yds_allow_550p")).toEqual({ key: "yds_allow_550p", stat: "yds_allow", min: 550 });
  });

  it("maps brackets to DEF-only range rules that tile every integer exactly once", () => {
    const settings = Object.fromEntries(KNOWN_BRACKET_KEYS.map((k) => [k, 1]));
    const { scoring } = mapSleeperScoring(settings);
    expect(scoring.rules).toHaveLength(KNOWN_BRACKET_KEYS.length);
    expect(scoring.rules.every((r) => r.positions?.length === 1 && r.positions[0] === "DEF")).toBe(true);
    for (let pts = 0; pts <= 70; pts++) expect(actualPoints({ gp: 1, pts_allow: pts, yds_allow: 330 }, "DEF", scoring)).toBe(2); // one pts + one yds bracket
    for (const yds of [0, 99, 100, 199, 200, 349, 350, 549, 550, 700]) expect(actualPoints({ gp: 1, pts_allow: 10, yds_allow: yds }, "DEF", scoring)).toBe(2);
    expect(actualPoints({ gp: 1, pts_allow: 10, yds_allow: 330 }, "WR", scoring)).toBe(0);
  });

  it("gives projected DEF lines an expected bracket value and other positions none", () => {
    const { scoring } = mapSleeperScoring({ pts_allow_0: 5, pts_allow_1_6: 4, pts_allow_7_13: 3, pts_allow_14_20: 1, pts_allow_28_34: -1, pts_allow_35p: -4 });
    const ev = expectedPoints({ pts_allow: 21.5 }, "DEF", scoring);
    // Normal(21.5, 9): a smooth average of the bracket points, between the extremes.
    expect(ev).toBeGreaterThan(-4);
    expect(ev).toBeLessThan(5);
    expect(expectedPoints({ pts_allow: 10 }, "DEF", scoring)).toBeGreaterThan(expectedPoints({ pts_allow: 30 }, "DEF", scoring));
    // A WR's projection has no pts_allow; the DEF-only rules must not score it (config SD 9 would).
    expect(expectedPoints({ rec: 5, rec_yd: 60 }, "WR", scoring)).toBe(0);
  });
});

describe("mapSleeperScoring: first-down bonuses by position", () => {
  it("stay per-unit keys, as /stats carries them, so a fullback earns none (SLP-7)", () => {
    const { scoring, mapping } = mapSleeperScoring({ rush_fd: 1, bonus_fd_wr: 1.25, bonus_fd_qb: 0.2, bonus_fd_te: 2, bonus_fd_rb: 0 });
    expect(scoring.perStat).toEqual({ rush_fd: 1, bonus_fd_qb: 0.2, bonus_fd_te: 2, bonus_fd_wr: 1.25 });
    expect(scoring.byPosition).toBeUndefined(); // Sleeper maps no byPosition rates at all
    expect(mapping.every((m) => m.as === "perStat")).toBe(true);
    // /stats: bonus_fd_wr = pass_fd + rush_fd + rec_fd. Sleeper: 1 × 1 + 1.25 × 4 = 6.
    expect(actualPoints({ gp: 1, rush_fd: 1, rec_fd: 3, bonus_fd_wr: 4 }, "WR", scoring)).toBeCloseTo(6, 10);
    expect(actualPoints({ gp: 1, rush_fd: 2 }, "RB", scoring)).toBe(2); // no RB bonus in this league
    // A Sleeper FB is an RB in our positions, but /stats gives him no bonus_fd_rb: the plain rate only.
    const rb = mapSleeperScoring({ rush_fd: 1, bonus_fd_rb: 0.75 }).scoring;
    expect(actualPoints({ gp: 1, rush_fd: 1, rec_fd: 1 }, "RB", rb)).toBe(1); // an FB line
    expect(actualPoints({ gp: 1, rush_fd: 1, rec_fd: 1, bonus_fd_rb: 2 }, "RB", rb)).toBeCloseTo(2.5, 10); // an RB line
    // /projections has no bonus_fd_* key: normalizeProjectionStats fills it for QB/RB/WR/TE rows, never FB.
    expect(expectedPoints(normalizeProjectionStats({ rush_fd: 0.5, rec_fd: 2.5 }, "WR"), "WR", scoring)).toBeCloseTo(0.5 * 1 + 3 * 1.25, 10);
    expect(expectedPoints(normalizeProjectionStats({ rush_fd: 0.5, rec_fd: 0.5 }, "FB"), "RB", rb)).toBeCloseTo(0.5, 10);
  });
});

describe("flag == rule(raw) on committed public /stats rows", () => {
  const fixture = readMinFixture<{ rows: Array<{ week: number; position: string; stats: Record<string, number> }> }>("sleeper", "flags", "stats-flag-rows");
  const keys = [...Object.entries(KNOWN_BONUS_TIERS).flatMap(([f, tiers]) => tiers.map((t) => `bonus_${f}_${t}`)), ...Object.keys(IDP_BONUS_THRESHOLDS), ...KNOWN_BRACKET_KEYS];
  const all = Object.fromEntries(keys.map((k) => [k, 1]));

  it("holds for every flag key on every committed boundary row", () => {
    expect(fixture.rows.length).toBeGreaterThan(200);
    let checks = 0;
    let flagged = 0;
    for (const key of keys) {
      const rule = ruleOf(all, key);
      for (const row of fixture.rows) {
        const pos: Pos = sleeperPos(row.position) ?? "WR";
        const want = ruleApplies(rule, pos) && rulePoints(rule, row.stats) ? 1 : 0;
        const flag = row.stats[key] ? 1 : 0;
        flagged += flag;
        checks++;
        if (want !== flag) throw new Error(`${key}: flag ${flag} vs rule ${want} on ${JSON.stringify(row)}`);
      }
    }
    expect(checks).toBe(keys.length * fixture.rows.length);
    expect(flagged).toBeGreaterThan(250);
  });

  it("includes the rows that show tiers are exclusive", () => {
    expect(fixture.rows.some((r) => r.stats.pass_yd === 410 && r.stats.bonus_pass_yd_400 === 1 && !r.stats.bonus_pass_yd_300)).toBe(true);
    expect(fixture.rows.some((r) => (r.stats.rush_yd ?? 0) + (r.stats.rec_yd ?? 0) >= 200 && r.stats.bonus_rush_rec_yd_200 === 1 && !r.stats.bonus_rush_rec_yd_100)).toBe(true);
  });

  it("leaves only these flags unchecked on the side where they fire (no such game in weeks 1–3)", () => {
    // No player had 200 rushing or receiving yards, no defense a shutout or under 100 yards allowed
    // (COMP-16): for these keys only "doesn't fire" is verified in the data. The rec_yd / rush_yd 200
    // tiers' exclusivity is documented by Sleeper ("The yard ranges are strict and do not stack",
    // support.sleeper.com/en/articles/3998131). Any other key must fire somewhere.
    const neverFired = keys.filter((k) => !fixture.rows.some((r) => r.stats[k]));
    expect(["bonus_rec_yd_200", "bonus_rush_yd_200", "pts_allow_0", "yds_allow_0_100"]).toEqual(expect.arrayContaining(neverFired));
  });

  it("bonus_fd_<pos> = pass_fd + rush_fd + rec_fd on QB/RB/WR/TE rows, none on fullback rows; projections get the same (SLP-7)", () => {
    const fd = (s: Record<string, number>) => (s.pass_fd ?? 0) + (s.rush_fd ?? 0) + (s.rec_fd ?? 0);
    const withFd = fixture.rows.filter((r) => fd(r.stats) > 0);
    const main = withFd.filter((r) => ["QB", "RB", "WR", "TE"].includes(r.position));
    expect(main.length).toBeGreaterThan(80); // 97 committed rows (678/678 in the full local weeks 1–3)
    for (const r of main) {
      const key = `bonus_fd_${r.position.toLowerCase()}`;
      expect(r.stats[key]).toBe(fd(r.stats));
      const withoutBonus = Object.fromEntries(Object.entries(r.stats).filter(([k]) => !k.startsWith("bonus_fd_")));
      expect(normalizeProjectionStats(withoutBonus, r.position)[key]).toBeCloseTo(fd(r.stats), 10);
    }
    const fullbacks = withFd.filter((r) => r.position === "FB");
    expect(fullbacks.length).toBeGreaterThan(0);
    for (const r of fullbacks) {
      expect(Object.keys(r.stats).filter((k) => k.startsWith("bonus_fd_"))).toEqual([]);
      expect(Object.keys(normalizeProjectionStats(r.stats, "FB")).filter((k) => k.startsWith("bonus_"))).toEqual([]);
    }
  });
});

describe("normalizeProjectionStats", () => {
  it("maps a DEF row's special-teams TD to def_st_td and drops its return components", () => {
    expect(normalizeProjectionStats({ st_td: 0.06, def_kr_td: 0.05, def_pr_td: 0.06, pr_td: 0.04, pr_yd: 14, def_pr_yd: 120, def_kr_yd: 400, sack: 2.5, pts_allow: 20.75, pts_allow_14_20: 1 }, "DEF")).toEqual({
      def_st_td: 0.06,
      def_pr_yd: 120,
      def_kr_yd: 400,
      sack: 2.5,
      pts_allow: 20.75,
      pts_allow_14_20: 1,
    });
  });

  it("maps a returner's TDs to st_td and return yards to kr_yd / pr_yd", () => {
    const out = normalizeProjectionStats({ def_kr_td: 0.05, pr_td: 0.04, def_kr_yd: 40, rec: 3, rec_yd: 30, bonus_rec_wr: 3 }, "WR");
    expect(out.st_td).toBeCloseTo(0.09, 10);
    expect(out).toMatchObject({ kr_yd: 40, rec: 3 });
    expect(out).not.toHaveProperty("def_kr_td");
    expect(out).not.toHaveProperty("def_kr_yd");
    expect(normalizeProjectionStats({ def_pr_yd: 22, idp_tkl: 5 }, "CB")).toEqual({ pr_yd: 22, idp_tkl: 5 });
  });

  it("derives fgmiss and fgm_50_59 for kickers (identities on /stats)", () => {
    expect(normalizeProjectionStats({ fga: 2.3, fgm: 1.9, fgm_50p: 0.3 }, "K")).toEqual({ fga: 2.3, fgm: 1.9, fgm_50p: 0.3, fgmiss: expect.closeTo(0.4, 10), fgm_50_59: 0.3 });
    expect(normalizeProjectionStats({ fga: 2, fgm: 2, fgmiss: 0.1, fgm_50p: 0.3, fgm_60p: 0.01 }, "K")).toEqual({ fga: 2, fgm: 2, fgmiss: 0.1, fgm_50p: 0.3, fgm_60p: 0.01 });
  });

  it("fills a missing position reception bonus from rec (and a QB's rushing-TD bonus)", () => {
    expect(normalizeProjectionStats({ rec: 0.29 }, "RB")).toEqual({ rec: 0.29, bonus_rec_rb: 0.29 });
    expect(normalizeProjectionStats({ rec: 4, bonus_rec_te: 4 }, "TE")).toEqual({ rec: 4, bonus_rec_te: 4 });
    expect(normalizeProjectionStats({ rush_td: 0.2 }, "QB")).toEqual({ rush_td: 0.2, bonus_rush_td_qb: 0.2 });
    expect(normalizeProjectionStats({ rec: 1 }, "FB")).toEqual({ rec: 1 }); // Sleeper gives FBs no RB bonus
  });

  it("fills the first-down bonus for QB/RB/WR/TE (pass_fd + rush_fd + rec_fd), never for FB", () => {
    expect(normalizeProjectionStats({ pass_fd: 11.5, rush_fd: 1.5 }, "QB")).toEqual({ pass_fd: 11.5, rush_fd: 1.5, bonus_fd_qb: 13 });
    expect(normalizeProjectionStats({ rush_fd: 3, rec_fd: 1 }, "RB")).toEqual({ rush_fd: 3, rec_fd: 1, bonus_fd_rb: 4 });
    expect(normalizeProjectionStats({ rec_fd: 2, bonus_fd_te: 2.5 }, "TE")).toEqual({ rec_fd: 2, bonus_fd_te: 2.5 }); // a carried value wins
    expect(normalizeProjectionStats({ rush_fd: 1, rec_fd: 0.5, rec: 1 }, "FB")).toEqual({ rush_fd: 1, rec_fd: 0.5, rec: 1 });
    expect(normalizeProjectionStats({ rush_yd: 3 }, "WR")).toEqual({ rush_yd: 3 }); // no first downs: nothing to fill
  });

  it("drops non-numbers and tolerates empty input", () => {
    expect(normalizeProjectionStats(null, "WR")).toEqual({});
    expect(normalizeProjectionStats({ rec: "3", rec_yd: 20 }, "WR")).toEqual({ rec_yd: 20 });
  });
});
