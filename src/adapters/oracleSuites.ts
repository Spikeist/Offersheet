/**
 * Test support (not app code): every real-data scoring oracle suite, across platforms (CLAUDE.md §5,
 * §16; planner reply to Checkpoint 0, answer 4: the oracle must cover EVERY rule type). Used by
 * oracleCoverage.test.ts and scripts/oracle-report.ts. All inputs are committed fixtures: Parker's
 * sanitized ESPN league and minimized copies of the strangers' test leagues.
 *
 * Rule-type counts are honest (engine/oracle.ts ruleTypesIn): a type counts only where a wrong
 * reading of it would have changed the points. RULE_TYPE_EVIDENCE says, per type, what platform data
 * backs it and whether that is ✅ (league-scored points) or ⚠️ (derived, small or indirect).
 */
import { config } from "@/engine/config";
import { runOracle, type OracleSummary, type RuleType } from "@/engine/oracle";
import { buildEspnScoring } from "./espn/scoringMap";
import { loadEspnCrossSourceOracle, loadEspnParkerOracle, loadEspnPublicOracle, loadEspnSteppedOracle, parkerLeague, publicLeague } from "./espn/oracleSuite";
import { SLEEPER_DEF_ALIASES } from "./espn/scoringMap";
import { KEEPER_REGRESSION_PIN, loadFleaflickerOracle } from "./fleaflicker/oracleSuite";
import { loadMflOracle } from "./mfl/oracleSuite";
import { loadSleeperOracleLeague, loadSleeperTestLeagueOracle, sleeperOracleLeagueLabels } from "./sleeper/oracleSuite";

export interface OracleSuiteResult {
  name: string;
  /** What our points are compared with. */
  source: string;
  summary: OracleSummary;
  /** §5's target, or for a suite that can't reach it, a regression pin on its measured result. */
  target: number;
  /** Set when the target is a regression pin rather than §5's target. */
  pin?: { within: number; total: number; why: string };
  /** Caveats shown with the suite (⚠️ facts a reader needs). */
  note?: string;
}

export function allOracleSuites(): OracleSuiteResult[] {
  const t = config.scoring.oracleTarget;
  const cross = loadEspnCrossSourceOracle();
  const aliasKeys = new Set(SLEEPER_DEF_ALIASES.map((a) => a.key));
  const { scoring } = parkerLeague();
  const drop = (table: Record<string, number> | undefined) => Object.fromEntries(Object.entries(table ?? {}).filter(([k]) => !aliasKeys.has(k)));
  const noAliases = runOracle(loadEspnCrossSourceOracle({ ...scoring, perStat: drop(scoring.perStat), byPosition: { ...scoring.byPosition, DEF: drop(scoring.byPosition?.DEF) } }).cases);
  return [
    { name: "ESPN · Parker's league, weeks 2–3", source: "ESPN stats → canonical keys vs ESPN appliedTotal", summary: loadEspnParkerOracle().summary, target: t },
    { name: "ESPN · public test league, weeks 2–3", source: "ESPN stats → canonical keys vs ESPN appliedTotal", summary: loadEspnPublicOracle().summary, target: t },
    {
      name: "ESPN · Parker's scoring on Sleeper stats, weeks 2–3",
      source: "Sleeper /stats vs ESPN appliedTotal",
      summary: cross.summary,
      target: t,
      note: `⚠️ ${noAliases.within}/${noAliases.total} without the 3 D/ST special-teams key aliases, which were derived from these same weeks; ${cross.cross.playerWeeks - cross.cases.length} player-weeks without a Sleeper line are left out (they scored 0)`,
    },
    {
      name: "ESPN · every-N counts, weeks 2–3 (Parker's and the public league)",
      source: "ESPN's own derived \"every N\" counts vs a stepped rule on the raw stat",
      summary: loadEspnSteppedOracle().summary,
      target: t,
      note: "⚠️ ESPN's derived counts, not league-scored points; ESPN sends no count for a negative raw value, so the stepped rule's clamp at 0 has no ESPN evidence",
    },
    { name: "Sleeper · public test league, weeks 2–3", source: "Sleeper /stats vs players_points", summary: loadSleeperTestLeagueOracle().summary, target: t },
    ...sleeperOracleLeagueLabels().map((label) => ({ name: `Sleeper · ${label.replace("oracle-league-", "cross-league ")}, weeks 2–3`, source: "Sleeper /stats vs players_points", summary: loadSleeperOracleLeague(label).summary, target: t })),
    { name: "MFL · public test league, weeks 2–3", source: "Sleeper /stats vs MFL player scores", summary: loadMflOracle().summary, target: t },
    { name: "Fleaflicker · conventional league, weeks 2–3", source: "Sleeper /stats vs Fleaflicker box scores", summary: loadFleaflickerOracle("conventional-league").summary, target: t },
    {
      name: "Fleaflicker · exotic keeper league, weeks 2–3",
      source: "Sleeper /stats vs Fleaflicker box scores",
      summary: loadFleaflickerOracle("keeper-league").summary,
      target: KEEPER_REGRESSION_PIN.within / KEEPER_REGRESSION_PIN.total,
      pin: { ...KEEPER_REGRESSION_PIN, why: "25 of its 82 rules (20+ yard completions, TD and FG length bands, …) have no Sleeper stat key and 3 are partly mapped; all are listed as unmapped" },
    },
  ];
}

