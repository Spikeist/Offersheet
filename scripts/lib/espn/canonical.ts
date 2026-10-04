/**
 * FROZEN PHASE 0 EVIDENCE: the probes still use this copy; the app uses src/adapters/espn/scoringMap.ts. A fix here doesn't
 * reach the app (and the reverse); `npm run import:report -- --live` is the live check of the shipped adapters.
 *
 * ESPN scoring rule → canonical (Sleeper) stat key candidates, for the Phase 0 check C.canonical.
 * CLAUDE.md §5: Sleeper's stat keys are canonical; a rule that doesn't map goes to scoring.unmapped.
 * Phase 1 ports this to src/adapters/espn/scoringMap.ts and proves it with the scoring oracle.
 *
 * What is computed and what is judgement:
 * - Range rules (points/yards allowed buckets, field goals by distance, 100-199 yard games) are
 *   classified by COMPUTING ranges: ESPN's from espn-api's SETTINGS_SCORING_FORMAT_MAP label
 *   ("14-17 points allowed"), Sleeper's from its key names ("pts_allow_14_20", "fgm_50p").
 * - Every other rule uses the hand-written candidate table DIRECT, checked against SLEEPER_KEYS
 *   (names Sleeper actually returned in Phase 0). That semantic match is judgement until the
 *   Phase 1 oracle recomputes ESPN's points through the canonical keys.
 * Pure functions only (no I/O).
 */

/**
 * Sleeper key names seen in Phase 0 (2026-09-29): the union of scoring_settings keys of the Sleeper
 * leagues and the stat keys of the Sleeper stats/projections responses the Sleeper probe captured
 * (its sanitized fixtures; a stranger's test league's copies now live in git-ignored
 * data-local/fixtures-sanitized/sleeper). Names only; a rare key can be missing here without being wrong.
 */
export const SLEEPER_KEYS: ReadonlySet<string> = new Set([
  // scoring_settings keys
  ...["blk_kick", "blk_kick_ret_yd", "bonus_pass_cmp_25", "bonus_pass_yd_300", "bonus_pass_yd_400", "bonus_rec_rb", "bonus_rec_te", "bonus_rec_wr", "bonus_rec_yd_100", "bonus_rec_yd_200", "bonus_rush_att_20"],
  ...["bonus_rush_rec_yd_100", "bonus_rush_rec_yd_200", "bonus_rush_yd_100", "bonus_rush_yd_200", "def_2pt", "def_kr_td", "def_kr_yd", "def_pass_def", "def_pr_td", "def_pr_yd", "def_st_ff"],
  ...["def_st_fum_rec", "def_st_td", "def_st_tkl_solo", "def_td", "ff", "fg_ret_yd", "fgm", "fgm_0_19", "fgm_20_29", "fgm_30_39", "fgm_40_49", "fgm_50_59", "fgm_50p", "fgm_60p", "fgm_yds"],
  ...["fgm_yds_over_30", "fgmiss", "fgmiss_0_19", "fgmiss_20_29", "fgmiss_30_39", "fgmiss_40_49", "fgmiss_50p", "fum", "fum_lost", "fum_rec", "fum_rec_td", "fum_ret_yd", "idp_sack_yd", "int"],
  ...["int_ret_yd", "kr_td", "kr_yd", "pass_2pt", "pass_att", "pass_cmp", "pass_cmp_40p", "pass_fd", "pass_inc", "pass_int", "pass_int_td", "pass_sack", "pass_td", "pass_td_40p", "pass_yd"],
  ...["pr_td", "pr_yd", "pts_allow", "pts_allow_0", "pts_allow_14_20", "pts_allow_1_6", "pts_allow_21_27", "pts_allow_28_34", "pts_allow_35p", "pts_allow_7_13", "qb_hit", "rec", "rec_0_4"],
  ...["rec_10_19", "rec_20_29", "rec_2pt", "rec_30_39", "rec_40p", "rec_5_9", "rec_fd", "rec_td", "rec_td_40p", "rec_yd", "rush_2pt", "rush_40p", "rush_att", "rush_fd", "rush_td", "rush_td_40p"],
  ...["rush_yd", "sack", "sack_yd", "safe", "st_ff", "st_fum_rec", "st_td", "st_tkl_solo", "tkl", "tkl_ast", "tkl_loss", "tkl_solo", "xpm", "xpmiss", "yds_allow", "yds_allow_0_100"],
  ...["yds_allow_100_199", "yds_allow_200_299", "yds_allow_300_349", "yds_allow_350_399", "yds_allow_400_449", "yds_allow_450_499", "yds_allow_500_549", "yds_allow_550p"],
  // stat keys seen only in the stats/projections feeds (the scoring-relevant ones)
  ...["def_fum_td", "fga", "fgmiss_50_59", "fgmiss_60p", "idp_ff", "idp_int", "idp_pass_def", "idp_tkl", "idp_tkl_ast", "idp_tkl_solo", "kr", "pr", "pass_td_50p", "rec_td_50p", "rec_tgt", "rec_yar", "xpa"],
]);

