/**
 * Scoring oracle for ESPN (CLAUDE.md §5), THROUGH THE CANONICAL FORM: ESPN's raw stat line →
 * toCanonicalStats → the league's canonical Scoring (buildEspnScoring) → engine scoring, compared
 * with ESPN's own league-scored appliedTotal. Target and tolerance come from config (≥ 99% within
 * 0.05 points).
 *
 * (a) ESPN-native: Parker's league weeks 2–3 (every rostered player) and the public test league
 *     weeks 2–3 (top-250 player pool plus its roster subset; minimized fixtures).
 * (b) Cross-source: Parker's scoring × Sleeper's public stat lines for the same players, vs ESPN's
 *     appliedTotal. Differences here are about stat definitions and providers, not ESPN's rules.
 * (c) Every-N: ESPN's own derived "every N yards" counts vs the engine's stepped rule on the raw stat.
 * Rule-type counts are honest (engine/oracle.ts ruleTypesIn): a type counts only where a wrong
 * reading of it would have changed the points. The cases are built in ./oracleSuite.ts (shared with
 * the cross-platform coverage test).
 */
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import type { Scoring } from "@/engine/model";
import { RULE_TYPES, describeMismatch, runOracle, type OracleSummary, type RuleType } from "@/engine/oracle";
import { EVERY_N_READINGS, loadEspnCrossSourceOracle, loadEspnParkerOracle, loadEspnPublicOracle, loadEspnSteppedOracle, parkerLeague, publicLeague } from "./oracleSuite";
import { SLEEPER_DEF_ALIASES, buildEspnScoring } from "./scoringMap";

const TARGET = config.scoring.oracleTarget;

function summary(name: string, s: OracleSummary): string {
  const types = RULE_TYPES.map((t) => `${t} ${s.ruleTypesExercised[t]}`).join(", ");
  return `${name}: ${s.within}/${s.total} within ${config.scoring.oracleTolerance} (${(100 * s.rate).toFixed(1)}%); rule types exercised: ${types}${s.mismatches.length ? `\n  ${s.mismatches.map(describeMismatch).join("\n  ")}` : ""}`;
}

/** The rule types a suite exercised (non-zero counters). */
const exercised = (s: OracleSummary) => RULE_TYPES.filter((t) => s.ruleTypesExercised[t] > 0);

describe("ESPN scoring oracle through canonical keys (ESPN-native)", () => {
  it("Parker's league, weeks 2–3: every rostered player within tolerance of ESPN's appliedTotal", () => {
    const { summary: s } = loadEspnParkerOracle();
    console.log(summary("ESPN oracle, Parker's league weeks 2–3", s));
    // Phase 0 had 165 + 166 = 331 player-weeks; the fixtures can be refreshed, so check the target, not a count.
    expect(s.total).toBeGreaterThan(300);
    expect(s.rate).toBeGreaterThanOrEqual(TARGET);
    expect(s.passes).toBe(true);
    // His league scores per-unit rates and D/ST points-allowed buckets; its FG 0–39 composite is
    // ESPN-native (one ESPN count), so it can't count as composite evidence.
    expect(exercised(s)).toEqual<RuleType[]>(["perUnit", "range"]);
  });

  it("public test league, weeks 2–3 (top-250 pool plus the roster subset): within tolerance", () => {
    const { cases, summary: s } = loadEspnPublicOracle();
    console.log(summary("ESPN oracle, public test league weeks 2–3", s));
    expect(new Set(cases.map((c) => c.week))).toEqual(new Set([2, 3]));
    expect(s.total).toBe(498);
    expect(s.within).toBe(498);
    expect(s.passes).toBe(true);
    // Its position-specific rushing rates have no base rate, so replace ≡ add there (not byPosition
    // evidence); the replacement reading is proven by the next test instead.
    expect(exercised(s)).toEqual<RuleType[]>(["perUnit", "range"]);
  });

  it("reading pointsOverrides as ADDITIVE (base + override) instead of replacing drops the public league below target", () => {
    const { items, ctx, scoring } = publicLeague();
    const additive = items.map((i) => (i.pointsOverrides ? { ...i, pointsOverrides: Object.fromEntries(Object.entries(i.pointsOverrides).map(([k, v]) => [k, i.points + v])) } : i));
    const add = loadEspnPublicOracle(buildEspnScoring(additive, ctx).scoring).summary;
    const replace = loadEspnPublicOracle(scoring).summary;
    console.log(summary("ESPN public test league with ADDITIVE overrides", { ...add, mismatches: add.mismatches.slice(0, 3) }));
    expect(replace.rate).toBeGreaterThanOrEqual(TARGET);
    expect(add.rate).toBeLessThan(TARGET);
    // Every miss is a D/ST: its return TDs and return yards have a base rate AND a D/ST override.
    expect(new Set(add.mismatches.map((m) => m.case.pos))).toEqual(new Set(["DEF"]));
  });
});

