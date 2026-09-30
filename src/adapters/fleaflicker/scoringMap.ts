/**
 * Fleaflicker FetchLeagueRules → the normalized Scoring (CLAUDE.md §5; planner reply to Checkpoint 0,
 * answer 4). Ported from the Phase 0 converter (scripts/lib/fleaflicker/scoring-map.ts; oracle 99.4%
 * on a conventional league) onto the extended Scoring model.
 *
 * Rule shapes (FetchLeagueRules.allScoringRuleTypes, live 2026-09-29):
 *   per unit   "P points for every N <stat>"                 → rate P/N. Fractional, not stepped: the
 *              conventional league's oracle matches with linear rates (0.05 per passing yard …).
 *   bonus      "P extra points when total <stat> is ≥ lo"     → threshold
 *              "… is ≤ hi" / "… between lo and hi"            → range (bounded when both are given)
 *   multiValue "P extra points for every <TD|FG> of/between … yards" → Sleeper's distance keys
 *              (*_td_40p, *_td_50p, fgm_40_49 …) when the band lines up with them, else unmapped;
 *              "P points for every N yards covered by a FG [after yard 30]" → fgm_yds / fgm_yds_over_30.
 *   per unit with bounds ("after reaching lo total", "for the first hi total") → unmapped: no league
 *              with that shape has been checked, so its exact semantics are unverified.
 *
 * Positions come from `applyTo`: with applyToAll it lists every position the league allows (and
 * omits D/ST when the league can't start one), so an applyToAll rule is league-wide (perStat).
 *
 * Definition adjustments, each verified by the Phase 0 oracle and switchable so tests can measure
 * what it changes:
 *   - recFdIncludesRecTd: Fleaflicker's Receiving First Down also counts TD catches → the composite
 *     stat rec_fd + rec_td (for the per-unit rule and for bonuses on it).
 *   - specialTeamsPlays: Solo Tackle / Fumble Recovered include special-teams plays → + st_tkl_solo /
 *     st_fum_rec; Fumble Forced reads idp_ff, which already includes them.
 *   - punterOnlyZeroTier: "≤ 5 yards on returned punts" is a punter stat, always 0 for QB/K, so the
 *     tier is a constant per game played for them (perGame).
 * Pure: no I/O.
 */
import type { ImportWarning, Pos, Scoring, ScoringRule, StatExpr } from "@/engine/model";
import { POSITIONS } from "@/engine/model";
import { MERGED_LABELS, mapPos } from "./positions";
import { fd, num, parseLeagueRules, type FfRule, type FfScoringGroup } from "./schema";

export const ADJUSTMENTS = {
  recFdIncludesRecTd: {
    label: "Receiving first downs include TD catches",
    detail: "Fleaflicker's Receiving First Down also counts receiving TDs; Sleeper's rec_fd does not, so the rule reads rec_fd + rec_td (Phase 0 oracle: fixed 57 player-weeks, broke 0)",
  },
  specialTeamsPlays: {
    label: "Tackles and fumble recoveries include special-teams plays",
    detail: "Fleaflicker counts special-teams plays in Solo Tackle / Fumble Forced / Fumble Recovered; Sleeper keeps special-teams solo tackles and recoveries apart (st_tkl_solo, st_fum_rec) and already includes them in idp_ff (Phase 0 oracle: fixed 11, broke 0)",
  },
  punterOnlyZeroTier: {
    label: "A punter-only tier that includes 0 fires for every QB/K who plays",
    detail: "Yards on returned punts is a punter stat, always 0 for other players, so a tier whose range includes 0 (e.g. '≤ 5') is a constant bonus per game played (Phase 0 oracle: fixed 22, broke 0; exact unless a kicker or quarterback punts)",
  },
} as const;
export type AdjustmentId = keyof typeof ADJUSTMENTS;
export const ALL_ADJUSTMENTS = Object.keys(ADJUSTMENTS) as AdjustmentId[];

type EventFamily = "pass_td" | "rush_td" | "rec_td" | "fgm" | "fgmiss";
export type PlayerClass = "offense" | "punter" | "dst" | "idp";

