/**
 * Minimized Fleaflicker scoring-oracle fixtures (CLAUDE.md §0.6, §5; planner reply to Checkpoint 0,
 * answer 2) for the two Phase 0 public test leagues: a conventional league and an exotic keeper
 * league (IDP, punters, 82 rules).
 *
 * Reads the git-ignored full sanitized copies (data-local/fixtures-sanitized/fleaflicker/: rules,
 * box scores for weeks 2–3, rosters and player listings with Sportradar ids) and cached public data
 * (Sleeper weekly stats and players DB) — offline, no new crawl — and writes
 * fixtures/sanitized/min/fleaflicker/oracle/ (committed), one file per league:
 *   - FetchLeagueRules trimmed to the fields the scoring map reads;
 *   - a subset of player-weeks {sleeperId, platformPos, pos, week, stats, expected} chosen by
 *     rule-type coverage, position and whether the player played, never by whether they match;
 *   - the oracle's aggregate result on every box-score player-week of the full copy, including those
 *     of players who didn't play (no gp; Fleaflicker scores them 0, so per-game constants need gp).
 * No team, owner or league identities and no Fleaflicker player ids are written.
 *
 *   npx tsx scripts/minimize/fleaflicker-oracle.ts            write the fixtures
 *   npx tsx scripts/minimize/fleaflicker-oracle.ts --dry-run  print aggregate numbers only
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { OracleFixture, OracleFixtureCase } from "@/adapters/fleaflicker/oracleFixture";
import { mapPos } from "@/adapters/fleaflicker/positions";
import { fd, type FormattedDecimal } from "@/adapters/fleaflicker/schema";
import { fleaflickerRulesToScoring } from "@/adapters/fleaflicker/scoringMap";
import { config } from "@/engine/config";
import { actualPoints } from "@/engine/scoring";
import { sha256 } from "../lib/cache";
import { explainMismatches } from "../lib/fleaflicker/oracle-explain";
import type { OracleRow } from "../lib/fleaflicker/scoring";
import type { RuleMapping } from "../lib/fleaflicker/scoring-map";
import { LOCAL_SANITIZED_DIR } from "../lib/fixtures";
import { readLocalFixture, saveMinimizedFixture, shiftTimestamps, timestampShiftMs } from "../lib/minimize";
import { isMainModule } from "../lib/runMode";
import { ORACLE_WEEKS, SEASON, TOLERANCE_TEXT, measurePopulation, minimizeStats, pct, round3, selectSubset, sleeperPlayers, sleeperWeekStats } from "./mfl-fleaflicker-common";

const DRY_RUN = process.argv.includes("--dry-run");
/** A player-week matches when |computed − Fleaflicker| ≤ the oracle tolerance (config). */
const within = (got: number, expected: number) => Math.abs(got - expected) <= config.scoring.oracleTolerance + 1e-9;

interface LeagueSpec {
  /** Label prefix of the local fixtures (Phase 0 probe). */
  prefix: "primary" | "oracle";
  /** Committed fixture label. */
  label: string;
  description: string;
}

const LEAGUES: LeagueSpec[] = [
  { prefix: "oracle", label: "conventional-league", description: "Phase 0 second public Fleaflicker test league (8 teams, conventional offensive scoring: 0.5 per catch, 6-pt pass TD)" },
  { prefix: "primary", label: "keeper-league", description: "Phase 0 public Fleaflicker test league (12-team keeper league: IDP, punters, targets instead of catches, 82 rules incl. length bands)" },
];

interface ProPlayer {
  id?: number;
  position?: string;
  proTeamAbbreviation?: string;
  externalIds?: Array<{ type?: string; id?: string }>;
}
interface LeaguePlayer {
  proPlayer?: ProPlayer;
  viewingActualPoints?: FormattedDecimal;
}

const localExists = (label: string) => existsSync(path.join(LOCAL_SANITIZED_DIR, "fleaflicker", `${sha256(label)}.json`));

/** Sportradar id from externalIds (type omitted = SPORTRADAR, proto3's first enum value). */
function sportradarId(p: ProPlayer | undefined): string | undefined {
  const e = (p?.externalIds ?? []).find((x) => (x.type ?? "SPORTRADAR") === "SPORTRADAR" && x.id);
  return e?.id?.toLowerCase();
}

