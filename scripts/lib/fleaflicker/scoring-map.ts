/**
 * Draft Fleaflicker scoring map (CLAUDE.md §5): stat category → canonical Sleeper stat keys, and
 * conversion of a league's FetchLeagueRules into the normalized Scoring shape
 * ({perStat, byPosition, bonuses, unmapped}). Phase 5 moves this to src/adapters/fleaflicker.
 *
 * Category ids and names were observed in live FetchLeagueRules / FetchLeagueBoxscore responses
 * on 2026-09-29. Each entry records the expected `nameSingular`; a rule whose id is known but whose
 * name differs is reported as unmapped instead of being guessed.
 *
 * Rule shapes (FetchLeagueRules.allScoringRuleTypes):
 *   per unit     "P points for every N <stat>"                     → rate P/N on a key
 *   bonus        "P extra points when total <stat> is ≥ lo / ≤ hi / between lo and hi"
 *   multiValue   per event: "P extra points for every <TD|FG> between lo and hi yards" → distance
 *                buckets (Sleeper *_40p, fgm_40_49 …); per yard: "P points for every N yards
 *                covered by a FG [after yard lo]" → fgm_yds / fgm_yds_over_30
 *   per unit with bounds ("after reaching lo total …") is piecewise: not representable.
 *
 * Positions come from `applyTo`. `applyToAll` only says "every position this league allows": its
 * applyTo lists exactly those (live data: D/ST is absent when the league can't start one), so an
 * applyToAll rule goes to perStat with the keys of the classes in applyTo only.
 *
 * Definition adjustments (ADJUSTMENTS) cover Fleaflicker stats that count more than the Sleeper key
 * of the same name; each is switchable so the scoring oracle can measure what it changes.
 */
import { fd, num, type FfRule } from "./api";
import { mapPos, type Pos } from "./positions";

type EventFamily = "pass_td" | "rush_td" | "rec_td" | "fgm" | "fgmiss";

/**
 * Where a Fleaflicker stat differs from the Sleeper key(s) it maps to. Evidence for each comes from
 * the scoring oracle (rows fixed / broken with the adjustment on vs off), reported by the probe.
 */
export const ADJUSTMENTS = {
  recFdIncludesRecTd: {
    label: "Receiving first downs include TD catches",
    detail: "Fleaflicker's Receiving First Down also counts receiving TDs; Sleeper's rec_fd does not, so the rule reads rec_fd + rec_td (a bonus on it reads the sum)",
  },
  specialTeamsPlays: {
    label: "Tackles, forced fumbles and recoveries include special-teams plays",
    detail: "Fleaflicker counts special-teams plays in Solo Tackle / Fumble Forced / Fumble Recovered for every position in applyTo. Sleeper keeps special-teams solo tackles and fumble recoveries apart (st_tkl_solo, st_fum_rec), but its idp_ff already includes special-teams forced fumbles; so tackles and recoveries add the st_* key and forced fumbles read idp_ff for offensive players too",
  },
  punterOnlyZeroTier: {
    label: "A punter-only tier that includes 0 fires for every QB/K who plays",
    detail: "Yards on returned punts is a punter stat, always 0 for other players, so a tier whose range includes 0 (e.g. '≤ 5') is a constant bonus per game played: gp ≥ 1 (exact unless a kicker or quarterback punts)",
  },
} as const;
export type AdjustmentId = keyof typeof ADJUSTMENTS;
export const ALL_ADJUSTMENTS = Object.keys(ADJUSTMENTS) as AdjustmentId[];

export interface CategoryMap {
  /** Expected category.nameSingular (guards against id reuse). */
  name: string;
  /** Key for an individual player's stat (any position; IDP players use it too unless `idp` is set). */
  player?: string;
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
  /**
   * Categories Sleeper merges into one key (see COMBINE_SETS): kick and punt return TDs are both
   * st_td for a player (def_st_td for a team D/ST); Sleeper's pr_td appears only on TEAM rows.
   */
  combine?: keyof typeof COMBINE_SETS;
  /** Why it isn't mapped (when no key is given). */
  note?: string;
}