export interface CategoryMap {
  /** Expected category.nameSingular (guards against id reuse). */
  name: string;
  /** Key for an individual player's stat (offense and kickers; also punters and IDP unless overridden). */
  player?: string;
  /** Key for a punter, when it differs from `player`. */
  punter?: string;
  /** Key for team defense (D/ST → DEF). */
  dst?: string;
  /** Key for an individual defensive player's defensive stat (DL LB DB). */
  idp?: string;
  /** Extra Sleeper keys the Fleaflicker stat also counts, per class (a definition adjustment). */
  extra?: { adj: AdjustmentId; player?: string[]; idp?: string[]; dst?: string[] };
  /** Classes that never record the stat (punter-only stats): a tier whose range includes 0 always fires. */
  zeroFor?: { adj: AdjustmentId; classes: PlayerClass[] };
  /** Classes whose Sleeper keys miss part of the stat (the rule is then "partial"). */
  partial?: { classes: PlayerClass[]; note: string };
  /** multiValue categories: each event carries a distance (TD length, FG length). */
  events?: EventFamily;
  /** Shown in box scores only; never a scoring rule. */
  display?: true;
  /** Categories Sleeper merges into one key (see COMBINE_SETS). */
  combine?: keyof typeof COMBINE_SETS;
  /** Why it isn't mapped (when no key is given). */
  note?: string;
}

/**
 * Category sets that map to one merged Sleeper key: kick and punt return TDs are both st_td for a
 * player (def_st_td for a team D/ST). Exact only when every rule in the set is identical.
 */
export const COMBINE_SETS = { returnTd: [63, 67] } as const;