/** nflverse/Fleaflicker team codes → Sleeper's DEF ids. */
const TEAM_ALIASES: Record<string, string> = { LA: "LAR", JAC: "JAX", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LAR" };
const normTeam = (code: string | undefined) => {
  const c = (code ?? "").toUpperCase();
  return TEAM_ALIASES[c] ?? c;
};

function minimizeRules(json: unknown): unknown {
  const groups = (json as { groups?: Array<{ label?: string; scoringRules?: Array<Record<string, unknown>> }> }).groups ?? [];
  const keepRule = ["category", "points", "forEvery", "boundLower", "boundUpper", "description", "applyTo", "applyToAll", "isBonus", "rangeType"];
  const keepCategory = ["id", "abbreviation", "nameSingular", "multiValue"];
  return {
    groups: groups.map((g) => ({
      label: g.label,
      scoringRules: (g.scoringRules ?? []).map((r) => {
        const out: Record<string, unknown> = {};
        for (const k of keepRule) {
          if (r[k] === undefined) continue;
          out[k] = k === "category" ? Object.fromEntries(Object.entries(r.category as Record<string, unknown>).filter(([ck]) => keepCategory.includes(ck))) : r[k];
        }
        return out;
      }),
    })),
  };
}

async function oracleFor(spec: LeagueSpec, sleeperBySr: Map<string, string>, sleeperDefs: Set<string>): Promise<void> {
  const rulesJson = readLocalFixture("fleaflicker", `${spec.prefix}/FetchLeagueRules?league_id={leagueId}`);
  const { scoring, mappings } = fleaflickerRulesToScoring(rulesJson);

  const srByFf = new Map<number, string>();
  const collect = (players: LeaguePlayer[] | undefined) => {
    for (const x of players ?? []) {
      const sr = sportradarId(x.proPlayer);
      if (sr && x.proPlayer?.id !== undefined) srByFf.set(x.proPlayer.id, sr);
    }
  };
  const rosters = readLocalFixture<{ rosters?: Array<{ players?: LeaguePlayer[] }> }>("fleaflicker", `${spec.prefix}/FetchLeagueRosters?league_id={leagueId}&season=${SEASON}&external_id_type=SPORTRADAR`);
  for (const r of rosters.rosters ?? []) collect(r.players);
  for (let n = 1; ; n++) {
    const label = `${spec.prefix}/FetchPlayerListing?league_id={leagueId}&filter.player_id={box-score players ${n}}&external_id_type=SPORTRADAR`;
    if (!localExists(label)) break;
    collect(readLocalFixture<{ players?: LeaguePlayer[] }>("fleaflicker", label).players);
  }

  const skipped: Record<string, number> = {};
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);
  const population: OracleFixtureCase[] = [];
  const seen = new Set<string>();
  for (const week of ORACLE_WEEKS) {
    const stats = await sleeperWeekStats(week);
    for (let game = 1; ; game++) {
      const label = `${spec.prefix}/FetchLeagueBoxscore?league_id={leagueId}&fantasy_game_id={game ${game}}&scoring_period=${week}`;
      if (!localExists(label)) break;
      const box = readLocalFixture<{ lineups?: Array<{ slots?: Array<{ home?: LeaguePlayer; away?: LeaguePlayer }> }> }>("fleaflicker", label);
      for (const slot of (box.lineups ?? []).flatMap((l) => l.slots ?? [])) {
        for (const lp of [slot.home, slot.away]) {
          const pp = lp?.proPlayer;
          if (!pp) continue;
          const platformPos = pp.position ?? "?";
          const pos = mapPos(platformPos);
          if (!pos) {
            skip(`no model position (${platformPos})`);
            continue;
          }
          const sleeperId = pos === "DEF" ? (sleeperDefs.has(normTeam(pp.proTeamAbbreviation)) ? normTeam(pp.proTeamAbbreviation) : undefined) : sleeperBySr.get(srByFf.get(pp.id ?? -1) ?? "");
          if (!sleeperId) {
            skip("no crosswalk to a Sleeper id");
            continue;
          }
          const key = `${sleeperId}|${week}`;
          if (seen.has(key)) continue;
          seen.add(key);
          // Every box-score player-week, played or not: one who didn't play has no gp and must score 0.
          population.push({ sleeperId, platformPos, pos, week, stats: stats.get(sleeperId) ?? {}, expected: round3(fd(lp?.viewingActualPoints)) });
        }
      }
    }
  }

  const { population: summary, mismatches, exercised, perGameWithoutGp } = measurePopulation(population, scoring, skipped);
  console.log(`Fleaflicker ${spec.label}, weeks ${ORACLE_WEEKS.join(", ")}: ${summary.within}/${summary.cases} player-weeks ${TOLERANCE_TEXT} (${pct(summary.within, summary.cases)}; ${summary.notPlayed} of them didn't play); skipped ${JSON.stringify(skipped)}`);
  console.log(`  by position: ${Object.entries(summary.byPos).map(([p, b]) => `${p} ${b.within}/${b.cases}`).join(", ")}`);
  console.log(`  rule types exercised (matched player-weeks): ${JSON.stringify(exercised)}`);
  console.log(`  per-game rules on players who didn't play (no gp): ${perGameWithoutGp.within}/${perGameWithoutGp.cases} ${TOLERANCE_TEXT}`);
  console.log(`  rule mappings: ${JSON.stringify(mappings.reduce<Record<string, number>>((a, m) => ((a[m.status] = (a[m.status] ?? 0) + 1), a), {}))}; unmapped or partial rules: ${scoring.unmapped.length}`);

  // Sort the population's mismatches by cause with the Phase 0 explainer (unmapped rules' exact
  // contributions where Sleeper's *_lng / bucket stats pin them down).
  const rows: OracleRow[] = population
    .map((c) => ({ c, got: actualPoints(c.stats, c.pos, scoring) }))
    .filter(({ c, got }) => !within(got, c.expected))
    .map(({ c, got }) => ({ week: c.week, ffId: 0, name: "", ffPos: c.platformPos, pos: c.pos as OracleRow["pos"], actual: c.expected, computed: got, diff: Math.round((got - c.expected) * 100) / 100, sleeper: c.stats }));
  const explained = explainMismatches(rows, mappings as unknown as RuleMapping[]);
  console.log(`  population mismatches: ${JSON.stringify(explained.verdicts)}; by rule: ${explained.byRule.map((b) => `${b.rule.slice(0, 60)} (exact ${b.exactRows}, unresolved ${b.unresolvedRows})`).join("; ")}`);
  if (process.argv.includes("--all")) for (const m of mismatches) console.log(`  mismatch: ${m}`);
  // Punters: "yards on returned punts" has no Sleeper key, but NFL net punting = gross − return
  // yards − 20 × touchbacks, so returned yards = punt_yds − punt_net_yd − 20 × punt_tb. Check how
  // many punter mismatches that derivation would close (the scoring model can't subtract stats).
  const rety = mappings.find((m) => m.categoryId === 161 && m.positions.includes("P") && m.status === "partial");
  if (rety) {
    const pRows = population.filter((c) => c.pos === "P");
    let fires = 0;
    let closes = 0;
    let pMismatches = 0;
    for (const c of pRows) {
      const got = actualPoints(c.stats, c.pos, scoring);
      const returned = (c.stats.punt_yds ?? 0) - (c.stats.punt_net_yd ?? 0) - 20 * (c.stats.punt_tb ?? 0);
      const inTier = (rety.shape.lo === undefined || returned >= rety.shape.lo) && (rety.shape.hi === undefined || returned <= rety.shape.hi) && (c.stats.punts ?? 0) >= 0;
      const add = inTier ? rety.points : 0;
      if (inTier) fires++;
      const before = within(got, c.expected);
      if (!before) pMismatches++;
      if (!before && within(got + add, c.expected)) closes++;
    }
    console.log(`  punters: ${pRows.length} player-weeks, ${pMismatches} mismatches; the derived returned-punt-yards tier fires on ${fires} and closes ${closes} of the ${pMismatches} mismatches`);
  }
  for (const e of explained.explanations.filter((x) => x.verdict === "unexplained")) console.log(`  unexplained: wk${e.row.week} ${e.row.ffPos} diff ${e.row.diff} residual ${e.residual} | ${Object.entries(minimizeStats(e.row.sleeper ?? {}, scoring)).map(([k, v]) => `${k}=${v}`).join(" ")}`);

  const subset = selectSubset(population, scoring, { perType: 15, fraction: 0.3, fractionNotPlayed: 0.1, salt: `fleaflicker-${spec.label}-subset-v1` }).map((c) => ({ ...c, stats: minimizeStats(c.stats, scoring) }));
  console.log(`  committed subset: ${subset.length} player-weeks (${pct(subset.length, population.length)} of the population)`);
  if (DRY_RUN) return;

  const fixture: OracleFixture = {
    meta: {
      platform: "fleaflicker",
      league: spec.description,
      season: SEASON,
      weeks: [...ORACLE_WEEKS],
      source: "Fleaflicker box-score points (FetchLeagueBoxscore viewingActualPoints) vs Sleeper's weekly actual stats × the scoring map; players joined through Sportradar ids",
      population: summary,
      mismatchVerdicts: explained.verdicts,
      selection: "every rule type the oracle counts as tested and per-game rules on players who didn't play (up to 15 player-weeks each), then 30% of each position-and-week stratum of players who played and 10% of those who didn't, in a fixed hash order; chosen without looking at whether a case matches",
      generatedBy: "scripts/minimize/fleaflicker-oracle.ts",
    },
    rules: minimizeRules(rulesJson),
    cases: subset,
  };
  const out = await saveMinimizedFixture("fleaflicker", "oracle", spec.label, shiftTimestamps(fixture, timestampShiftMs("fleaflicker")), { note: `scoring oracle: ${spec.label} rules and a subset of player-weeks (weeks 2–3); no identities` });
  console.log(`  wrote ${out}`);
}

async function main(): Promise<void> {
  const sleeperBySr = new Map<string, string>();
  const sleeperDefs = new Set<string>();
  for (const p of Object.values(await sleeperPlayers())) {
    if (p.sportradar_id) sleeperBySr.set(String(p.sportradar_id).toLowerCase(), p.player_id);
    if (p.position === "DEF") sleeperDefs.add(p.player_id);
  }
  for (const spec of LEAGUES) await oracleFor(spec, sleeperBySr, sleeperDefs);
}

// Run only as a script (an exact path: ../lib/runMode.ts isMainModule; a scratch file that imports it starts nothing).
if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
