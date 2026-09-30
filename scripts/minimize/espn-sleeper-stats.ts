/**
 * Cross-source oracle fixture (Phase 1, ESPN unit): Sleeper's PUBLIC weekly stat lines for the
 * players on Parker's ESPN rosters in weeks 2–3, so a test can score them with his league's
 * canonical Scoring and compare with ESPN's appliedTotal. It checks that the canonical key names
 * the ESPN scoring map chose mean the same thing in Sleeper's feed (provider differences can show).
 *
 * Sources (public, league-independent, fetched politely through the cached probe client):
 *   - https://api.sleeper.app/stats/nfl/{season}/{week}?season_type=regular   (6 h cache, §2.10)
 *   - DynastyProcess db_playerids.csv espn_id → sleeper_id                      (24 h cache)
 *   - the Sleeper players DB espn_id → player_id as a fallback                  (24 h cache)
 * ESPN team D/ST units map to Sleeper's DEF ids (team codes; ESPN WSH = Sleeper WAS).
 *
 * Output: fixtures/sanitized/min/espn/cross-source/ "sleeper stats weeks 2-3 (Parker's rostered
 * players)": per player-week only the Sleeper keys his scoring reads (plus gp). Rosters themselves
 * are already committed (sanitized) in fixtures/sanitized/espn/.
 *
 *   npx tsx scripts/minimize/espn-sleeper-stats.ts
 */
import { parse as parseCsv } from "csv-parse/sync";
import { ESPN_PRO_TEAMS } from "@/adapters/espn/constants";
import { buildEspnScoring } from "@/adapters/espn/scoringMap";
import { positionOf } from "@/adapters/espn/positions";
import { scoringStatKeys } from "@/engine/scoring";
import { readSanitizedFixture } from "@/test-utils/fixtures";
import { TTL } from "../lib/cache";
import { request } from "../lib/http";
import { saveMinimizedFixture } from "../lib/minimize";
import { installConsoleScrubber } from "../lib/redact";
import { getSleeperPlayers } from "../lib/sleeper-players";

export const CROSS_GROUP = "cross-source";
export const CROSS_LABEL = "sleeper stats weeks 2-3 (Parker's rostered players)";
const SEASON = 2026;
const WEEKS = [2, 3];
const DP_IDMAP_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";
/** ESPN abbreviation → Sleeper team code where they differ (Phase 0 XWALK: team codes by source). */
const SLEEPER_TEAM: Record<string, string> = { WSH: "WAS" };
/**
 * Sleeper keys that may carry what ESPN puts in a scored D/ST stat (special-teams TDs and fumble
 * recoveries are keyed separately in Sleeper, Phase 0 finding 15): kept so a mismatch can be explained.
 */
const DIAGNOSTIC_KEYS = ["def_st_td", "st_td", "def_st_fum_rec", "st_fum_rec", "def_st_ff", "st_ff", "def_fum_td", "td"];
const statsUrl = (week: number) => `https://api.sleeper.app/stats/nfl/${SEASON}/${week}?season_type=regular`;

interface EspnLine {
  week: number;
  espnId: number;
  defaultPositionId: number;
  proTeamId: number;
}