/** Category sets that map to one merged Sleeper key; exact only when every rule in the set is identical. */
export const COMBINE_SETS = { returnTd: [63, 67] } as const;

export const FF_CATEGORIES: Record<number, CategoryMap> = {
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
  64: { name: "Kick Return TD", note: "per-TD length bonus; Sleeper has no return-TD length buckets" },
  66: { name: "Punt Return Yard", player: "pr_yd", dst: "def_pr_yd" },
  67: { name: "Punt Return TD", player: "st_td", dst: "def_st_td", combine: "returnTd" },
  68: { name: "Punt Return TD", note: "per-TD length bonus; Sleeper has no return-TD length buckets" },
  69: { name: "Blocked Punt Return TD", note: "no Sleeper key for this return-TD type (Sleeper counts it in idp_def_td / def_td / def_st_td)" },
  81: { name: "Total Tackle", idp: "idp_tkl", dst: "tkl", extra: { adj: "specialTeamsPlays", player: ["st_tkl_solo"], idp: ["st_tkl_solo"] }, partial: { classes: ["offense", "idp"], note: "Sleeper records special-teams tackles only as st_tkl_solo: an assisted special-teams tackle has no key" } },
  82: { name: "Assisted Tackle", idp: "idp_tkl_ast", dst: "tkl_ast", partial: { classes: ["offense", "idp"], note: "Sleeper has no special-teams assisted-tackle key (only st_tkl_solo)" } },
  83: { name: "Solo Tackle", idp: "idp_tkl_solo", dst: "tkl_solo", extra: { adj: "specialTeamsPlays", player: ["st_tkl_solo"], idp: ["st_tkl_solo"] } },
  84: { name: "Interception", idp: "idp_int", dst: "int" },
  85: { name: "Sack", idp: "idp_sack", dst: "sack" },
  // Sleeper's idp_ff already counts special-teams forced fumbles (every row with st_ff also has
  // idp_ff), so st_ff is not added; an offensive player's forced fumble is read from idp_ff too.
  86: { name: "Fumble Forced", idp: "idp_ff", dst: "ff", extra: { adj: "specialTeamsPlays", player: ["idp_ff"], idp: [] } },
  87: {
    name: "Fumble Recovered",
    idp: "idp_fum_rec",
    dst: "fum_rec",
    extra: { adj: "specialTeamsPlays", player: ["st_fum_rec"], idp: ["st_fum_rec"] },
    partial: { classes: ["offense"], note: "an offensive player's recovery of his own or a teammate's fumble has no Sleeper key (fum − fum_lost only says his team kept the ball)" },
  },
  88: { name: "Safety", idp: "idp_safe", dst: "safe" },
  89: { name: "Defensive TD", idp: "idp_def_td", dst: "def_td" },
  90: { name: "Defensive TD", note: "per-TD length bonus; Sleeper has only bonus_def_int_td_50p-style keys" },
  91: { name: "XP Blocked", note: "Sleeper blk_kick counts every blocked kick (XP, FG and punt together)" },
  92: { name: "FG Blocked", note: "Sleeper blk_kick counts every blocked kick (XP, FG and punt together)" },
  93: { name: "Punt Blocked", note: "Sleeper blk_kick counts every blocked kick (XP, FG and punt together)" },
  94: { name: "Point Allowed", dst: "pts_allow" },
  95: { name: "Net Yard Allowed", dst: "yds_allow" },
  96: { name: "Pass Defended", idp: "idp_pass_def", dst: "def_pass_def" },
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
  112: { name: "Offensive Point Allowed (FG, Pass TD, Rush TD)", note: "Sleeper pts_allow counts all points, including return and defensive TDs" },
  117: { name: "Blocked Kick", idp: "idp_blk_kick", dst: "blk_kick" },
  118: { name: "Offensive Fumble Recovery TD", player: "fum_rec_td" },
  119: { name: "Offensive Fumble Recovery TD", note: "per-TD length bonus; no Sleeper equivalent" },
  120: { name: "Own Fumble Recovery", note: "no Sleeper per-player key (fum − fum_lost counts fumbles his team kept, not his own recoveries)" },
  122: { name: "Touchdown", display: true },
  123: { name: "Target", player: "rec_tgt" },
  124: { name: "Tackle for Loss", idp: "idp_tkl_loss", dst: "tkl_loss" },
  125: { name: "Conversion Return", dst: "def_2pt" },
  126: { name: "Fourth-Down Stop", dst: "def_4_and_stop" },
  127: { name: "Three and Out", dst: "def_3_and_out" },
  128: { name: "Interception Return Yard", idp: "idp_int_ret_yd", dst: "int_ret_yd" },
  129: { name: "Fumble Return Yard", idp: "idp_fum_ret_yd", dst: "fum_ret_yd" },
  131: { name: "Receiving First Down", player: "rec_fd", extra: { adj: "recFdIncludesRecTd", player: ["rec_td"] } },
  136: { name: "QB Hit", idp: "idp_qb_hit", dst: "qb_hit" },
  144: { name: "Drop", player: "rec_drop" },
  154: { name: "Punt Attempt", player: "punts" },
  155: { name: "Punt Yard", player: "punt_yds" },
  156: { name: "Punt Inside 20", player: "punt_in_20" },
  157: { name: "Blocked Punt", player: "punt_blkd" },
  158: { name: "Touchback Punt", player: "punt_tb" },
  160: { name: "Yards Per Punt", display: true },
  161: { name: "Yard on Returned Punt", zeroFor: { adj: "punterOnlyZeroTier", classes: ["offense", "idp"] }, note: "no Sleeper key for punt return yards allowed by a punter" },
  166: { name: "Passing Completion of 20+ Yards", note: "Sleeper only has pass_cmp_40p (40+ yards)" },
  175: { name: "Target % Caught", display: true },
};