/** Category ids and names observed in live FetchLeagueRules / FetchLeagueBoxscore (2026-09-29). */
export const FF_CATEGORIES: Readonly<Record<number, CategoryMap>> = {
  2: { name: "Passing Completion", player: "pass_cmp" },
  3: { name: "Passing Yard", player: "pass_yd" },
  4: { name: "2 Pt Conversion Passing", player: "pass_2pt" },
  5: { name: "Passing TD", player: "pass_td" },
  6: { name: "Passing TD", events: "pass_td" },
  7: { name: "Interception", player: "pass_int" },
  8: { name: "Interception For TD", player: "pass_int_td" },
  12: { name: "Completion Percentage", player: "cmp_pct" },
  21: { name: "Rushing Attempt", player: "rush_att" },
  22: { name: "Rushing Yard", player: "rush_yd" },
  23: { name: "2 Pt Conversion Rushing", player: "rush_2pt" },
  24: { name: "Rushing TD", player: "rush_td" },
  25: { name: "Rushing TD", events: "rush_td" },
  26: { name: "Fumble", player: "fum" },
  27: { name: "Fumble Lost", player: "fum_lost" },
  29: { name: "Offensive + Special Teams TD", display: true },
  41: { name: "Catch", player: "rec" },
  42: { name: "Receiving Yard", player: "rec_yd" },
  43: { name: "2 Pt Conversion Receiving", player: "rec_2pt" },
  44: { name: "Receiving TD", player: "rec_td" },
  45: { name: "Receiving TD", events: "rec_td" },
  61: { name: "Kick Return Attempt", player: "kr", dst: "def_kr" },
  62: { name: "Kick Return Yard", player: "kr_yd", dst: "def_kr_yd" },
  63: { name: "Kick Return TD", player: "st_td", dst: "def_st_td", combine: "returnTd" },
  64: { name: "Kick Return TD", note: "per-TD length bonus; Sleeper has no return-TD length keys" },
  66: { name: "Punt Return Yard", player: "pr_yd", dst: "def_pr_yd" },
  67: { name: "Punt Return TD", player: "st_td", dst: "def_st_td", combine: "returnTd" },
  68: { name: "Punt Return TD", note: "per-TD length bonus; Sleeper has no return-TD length keys" },
  69: { name: "Blocked Punt Return TD", note: "no Sleeper key for this return-TD type (Sleeper counts it in idp_def_td / def_td / def_st_td)" },
  // Defensive categories: Sleeper records an offensive player's defensive plays (a tackle after a
  // turnover, a two-way player's snaps) under the same idp_* keys (weeks 2–3: idp_tkl_solo on 15 WR,
  // 5 TE, 5 RB and 3 QB rows), and Fleaflicker scores them for every position in applyTo.
  81: { name: "Total Tackle", player: "idp_tkl", idp: "idp_tkl", dst: "tkl", extra: { adj: "specialTeamsPlays", player: ["st_tkl_solo"], idp: ["st_tkl_solo"] }, partial: { classes: ["offense", "punter", "idp"], note: "Sleeper records special-teams tackles only as st_tkl_solo: an assisted special-teams tackle has no key" } },
  82: { name: "Assisted Tackle", player: "idp_tkl_ast", idp: "idp_tkl_ast", dst: "tkl_ast", partial: { classes: ["offense", "punter", "idp"], note: "Sleeper has no special-teams assisted-tackle key (only st_tkl_solo)" } },
  83: { name: "Solo Tackle", player: "idp_tkl_solo", idp: "idp_tkl_solo", dst: "tkl_solo", extra: { adj: "specialTeamsPlays", player: ["st_tkl_solo"], idp: ["st_tkl_solo"] } },
  84: { name: "Interception", player: "idp_int", idp: "idp_int", dst: "int" },
  85: { name: "Sack", player: "idp_sack", idp: "idp_sack", dst: "sack" },
  // Sleeper's idp_ff already counts special-teams forced fumbles (every row with st_ff also has
  // idp_ff), so st_ff is not added.
  86: { name: "Fumble Forced", player: "idp_ff", idp: "idp_ff", dst: "ff" },
  87: {
    name: "Fumble Recovered",
    player: "idp_fum_rec",
    idp: "idp_fum_rec",
    dst: "fum_rec",
    extra: { adj: "specialTeamsPlays", player: ["st_fum_rec"], idp: ["st_fum_rec"] },
    partial: { classes: ["offense", "punter"], note: "an offensive player's recovery of his own or a teammate's fumble has no Sleeper key (fum − fum_lost only says his team kept the ball)" },
  },
  88: { name: "Safety", player: "idp_safe", idp: "idp_safe", dst: "safe" },
  89: { name: "Defensive TD", player: "idp_def_td", idp: "idp_def_td", dst: "def_td" },
  90: { name: "Defensive TD", note: "per-TD length bonus; Sleeper has only bonus_def_int_td_50p-style keys" },
  91: { name: "XP Blocked", note: "Sleeper's blk_kick counts every blocked kick (XP, FG and punt together)" },
  92: { name: "FG Blocked", note: "Sleeper's blk_kick counts every blocked kick (XP, FG and punt together)" },
  93: { name: "Punt Blocked", note: "Sleeper's blk_kick counts every blocked kick (XP, FG and punt together)" },
  94: { name: "Point Allowed", dst: "pts_allow" },
  95: { name: "Net Yard Allowed", dst: "yds_allow" },
  96: { name: "Pass Defended", player: "idp_pass_def", idp: "idp_pass_def", dst: "def_pass_def" },
  97: { name: "Blocked FG Return TD", note: "no Sleeper key for this return-TD type (Sleeper counts it in idp_def_td / def_td)" },
  98: { name: "Missed FG Return TD", note: "no Sleeper key for this return-TD type (Sleeper counts it in idp_def_td / def_td)" },
  99: { name: "Fumble Return TD", note: "Sleeper has only the combined idp_def_td / def_td (every defensive TD)" },
  100: { name: "INT Return TD", note: "Sleeper has only the combined idp_def_td / def_td (every defensive TD)" },
  101: { name: "Field Goal Made", player: "fgm" },
  102: { name: "Field Goal Made", events: "fgm" },
  103: { name: "Field Goal Missed", player: "fgmiss" },
  104: { name: "XP", player: "xpm" },
  105: { name: "XP Missed", player: "xpmiss" },
  106: { name: "Field Goal Missed", events: "fgmiss" },
  107: { name: "Field Goal Attempt", player: "fga" },
  109: { name: "FG Percentage", display: true },
  110: { name: "XP Percentage", display: true },
  112: { name: "Offensive Point Allowed (FG, Pass TD, Rush TD)", note: "Sleeper's pts_allow counts all points, including return and defensive TDs" },
  117: { name: "Blocked Kick", player: "idp_blk_kick", idp: "idp_blk_kick", dst: "blk_kick" },
  118: { name: "Offensive Fumble Recovery TD", player: "fum_rec_td" },
  119: { name: "Offensive Fumble Recovery TD", note: "per-TD length bonus; no Sleeper equivalent" },
  120: { name: "Own Fumble Recovery", note: "no Sleeper per-player key (fum − fum_lost counts fumbles his team kept, not his own recoveries)" },
  122: { name: "Touchdown", display: true },
  123: { name: "Target", player: "rec_tgt" },
  124: { name: "Tackle for Loss", player: "idp_tkl_loss", idp: "idp_tkl_loss", dst: "tkl_loss" },
  125: { name: "Conversion Return", dst: "def_2pt" },
  126: { name: "Fourth-Down Stop", dst: "def_4_and_stop" },
  127: { name: "Three and Out", dst: "def_3_and_out" },
  128: { name: "Interception Return Yard", player: "idp_int_ret_yd", idp: "idp_int_ret_yd", dst: "int_ret_yd" },
  129: { name: "Fumble Return Yard", player: "idp_fum_ret_yd", idp: "idp_fum_ret_yd", dst: "fum_ret_yd" },
  131: { name: "Receiving First Down", player: "rec_fd", extra: { adj: "recFdIncludesRecTd", player: ["rec_td"] } },
  136: { name: "QB Hit", player: "idp_qb_hit", idp: "idp_qb_hit", dst: "qb_hit" },
  144: { name: "Drop", player: "rec_drop" },
  154: { name: "Punt Attempt", player: "punts" },
  155: { name: "Punt Yard", player: "punt_yds" },
  156: { name: "Punt Inside 20", player: "punt_in_20" },
  157: { name: "Blocked Punt", player: "punt_blkd" },
  158: { name: "Touchback Punt", player: "punt_tb" },
  160: { name: "Yards Per Punt", display: true },
  161: {
    name: "Yard on Returned Punt",
    zeroFor: { adj: "punterOnlyZeroTier", classes: ["offense", "idp"] },
    note: "no Sleeper key for the yards a punter's punts were returned (punt_yds − punt_net_yd − 20 × punt_tb might give it, but the scoring model can't subtract stats)",
  },
  166: { name: "Passing Completion of 20+ Yards", note: "Sleeper only has pass_cmp_40p (40+ yards)" },
  175: { name: "Target % Caught", display: true },
};

