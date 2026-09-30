/**
 * Sleeper scoring_settings → Scoring (CLAUDE.md §4, §5). Sleeper's stat keys ARE the canonical
 * keys, so most rules stay plain per-unit rates. Two families don't, because Sleeper's /stats
 * carries them as derived per-game flags that /projections lacks:
 *
 * 1. Bonus flags (bonus_pass_yd_300, bonus_rec_yd_100, bonus_rush_att_20, bonus_tkl_10p, …) →
 *    threshold / range rules on the raw stat, so projections get expected values (§5). Checked on
 *    the cached public /stats weeks 1–3 (6,944 player rows, `npx tsx scripts/minimize/sleeper-flags.ts`):
 *    every flag equals its rule on the raw stat. Tiers of one stat are EXCLUSIVE — a 410-yard passer
 *    carries bonus_pass_yd_400 but not bonus_pass_yd_300, a 213 rush+rec-yard back carries only
 *    bonus_rush_rec_yd_200 — so a lower tier is the bounded range [300, 399]. Exclusivity is seen in
 *    the data for pass_yd and rush_rec_yd, and Sleeper's help center documents it for the rushing,
 *    receiving and rush + rec yardage tiers ("100-199 Yard Rushing Game", "200+ Yard Rushing Game":
 *    "The yard ranges are strict and do not stack", support.sleeper.com/en/articles/3998131) ✅,
 *    though no player had a 200-yard rushing or receiving game in weeks 1–3.
 * 2. D/ST brackets (pts_allow_*, yds_allow_*) → range rules on pts_allow / yds_allow for DEF only
 *    (96/96 DEF rows: exactly one flag each, matching the bounds in the key names; seen boundaries
 *    6|7, 13|14, 20|21, 27|28, 34|35 points and 199|200, 300, 350 yards). yds_allow_0_100 overlaps
 *    yds_allow_100_199 at 100 by name; it is read as 0–99 (⚠️ no game ≤ 150 yards to check), and no
 *    shutout was seen for pts_allow_0 (⚠️ only its "doesn't fire" side is checked).
 *
 * Position bonuses stay per-unit keys (§5), because /stats carries them as stats of their own on
 * exactly the matching Sleeper position:
 * - bonus_rec_te/rb/wr = rec (bonus_rec_te on 181/181 TE rows, none elsewhere) and
 *   bonus_rush_td_qb = rush_td. /projections carries them too (e.g. week 4: TE 98/99, RB 93/96, WR
 *   163/163 rows with receptions; the few gaps have < 0.3 projected catches).
 * - bonus_fd_qb/rb/wr/te = pass_fd + rush_fd + rec_fd on 678/678 QB/RB/WR/TE rows with a first
 *   down, and on NO fullback row (0 of 4 FB rows with first downs): an FB counts as an RB in our
 *   positions but Sleeper gives him no RB first-down bonus, which a per-unit key gets right.
 *   /projections carries no bonus_fd_* key (only the three *_fd keys).
 * normalizeProjectionStats fills the keys a projection row lacks, for the Sleeper positions that
 * carry them (never FB).
 *
 * Pure and browser-safe.
 */
import type { ImportWarning, Scoring, ScoringRule, StatExpr, StatLine } from "@/engine/model";

// ---------------------------------------------------------------------------------------------
// 1. Bonus tiers

/** Raw stat behind each bonus family (rush_rec_yd = rush_yd + rec_yd: 863/863 /stats rows). */
export const BONUS_TIER_STATS: Readonly<Record<string, StatExpr>> = {
  pass_yd: "pass_yd",
  rec_yd: "rec_yd",
  rush_yd: "rush_yd",
  rush_rec_yd: { sum: ["rush_yd", "rec_yd"] },
  pass_cmp: "pass_cmp",
  rush_att: "rush_att",
};

/** Thresholds Sleeper defines per family (its default scoring keys); a league's own keys are added. */
export const KNOWN_BONUS_TIERS: Readonly<Record<string, readonly number[]>> = {
  pass_yd: [300, 400],
  rec_yd: [100, 200],
  rush_yd: [100, 200],
  rush_rec_yd: [100, 200],
  pass_cmp: [25],
  rush_att: [20],
};