/** ESPN's pointsOverrides REPLACE the base rate: the public league matches only under that reading. */
export function espnReplacementEvidence(): { replace: OracleSummary; additive: OracleSummary } {
  const { items, ctx, scoring } = publicLeague();
  const additiveItems = items.map((i) => (i.pointsOverrides ? { ...i, pointsOverrides: Object.fromEntries(Object.entries(i.pointsOverrides).map(([k, v]) => [k, i.points + v])) } : i));
  return { replace: loadEspnPublicOracle(scoring).summary, additive: loadEspnPublicOracle(buildEspnScoring(additiveItems, ctx).scoring).summary };
}

export interface RuleTypeEvidence {
  type: RuleType;
  status: "✅" | "⚠️";
  /** Where the platform evidence comes from, in words. */
  evidence: string;
}

/** Per rule type: what backs it (§0.12: ✅ only when league-scored points verify it). */
export function ruleTypeEvidence(suites: OracleSuiteResult[] = allOracleSuites()): RuleTypeEvidence[] {
  const count = (t: RuleType, where: (s: OracleSuiteResult) => boolean = () => true) => suites.filter(where).reduce((n, s) => n + s.summary.ruleTypesExercised[t], 0);
  const leaguePoints = (s: OracleSuiteResult) => !s.name.includes("every-N");
  const { replace, additive } = espnReplacementEvidence();
  const where = (t: RuleType) =>
    suites
      .filter((s) => s.summary.ruleTypesExercised[t] > 0)
      .map((s) => `${s.name.split(",")[0]} ${s.summary.ruleTypesExercised[t]}`)
      .join("; ");
  return [
    { type: "perUnit", status: "✅", evidence: `${count("perUnit")} matched player-weeks on every platform` },
    {
      type: "byPosition",
      status: replace.rate >= config.scoring.oracleTarget && additive.rate < config.scoring.oracleTarget ? "✅" : "⚠️",
      evidence: `ESPN public test league: position overrides read as REPLACEMENTS match ${replace.within}/${replace.total}; read as additions ${additive.within}/${additive.total} (below target). No committed case has an override on a non-zero base, so the per-case counter is 0`,
    },
    { type: "threshold", status: count("threshold", leaguePoints) ? "✅" : "⚠️", evidence: where("threshold") || "none" },
    { type: "range", status: count("range", leaguePoints) ? "✅" : "⚠️", evidence: where("range") || "none" },
    { type: "stepped", status: "⚠️", evidence: `${count("stepped")} cases where the floor bites, all from ESPN's own every-N counts (not league-scored points): none of our leagues scores a stepped rule` },
    { type: "bounded", status: "⚠️", evidence: count("bounded") ? where("bounded") : "none: no league in our data has a per-unit or stepped rule whose bound cuts a stat (engine unit tests only)" },
    { type: "composite", status: count("composite", leaguePoints) ? "✅" : "⚠️", evidence: where("composite") || "none" },
    {
      type: "perGame",
      status: "⚠️",
      evidence: `${where("perGame") || "none"}: one derived rule (the Fleaflicker keeper league's "≤ 5 returned punt yards" tier, which pays QBs and kickers every game), incl. idle QB/K weeks without gp that score 0`,
    },
  ];
}