/** Inclusive integer range; hi null = open-ended ("46+"). */
export interface Range {
  lo: number;
  hi: number | null;
}

export const fmtRange = (r: Range) => (r.hi === null ? `${r.lo}+` : r.lo === r.hi ? `${r.lo}` : `${r.lo}–${r.hi}`);

/** ESPN label → range: "14-17 points allowed", "46+ points allowed", "Less than 100 total yards allowed", "0 points allowed", "FG Made (0-39 yards)". */
export function parseEspnRange(label: string): Range | undefined {
  const span = /(\d+)\s*-\s*(\d+)/.exec(label);
  if (span) return { lo: Number(span[1]), hi: Number(span[2]) };
  const plus = /(\d+)\s*\+/.exec(label);
  if (plus) return { lo: Number(plus[1]), hi: null };
  const less = /less than (\d+)/i.exec(label);
  if (less) return { lo: 0, hi: Number(less[1]) - 1 };
  const single = /(?:^|\s)(\d+) points allowed$/i.exec(label);
  if (single) return { lo: Number(single[1]), hi: Number(single[1]) };
  return undefined;
}

export interface Bucket extends Range {
  key: string;
}

/** Sleeper bucket keys of one family: "pts_allow_14_20" → 14–20, "pts_allow_35p" → 35+, "pts_allow_0" → 0. */
export function sleeperBuckets(family: string, keys: Iterable<string> = SLEEPER_KEYS): Bucket[] {
  const out: Bucket[] = [];
  const re = new RegExp(`^${family}_(\\d+)(?:_(\\d+)|(p))?$`);
  for (const key of keys) {
    const m = re.exec(key);
    if (!m) continue;
    const lo = Number(m[1]);
    out.push({ key, lo, hi: m[3] ? null : m[2] !== undefined ? Number(m[2]) : lo });
  }
  return out.sort((a, b) => a.lo - b.lo || (a.hi ?? Infinity) - (b.hi ?? Infinity));
}

/** Sleeper threshold keys of one family: "bonus_rush_yd_100" → 100 (meaning "100 or more"). */
export function sleeperThresholds(family: string, keys: Iterable<string> = SLEEPER_KEYS): Map<number, string> {
  const out = new Map<number, string>();
  const re = new RegExp(`^${family}_(\\d+)$`);
  for (const key of keys) {
    const m = re.exec(key);
    if (m) out.set(Number(m[1]), key);
  }
  return out;
}

/**
 * Cover `range` exactly with disjoint buckets (each picked bucket starts where the previous ended),
 * preferring the widest bucket that fits. Returns the bucket keys, or undefined when no exact cover exists.
 */
export function coverRange(range: Range, buckets: readonly Bucket[]): string[] | undefined {
  const keys: string[] = [];
  let cursor = range.lo;
  for (let guard = 0; guard < 100; guard++) {
    const fits = buckets.filter((b) => b.lo === cursor && (range.hi === null ? true : b.hi !== null && b.hi <= range.hi));
    if (!fits.length) return undefined;
    // Widest first: an open-ended bucket wins when the range is open-ended too.
    const best = fits.reduce((a, b) => ((b.hi ?? Infinity) > (a.hi ?? Infinity) ? b : a));
    keys.push(best.key);
    if (best.hi === null) return range.hi === null ? keys : undefined;
    if (range.hi !== null && best.hi === range.hi) return keys;
    cursor = best.hi + 1;
  }
  return undefined;
}