const CLASS_OF: Readonly<Record<Pos, PlayerClass>> = { QB: "offense", RB: "offense", WR: "offense", TE: "offense", K: "offense", P: "punter", DEF: "dst", DL: "idp", LB: "idp", DB: "idp" };

export function classOf(pos: Pos): PlayerClass {
  return CLASS_OF[pos];
}

// ---------------------------------------------------------------------------------------------
// Output types

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type RuleNoPos = DistributiveOmit<ScoringRule, "positions">;

export type MappingStatus = "mapped" | "partial" | "unmapped" | "inactive";

export interface FleaflickerRuleMapping {
  /** JSON path in the FetchLeagueRules body. */
  path: string;
  group: string;
  categoryId: number;
  category: string;
  description: string;
  points: number;
  status: MappingStatus;
  /** What it became: "rate", "perUnit", "threshold", "range", "perGame", "distance". */
  kinds: string[];
  /** Canonical keys it reads; "a+b" = a composite sum. */
  keys: string[];
  positions: Pos[];
  /** Fleaflicker labels in applyTo that have no model position. */
  droppedPositions: string[];
  notes: string[];
  adjustments: AdjustmentId[];
  /** The rule's shape (bounds, per-unit rate), e.g. to estimate what an unmapped rule would have added. */
  shape: { isBonus: boolean; multi: boolean; lo?: number; hi?: number; rate: number };
}

export interface FleaflickerScoringResult {
  scoring: Scoring;
  mappings: FleaflickerRuleMapping[];
  warnings: ImportWarning[];
}

export interface ConvertOptions {
  /** Definition adjustments to switch off (tests measure what each one changes). */
  disable?: readonly AdjustmentId[];
}

// ---------------------------------------------------------------------------------------------
// Rule helpers

/** Which bounds a rule has: `rangeType` says so, because a bound of 0 is omitted (proto3). */
export function ruleBounds(r: FfRule): { lo?: number; hi?: number } {
  switch (r.rangeType) {
    case "RANGE_LOWER_BOUND":
      return { lo: num(r.boundLower) };
    case "RANGE_UPPER_BOUND":
      return { hi: num(r.boundUpper) };
    case "RANGE_DOUBLE_BOUND":
      return { lo: num(r.boundLower), hi: num(r.boundUpper) };
    default:
      return { lo: r.boundLower, hi: r.boundUpper };
  }
}

/** Points per unit = points / forEvery (missing forEvery = 1). `pointsPer` is a float32 display copy. */
export function ruleRate(r: FfRule): number {
  return fd(r.points) / (num(r.forEvery) || 1);
}

/**
 * Positions a rule applies to, in model terms. `applyTo` is authoritative; only a rule with
 * applyToAll and no applyTo at all is taken to mean every model position.
 */
