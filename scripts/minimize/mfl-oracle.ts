/**
 * Minimized MFL scoring-oracle fixture (CLAUDE.md §0.6, §5; planner reply to Checkpoint 0, answer 2).
 *
 * Reads the git-ignored full sanitized copy of the Phase 0 public MFL test league
 * (data-local/fixtures-sanitized/mfl/) and cached public data (Sleeper weekly stats, the Sleeper
 * players DB, the DynastyProcess ID map) — offline, no new crawl — and writes
 * fixtures/sanitized/min/mfl/oracle/ (committed):
 *   - the league's scoring rules, only the fields the scoring map reads;
 *   - a subset of player-weeks (weeks 2–3) {sleeperId, platformPos, pos, week, stats, expected}
 *     chosen by rule-type coverage, position and whether the player played, never by whether they
 *     match;
 *   - the oracle's aggregate result on every rostered player-week of the full copy, including those
 *     of players who didn't play (no gp; MFL scores them 0).
 * No team, owner or league identities and no MFL player ids are written.
 *
 *   npx tsx scripts/minimize/mfl-oracle.ts            write the fixture
 *   npx tsx scripts/minimize/mfl-oracle.ts --dry-run  print aggregate numbers only
 */
import { asArray, isRecord, text } from "@/adapters/mfl/json";
import type { OracleFixture, OracleFixtureCase } from "@/adapters/mfl/oracleFixture";
import { MFL_POS } from "@/adapters/mfl/positions";
import { mflRulesToScoring } from "@/adapters/mfl/scoringMap";
import { buildCrosswalk, type MflPlayerIds } from "../lib/mfl/oracle";
import { readLocalFixture, saveMinimizedFixture, shiftTimestamps, timestampShiftMs } from "../lib/minimize";
import { isMainModule } from "../lib/runMode";
import { ORACLE_WEEKS, SEASON, TOLERANCE_TEXT, dynastyProcessRows, measurePopulation, minimizeStats, pct, round3, selectSubset, sleeperPlayers, sleeperWeekStats } from "./mfl-fleaflicker-common";

const DRY_RUN = process.argv.includes("--dry-run");
const LABEL = (type: string) => `mfl/${SEASON}/export?TYPE=${type}&JSON=1`;

/** The scoring rules body, trimmed to what the scoring map reads (MFL's "$t" text nodes are kept). */
function minimizeRules(json: unknown): unknown {
  const groups = asArray(isRecord(json) && isRecord(json.rules) ? json.rules.positionRules : undefined);
  return {
    rules: {
      positionRules: groups.map((g) => {
        const rec = isRecord(g) ? g : {};
        return { positions: rec.positions, rule: asArray(rec.rule as unknown[]).map((r) => (isRecord(r) ? Object.fromEntries(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : 1))) : r)) };
      }),
    },
  };
}