/** Bounded Sleeper buckets whose names overlap (e.g. yds_allow_0_100 and yds_allow_100_199 share 100). */
export function bucketOverlaps(buckets: readonly Bucket[]): string[] {
  const bounded = buckets.filter((b) => b.hi !== null);
  const out: string[] = [];
  for (let i = 1; i < bounded.length; i++) {
    const a = bounded[i - 1] as Bucket;
    const b = bounded[i] as Bucket;
    if (a.hi !== null && a.hi >= b.lo) out.push(`${a.key}/${b.key} share ${b.lo}${a.hi > b.lo ? `–${a.hi}` : ""}`);
  }
  return out;
}

/** The bucket containing `value` (first match), if any. */
export function bucketOf(value: number, buckets: readonly Bucket[]): Bucket | undefined {
  return buckets.find((b) => value >= b.lo && (b.hi === null || value <= b.hi));
}

export type CanonicalKind =
  /** one ESPN stat ↔ one Sleeper key */
  | "exact"
  /** Sleeper has separate keys for players and team defenses (kr_yd / def_kr_yd); exact by position */
  | "split"
  /** ESPN rule = sum of several disjoint Sleeper keys at the same rate (FG 0-39 = fgm_0_19 + fgm_20_29 + fgm_30_39) */
  | "sum"
  /** ESPN range between two Sleeper thresholds: rate(a) = p, rate(b+1) = −p (100-199 yard game) */
  | "difference"
  /** a range no set of Sleeper buckets reproduces: derive from the raw stat (threshold bonuses) */
  | "range"
  /** "every N yards" style rule: derive from the raw stat (floor(x / N)) */
  | "derived"
  /** no Sleeper equivalent (head coach, punter, per-game averages, 1-point safety …) */
  | "none"
  /** not in the Phase 0 candidate table */
  | "unknown";

export interface CanonicalRule {
  statId: number;
  abbr: string;
  kind: CanonicalKind;
  /** Candidate Sleeper keys (in the order they apply). */
  keys: string[];
  /** Raw Sleeper stat a derived rule would be computed from. */
  raw?: string;
  /** ESPN range parsed from the label, when there is one. */
  range?: Range;
  /** Sleeper key family of a range rule ("pts_allow", "fgm", "bonus_rush_yd"…). */
  family?: string;
  /** Candidate keys Sleeper didn't return in Phase 0 (unverified names). */
  missing: string[];
  note: string;
}

type Direct = string | readonly string[] | { player: string; dst: string };

/**
 * Hand-written candidates (judgement, see the file comment). Arrays are sums over play types;
 * { player, dst } = Sleeper keeps team-defense stats under separate def_* keys.
 */
const DIRECT: Record<number, Direct> = {
  0: "pass_att",
  1: "pass_cmp",
  2: "pass_inc",
  3: "pass_yd",
  4: "pass_td",
  15: "pass_td_40p",
  16: "pass_td_50p",
  19: "pass_2pt",
  20: "pass_int",
  23: "rush_att",
  24: "rush_yd",
  25: "rush_td",
  26: "rush_2pt",
  35: "rush_td_40p",
  36: "rush_td_50p",
  41: "rec",
  42: "rec_yd",
  43: "rec_td",
  44: "rec_2pt",
  45: "rec_td_40p",
  46: "rec_td_50p",
  53: "rec",
  58: "rec_tgt",
  62: ["pass_2pt", "rush_2pt", "rec_2pt"],
  63: "fum_rec_td",
  64: "pass_sack",
  68: "fum",
  72: "fum_lost",
  73: ["pass_int", "fum_lost"],
  83: "fgm",
  84: "fga",
  85: "fgmiss",
  86: "xpm",
  87: "xpa",
  88: "xpmiss",
  94: "def_td",
  95: "int",
  96: "fum_rec",
  97: "blk_kick",
  98: "safe",
  99: "sack",
  101: { player: "kr_td", dst: "def_kr_td" },
  102: { player: "pr_td", dst: "def_pr_td" },
  103: "def_td",
  104: "def_td",
  106: "ff",
  114: { player: "kr_yd", dst: "def_kr_yd" },
  115: { player: "pr_yd", dst: "def_pr_yd" },
  120: "pts_allow",
  127: "yds_allow",
  187: "pts_allow",
  205: "def_2pt",
  206: "def_2pt",
  211: "pass_fd",
  212: "rush_fd",
  213: "rec_fd",
  214: "fgm_yds",
};