export function rulePositions(r: FfRule): { positions: Pos[]; dropped: string[]; notes: string[] } {
  const labels = r.applyTo ?? [];
  if (!labels.length) return r.applyToAll ? { positions: [...POSITIONS], dropped: [], notes: ["applyToAll without an applyTo list: taken as every position"] } : { positions: [], dropped: [], notes: [] };
  const positions = new Set<Pos>();
  const dropped: string[] = [];
  for (const l of labels) {
    const p = mapPos(l);
    if (p) positions.add(p);
    else dropped.push(l);
  }
  const notes: string[] = [];
  for (const g of MERGED_LABELS) {
    const has = g.labels.filter((l) => labels.includes(l));
    if (has.length && has.length < g.labels.length) notes.push(`applies to ${has.join("/")} but not ${g.labels.filter((l) => !has.includes(l)).join("/")}; the model's ${g.pos} can't tell them apart`);
  }
  return { positions: POSITIONS.filter((p) => positions.has(p)), dropped, notes };
}

/** Sleeper's field-goal distance buckets (fgm_<suffix>, fgmiss_<suffix>). */
export const FG_BUCKETS: ReadonlyArray<{ lo: number; hi: number; suffix: string }> = [
  { lo: 0, hi: 19, suffix: "0_19" },
  { lo: 20, hi: 29, suffix: "20_29" },
  { lo: 30, hi: 39, suffix: "30_39" },
  { lo: 40, hi: 49, suffix: "40_49" },
  { lo: 50, hi: 59, suffix: "50_59" },
  { lo: 60, hi: Number.POSITIVE_INFINITY, suffix: "60p" },
];

/** Per-event distance range → Sleeper keys with signed weights, or null when the band doesn't line up. */
export function distanceKeys(family: EventFamily, lo: number | undefined, hi: number | undefined): Array<{ key: string; weight: number }> | null {
  const from = lo ?? 0;
  const to = hi ?? Number.POSITIVE_INFINITY;
  if (family === "pass_td" || family === "rush_td" || family === "rec_td") {
    if (from === 40 && to === Number.POSITIVE_INFINITY) return [{ key: `${family}_40p`, weight: 1 }];
    if (from === 50 && to === Number.POSITIVE_INFINITY) return [{ key: `${family}_50p`, weight: 1 }];
    if (from === 40 && to === 49)
      return [
        { key: `${family}_40p`, weight: 1 },
        { key: `${family}_50p`, weight: -1 },
      ];
    return null;
  }
  if (from === 50 && to === Number.POSITIVE_INFINITY) return [{ key: `${family}_50p`, weight: 1 }];
  const inside = FG_BUCKETS.filter((b) => b.lo >= from && b.hi <= to);
  const covered = inside.reduce((n, b) => n + (b.hi === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : b.hi - b.lo + 1), 0);
  const span = to === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : to - from + 1;
  if (!inside.length || covered !== span || inside[0]?.lo !== from) return null;
  return inside.map((b) => ({ key: `${family}_${b.suffix}`, weight: 1 }));
}

/** Sleeper keys for one player class, including enabled definition adjustments. */
function keysFor(entry: CategoryMap, c: PlayerClass, enabled: (a: AdjustmentId) => boolean): string[] {
  const base = c === "dst" ? entry.dst : c === "idp" ? (entry.idp ?? entry.player) : c === "punter" ? (entry.punter ?? entry.player) : entry.player;
  const x = entry.extra && enabled(entry.extra.adj) ? entry.extra : undefined;
  // IDP players fall back to the player's extra keys only when they also use the player's base key.
  const extra = !x ? [] : c === "dst" ? (x.dst ?? []) : c === "idp" ? (x.idp ?? (entry.idp ? [] : (x.player ?? []))) : (x.player ?? []);
  return [...new Set([...(base ? [base] : []), ...extra])];
}

