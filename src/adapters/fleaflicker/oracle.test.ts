/**
 * Scoring oracle on real data (CLAUDE.md §5) for the two Phase 0 public Fleaflicker test leagues.
 * Fixtures are committed, minimized subsets (scripts/minimize/fleaflicker-oracle.ts); their meta
 * records the result on every player-week of the full local copies. Both include box-score players
 * who didn't play (no gp; Fleaflicker scores them 0).
 *
 * - The conventional league must reach the §5 target (config.scoring.oracleTarget within
 *   oracleTolerance) for players who played; its idle QBs expose an engine gap (see below).
 * - The exotic keeper league is reported honestly: 25 of its 82 rules have no Sleeper equivalent
 *   (TD / FG / return length bands, 20+ yard completions …) and 3 are only partly mappable, so the
 *   test holds a regression pin (not a target) and lists every unmapped rule.
 */
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import { RULE_TYPES, describeMismatch, runOracle, type OracleCase, type OracleMismatch, type OracleSummary } from "@/engine/oracle";
import { KEEPER_POPULATION_PIN, KEEPER_REGRESSION_PIN, loadFleaflickerOracle } from "./oracleSuite";
import { ALL_ADJUSTMENTS, type FleaflickerRuleMapping } from "./scoringMap";

const { oracleTarget: TARGET, oracleTolerance: TOLERANCE } = config.scoring;
/** Sleeper leaves gp out of the line of a player who didn't play. */
const played = (c: OracleCase) => (c.stats.gp ?? 0) > 0;
/** Rule types that at least one matched player-week tested, in RULE_TYPES order. */
const exercisedTypes = (s: OracleSummary) => RULE_TYPES.filter((t) => s.ruleTypesExercised[t] > 0);

/**
 * Stats that show an unmapped or partial rule may have fired for a player-week (the rule itself
 * can't be evaluated from Sleeper's stats). Keyed by Fleaflicker category id.
 */
const TRIGGERS: Record<number, string[]> = {
  6: ["pass_td"],
  25: ["rush_td"],
  45: ["rec_td"],
  64: ["st_td"],
  68: ["st_td"],
  82: ["gp"],
  87: ["gp"],
  90: ["idp_def_td"],
  102: ["fgm"],
  106: ["fgmiss"],
  119: ["fum_rec_td"],
  125: [],
  161: ["punts"],
  166: ["pass_cmp"],
};

function triggeredRules(c: OracleCase, mappings: FleaflickerRuleMapping[]): FleaflickerRuleMapping[] {
  return mappings.filter((m) => (m.status === "unmapped" || m.status === "partial") && m.positions.includes(c.pos) && (TRIGGERS[m.categoryId] ?? []).some((k) => (c.stats[k] ?? 0) > 0));
}

const gcd = (a: number, b: number): number => (b < 1e-9 ? a : gcd(b, a % b));

/**
 * A mismatch is attributable when some rule that may have fired scores in the direction of the gap
 * and the gap is a whole number of those rules' points (each scores per event or per tier).
 */
function attributable(m: OracleMismatch, mappings: FleaflickerRuleMapping[]): boolean {
  const rules = triggeredRules(m.case, mappings);
  const gap = m.case.expected - m.got;
  if (!rules.length || !rules.some((r) => Math.sign(r.points) === Math.sign(gap))) return false;
  const unit = rules.map((r) => Math.abs(r.points)).reduce(gcd);
  const k = gap / unit;
  return Math.abs(k - Math.round(k)) * unit <= TOLERANCE;
}