describe("ESPN scoring × Sleeper's stat lines (cross-source)", () => {
  it("Parker's scoring on Sleeper's public stats reproduces ESPN's points (provider differences reported)", () => {
    const { cases, summary: s, cross } = loadEspnCrossSourceOracle();
    console.log(summary(`Cross-source (Sleeper /stats × Parker's ESPN scoring), weeks 2–3; ${cross.playerWeeks - cases.length} of ${cross.playerWeeks} player-weeks unmatched (no Sleeper id ${cross.unmatched.noSleeperId}, no Sleeper row ${cross.unmatched.noSleeperRow})`, s));
    expect(cases.length).toBeGreaterThan(300);
    expect(s.rate).toBeGreaterThanOrEqual(TARGET);
    // Sleeper splits FG 0–39 into three keys, so here the composite is real evidence.
    expect(s.ruleTypesExercised.composite).toBeGreaterThan(0);
  });

  it("without the Sleeper D/ST special-teams aliases, exactly the 3 D/ST special-teams plays miss", () => {
    const aliasKeys = new Set(SLEEPER_DEF_ALIASES.map((a) => a.key));
    const { scoring } = parkerLeague();
    const drop = (t: Record<string, number> | undefined) => Object.fromEntries(Object.entries(t ?? {}).filter(([k]) => !aliasKeys.has(k)));
    const noAlias: Scoring = { ...scoring, perStat: drop(scoring.perStat), byPosition: { ...scoring.byPosition, DEF: drop(scoring.byPosition?.DEF) } };
    const { cases } = loadEspnCrossSourceOracle(noAlias);
    const s = runOracle(cases);
    console.log(summary("Cross-source without the D/ST special-teams aliases", s));
    expect(s.mismatches.map((m) => m.case.pos)).toEqual(["DEF", "DEF", "DEF"]);
    for (const m of s.mismatches) expect(Object.keys(m.case.stats).some((k) => aliasKeys.has(k))).toBe(true);
  });
});

describe("ESPN's own every-N counts vs the engine's stepped rule (stepped-floor evidence)", () => {
  it("covers every plain every-N reading ESPN has", () => {
    expect(new Set(EVERY_N_READINGS.map((r) => r.stat))).toEqual(new Set(["pass_yd", "pass_cmp", "pass_inc", "rush_yd", "rush_att", "rec_yd", "rec", "fgm_yds"]));
  });

  it("reproduces ESPN's floor(max(0, raw) / N) on Parker's and the public league's weeks 2–3 lines, with the floor biting in most cases", () => {
    const { cases, summary: s } = loadEspnSteppedOracle();
    console.log(summary("ESPN every-N counts vs stepped rules", { ...s, mismatches: s.mismatches.slice(0, 10) }));
    expect(new Set(cases.map((c) => c.source.replace(/.*\((.*)\)/, "$1")))).toEqual(new Set(["Parker's league", "public test league"]));
    expect(s.total).toBeGreaterThan(3000);
    expect(s.within).toBe(s.total);
    expect(exercised(s)).toEqual<RuleType[]>(["stepped"]);
    // The floor bites (the raw stat isn't a multiple of N) in most cases: a "no floor" or "ceil" reading would fail them.
    expect(s.ruleTypesExercised.stepped).toBeGreaterThan(0.8 * s.total);
    // Including counts that floor to 0 (e.g. 3 rushing yards, every 5). ESPN omits most 0 counts and
    // every count for a negative raw value, so the max(0, ·) clamp itself has no ESPN evidence.
    const raw = (c: (typeof cases)[number]) => c.stats[(c.scoring.rules[0] as { stat: string }).stat] ?? 0;
    expect(cases.some((c) => c.expected === 0 && raw(c) > 0)).toBe(true);
    expect(cases.some((c) => raw(c) < 0)).toBe(false);
  });
});