/** "N or more" IDP bonuses (idp_tkl = idp_tkl_solo + idp_tkl_ast on 1,593/1,593 rows; both feeds carry idp_tkl). */
export const IDP_BONUS_THRESHOLDS: Readonly<Record<string, { stat: string; min: number }>> = {
  bonus_sack_2p: { stat: "idp_sack", min: 2 },
  bonus_tkl_10p: { stat: "idp_tkl", min: 10 },
  idp_pass_def_3p: { stat: "idp_pass_def", min: 3 },
};

const TIER_KEY = /^bonus_(pass_yd|rec_yd|rush_yd|rush_rec_yd|pass_cmp|rush_att)_(\d+)p?$/;

function tierThresholds(family: string, keys: Iterable<string>): number[] {
  const out = new Set<number>(KNOWN_BONUS_TIERS[family] ?? []);
  for (const k of keys) {
    const m = TIER_KEY.exec(k);
    if (m?.[1] === family) out.add(Number(m[2]));
  }
  return [...out].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------
// 2. D/ST brackets

/** Sleeper's bracket keys (its default scoring keys); a league's own keys are added. */
export const KNOWN_BRACKET_KEYS: readonly string[] = [
  "pts_allow_0",
  "pts_allow_1_6",
  "pts_allow_7_13",
  "pts_allow_14_20",
  "pts_allow_21_27",
  "pts_allow_28_34",
  "pts_allow_35p",
  "yds_allow_0_100",
  "yds_allow_100_199",
  "yds_allow_200_299",
  "yds_allow_300_349",
  "yds_allow_350_399",
  "yds_allow_400_449",
  "yds_allow_450_499",
  "yds_allow_500_549",
  "yds_allow_550p",
];

const BRACKET_KEY = /^(pts_allow|yds_allow)_(\d+)(?:_(\d+)|(p))?$/;

export interface Bracket {
  key: string;
  stat: "pts_allow" | "yds_allow";
  /** Undefined = open below (the lowest bracket also takes the normal curve's impossible negative tail). */
  min?: number;
  /** Undefined = open above. */
  max?: number;
}

/**
 * Bounds of every bracket key: from the key name, then made non-overlapping (a bracket ends one
 * below the next one's start, so yds_allow_0_100 is 0–99) and open at the bottom and top.
 */
export function bracketBounds(keys: Iterable<string>): Map<string, Bracket> {
  const byStat = new Map<string, Array<{ key: string; lo: number; hi: number }>>();
  for (const key of new Set([...KNOWN_BRACKET_KEYS, ...keys])) {
    const m = BRACKET_KEY.exec(key);
    if (!m) continue;
    const lo = Number(m[2]);
    const hi = m[3] !== undefined ? Number(m[3]) : m[4] === "p" ? Number.POSITIVE_INFINITY : lo;
    const list = byStat.get(m[1] as string) ?? [];
    list.push({ key, lo, hi });
    byStat.set(m[1] as string, list);
  }
  const out = new Map<string, Bracket>();
  for (const [stat, list] of byStat) {
    list.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
    list.forEach((b, i) => {
      const next = list[i + 1];
      const hi = next && b.hi >= next.lo ? next.lo - 1 : b.hi;
      out.set(b.key, {
        key: b.key,
        stat: stat as Bracket["stat"],
        ...(i === 0 ? {} : { min: b.lo }),
        ...(Number.isFinite(hi) ? { max: hi } : {}),
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

/** bonus_fd_<pos> counts every first down: pass_fd + rush_fd + rec_fd (678/678 /stats rows). */
export const FIRST_DOWN_KEYS = ["pass_fd", "rush_fd", "rec_fd"] as const;

export interface KeyMapping {
  key: string;
  points: number;
  as: "perStat" | "rule";
}

export interface SleeperScoringMap {
  scoring: Scoring;
  /** How each non-zero Sleeper key was mapped (for the Import Report and tests). */
  mapping: KeyMapping[];
  warnings: ImportWarning[];
}

/**
 * Map a league's scoring_settings to the normalized Scoring. Keys with value 0 are dropped (Sleeper
 * lists every default key, most at 0), but all keys — zeros included — define the tier and bracket
 * boundaries, so an unknown new tier still splits its family correctly.
 */
export function mapSleeperScoring(scoringSettings: Record<string, unknown>): SleeperScoringMap {
  const warnings: ImportWarning[] = [];
  const values = new Map<string, number>();
  for (const [key, v] of Object.entries(scoringSettings)) {
    if (typeof v === "number" && Number.isFinite(v)) values.set(key, v);
    else if (v !== null && v !== undefined) warnings.push({ code: "SCORING_VALUE_NOT_NUMBER", message: `Scoring rule "${key}" has a non-numeric value and was ignored.`, platformPath: `scoring_settings.${key}` });
  }
  const allKeys = [...values.keys()];
  const brackets = bracketBounds(allKeys);
  const tiersCache = new Map<string, number[]>();
  const tiers = (family: string) => {
    let t = tiersCache.get(family);
    if (!t) tiersCache.set(family, (t = tierThresholds(family, allKeys)));
    return t;
  };

  const perStat: Record<string, number> = {};
  const rules: Array<{ key: string; rule: ScoringRule }> = [];
  const mapping: KeyMapping[] = [];

  for (const key of [...values.keys()].sort()) {
    const points = values.get(key) as number;
    const tier = TIER_KEY.exec(key);
    const idp = IDP_BONUS_THRESHOLDS[key];
    const bracket = brackets.get(key);
    // Flag keys never become per-unit rates, even at 0: /stats carries them next to the raw stat.
    if (tier) {
      if (!points) continue;
      const family = tier[1] as string;
      const min = Number(tier[2]);
      const list = tiers(family);
      const next = list.find((t) => t > min);
      const stat = BONUS_TIER_STATS[family] as StatExpr;
      rules.push({ key, rule: next === undefined ? { kind: "threshold", stat, min, points } : { kind: "range", stat, min, max: next - 1, points } });
      mapping.push({ key, points, as: "rule" });
    } else if (idp) {
      if (!points) continue;
      rules.push({ key, rule: { kind: "threshold", stat: idp.stat, min: idp.min, points } });
      mapping.push({ key, points, as: "rule" });
    } else if (bracket) {
      if (!points) continue;
      rules.push({ key, rule: { kind: "range", stat: bracket.stat, ...(bracket.min !== undefined ? { min: bracket.min } : {}), ...(bracket.max !== undefined ? { max: bracket.max } : {}), points, positions: ["DEF"] } });
      mapping.push({ key, points, as: "rule" });
    } else if (points) {
      // Includes the position bonuses (bonus_rec_te, bonus_fd_rb, …): stats of their own (see the header).
      perStat[key] = points;
      mapping.push({ key, points, as: "perStat" });
    }
  }

  return { scoring: { perStat, rules: rules.map((r) => r.rule), unmapped: [] }, mapping, warnings };
}

// ---------------------------------------------------------------------------------------------
// Projections → the stat keys /stats and scoring_settings use

export type ProjectionRowKind = "DEF" | "player";

export interface ProjectionAlias {
  kind: ProjectionRowKind;
  /** Key in /projections. */
  from: string;
  /** Scoring key the value counts toward (the key /stats uses for the same event). */
  to: string;
}

/**
 * /projections spells special-teams and return stats differently from /stats (Phase 0,
 * reports/probe-output/sleeper.md C.unmapped): a DEF row projects its return TD as st_td (/stats:
 * def_st_td); a player row projects return TDs as def_kr_td / pr_td (/stats: st_td) and return yards
 * as def_kr_yd / def_pr_yd (/stats: kr_yd / pr_yd). def_pr_yd → pr_yd is added here: /projections
 * puts it on defensive returners' rows (CB/DB/LB, week 4: 174 rows, never with pr_yd), while /stats
 * has def_pr_yd only on DEF rows (74) and pr_yd on players, CBs and DBs included.
 */
export const PROJECTION_ALIASES: readonly ProjectionAlias[] = [
  { kind: "DEF", from: "st_td", to: "def_st_td" },
  { kind: "player", from: "def_kr_td", to: "st_td" },
  { kind: "player", from: "pr_td", to: "st_td" },
  { kind: "player", from: "def_kr_yd", to: "kr_yd" },
  { kind: "player", from: "def_pr_yd", to: "pr_yd" },
];

/** Return components a DEF projection carries that /stats never puts on a DEF row (they'd double count st_td). */
export const DEF_PROJECTION_DROPPED: ReadonlySet<string> = new Set(["def_kr_td", "def_pr_td", "pr_td", "pr_yd"]);

/**
 * Position bonus keys by Sleeper position, as /stats fills them (see the header): each is the sum of
 * `from`. Sleeper positions only, so a fullback ("FB") gets none of the RB bonuses.
 */
const POSITION_BONUS_FILL: Readonly<Record<string, ReadonlyArray<{ key: string; from: readonly string[] }>>> = {
  QB: [
    { key: "bonus_rush_td_qb", from: ["rush_td"] },
    { key: "bonus_fd_qb", from: FIRST_DOWN_KEYS },
  ],
  RB: [
    { key: "bonus_rec_rb", from: ["rec"] },
    { key: "bonus_fd_rb", from: FIRST_DOWN_KEYS },
  ],
  WR: [
    { key: "bonus_rec_wr", from: ["rec"] },
    { key: "bonus_fd_wr", from: FIRST_DOWN_KEYS },
  ],
  TE: [
    { key: "bonus_rec_te", from: ["rec"] },
    { key: "bonus_fd_te", from: FIRST_DOWN_KEYS },
  ],
};

/**
 * A /projections row's stats in the keys league scoring uses (for Phase 2's projection model):
 * - the aliases above (value added to the /stats key, source key removed) and DEF duplicates dropped;
 * - fgmiss = fga − fgm when absent (an identity on /stats: 87/87 kicker rows);
 * - fgm_50_59 = fgm_50p when neither split key is present (fgm_50p = fgm_50_59 + fgm_60p on 30/30
 *   /stats rows; 60+ yard makes are rare, so they are assumed 0);
 * - the position bonuses when the row lacks them: bonus_rec_<pos> = rec (a few rows with under 0.3
 *   projected catches lack it), bonus_rush_td_qb = rush_td, and bonus_fd_<pos> = pass_fd + rush_fd +
 *   rec_fd (/projections never carries it) — for Sleeper positions QB/RB/WR/TE only, never FB.
 * `position` is Sleeper's position for the player ("DEF" for team defenses). Non-numbers are dropped.
 */
export function normalizeProjectionStats(stats: Record<string, unknown> | null | undefined, position: string | null | undefined): StatLine {
  const out: StatLine = {};
  for (const [k, v] of Object.entries(stats ?? {})) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  const kind: ProjectionRowKind = position === "DEF" ? "DEF" : "player";
  for (const a of PROJECTION_ALIASES) {
    if (a.kind !== kind || out[a.from] === undefined) continue;
    const v = out[a.from] as number;
    delete out[a.from];
    out[a.to] = (out[a.to] ?? 0) + v;
  }
  if (kind === "DEF") for (const k of DEF_PROJECTION_DROPPED) delete out[k];
  if (out.fga !== undefined && out.fgmiss === undefined) out.fgmiss = Math.max(0, out.fga - (out.fgm ?? 0));
  if (out.fgm_50p !== undefined && out.fgm_50_59 === undefined && out.fgm_60p === undefined) out.fgm_50_59 = out.fgm_50p;
  for (const f of POSITION_BONUS_FILL[position ?? ""] ?? []) {
    if (out[f.key] !== undefined) continue;
    const v = f.from.reduce((sum, k) => sum + (out[k] ?? 0), 0);
    if (v) out[f.key] = v;
  }
  return out;
}