/** True when a bonus range [lo, hi] (either may be open) contains 0. */
function rangeHasZero(lo: number | undefined, hi: number | undefined): boolean {
  return (lo === undefined || lo <= 0) && (hi === undefined || hi >= 0);
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const statText = (s: StatExpr) => (typeof s === "string" ? s : s.sum.join("+"));
const exprOf = (keys: string[]): StatExpr => (keys.length === 1 ? (keys[0] as string) : { sum: [...keys] });

// ---------------------------------------------------------------------------------------------
// Conversion

/** Convert FetchLeagueRules groups. Pure. */
export function convertFleaflickerRules(groups: readonly FfScoringGroup[], opts: ConvertOptions = {}): FleaflickerScoringResult {
  const disabled = new Set(opts.disable ?? []);
  const enabled = (a: AdjustmentId) => !disabled.has(a);
  const allRate = new Map<string, number>();
  const posRate = new Map<string, Map<Pos, number>>();
  const ruleOrder: string[] = [];
  const ruleByKey = new Map<string, { rule: RuleNoPos; positions: Set<Pos> }>();
  const unmapped: Scoring["unmapped"] = [];
  const mappings: FleaflickerRuleMapping[] = [];
  const warnings: ImportWarning[] = [];

  const addRate = (key: string, rate: number, positions: readonly Pos[] | "all") => {
    if (positions === "all") {
      allRate.set(key, (allRate.get(key) ?? 0) + rate);
      return;
    }
    const m = posRate.get(key) ?? new Map<Pos, number>();
    for (const p of positions) m.set(p, (m.get(p) ?? 0) + rate);
    posRate.set(key, m);
  };
  const addRule = (rule: RuleNoPos, positions: readonly Pos[]) => {
    const key = JSON.stringify(rule);
    let e = ruleByKey.get(key);
    if (!e) {
      e = { rule, positions: new Set() };
      ruleByKey.set(key, e);
      ruleOrder.push(key);
    }
    for (const p of positions) e.positions.add(p);
  };

  // Merged Sleeper keys (return TDs): usable only when every category of the set has exactly one
  // plain per-unit rule with the same rate and positions; the rate is then added once.
  const allRules = groups.flatMap((g) => g.scoringRules ?? []);
  const combineVerdict = new Map<string, { ok: boolean; first: number; why?: string }>();
  for (const [name, ids] of Object.entries(COMBINE_SETS)) {
    const rules = allRules.filter((r) => (ids as readonly number[]).includes(r.category.id));
    if (!rules.length) continue;
    const sig = (r: FfRule) => `${ruleRate(r)}|${r.applyToAll ? "all" : [...(r.applyTo ?? [])].sort().join(",")}|${r.isBonus ? 1 : 0}|${r.rangeType ?? ""}|${r.category.multiValue ? 1 : 0}`;
    const plain = rules.every((r) => !r.isBonus && !r.category.multiValue && r.rangeType === undefined);
    const oneEach = ids.every((id) => rules.filter((r) => r.category.id === id).length === 1);
    const same = new Set(rules.map(sig)).size === 1;
    combineVerdict.set(name, {
      ok: plain && oneEach && same,
      first: ids.find((id) => rules.some((r) => r.category.id === id)) ?? ids[0],
      why: !oneEach ? "only some of the merged categories are scored" : !same ? "the merged categories score differently" : !plain ? "bonus or length rules on a merged key" : undefined,
    });
  }

  groups.forEach((g, gi) => {
    (g.scoringRules ?? []).forEach((r, ri) => {
      const path = `groups[${gi}].scoringRules[${ri}]`;
      const cat = r.category;
      const entry = FF_CATEGORIES[cat.id];
      const points = fd(r.points);
      const { positions, dropped, notes } = rulePositions(r);
      const { lo, hi } = ruleBounds(r);
      const multi = cat.multiValue === true;
      const m: FleaflickerRuleMapping = {
        path,
        group: g.label ?? "",
        categoryId: cat.id,
        category: `${cat.abbreviation ?? "?"} (${cat.nameSingular ?? "?"})`,
        description: r.description ?? cat.nameSingular ?? "",
        points,
        status: "mapped",
        kinds: [],
        keys: [],
        positions,
        droppedPositions: dropped,
        notes: [...notes],
        adjustments: [],
        shape: { isBonus: r.isBonus === true, multi, ...(lo !== undefined ? { lo } : {}), ...(hi !== undefined ? { hi } : {}), rate: ruleRate(r) },
      };
      const fail = (reason: string) => {
        m.status = "unmapped";
        m.notes.push(reason);
        mappings.push(m);
      };
      if (!entry) return fail("category id not in the mapping table");
      if (entry.display) return fail("display-only category");
      if (cat.nameSingular !== undefined && cat.nameSingular !== entry.name) return fail(`category name "${cat.nameSingular}" differs from the table ("${entry.name}")`);
      if (!positions.length && !dropped.length) {
        m.status = "inactive";
        m.notes.push("no applyTo and applyToAll is false: applies to no position in this league");
        mappings.push(m);
        return;
      }
      if (!positions.length) return fail(`applies only to ${dropped.join("/")}, which has no model position`);
      if (dropped.length) m.notes.push(`${dropped.join("/")} not modeled`);

      const classes = [...new Set(positions.map((p) => CLASS_OF[p]))];
      const byClass = classes.map((c) => ({ c, keys: keysFor(entry, c, enabled), pos: positions.filter((p) => CLASS_OF[p] === c) }));
      const usable = byClass.filter((x) => x.keys.length > 0);
      const allKeys = [...new Set(usable.flatMap((u) => u.keys))];
      const partialClasses = entry.partial ? classes.filter((c) => entry.partial?.classes.includes(c)) : [];
      const extraUsed = entry.extra !== undefined && enabled(entry.extra.adj) && byClass.some((x) => x.keys.length > keysFor(entry, x.c, () => false).length);
      const finish = () => {
        if (extraUsed && entry.extra) {
          m.adjustments.push(entry.extra.adj);
          m.notes.push(`definition adjustment: ${ADJUSTMENTS[entry.extra.adj].label}`);
        }
        if (partialClasses.length && entry.partial) {
          m.status = "partial";
          m.notes.push(`${partialClasses.join("/")} players: ${entry.partial.note}`);
        }
        mappings.push(m);
      };

      // Punter-only stats: other players always record 0 (only when no class has a real key).
      const zf = entry.zeroFor;
      if (zf && enabled(zf.adj) && !multi && !usable.length) {
        const zero = byClass.filter((x) => zf.classes.includes(x.c));
        const other = byClass.filter((x) => !zf.classes.includes(x.c));
        if (zero.length) {
          const zeroPos = zero.flatMap((x) => x.pos);
          m.adjustments.push(zf.adj);
          if (r.isBonus && rangeHasZero(lo, hi)) {
            addRule({ kind: "perGame", points }, zeroPos);
            m.kinds.push("perGame");
            m.notes.push(`definition adjustment: ${ADJUSTMENTS[zf.adj].label}: ${zeroPos.join("/")} always have 0 here, so the tier is ${points > 0 ? "+" : ""}${points} per game played`);
          } else {
            m.status = "inactive";
            m.notes.push(`${zeroPos.join("/")} always have 0 for this punter-only stat, so the rule never scores for them`);
          }
          if (other.length) {
            m.status = "partial";
            m.notes.push(`${other.map((x) => x.pos.join("/")).join("/")}: ${entry.note ?? "no Sleeper key"}`);
          }
          mappings.push(m);
          return;
        }
      }

      if (multi || entry.events) {
        const family = entry.events;
        if (!family) return fail(entry.note ?? "per-event distance rule with no Sleeper equivalent");
        const target = r.applyToAll ? ("all" as const) : positions;
        if (r.isBonus) {
          const buckets = distanceKeys(family, lo, hi);
          if (!buckets) return fail(`distance band ${lo ?? 0}–${hi ?? "∞"} yds doesn't line up with Sleeper's keys`);
          for (const b of buckets) addRate(b.key, points * b.weight, target);
          m.kinds.push("distance");
          m.keys = buckets.map((b) => `${b.weight < 0 ? "-" : ""}${b.key}`);
        } else {
          // Per yard of each event: only FG distance has Sleeper totals (fgm_yds, fgm_yds_over_30).
          const key = family === "fgm" && lo === undefined && hi === undefined ? "fgm_yds" : family === "fgm" && lo === 30 && hi === undefined ? "fgm_yds_over_30" : null;
          if (!key) return fail(`per-yard rule on ${family}${lo !== undefined ? ` after yard ${lo}` : ""}${hi !== undefined ? ` up to yard ${hi}` : ""} has no Sleeper total`);
          addRate(key, ruleRate(r), target);
          m.kinds.push("distance");
          m.keys = [key];
        }
        mappings.push(m);
        return;
      }

      if (!usable.length) return fail(entry.note ?? entry.partial?.note ?? `no Sleeper key for ${classes.join("/")} players`);

      if (entry.combine) {
        const v = combineVerdict.get(entry.combine);
        if (!v?.ok) return fail(`Sleeper merges kick and punt return TDs into ${allKeys.join("/")}; ${v?.why ?? "can't split them"}`);
        if (cat.id === v.first) {
          const rate = ruleRate(r);
          if (r.applyToAll) for (const k of allKeys) addRate(k, rate, "all");
          else for (const u of usable) for (const k of u.keys) addRate(k, rate, u.pos);
        }
        m.kinds.push("rate");
        m.keys = allKeys;
        m.notes.push(`merged key (kick and punt return TDs score the same; added once)${cat.id === v.first ? "" : ": rate already counted"}`);
        return finish();
      }

      if (r.isBonus) {
        if (lo === undefined && hi === undefined) return fail("bonus rule without a range");
        for (const u of usable) {
          const stat = exprOf(u.keys);
          const rule: RuleNoPos = hi === undefined ? { kind: "threshold", stat, min: lo as number, points } : { kind: "range", stat, ...(lo !== undefined ? { min: lo } : {}), max: hi, points };
          addRule(rule, u.pos);
          if (!m.kinds.includes(rule.kind)) m.kinds.push(rule.kind);
        }
        m.keys = [...new Set(usable.map((u) => statText(exprOf(u.keys))))];
        return finish();
      }

      if (lo !== undefined || hi !== undefined) return fail(`per-unit rule limited to totals ${lo ?? 0}–${hi ?? "∞"}: that rule shape's exact semantics are unverified (no league with it has been checked)`);
      const rate = ruleRate(r);
      if (r.applyToAll && usable.every((u) => u.keys.length === 1)) {
        for (const k of allKeys) addRate(k, rate, "all");
        m.kinds.push("rate");
      } else {
        for (const u of usable) {
          if (u.keys.length === 1) {
            addRate(u.keys[0] as string, rate, u.pos);
            if (!m.kinds.includes("rate")) m.kinds.push("rate");
          } else {
            addRule({ kind: "perUnit", stat: exprOf(u.keys), points: round6(rate) }, u.pos);
            if (!m.kinds.includes("perUnit")) m.kinds.push("perUnit");
          }
        }
      }
      m.keys = [...new Set(usable.map((u) => statText(exprOf(u.keys))))];
      return finish();
    });
  });

  // perStat holds league-wide (applyToAll) rates; byPosition REPLACES the rate for a position
  // (CLAUDE.md §5), so it includes the league-wide part.
  const perStat: Record<string, number> = {};
  const byPosition: Partial<Record<Pos, Record<string, number>>> = {};
  for (const [k, v] of allRate) if (round6(v) !== 0) perStat[k] = round6(v);
  for (const [k, byPos] of posRate) for (const [p, v] of byPos) (byPosition[p] ??= {})[k] = round6((allRate.get(k) ?? 0) + v);
  const rules: ScoringRule[] = ruleOrder.map((key) => {
    const e = ruleByKey.get(key) as { rule: RuleNoPos; positions: Set<Pos> };
    return { ...e.rule, positions: POSITIONS.filter((p) => e.positions.has(p)) } as ScoringRule;
  });

  // Unmapped and partly mapped rules are listed (with points) and warned about; nothing is dropped silently.
  const merged = new Set<string>();
  for (const m of mappings) {
    if (m.status === "unmapped" || m.status === "partial") {
      const reason = m.notes.at(-1) ?? "";
      unmapped.push({ platformKey: `${m.categoryId}:${m.category}`, label: `${m.status === "partial" ? "(partly mapped) " : ""}${m.description}: ${reason}`, points: m.points });
      warnings.push({ code: m.status === "partial" ? "SCORING_RULE_PARTIAL" : "SCORING_RULE_UNMAPPED", message: `Scoring rule "${m.description}" ${m.status === "partial" ? "is only partly used" : "isn't used"}: ${reason}.`, platformPath: m.path });
    }
    for (const n of m.notes) if (/can't tell them apart/.test(n) && !merged.has(n)) merged.add(n);
  }
  for (const n of merged) warnings.push({ code: "SCORING_POSITIONS_MERGED", message: `A scoring rule ${n}.` });
  const used = new Set(mappings.flatMap((m) => m.adjustments));
  for (const a of ALL_ADJUSTMENTS) if (used.has(a)) warnings.push({ code: "SCORING_DEFINITION_ADJUSTED", message: `${ADJUSTMENTS[a].label}: ${ADJUSTMENTS[a].detail}.` });
  if (!mappings.length) warnings.push({ code: "SCORING_EMPTY", message: "The league's rules list no scoring rules; every player would score 0.", platformPath: "groups" });

  return { scoring: { perStat, byPosition, rules, unmapped }, mappings, warnings };
}

/** FetchLeagueRules body → Scoring. Throws LeagueImportError BAD_RESPONSE on a malformed body. */
export function fleaflickerRulesToScoring(json: unknown, opts: ConvertOptions = {}): FleaflickerScoringResult {
  return convertFleaflickerRules(parseLeagueRules(json).groups ?? [], opts);
}