export type PlayerClass = "offense" | "dst" | "idp";
const CLASS_OF: Record<Pos, PlayerClass> = { QB: "offense", RB: "offense", WR: "offense", TE: "offense", K: "offense", DEF: "dst", DL: "idp", LB: "idp", DB: "idp" };
const POS_OF_CLASS: Record<PlayerClass, Pos[]> = { offense: ["QB", "RB", "WR", "TE", "K"], dst: ["DEF"], idp: ["DL", "LB", "DB"] };
export const ALL_POS: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
/** Model positions that several Fleaflicker labels collapse into. */
const GROUPS: Array<{ pos: Pos; labels: string[] }> = [
  { pos: "DB", labels: ["CB", "S"] },
  { pos: "DL", labels: ["EDR", "IL"] },
];

export function classOf(pos: Pos): PlayerClass {
  return CLASS_OF[pos];
}

export interface Bonus {
  /** Canonical key, or several joined by "+" when the Fleaflicker stat is their sum ("rec_fd+rec_td"). */
  stat: string;
  /** Minimum (inclusive). -1e9 stands for "no lower bound" (an ≤-only tier). */
  threshold: number;
  points: number;
  positions?: Pos[];
  /** Maximum (inclusive): an extension to the spec's Scoring.bonuses, needed for Fleaflicker tiers. */
  max?: number;
}

export interface ConvertedScoring {
  perStat: Record<string, number>;
  byPosition: Partial<Record<Pos, Record<string, number>>>;
  bonuses: Bonus[];
  unmapped: Array<{ platformKey: string; label: string; points: number; reason: string }>;
}

/**
 * inactive = the rule lists no position (proto3 drops an empty applyTo and a false applyToAll);
 * seen for kicker/D/ST rules in leagues that start no K or D/ST.
 */
export type MapStatus = "per-unit" | "bonus" | "tier" | "distance" | "partial" | "unmapped" | "inactive";

export interface RuleMapping {
  group: string;
  categoryId: number;
  category: string;
  description: string;
  points: number;
  status: MapStatus;
  /** Canonical keys this rule feeds (with the rate or bonus that goes on each); "a+b" = a sum. */
  keys: string[];
  positions: Pos[];
  /** Fleaflicker labels in applyTo that have no model Pos (e.g. P). */
  droppedPositions: string[];
  notes: string[];
  /** Definition adjustments this rule uses (see ADJUSTMENTS). */
  adjustments: AdjustmentId[];
  /** Rule shape, for estimating what an unmapped rule would have added (oracle explanations). */
  shape: { isBonus: boolean; multi: boolean; lo?: number; hi?: number; rate: number };
}