describe("Fleaflicker scoring oracle: conventional league (weeks 2–3)", () => {
  const { fx, compiled, cases, summary } = loadFleaflickerOracle("conventional-league");
  const idleMisses = summary.mismatches.filter((m) => !played(m.case));

  it("maps every active rule", () => {
    expect(compiled.scoring.unmapped).toEqual([]);
    expect(compiled.mappings.filter((m) => m.status !== "inactive").every((m) => m.status === "mapped")).toBe(true);
  });

  it(`matches Fleaflicker's points (within ${TOLERANCE}) for ≥ ${TARGET * 100}% of the committed player-weeks of players who played`, () => {
    const s = runOracle(cases.filter(played));
    expect(s.total).toBeGreaterThanOrEqual(100);
    expect(s.passes, s.mismatches.map(describeMismatch).join("\n")).toBe(true);
    // The only miss is a stat-provider difference in drops (−0.25 per drop).
    expect(s.mismatches.map((m) => Math.abs(m.diff))).toEqual([0.25]);
  });

  it("includes players who didn't play (no gp): Fleaflicker scores every one of them 0", () => {
    const idle = cases.filter((c) => !played(c));
    expect(idle.length).toBeGreaterThan(0);
    expect(idle.every((c) => c.expected === 0)).toBe(true);
  });

  // ENG-3: the engine scores no rule on a line without games played (engine/scoring.ts playedGame), so
  // this league's "completion % ≤ 50 → −2" no longer fires on the empty line of a QB who didn't play.
  it("scores 0 for every committed player-week of a player who didn't play", () => {
    expect(idleMisses.map(describeMismatch)).toEqual([]);
  });

  it(`meets the target (≥ ${TARGET * 100}% within ${TOLERANCE}) on every committed player-week, played or not`, () => {
    expect(summary.rate, summary.mismatches.map(describeMismatch).join("\n")).toBeGreaterThanOrEqual(TARGET);
    const rule = compiled.scoring.rules.find((r) => r.kind === "range" && r.stat === "cmp_pct" && r.max !== undefined && r.min === undefined);
    expect(rule?.points).toBe(-2); // the rule that used to misfire on idle QBs is still mapped
  });

  it("tests per-unit rates, threshold bonuses and range tiers (honest rule-type counts)", () => {
    // ruleTypesIn counts a type only when a wrong reading would change the points. This league has no
    // position rate over a league-wide base, no stepped or bounded per-unit rule, no composite and no
    // per-game constant.
    expect(exercisedTypes(summary)).toEqual(["perUnit", "threshold", "range"]);
  });

  it("recorded the full population at the target for players who played; those who didn't are counted apart", () => {
    const p = fx.meta.population;
    const idle = p.notPlayed ?? 0;
    const idleWithin = p.notPlayedWithin ?? 0;
    expect(p.cases).toBeGreaterThanOrEqual(400);
    expect(idle).toBeGreaterThan(0);
    expect((p.within - idleWithin) / (p.cases - idle)).toBeGreaterThanOrEqual(TARGET);
  });
});

