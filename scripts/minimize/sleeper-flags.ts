/**
 * Evidence for the Sleeper scoring map (src/adapters/sleeper/scoringMap.ts): Sleeper's /stats
 * carries every bonus and D/ST bracket as a per-game flag NEXT TO the raw stat, so each flag can be
 * checked against the rule mapSleeperScoring() derives from it: flag == rule(raw). The first-down
 * bonuses (bonus_fd_<pos> = pass_fd + rush_fd + rec_fd, never on fullback rows) are checked too.
 *
 * Reads the cached PUBLIC /stats weeks (league-independent NFL data) offline — no request is made —
 * prints per-key counts, and saves the rows at the rule boundaries (plus every flagged row and every
 * fullback row with a first down) as a committed fixture for the unit test:
 * fixtures/sanitized/min/sleeper/flags/. Rows carry only the week, Sleeper's position and the stats
 * the rules read; no player IDs. Flag keys that never fire in these weeks are listed: for them only
 * the "doesn't fire" side is checked (⚠️).
 *
 *   npx tsx scripts/minimize/sleeper-flags.ts
 */
import { IDP_BONUS_THRESHOLDS, KNOWN_BONUS_TIERS, KNOWN_BRACKET_KEYS, mapSleeperScoring } from "@/adapters/sleeper/scoringMap";
import { sleeperPos } from "@/adapters/sleeper/normalize";
import type { ScoringRule, StatLine } from "@/engine/model";
import { ruleApplies, rulePoints, statValue } from "@/engine/scoring";
import { readCache } from "../lib/cache";
import { saveMinimizedFixture } from "../lib/minimize";

const WEEKS = [1, 2, 3];
const SEASON = 2026;

export interface StatsRow {
  player_id: string;
  stats?: Record<string, number> | null;
  player?: { position?: string | null; fantasy_positions?: string[] | null } | null;
}

/** A cached public /stats week (probe:sleeper or probe:shared cache), or null. Offline only. */
export async function cachedStatsWeek(season: number, week: number): Promise<StatsRow[] | null> {
  const url = `https://api.sleeper.app/stats/nfl/${season}/${week}?season_type=regular`;
  for (const [namespace, key] of [
    ["sleeper-stats", `sleeper:${url}`],
    ["stats", `stats:${url}`],
  ] as const) {
    const hit = await readCache<{ status: number; text: string }>(namespace, key, Number.POSITIVE_INFINITY);
    if (hit?.value.status === 200) return JSON.parse(hit.value.text) as StatsRow[];
  }
  return null;
}

/** Every flag key Sleeper defines, with the rule the scoring map derives from it (1 point). */
export function flagRules(): Array<{ key: string; rule: ScoringRule }> {
  const keys = [
    ...Object.entries(KNOWN_BONUS_TIERS).flatMap(([family, tiers]) => tiers.map((t) => `bonus_${family}_${t}`)),
    ...Object.keys(IDP_BONUS_THRESHOLDS),
    ...KNOWN_BRACKET_KEYS,
  ];
  // Map all flags together so tiers and brackets split exactly as they do for a real league.
  const { scoring, mapping } = mapSleeperScoring(Object.fromEntries(keys.map((k) => [k, 1])));
  return mapping.filter((m) => m.as === "rule").map((m, i) => ({ key: m.key, rule: scoring.rules[i] as ScoringRule }));
}

const FD_BONUS_KEYS = ["bonus_fd_qb", "bonus_fd_rb", "bonus_fd_wr", "bonus_fd_te"];
const RAW_KEYS = ["pass_yd", "rec_yd", "rush_yd", "pass_cmp", "rush_att", "idp_sack", "idp_tkl", "idp_pass_def", "pts_allow", "yds_allow", "rec", "pass_fd", "rush_fd", "rec_fd", "gp", ...FD_BONUS_KEYS];
const firstDowns = (s: StatLine) => (s.pass_fd ?? 0) + (s.rush_fd ?? 0) + (s.rec_fd ?? 0);