export interface ConvertOptions {
  /** Definition adjustments to switch off (the oracle measures each one's effect). */
  disable?: readonly AdjustmentId[];
}

const NO_LOWER = -1e9;

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

/**
 * Points per unit = points / forEvery (forEvery missing = 1). `pointsPer` is only a float32 display
 * copy (1/3 arrives as 0.33333334), so it is not used.
 */
export function ruleRate(r: FfRule): number {
  return fd(r.points) / (num(r.forEvery) || 1);
}

/**
 * Positions a rule applies to, in model terms. `applyTo` is authoritative: with applyToAll=true it
 * lists every position the league allows (and omits D/ST when the league can't start one). Only a
 * rule with applyToAll and no applyTo at all is taken to mean every model position.
 */
export function rulePositions(r: FfRule): { positions: Pos[]; dropped: string[]; notes: string[] } {
  const labels = r.applyTo ?? [];
  if (!labels.length) return r.applyToAll ? { positions: [...ALL_POS], dropped: [], notes: ["applyToAll without an applyTo list: taken as every position"] } : { positions: [], dropped: [], notes: [] };
  const positions = new Set<Pos>();
  const dropped: string[] = [];
  for (const l of labels) {
    const p = mapPos(l);
    if (p) positions.add(p);
    else dropped.push(l);
  }
  const notes: string[] = [];
  for (const g of GROUPS) {
    const has = g.labels.filter((l) => labels.includes(l));
    if (has.length && has.length < g.labels.length) notes.push(`applies to ${has.join("/")} but not ${g.labels.filter((l) => !has.includes(l)).join("/")}; the model's ${g.pos} can't tell them apart`);
  }
  return { positions: [...positions], dropped, notes };
}

/** Sleeper's field-goal distance buckets (fgm_<suffix>, fgmiss_<suffix>). */
export const FG_BUCKETS: ReadonlyArray<{ lo: number; hi: number; suffix: string }> = [
  { lo: 0, hi: 19, suffix: "0_19" },
  { lo: 20, hi: 29, suffix: "20_29" },
  { lo: 30, hi: 39, suffix: "30_39" },
  { lo: 40, hi: 49, suffix: "40_49" },
  { lo: 50, hi: 59, suffix: "50_59" },
  { lo: 60, hi: Infinity, suffix: "60p" },
];

/** Per-event distance range → Sleeper bucket keys with signed weights, or null when not exact. */
export function distanceKeys(family: EventFamily, lo: number | undefined, hi: number | undefined): Array<{ key: string; weight: number }> | null {
  const from = lo ?? 0;
  const to = hi ?? Infinity;
  if (family === "pass_td" || family === "rush_td" || family === "rec_td") {
    if (from === 40 && to === Infinity) return [{ key: `${family}_40p`, weight: 1 }];
    if (from === 50 && to === Infinity) return [{ key: `${family}_50p`, weight: 1 }];
    if (from === 40 && to === 49) return [{ key: `${family}_40p`, weight: 1 }, { key: `${family}_50p`, weight: -1 }];
    return null;
  }
  if (from === 50 && to === Infinity) return [{ key: `${family}_50p`, weight: 1 }];
  const inside = FG_BUCKETS.filter((b) => b.lo >= from && b.hi <= to);
  const covered = inside.reduce((n, b) => n + (b.hi === Infinity ? Infinity : b.hi - b.lo + 1), 0);
  const span = to === Infinity ? Infinity : to - from + 1;
  if (!inside.length || covered !== span || inside[0]?.lo !== from) return null;
  return inside.map((b) => ({ key: `${family}_${b.suffix}`, weight: 1 }));
}