describe("Fleaflicker scoring oracle: exotic keeper league (weeks 2–3), reported honestly", () => {
  const { fx, compiled, cases, summary } = loadFleaflickerOracle("keeper-league");

  it(`stays at or above its regression pin (${KEEPER_REGRESSION_PIN.within}/${KEEPER_REGRESSION_PIN.total} committed; a pin, not a target)`, () => {
    expect(cases.length).toBe(KEEPER_REGRESSION_PIN.total);
    expect(summary.within).toBeGreaterThanOrEqual(KEEPER_REGRESSION_PIN.within);
    const p = fx.meta.population;
    expect(p.cases).toBe(KEEPER_POPULATION_PIN.total);
    expect(p.within).toBeGreaterThanOrEqual(KEEPER_POPULATION_PIN.within);
  });

  it("tests per-unit rates, threshold bonuses, range tiers, composite stats and per-game constants (honest rule-type counts)", () => {
    // Fleaflicker has no stepped or bounded per-unit rule (per-unit rules with bounds stay unmapped), and
    // this league's position-specific rates have no league-wide base to replace.
    expect(exercisedTypes(summary)).toEqual(["perUnit", "threshold", "range", "composite", "perGame"]);
  });

  it("per-game constants need games played: every QB and K who didn't play scores 0, as on Fleaflicker", () => {
    // ENG-3: the punter-only tier ("≤ 5 yards on returned punts") is a per-game constant for QB/K.
    const perGame = compiled.scoring.rules.filter((r) => r.kind === "perGame");
    expect(perGame.length).toBeGreaterThan(0);
    const perGamePos = new Set(perGame.flatMap((r) => r.positions ?? []));
    const idle = cases.filter((c) => !played(c) && perGamePos.has(c.pos));
    expect(idle.length).toBeGreaterThanOrEqual(10);
    expect(idle.every((c) => c.expected === 0)).toBe(true);
    expect(summary.mismatches.filter((m) => idle.includes(m.case))).toEqual([]);
    expect(summary.ruleTypesExercised.perGame).toBeGreaterThan(0); // and it scores for those who played
    const p = fx.meta.population;
    expect(p.notPlayed).toBeGreaterThan(0);
    expect(p.notPlayedWithin).toBe(p.notPlayed); // every idle player-week of the full copy matches
  });

  it("lists every rule it can't map (25 unmapped, 3 partly mapped), with points", () => {
    const unmapped = compiled.mappings.filter((m) => m.status === "unmapped").map((m) => m.description);
    const partial = compiled.mappings.filter((m) => m.status === "partial").map((m) => m.description);
    expect(unmapped).toEqual([
      "1 point for every Passing Completion of 20+ Yards",
      "2 extra points for every Passing TD between 40 and 59 yards (inclusive)",
      "3 extra points for every Passing TD between 60 and 79 yards (inclusive)",
      "5 extra points for every Passing TD of 80 or more yards",
      "2 extra points for every Rushing TD between 40 and 59 yards (inclusive)",
      "4 extra points for every Rushing TD between 60 and 79 yards (inclusive)",
      "6 extra points for every Rushing TD of 80 or more yards",
      "2 extra points for every Receiving TD between 40 and 59 yards (inclusive)",
      "4 extra points for every Receiving TD between 60 and 79 yards (inclusive)",
      "6 extra points for every Receiving TD of 80 or more yards",
      "2 extra points for every Offensive Fumble Recovery TD between 40 and 79 yards (inclusive)",
      "4 extra points for every Offensive Fumble Recovery TD of 80 or more yards",
      "1 extra point for every Field Goal Made between 41 and 43 yards (inclusive)",
      "2 extra points for every Field Goal Made between 44 and 46 yards (inclusive)",
      "3 extra points for every Field Goal Made between 47 and 49 yards (inclusive)",
      "4 extra points for every Field Goal Made between 50 and 54 yards (inclusive)",
      "5 extra points for every Field Goal Made of 55 or more yards",
      "-2 extra points for every Field Goal Missed of 35 or less yards",
      "3 extra points for every Kick Return TD between 50 and 79 yards (inclusive)",
      "6 extra points for every Kick Return TD of 80 or more yards",
      "3 extra points for every Punt Return TD between 50 and 69 yards (inclusive)",
      "6 extra points for every Punt Return TD between 70 and 110 yards (inclusive)",
      "2 extra points for every Defensive TD between 40 and 79 yards (inclusive)",
      "4 extra points for every Defensive TD of 80 or more yards",
      "2 points for every Conversion Return",
    ]);
    expect(partial).toEqual(["1 point for every Assisted Tackle", "4 points for every Fumble Recovered", "2 extra points when total Yards on Returned Punts is less than or equal to 5"]);
    expect(compiled.scoring.unmapped).toHaveLength(28);
    expect(compiled.scoring.unmapped.every((u) => Number.isFinite(u.points) && u.points !== 0)).toBe(true);
  });

  it("attributes every mismatch to a rule Sleeper's stats can't express", () => {
    const unattributed = summary.mismatches.filter((m) => !attributable(m, compiled.mappings));
    expect(summary.mismatches.length).toBe(cases.length - summary.within);
    expect(unattributed.map(describeMismatch)).toEqual([]);
  });

  it("each definition adjustment fixes player-weeks and breaks none", () => {
    const matched = (s: typeof summary) => new Set(s.mismatches.map((m) => `${m.case.playerId}|${m.case.week}`));
    const onMissed = matched(summary);
    for (const adj of ALL_ADJUSTMENTS) {
      const off = loadFleaflickerOracle("keeper-league", { disable: [adj] }).summary;
      const offMissed = matched(off);
      expect(off.within, adj).toBeLessThan(summary.within);
      expect([...onMissed].filter((k) => !offMissed.has(k)), `${adj} broke these`).toEqual([]);
    }
  });
});