const NOTES: Record<number, string> = {
  93: "no dedicated Sleeper key (def_st_td may include blocked-kick return TDs; unverified)",
  94: "Sleeper def_td is taken to cover INT and fumble return TDs (judgement)",
  103: "Sleeper def_td is taken to cover INT and fumble return TDs (judgement)",
  104: "Sleeper def_td is taken to cover INT and fumble return TDs (judgement; def_fum_td also exists)",
};

/** Labels of rules with no Sleeper equivalent. */
const NONE_LABEL = /per game|pct|average|per attempt|per catch|win margin|loss margin|team (win|loss|tie)|points scored|margin of victory|punt|touchback|fair catch|1pt safety|1\/2 sack|games played|stuffs|offensive 2pt return|total return td|(passing|rushing|receiving) fumbles|fumbles lost$|td (pass|rush|rec) bonus$|fg (missed|attempt) yards$/i;

/** "Every N <thing>" → the raw Sleeper stat it counts. */
const EVERY_RAW: Array<[RegExp, string]> = [
  [/passing yards/i, "pass_yd"],
  [/rushing yards/i, "rush_yd"],
  [/receiving yards/i, "rec_yd"],
  [/pass completions/i, "pass_cmp"],
  [/pass incompletions/i, "pass_inc"],
  [/rush attempts/i, "rush_att"],
  [/receptions/i, "rec"],
  [/total tackles/i, "tkl"],
  [/kickoff return yards/i, "kr_yd"],
  [/punt return yards/i, "pr_yd"],
  [/fg made yards/i, "fgm_yds"],
];