async function main(): Promise<void> {
  const rules = flagRules();
  const rows: Array<{ week: number; position: string; stats: StatLine }> = [];
  for (const week of WEEKS) {
    const data = await cachedStatsWeek(SEASON, week);
    if (!data) {
      console.log(`week ${week}: no cached public /stats copy (run npm run probe:sleeper or probe:shared once); skipped`);
      continue;
    }
    for (const r of data) {
      const position = r.player?.position ?? "";
      if (!position || position === "TEAM") continue; // team-total rows carry no flags
      rows.push({ week, position, stats: r.stats ?? {} });
    }
  }
  if (!rows.length) {
    console.log("no cached /stats weeks; nothing checked");
    return;
  }
  console.log(`checked ${rows.length} player rows from /stats weeks ${WEEKS.join(", ")} (cached, public)`);
  console.log("key".padEnd(24), "flagged", "rule-true", "agree", "disagree");
  const keep = new Set<number>();
  let totalDisagree = 0;
  const neverFired: string[] = [];
  for (const { key, rule } of rules) {
    let flagged = 0;
    let ruleTrue = 0;
    let agree = 0;
    const near: number[] = [];
    rows.forEach((row, i) => {
      const pos = sleeperPos(row.position, []) ?? "WR";
      const flag = row.stats[key] ? 1 : 0;
      const want = ruleApplies(rule, pos) && rulePoints(rule, row.stats) ? 1 : 0;
      flagged += flag;
      ruleTrue += want;
      if (flag === want) agree++;
      if (flag || want !== flag) keep.add(i);
      if (rule.kind !== "perGame" && rule.kind !== "perUnit") {
        const x = statValue(row.stats, rule.stat);
        const bounds = [rule.min, rule.kind === "range" ? rule.max : undefined].filter((b): b is number => b !== undefined);
        if (x && bounds.some((b) => Math.abs(x - b) <= 2)) near.push(i);
      }
    });
    near.slice(0, 12).forEach((i) => keep.add(i));
    totalDisagree += rows.length - agree;
    if (!flagged) neverFired.push(key);
    console.log(key.padEnd(24), String(flagged).padStart(7), String(ruleTrue).padStart(9), String(agree).padStart(5), String(rows.length - agree).padStart(8));
  }
  // Fullbacks: Sleeper's FB counts as RB in our positions, but /stats gives him no RB first-down bonus.
  rows.forEach((r, i) => {
    if (r.position === "FB" && firstDowns(r.stats)) keep.add(i);
  });
  // Identities behind the non-flag parts of the map.
  const identity = (name: string, applies: (r: (typeof rows)[number]) => boolean, ok: (s: StatLine, pos: string) => boolean) => {
    const hit = rows.filter(applies);
    console.log(`${name}: ${hit.filter((r) => ok(r.stats, r.position)).length}/${hit.length}`);
  };
  const g = (s: StatLine, k: string) => s[k] ?? 0;
  const OFF = new Set(["QB", "RB", "WR", "TE"]);
  identity("bonus_fd_<pos> = pass_fd + rush_fd + rec_fd (QB/RB/WR/TE rows with any first down)", (r) => OFF.has(r.position) && ["pass_fd", "rush_fd", "rec_fd", `bonus_fd_${r.position.toLowerCase()}`].some((k) => r.stats[k]), (s, p) => g(s, `bonus_fd_${p.toLowerCase()}`) === firstDowns(s));
  identity("no bonus_fd_* on FB rows with a first down", (r) => r.position === "FB" && firstDowns(r.stats) > 0, (s) => FD_BONUS_KEYS.every((k) => !s[k]));
  identity("bonus_rec_<pos> = rec on RB/WR/TE rows with catches", (r) => ["RB", "WR", "TE"].includes(r.position) && !!r.stats.rec, (s, p) => g(s, `bonus_rec_${p.toLowerCase()}`) === g(s, "rec"));
  identity("no bonus_rec_* on other positions' rows", (r) => ["bonus_rec_rb", "bonus_rec_wr", "bonus_rec_te"].some((k) => r.stats[k]), (s, p) => ["RB", "WR", "TE"].every((q) => !s[`bonus_rec_${q.toLowerCase()}`] || q === p));
  identity("rush_rec_yd = rush_yd + rec_yd", (r) => r.stats.rush_rec_yd !== undefined, (s) => g(s, "rush_rec_yd") === g(s, "rush_yd") + g(s, "rec_yd"));
  identity("idp_tkl = idp_tkl_solo + idp_tkl_ast", (r) => r.stats.idp_tkl !== undefined, (s) => g(s, "idp_tkl") === g(s, "idp_tkl_solo") + g(s, "idp_tkl_ast"));
  identity("fgmiss = fga − fgm", (r) => r.stats.fga !== undefined, (s) => g(s, "fgmiss") === g(s, "fga") - g(s, "fgm"));
  identity("fgm_50p = fgm_50_59 + fgm_60p", (r) => ["fgm_50p", "fgm_50_59", "fgm_60p"].some((k) => r.stats[k] !== undefined), (s) => g(s, "fgm_50p") === g(s, "fgm_50_59") + g(s, "fgm_60p"));
  console.log(totalDisagree ? `❌ ${totalDisagree} flag/rule disagreement(s)` : "✅ every flag equals its rule on the raw stat");
  if (neverFired.length) console.log(`⚠️ never flagged in weeks ${WEEKS.join(", ")} (only the "doesn't fire" side is checked): ${neverFired.join(", ")}`);

  const flagKeys = new Set(rules.map((r) => r.key));
  const body = [...keep]
    .sort((a, b) => a - b)
    .map((i) => {
      const r = rows[i] as (typeof rows)[number];
      const stats = Object.fromEntries(Object.entries(r.stats).filter(([k, v]) => v !== 0 && (flagKeys.has(k) || RAW_KEYS.includes(k))));
      return { week: r.week, position: r.position, stats };
    });
  const file = await saveMinimizedFixture("sleeper", "flags", "stats-flag-rows", { note: "public /stats rows (no player ids) at bonus/bracket boundaries, every flagged row and every fullback row with a first down", season: SEASON, weeks: WEEKS, rows: body });
  console.log(`saved ${body.length} rows → ${file}`);
}

const isMain = process.argv[1] && /sleeper-flags\.ts$/.test(process.argv[1]);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  });
}