/** Sleeper keys for one player class, including enabled definition adjustments. */
function keysFor(entry: CategoryMap, c: PlayerClass, enabled: (a: AdjustmentId) => boolean): string[] {
  const base = c === "dst" ? entry.dst : c === "idp" ? (entry.idp ?? entry.player) : entry.player;
  const x = entry.extra && enabled(entry.extra.adj) ? entry.extra : undefined;
  // IDP players fall back to the player's extra keys only when they also use the player's base key.
  const extra = !x ? [] : c === "dst" ? (x.dst ?? []) : c === "idp" ? (x.idp ?? (entry.idp ? [] : (x.player ?? []))) : (x.player ?? []);
  return [...new Set([...(base ? [base] : []), ...extra])];
}

/** True when a bonus range [lo, hi] (either may be open) contains 0. */
function rangeHasZero(lo: number | undefined, hi: number | undefined): boolean {
  return (lo === undefined || lo <= 0) && (hi === undefined || hi >= 0);
}

/** Convert a league's rules. Pure: no I/O. */
export function convertRules(groups: ReadonlyArray<{ label?: string; scoringRules?: FfRule[] }>, opts: ConvertOptions = {}): { scoring: ConvertedScoring; mappings: RuleMapping[] } {
  const disabled = new Set(opts.disable ?? []);
  const enabled = (a: AdjustmentId) => !disabled.has(a);
  const allRate = new Map<string, number>();
  const posRate = new Map<string, Map<Pos, number>>();
  const bonuses: Bonus[] = [];
  const unmapped: ConvertedScoring["unmapped"] = [];
  const mappings: RuleMapping[] = [];

  const addRate = (key: string, rate: number, positions: Pos[] | "all") => {
    if (positions === "all") {
      allRate.set(key, (allRate.get(key) ?? 0) + rate);
      return;
    }
    const m = posRate.get(key) ?? new Map<Pos, number>();
    for (const p of positions) m.set(p, (m.get(p) ?? 0) + rate);
    posRate.set(key, m);
  };

  // Merged Sleeper keys (return TDs): usable only when every category of the set has exactly one
  // plain per-unit rule with the same rate and positions; the rate is then added once.
  const combineVerdict = new Map<string, { ok: boolean; first: number; why?: string }>();
  for (const [name, ids] of Object.entries(COMBINE_SETS)) {
    const rules = groups.flatMap((g) => g.scoringRules ?? []).filter((r) => (ids as readonly number[]).includes(r.category.id));
    if (!rules.length) continue;
    const sig = (r: FfRule) => `${ruleRate(r)}|${r.applyToAll ? "all" : [...(r.applyTo ?? [])].sort().join(",")}|${r.isBonus ? 1 : 0}|${r.rangeType ?? ""}|${r.category.multiValue ? 1 : 0}`;
    const plain = rules.every((r) => !r.isBonus && !r.category.multiValue && r.rangeType === undefined);
    const oneEach = ids.every((id) => rules.filter((r) => r.category.id === id).length === 1);
    const same = new Set(rules.map(sig)).size === 1;
    combineVerdict.set(name, {
      ok: plain && oneEach && same,
      first: ids.find((id) => rules.some((r) => r.category.id === id)) ?? ids[0],
      why: !oneEach ? "only some of the merged categories are scored" : !same ? "the merged categories score differently" : !plain ? "bonus/length rules on a merged key" : undefined,
    });
  }

  for (const g of groups) {
    for (const r of g.scoringRules ?? []) {
      const cat = r.category;
      const entry = FF_CATEGORIES[cat.id];
      const points = fd(r.points);
      const { positions, dropped, notes } = rulePositions(r);
      const bounds = ruleBounds(r);
      const m: RuleMapping = {
        group: g.label ?? "",
        categoryId: cat.id,
        category: `${cat.abbreviation ?? "?"} (${cat.nameSingular ?? "?"})`,
        description: r.description ?? "",
        points,
        status: "unmapped",
        keys: [],
        positions,
        droppedPositions: dropped,
        notes: [...notes],
        adjustments: [],
        shape: { isBonus: r.isBonus === true, multi: cat.multiValue === true, lo: bounds.lo, hi: bounds.hi, rate: ruleRate(r) },
      };
      const fail = (reason: string) => {
        m.status = "unmapped";
        m.notes.push(reason);
        unmapped.push({ platformKey: `${cat.id}:${cat.abbreviation ?? "?"}`, label: r.description ?? cat.nameSingular ?? "", points, reason });
        mappings.push(m);
      };
      if (!entry) {
        fail("category id not in the mapping table");
        continue;
      }
      if (entry.display) {
        fail("display-only category");
        continue;
      }
      if (cat.nameSingular !== undefined && cat.nameSingular !== entry.name) {
        fail(`name "${cat.nameSingular}" differs from the table ("${entry.name}")`);
        continue;
      }
      if (!positions.length && !dropped.length) {
        m.status = "inactive";
        m.notes.push("no applyTo and applyToAll is false: applies to no position in this league");
        mappings.push(m);
        continue;
      }
      if (!positions.length) {
        fail(`applies only to ${dropped.join("/")}, which has no model position`);
        continue;
      }
      const { lo, hi } = bounds;
      const multi = cat.multiValue === true;

      // Keys per player class, restricted to the classes the rule applies to. A class without a key
      // simply never records the stat (a WR has no sacks), unless the table says otherwise.
      const classes = [...new Set(positions.map((p) => CLASS_OF[p]))];
      const byClass = classes.map((c) => ({ c, keys: keysFor(entry, c, enabled), pos: positions.filter((p) => CLASS_OF[p] === c) }));
      const usable = byClass.filter((x) => x.keys.length > 0);
      // Rules for every position: add each distinct key once (classes can share a key, e.g. rec_td).
      const allKeys = [...new Set(usable.flatMap((u) => u.keys))];
      const partialClasses = entry.partial ? classes.filter((c) => entry.partial?.classes.includes(c)) : [];
      const extraUsed = entry.extra !== undefined && enabled(entry.extra.adj) && byClass.some((x) => x.keys.length > keysFor(entry, x.c, () => false).length);
      /** After a successful mapping: record adjustments and partial coverage. */
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
            bonuses.push({ stat: "gp", threshold: 1, points, positions: zeroPos });
            m.status = "tier";
            m.keys = ["gp"];
            m.notes.push(`definition adjustment: ${ADJUSTMENTS[zf.adj].label}: ${zeroPos.join("/")} always have 0 here, so the tier is +${points} per game played (gp ≥ 1)`);
          } else {
            m.status = "inactive";
            m.notes.push(`${zeroPos.join("/")} always have 0 for this punter-only stat, so the rule never scores for them`);
          }
          if (other.length) {
            m.status = "partial";
            m.notes.push(`no Sleeper key for ${other.map((x) => x.c).join("/")} players (${entry.note ?? "punter-only stat"})`);
          }
          if (dropped.length) m.notes.push(`${dropped.join("/")} not modeled`);
          mappings.push(m);
          continue;
        }
      }

      if (multi || entry.events) {
        const family = entry.events;
        if (!family) {
          fail(entry.note ?? "per-event distance rule with no Sleeper equivalent");
          continue;
        }
        if (r.isBonus) {
          const buckets = distanceKeys(family, lo, hi);
          if (!buckets) {
            fail(`distance range ${lo ?? 0}–${hi ?? "∞"} yds doesn't match Sleeper's buckets`);
            continue;
          }
          for (const b of buckets) addRate(b.key, points * b.weight, r.applyToAll ? "all" : positions);
          m.status = "distance";
          m.keys = buckets.map((b) => `${b.weight < 0 ? "-" : ""}${b.key}`);
        } else {
          // Per yard of each event: only FG distance has Sleeper totals (fgm_yds, fgm_yds_over_30).
          const rate = ruleRate(r);
          const key = family === "fgm" && lo === undefined && hi === undefined ? "fgm_yds" : family === "fgm" && lo === 30 && hi === undefined ? "fgm_yds_over_30" : null;
          if (!key) {
            fail(`per-yard rule on ${family} ${lo !== undefined ? `after yard ${lo}` : ""}${hi !== undefined ? ` up to ${hi}` : ""} has no Sleeper total`);
            continue;
          }
          addRate(key, rate, r.applyToAll ? "all" : positions);
          m.status = "distance";
          m.keys = [key];
        }
        mappings.push(m);
        continue;
      }

      if (!usable.length) {
        fail(entry.note ?? entry.partial?.note ?? `no Sleeper key for ${classes.join("/")} players`);
        continue;
      }

      if (entry.combine) {
        const v = combineVerdict.get(entry.combine);
        if (!v?.ok) {
          fail(`Sleeper merges kick and punt return TDs into ${allKeys.join("/")}; ${v?.why ?? "can't split them"}`);
          continue;
        }
        if (cat.id === v.first) {
          const rate = ruleRate(r);
          if (r.applyToAll) for (const k of allKeys) addRate(k, rate, "all");
          else for (const u of usable) for (const k of u.keys) addRate(k, rate, u.pos);
        }
        m.status = "per-unit";
        m.keys = allKeys;
        m.notes.push(`merged key (KR and PR TDs score the same; added once)${cat.id === v.first ? "" : ": rate already counted"}`);
        finish();
        continue;
      }

      if (r.isBonus) {
        // A bonus on a stat that sums several Sleeper keys reads their sum ("rec_fd+rec_td").
        for (const u of usable) {
          const b: Bonus = { stat: u.keys.join("+"), threshold: lo ?? NO_LOWER, points, positions: u.pos };
          if (hi !== undefined) b.max = hi;
          bonuses.push(b);
        }
        m.status = hi === undefined && lo !== undefined ? "bonus" : "tier";
        m.keys = [...new Set(usable.map((u) => u.keys.join("+")))];
        if (lo === undefined) m.notes.push("≤-only tier: needs a max (no lower bound) in Scoring.bonuses");
        else if (hi !== undefined) m.notes.push("bounded tier: needs a max in Scoring.bonuses (or two thresholds for whole-number stats)");
        if (m.keys.some((k) => k.includes("+"))) m.notes.push("bonus on a sum of Sleeper keys: Scoring.bonuses needs a composite stat");
      } else {
        if (lo !== undefined || hi !== undefined) {
          fail(`per-unit rule limited to totals ${lo ?? 0}–${hi ?? "∞"} (piecewise) can't be expressed`);
          continue;
        }
        const rate = ruleRate(r);
        if (r.applyToAll) for (const k of allKeys) addRate(k, rate, "all");
        else for (const u of usable) for (const k of u.keys) addRate(k, rate, u.pos);
        m.status = "per-unit";
        m.keys = allKeys;
      }
      finish();
    }
  }

  // Build perStat/byPosition: perStat holds rules for all positions; byPosition REPLACES the rate
  // for a position (CLAUDE.md §5), so it includes the all-position part.
  const perStat: Record<string, number> = {};
  const byPosition: ConvertedScoring["byPosition"] = {};
  for (const [k, v] of allRate) perStat[k] = round6(v);
  for (const [k, m] of posRate) {
    for (const [p, v] of m) {
      const total = round6((allRate.get(k) ?? 0) + v);
      (byPosition[p] ??= {})[k] = total;
    }
  }
  return { scoring: { perStat, byPosition, bonuses, unmapped }, mappings };
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/** Positions of a class (for reports). */
export function positionsOfClass(c: PlayerClass): Pos[] {
  return POS_OF_CLASS[c];
}

/** Summary counts by status. */
export function mappingCounts(mappings: readonly RuleMapping[]): Record<MapStatus, number> {
  const out: Record<MapStatus, number> = { "per-unit": 0, bonus: 0, tier: 0, distance: 0, partial: 0, unmapped: 0, inactive: 0 };
  for (const m of mappings) out[m.status]++;
  return out;
}

/** Canonical keys a converted scoring reads (to check they exist in Sleeper's stats); sums are split. */
export function scoringKeys(s: ConvertedScoring): string[] {
  const keys = new Set<string>(Object.keys(s.perStat));
  for (const rates of Object.values(s.byPosition)) for (const k of Object.keys(rates ?? {})) keys.add(k);
  for (const b of s.bonuses) for (const k of b.stat.split("+")) keys.add(k);
  return [...keys].sort();
}