/** Range families recognised from ESPN labels (only when the label holds a range). */
const FAMILIES: Array<{ re: RegExp; family: string; raw: string; type: "bucket" | "threshold" }> = [
  { re: /points allowed$/i, family: "pts_allow", raw: "pts_allow", type: "bucket" },
  { re: /total yards allowed$/i, family: "yds_allow", raw: "yds_allow", type: "bucket" },
  { re: /^fg made \(/i, family: "fgm", raw: "field goals made by distance", type: "bucket" },
  { re: /^fg missed \(/i, family: "fgmiss", raw: "field goals missed by distance", type: "bucket" },
  { re: /^fg attempted \(/i, family: "fga", raw: "field goals attempted by distance", type: "bucket" },
  { re: /yard passing game$/i, family: "bonus_pass_yd", raw: "pass_yd", type: "threshold" },
  { re: /yard rushing game$/i, family: "bonus_rush_yd", raw: "rush_yd", type: "threshold" },
  { re: /yard receiving game$/i, family: "bonus_rec_yd", raw: "rec_yd", type: "threshold" },
];

const missingOf = (keys: readonly string[], known: ReadonlySet<string>) => keys.filter((k) => !known.has(k));

/** Classify one ESPN scoring rule (statId + espn-api's abbr/label). */
export function classifyRule(statId: number, abbr: string, label: string, known: ReadonlySet<string> = SLEEPER_KEYS): CanonicalRule {
  const range = parseEspnRange(label);
  const fam = range ? FAMILIES.find((f) => f.re.test(label)) : undefined;
  const base = { statId, abbr, ...(fam ? { family: fam.family } : {}) };
  if (fam && range) {
    if (fam.type === "bucket") {
      const buckets = sleeperBuckets(fam.family, known);
      const cover = coverRange(range, buckets);
      if (cover) return { ...base, kind: cover.length === 1 ? "exact" : "sum", keys: cover, range, missing: [], note: cover.length === 1 ? `${fmtRange(range)} = ${cover[0]}` : `${fmtRange(range)} = ${cover.join(" + ")}` };
      const near = buckets.filter((b) => b.lo <= (range.hi ?? Infinity) && (b.hi === null || b.hi >= range.lo)).map((b) => b.key);
      return { ...base, kind: "range", keys: [], raw: fam.raw, range, missing: [], note: `ESPN ${fmtRange(range)} vs Sleeper ${near.join(", ") || `no ${fam.family}_* bucket`}: no exact cover` };
    }
    const th = sleeperThresholds(fam.family, known);
    const from = th.get(range.lo);
    if (range.hi === null && from) return { ...base, kind: "exact", keys: [from], range, missing: [], note: `${fmtRange(range)} = ${from}` };
    const to = range.hi !== null ? th.get(range.hi + 1) : undefined;
    if (from && to) return { ...base, kind: "difference", keys: [from, to], range, missing: [], note: `${fmtRange(range)} = ${from} at +p and ${to} at −p` };
    return { ...base, kind: "range", keys: [], raw: fam.raw, range, missing: [], note: `ESPN ${fmtRange(range)}: Sleeper thresholds ${[...th.keys()].join("/") || "none"} don't bound it` };
  }
  const every = /^every (\d+) (.+)$/i.exec(label);
  if (every) {
    const raw = EVERY_RAW.find(([re]) => re.test(every[2] ?? ""))?.[1];
    return raw ? { ...base, kind: "derived", keys: [], raw, missing: [], note: `floor(${raw} / ${every[1]})` } : { ...base, kind: "none", keys: [], missing: [], note: `"${label}": no Sleeper stat to derive it from` };
  }
  const d = DIRECT[statId];
  if (d !== undefined) {
    const note = NOTES[statId] ?? "";
    if (typeof d === "string") return { ...base, kind: "exact", keys: [d], missing: missingOf([d], known), note };
    if (Array.isArray(d)) return { ...base, kind: "sum", keys: [...d], missing: missingOf(d, known), note: note || `sum over play types` };
    const s = d as { player: string; dst: string };
    return { ...base, kind: "split", keys: [s.player, s.dst], missing: missingOf([s.player, s.dst], known), note: note || `players ${s.player}, team defenses ${s.dst}` };
  }
  if (NOTES[statId] || NONE_LABEL.test(label)) return { ...base, kind: "none", keys: [], missing: [], note: NOTES[statId] ?? `"${label}"` };
  return { ...base, kind: "unknown", keys: [], missing: [], note: `"${label}": not in the Phase 0 candidate table` };
}

export interface ScoredRule {
  statId: number;
  points: number;
  pointsOverrides?: Record<string, number> | null;
}

export interface MergeGroup {
  key: string;
  statIds: number[];
  /** True when every rule in the group scores the same (points and overrides), so one Sleeper rate reproduces them. */
  equalRates: boolean;
}

/** Rules of one league that share a Sleeper key (ESPN splits what Sleeper counts once, e.g. INT and fumble return TDs). */
export function mergeGroups(rules: readonly CanonicalRule[], items: readonly ScoredRule[]): MergeGroup[] {
  const byKey = new Map<string, number[]>();
  for (const r of rules) {
    if (r.kind !== "exact" && r.kind !== "split") continue;
    for (const k of r.keys) byKey.set(k, [...(byKey.get(k) ?? []), r.statId]);
  }
  const rate = (id: number) => {
    const it = items.find((i) => i.statId === id);
    const o = Object.entries(it?.pointsOverrides ?? {}).sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify([it?.points ?? 0, o]);
  };
  return [...byKey]
    .filter(([, ids]) => new Set(ids).size > 1)
    .map(([key, ids]) => {
      const uniq = [...new Set(ids)].sort((a, b) => a - b);
      return { key, statIds: uniq, equalRates: new Set(uniq.map(rate)).size === 1 };
    });
}

/** Report groups: what the planner needs to know about each rule. */
export type CanonicalGroup = "oneToOne" | "severalKeys" | "derivedRule" | "noKey";

export function groupOf(kind: CanonicalKind, inUnequalMerge = false): CanonicalGroup {
  if (inUnequalMerge) return "derivedRule";
  if (kind === "exact" || kind === "split") return "oneToOne";
  if (kind === "sum" || kind === "difference") return "severalKeys";
  if (kind === "range" || kind === "derived") return "derivedRule";
  return "noKey";
}