async function main(): Promise<void> {
  const rulesJson = readLocalFixture("mfl", LABEL("rules&L={leagueId}"));
  const { scoring, mappings } = mflRulesToScoring(rulesJson);

  const rosters = readLocalFixture("mfl", LABEL("rosters&L={leagueId}"));
  const rostered = [...new Set(asArray((rosters as { rosters?: { franchise?: unknown } }).rosters?.franchise as unknown[]).flatMap((f) => asArray((f as { player?: unknown }).player as unknown[]).map((p) => text((p as { id?: unknown }).id) ?? "")))].filter(Boolean);
  const playersDb = readLocalFixture("mfl", LABEL("players&DETAILS=1"));
  const players = new Map(asArray((playersDb as { players?: { player?: unknown } }).players?.player as unknown[]).filter(isRecord).map((p) => [text(p.id) ?? "", p] as const));

  // Canonical ids: DynastyProcess mfl_id → sleeper_id, then Sleeper-DB joins (Phase 0: 383/383).
  // League-specific custom players are not in MFL's player DB and are never crosswalked.
  const mflIds: MflPlayerIds[] = [...players.values()].map((p) => ({ id: text(p.id) ?? "", position: text(p.position), espn_id: text(p.espn_id), rotowire_id: text(p.rotowire_id), sportsdata_id: text(p.sportsdata_id), stats_id: text(p.stats_id) }));
  const xw = buildCrosswalk(mflIds, await dynastyProcessRows(), Object.values(await sleeperPlayers()));

  const skipped: Record<string, number> = {};
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);
  const population: OracleFixtureCase[] = [];
  for (const week of ORACLE_WEEKS) {
    const scoresJson = readLocalFixture("mfl", LABEL(`playerScores&L={leagueId}&W=${week}`));
    const scores = new Map(asArray((scoresJson as { playerScores?: { playerScore?: unknown } }).playerScores?.playerScore as unknown[]).filter(isRecord).map((e) => [text(e.id) ?? "", Number(text(e.score) ?? "0") || 0] as const));
    const stats = await sleeperWeekStats(week);
    for (const id of rostered) {
      const p = players.get(id);
      if (!p) {
        skip("custom player (not in MFL's player DB)");
        continue;
      }
      const platformPos = text(p.position) ?? "?";
      const pos = MFL_POS[platformPos];
      if (!pos) {
        skip(`no model position (${platformPos})`);
        continue;
      }
      const sleeperId = xw.sleeperOf.get(id)?.sleeperId;
      if (!sleeperId) {
        skip("no crosswalk to a Sleeper id");
        continue;
      }
      // Every rostered player-week, played or not: one who didn't play has no gp and must score 0.
      population.push({ sleeperId, platformPos, pos, week, stats: stats.get(sleeperId) ?? {}, expected: round3(scores.get(id) ?? 0) });
    }
  }

  const { population: summary, mismatches, exercised } = measurePopulation(population, scoring, skipped);
  console.log(`MFL test league, weeks ${ORACLE_WEEKS.join(", ")}: ${summary.within}/${summary.cases} player-weeks ${TOLERANCE_TEXT} (${pct(summary.within, summary.cases)}; ${summary.notPlayed} of them didn't play); skipped ${JSON.stringify(skipped)}`);
  console.log(`  by position: ${Object.entries(summary.byPos).map(([p, b]) => `${p} ${b.within}/${b.cases}`).join(", ")}`);
  console.log(`  rule types exercised (matched player-weeks): ${JSON.stringify(exercised)}`);
  console.log(`  rule mappings: ${JSON.stringify(mappings.reduce<Record<string, number>>((a, m) => ((a[m.status] = (a[m.status] ?? 0) + 1), a), {}))}; unmapped rules: ${scoring.unmapped.length}`);
  for (const m of mismatches.slice(0, 20)) console.log(`  mismatch: ${m}`);

  const subset = selectSubset(population, scoring, { perType: 15, fraction: 0.3, fractionNotPlayed: 0.1, salt: "mfl-oracle-subset-v1" }).map((c) => ({ ...c, stats: minimizeStats(c.stats, scoring) }));
  console.log(`  committed subset: ${subset.length} player-weeks (${pct(subset.length, population.length)} of the population)`);
  if (DRY_RUN) return;

  const fixture: OracleFixture = {
    meta: {
      platform: "mfl",
      league: "Phase 0 public MFL test league (10-team dynasty, IDP, TE premium)",
      season: SEASON,
      weeks: [...ORACLE_WEEKS],
      source: "MFL playerScores (league-scored) vs Sleeper's weekly actual stats × the scoring map; players joined through DynastyProcess mfl_id → sleeper_id and Sleeper-DB id joins",
      population: summary,
      selection: "every rule type the oracle counts as tested (up to 15 player-weeks each), then 30% of each position-and-week stratum of players who played and 10% of those who didn't, in a fixed hash order; chosen without looking at whether a case matches",
      generatedBy: "scripts/minimize/mfl-oracle.ts",
    },
    rules: minimizeRules(rulesJson),
    cases: subset,
  };
  const out = await saveMinimizedFixture("mfl", "oracle", "test-league", shiftTimestamps(fixture, timestampShiftMs("mfl")), { note: "scoring oracle: the Phase 0 public test league's rules and a subset of player-weeks (weeks 2–3); no identities" });
  console.log(`  wrote ${out}`);
}

// Run only as a script (an exact path: ../lib/runMode.ts isMainModule; a scratch file that imports it starts nothing).
if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