async function main(): Promise<void> {
  installConsoleScrubber();
  const league = readSanitizedFixture<{ settings: { scoringSettings: { scoringItems: Array<{ statId: number; points: number; pointsOverrides?: Record<string, number> | null }> } } }>("espn", "league/{leagueId}/view=mSettings+mTeam+mRoster+mMatchup+mStatus");
  const { scoring } = buildEspnScoring(league.settings.scoringSettings.scoringItems);
  const keys = [...new Set([...scoringStatKeys(scoring), "gp", ...DIAGNOSTIC_KEYS])].sort();

  const lines: EspnLine[] = [];
  for (const week of WEEKS) {
    const r = readSanitizedFixture<{ teams: Array<{ roster: { entries: Array<{ playerPoolEntry: { player: { id: number; defaultPositionId: number; proTeamId: number; stats?: Array<{ statSourceId: number; statSplitTypeId: number; scoringPeriodId: number }> } } }> } }> }>("espn", `league/{leagueId}/view=mRoster&scoringPeriodId=${week}`);
    for (const t of r.teams)
      for (const e of t.roster.entries) {
        const p = e.playerPoolEntry.player;
        if ((p.stats ?? []).some((s) => s.statSourceId === 0 && s.statSplitTypeId === 1 && s.scoringPeriodId === week)) lines.push({ week, espnId: p.id, defaultPositionId: p.defaultPositionId, proTeamId: p.proTeamId });
      }
  }

  // ESPN id → Sleeper id: DynastyProcess first, then the Sleeper players DB.
  const dp = await request(DP_IDMAP_URL, { cache: { key: `idmap:${DP_IDMAP_URL}`, ttlMs: TTL.idMap, namespace: "idmap" }, label: "DynastyProcess db_playerids.csv", timeoutMs: 180_000 });
  const rows = parseCsv(dp.text, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;
  const byEspn = new Map<string, string>();
  for (const row of rows) if (row.espn_id && row.sleeper_id && row.espn_id !== "NA" && row.sleeper_id !== "NA") byEspn.set(row.espn_id, row.sleeper_id);
  const sleeperDb = (await getSleeperPlayers()).data;
  for (const [id, p] of Object.entries(sleeperDb)) if (p.espn_id !== null && p.espn_id !== undefined && !byEspn.has(String(p.espn_id))) byEspn.set(String(p.espn_id), id);

  const sleeperIdOf = (l: EspnLine): string | undefined => {
    if (positionOf(l.defaultPositionId).pos === "DEF") {
      const abbr = ESPN_PRO_TEAMS[l.proTeamId];
      return abbr && abbr !== "None" ? (SLEEPER_TEAM[abbr] ?? abbr) : undefined;
    }
    return byEspn.get(String(l.espnId));
  };

  const out: Array<{ week: number; espnId: number; sleeperId: string; stats: Record<string, number> }> = [];
  let noSleeperId = 0;
  let noSleeperRow = 0;
  for (const week of WEEKS) {
    const res = await request(statsUrl(week), { cache: { key: `sleeper:${statsUrl(week)}`, ttlMs: TTL.projections, namespace: "sleeper-stats" }, label: `Sleeper stats ${SEASON} week ${week}`, timeoutMs: 120_000 });
    if (!res.ok || !Array.isArray(res.json)) throw new Error(`Sleeper stats week ${week}: HTTP ${res.status}`);
    const byId = new Map((res.json as Array<{ player_id: string; stats?: Record<string, number> }>).map((r) => [String(r.player_id), r.stats ?? {}]));
    for (const l of lines.filter((x) => x.week === week)) {
      const sid = sleeperIdOf(l);
      if (!sid) {
        noSleeperId++;
        continue;
      }
      const stats = byId.get(sid);
      if (!stats) {
        noSleeperRow++;
        continue;
      }
      out.push({ week, espnId: l.espnId, sleeperId: sid, stats: Object.fromEntries(keys.filter((k) => typeof stats[k] === "number" && stats[k] !== 0).map((k) => [k, stats[k] as number])) });
    }
  }
  const body = { source: "https://api.sleeper.app/stats/nfl/2026/{week}?season_type=regular", idMap: "DynastyProcess espn_id → sleeper_id, then the Sleeper players DB; D/ST by team code", keys, playerWeeks: lines.length, unmatched: { noSleeperId, noSleeperRow }, rows: out };
  const file = await saveMinimizedFixture("espn", CROSS_GROUP, CROSS_LABEL, body, { note: `public Sleeper stats: ${out.length} of ${lines.length} player-weeks (no Sleeper id ${noSleeperId}, no Sleeper row ${noSleeperRow}); only the keys the league's scoring reads` });
  console.log(`saved ${file}: ${out.length}/${lines.length} player-weeks (no Sleeper id ${noSleeperId}, no Sleeper row ${noSleeperRow})`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
