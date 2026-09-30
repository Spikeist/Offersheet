/**
 * MFL scoring rules (TYPE=rules) → the normalized Scoring (CLAUDE.md §5; planner reply to
 * Checkpoint 0, answer 4). Ported from the Phase 0 compiler (scripts/lib/mfl/rules.ts, oracle
 * 604/604) onto the extended Scoring model:
 *
 * - "*N" per unit          → a plain per-unit rate, or a bounded perUnit rule when the range doesn't
 *                             cover the stat's whole realistic line (e.g. "0-999" on yards: MFL gives
 *                             nothing for negative yards).
 * - "a/b" stepped          → a per-unit rate a/b when that is exact on the stat's grid ("1.5/0.5" on
 *                             half sacks is 3 per sack: every step lands on a grid point), else a
 *                             stepped rule (floor(total / b) × a, "1/10" on yards), plus a range
 *                             constant and a cancelling threshold when the range starts or ends inside
 *                             the line.
 * - "N" flat band          → a range rule (bands don't stack: 250 yds gets only the 200–999 band).
 * - "a/b" + thresholdPoints → range (the threshold points) + a per-unit or stepped rule from the range low.
 * - per-play length rules  → Sleeper's TD length keys (*_td_40p/_50p) or FG distance buckets.
 * - several stats summed   → a composite stat ({ sum: [...] }).
 * - overlapping position groups add up (MFL help FAQ 7).
 *
 * Every translation is verified numerically: the model rules are evaluated with the engine's own
 * rulePoints() on the stat's realistic value grid and must equal MFL's semantics at every point.
 * Anything that can't be expressed exactly lands in scoring.unmapped with its reason and a warning.
 * Pure: no I/O.
 */
import type { ImportWarning, Pos, Scoring, ScoringRule, StatExpr } from "@/engine/model";
import { POSITIONS } from "@/engine/model";
import { rulePoints } from "@/engine/scoring";
import { MERGE_PREFERENCE, MFL_IDP_POSITIONS, MFL_POS, unsupportedReason } from "./positions";
import { describeRule, mflRuleValue, parseMflRules, type MflRule } from "./rules";

export type LengthFamily = "pass_td" | "rush_td" | "rec_td" | "fgm" | "fgmiss" | "pass_int_td" | "pr_td" | "kr_td" | "fum_rec_td" | "def_td";

/** Which Sleeper keys an MFL position reads: offense, kickers and punters; individual defenders; team defense. */
export type KeyClass = "off" | "idp" | "def";

export interface MflEventMap {
  /** "total": the range is tested against the per-game total; "length": once per play, against its length. */
  kind: "total" | "length";
  /** Sleeper keys for offense, kickers and punters (QB RB WR TE PK PN). Several keys = their sum. */
  off?: string[];
  /** Sleeper keys for individual defensive players (DT DE LB CB S). */
  idp?: string[];
  /** Sleeper keys for team defense (Def). */
  def?: string[];
  family?: LengthFamily;
  /** MFL's value = scale × the Sleeper stat (AS2: MFL scores assists ÷ 2). */
  scale?: number;
  /** Realistic per-game range of the Sleeper stat: the grid every translation is verified on. */
  min?: number;
  max?: number;
  /** Grid step: individual sacks come in halves. */
  step?: number;
  /** Why the mapping is only approximate (shown in the Import Report): for every class, or per class. */
  approx?: string | Partial<Record<KeyClass, string>>;
  /**
   * Sleeper counts this event together with other MFL event types (defensive TDs, blocked kicks,
   * return TDs). Exact when every merged type scores the same; checked after all rules.
   */
  merged?: boolean;
}

/** Sleeper's player key for kick and punt return TDs together (Sleeper fills no pr_td / kr_td on player rows). */
const PLAYER_RETURN_TD = "st_td";
const OFF_FUMBLE_PLAYS = "an offensive player's forced fumbles and recoveries (after a turnover or on special teams) are read from Sleeper's defensive keys; no MFL league scoring them for offense was checked";
const DEF_UNVERIFIED = "unverified: no MFL league with a team defense was checked";

/**
 * MFL rule codes (TYPE=allRules abbreviations) → canonical Sleeper keys. Codes not listed are
 * reported as unmapped with their points (never dropped silently). sleeperKeys.test.ts checks that
 * every key appears on committed Sleeper rows of its class and lists the rare-event keys that don't.
 *
 * Definitions from MFL's allRules (fixtures/sanitized/mfl, TYPE=allRules):
 * - FC = fumbles recovered from the opponent, "on defense or special teams" (own-team recoveries are
 *   OFC). Sleeper keeps special-teams recoveries apart: st_fum_rec for players (every weeks 1–3 row
 *   with st_fum_rec has idp_fum_rec 0), def_st_fum_rec for a team (5 of 7 rows have fum_rec 0).
 * - FF = forced fumbles by the player. Sleeper's idp_ff already counts special-teams ones (every
 *   weeks 1–3 row with st_ff has idp_ff ≥ st_ff), so st_ff is not added.
 * - #UT / #KT = punt / kickoff return TDs: Sleeper's player key is st_td for both (0 of 6,848 player
 *   rows in weeks 1–3 carry pr_td or kr_td; player projections carry pr_td / def_kr_td, which the
 *   Sleeper adapter normalizes to st_td).
 */
export const MFL_EVENTS: Readonly<Record<string, MflEventMap>> = {
  // Passing
  "#P": { kind: "total", off: ["pass_td"], max: 10 },
  PS: { kind: "length", family: "pass_td" },
  PY: { kind: "total", off: ["pass_yd"], min: -30, max: 600 },
  PA: { kind: "total", off: ["pass_att"], max: 80 },
  PC: { kind: "total", off: ["pass_cmp"], max: 60 },
  INC: { kind: "total", off: ["pass_inc"], max: 60 },
  IN: { kind: "total", off: ["pass_int"], max: 8 },
  "#IT": { kind: "total", off: ["pass_int_td"], max: 5 },
  IT: { kind: "length", family: "pass_int_td" },
  TSK: { kind: "total", off: ["pass_sack"], max: 15 },
  TSY: { kind: "total", off: ["pass_sack_yds"], max: 150 },
  P40: { kind: "total", off: ["pass_cmp_40p"], max: 10 },
  P2: { kind: "total", off: ["pass_2pt"], max: 5 },
  // Rushing
  "#R": { kind: "total", off: ["rush_td"], max: 8 },
  RS: { kind: "length", family: "rush_td" },
  RY: { kind: "total", off: ["rush_yd"], min: -30, max: 400 },
  RA: { kind: "total", off: ["rush_att"], max: 50 },
  R40: { kind: "total", off: ["rush_40p"], max: 5 },
  R2: { kind: "total", off: ["rush_2pt"], max: 5 },
  // Receiving
  "#C": { kind: "total", off: ["rec_td"], max: 6 },
  RC: { kind: "length", family: "rec_td" },
  CY: { kind: "total", off: ["rec_yd"], min: -20, max: 400 },
  CC: { kind: "total", off: ["rec"], max: 25 },
  TGT: { kind: "total", off: ["rec_tgt"], max: 30 },
  C20: { kind: "total", off: ["rec_20_29", "rec_30_39", "rec_40p"], max: 10 },
  C40: { kind: "total", off: ["rec_40p"], max: 5 },
  C2: { kind: "total", off: ["rec_2pt"], max: 5 },
  RCY: { kind: "total", off: ["rush_rec_yd"], min: -30, max: 500 },
  PRY: { kind: "total", off: ["pass_rush_yd"], min: -30, max: 700 },
  TYS: { kind: "total", off: ["pass_yd", "rush_yd", "rec_yd"], min: -30, max: 800 },
  TY: { kind: "total", off: ["pass_yd", "rush_yd", "rec_yd", "pr_yd", "kr_yd"], min: -30, max: 900 },
  FD: { kind: "total", off: ["pass_fd", "rush_fd", "rec_fd"], max: 30 },
  "1P": { kind: "total", off: ["pass_fd"], max: 30 },
  "1R": { kind: "total", off: ["rush_fd"], max: 20 },
  "1C": { kind: "total", off: ["rec_fd"], max: 20 },
  // Kicking
  "#F": { kind: "total", off: ["fgm"], max: 8 },
  FG: { kind: "length", family: "fgm" },
  "#M": { kind: "total", off: ["fgmiss"], max: 6 },
  MG: { kind: "length", family: "fgmiss" },
  "#A": { kind: "total", off: ["fga"], max: 8 },
  HBF: { kind: "total", off: ["fg_blkd"], max: 3 },
  EP: { kind: "total", off: ["xpm"], max: 10 },
  EM: { kind: "total", off: ["xpmiss"], max: 5 },
  EA: { kind: "total", off: ["xpa"], max: 10 },
  HBE: { kind: "total", off: ["xp_blkd"], max: 3 },
  // Punting and returns
  "#N": { kind: "total", off: ["punts"], max: 15 },
  PNY: { kind: "total", off: ["punt_yds"], max: 800 },
  PI: { kind: "total", off: ["punt_in_20"], max: 10 },
  "#UT": { kind: "total", off: [PLAYER_RETURN_TD], def: ["def_st_td"], max: 3, merged: true },
  PR: { kind: "length", family: "pr_td", merged: true },
  "#U": { kind: "total", off: ["pr"], max: 10 },
  UY: { kind: "total", off: ["pr_yd"], min: -20, max: 300 },
  "#KT": { kind: "total", off: [PLAYER_RETURN_TD], def: ["def_st_td"], max: 3, merged: true },
  KO: { kind: "length", family: "kr_td", merged: true },
  "#K": { kind: "total", off: ["kr"], max: 10 },
  KY: { kind: "total", off: ["kr_yd"], max: 400 },
  // Fumbles
  FU: { kind: "total", off: ["fum"], max: 5 },
  FL: { kind: "total", off: ["fum_lost"], max: 5 },
  FLO: { kind: "total", off: ["fum_lost"], max: 5, approx: "Sleeper's fum_lost also counts special-teams fumbles" },
  "#FR": { kind: "total", off: ["fum_rec_td"], max: 3 },
  FR: { kind: "length", family: "fum_rec_td" },
  FC: {
    kind: "total",
    off: ["idp_fum_rec", "st_fum_rec"],
    idp: ["idp_fum_rec", "st_fum_rec"],
    def: ["fum_rec", "def_st_fum_rec"],
    max: 5,
    approx: { off: OFF_FUMBLE_PLAYS, def: DEF_UNVERIFIED },
  },
  FCY: { kind: "total", idp: ["idp_fum_ret_yd"], def: ["fum_ret_yd"], max: 200 },
  FF: {
    kind: "total",
    off: ["idp_ff"],
    idp: ["idp_ff"],
    def: ["ff"],
    max: 5,
    approx: { off: OFF_FUMBLE_PLAYS, def: `${DEF_UNVERIFIED} (Sleeper keeps a team's special-teams forced fumbles apart, in def_st_ff)` },
  },
  // Defense (IDP and team)
  "#DR": { kind: "total", idp: ["idp_def_td"], def: ["def_td"], max: 3, merged: true },
  DR: { kind: "length", family: "def_td", merged: true },
  "#IR": { kind: "total", idp: ["idp_def_td"], def: ["def_td"], max: 3, merged: true },
  IR: { kind: "length", family: "def_td", merged: true },
  "#D": { kind: "total", idp: ["idp_def_td"], def: ["def_td"], max: 3, merged: true },
  DD: { kind: "length", family: "def_td", merged: true },
  "#T": { kind: "total", idp: ["idp_def_td"], def: ["def_td", "def_st_td"], max: 3, merged: true },
  TT: { kind: "length", family: "def_td", merged: true, approx: "team DEF: special-teams TDs are separate in Sleeper (def_st_td)" },
  "#BF": { kind: "total", idp: ["idp_def_td"], def: ["def_st_td"], max: 2, merged: true },
  BF: { kind: "length", family: "def_td", merged: true },
  "#MF": { kind: "total", idp: ["idp_def_td"], def: ["def_st_td"], max: 2, merged: true },
  MF: { kind: "length", family: "def_td", merged: true },
  "#BP": { kind: "total", idp: ["idp_def_td"], def: ["def_st_td"], max: 2, merged: true },
  BP: { kind: "length", family: "def_td", merged: true },
  IC: { kind: "total", idp: ["idp_int"], def: ["int"], max: 5 },
  ICY: { kind: "total", idp: ["idp_int_ret_yd"], def: ["int_ret_yd"], max: 300 },
  PD: { kind: "total", idp: ["idp_pass_def"], def: ["def_pass_def"], max: 10 },
  BLF: { kind: "total", idp: ["idp_blk_kick"], def: ["blk_kick"], max: 3, merged: true },
  BLP: { kind: "total", idp: ["idp_blk_kick"], def: ["blk_kick"], max: 3, merged: true },
  BLE: { kind: "total", idp: ["idp_blk_kick"], def: ["blk_kick"], max: 3, merged: true },
  TKD: { kind: "total", idp: ["idp_tkl_solo"], max: 30 },
  ASD: { kind: "total", idp: ["idp_tkl_ast"], max: 30 },
  TK: { kind: "total", idp: ["idp_tkl_solo"], max: 30, approx: "MFL's TK also counts offensive and special-teams tackles" },
  AS: { kind: "total", idp: ["idp_tkl_ast"], max: 30, approx: "MFL's AS also counts offensive and special-teams assists" },
  AS2: { kind: "total", idp: ["idp_tkl_ast"], scale: 0.5, max: 30 },
  SK: { kind: "total", idp: ["idp_sack"], def: ["sack"], max: 10, step: 0.5 },
  SKY: { kind: "total", idp: ["idp_sack_yd"], def: ["sack_yd"], max: 100, step: 0.5 },
  QH: { kind: "total", idp: ["idp_qb_hit"], def: ["qb_hit"], max: 10 },
  TKL: { kind: "total", idp: ["idp_tkl_loss"], def: ["tkl_loss"], max: 10 },
  SF: { kind: "total", idp: ["idp_safe"], def: ["safe"], max: 3 },
  // Team defense: points and yards allowed (Sleeper pts_allow / yds_allow totals, scored with range rules).
  TPA: { kind: "total", def: ["pts_allow"], max: 80, approx: `${DEF_UNVERIFIED} (does MFL's points allowed match Sleeper's pts_allow?)` },
  TYA: { kind: "total", def: ["yds_allow"], min: -20, max: 900, approx: DEF_UNVERIFIED },
};

/** Sleeper field-goal distance buckets (fgm_<suffix>, fgmiss_<suffix>). Lengths below 18 can't happen. */
export const FG_BUCKETS: ReadonlyArray<readonly [number, number, string]> = [
  [18, 19, "0_19"],
  [20, 29, "20_29"],
  [30, 39, "30_39"],
  [40, 49, "40_49"],
  [50, 59, "50_59"],
  [60, 70, "60p"],
];
/** Sleeper's TD length keys: *_td_40p, *_td_50p. */
export const TD_BONUS_BREAKS = [40, 50] as const;
/** Length families whose Sleeper keys exist only for offensive players and kickers. */
const OFFENSIVE_FAMILIES: ReadonlySet<LengthFamily> = new Set(["pass_td", "rush_td", "rec_td", "fgm", "fgmiss"]);

/**
 * Sleeper keys that count the union of several distinct MFL events (a pick-six and a fumble-return
 * TD are both idp_def_td; a kickoff and a punt return TD are both st_td). Summing their rates would
 * double-count, so the per-play value is used.
 */
export const MERGED_KEYS: ReadonlySet<string> = new Set(["idp_def_td", "def_td", "def_st_td", "idp_blk_kick", "blk_kick", PLAYER_RETURN_TD]);
/** MFL events that already count every defensive (and special-teams) TD type. */
const AGGREGATE_EVENTS: ReadonlySet<string> = new Set(["#D", "#T", "DD", "TT"]);
/**
 * A count rule and a length rule for the same kind of play ("#IR" and "IR": both score each pick-six)
 * are one event type: MFL adds their points on that play. Other merged events are their own type.
 */
const EVENT_TYPE: Readonly<Record<string, string>> = {
  "#IR": "interception return TD",
  IR: "interception return TD",
  "#DR": "fumble return TD",
  DR: "fumble return TD",
  "#BF": "blocked field goal TD",
  BF: "blocked field goal TD",
  "#MF": "missed field goal return TD",
  MF: "missed field goal return TD",
  "#BP": "blocked punt TD",
  BP: "blocked punt TD",
  "#UT": "punt return TD",
  PR: "punt return TD",
  "#KT": "kickoff return TD",
  KO: "kickoff return TD",
  "#D": "defensive TD",
  DD: "defensive TD",
  "#T": "defensive or special-teams TD",
  TT: "defensive or special-teams TD",
};
const eventType = (event: string) => EVENT_TYPE[event] ?? event;
/**
 * Every event type a merged key counts, where that is known: a type the league doesn't score would
 * still earn the key's points (a punt return TD in a league that scores only kickoff return TDs).
 */
const MERGED_TYPES: Readonly<Record<string, readonly string[]>> = { [PLAYER_RETURN_TD]: ["kickoff return TD", "punt return TD"] };

const SIMPLE_FAMILY_KEY: Readonly<Record<string, { off?: string; idp?: string; def?: string }>> = {
  pass_int_td: { off: "pass_int_td" },
  pr_td: { off: PLAYER_RETURN_TD },
  kr_td: { off: PLAYER_RETURN_TD },
  fum_rec_td: { off: "fum_rec_td" },
  def_td: { idp: "idp_def_td", def: "def_td" },
};

// ---------------------------------------------------------------------------------------------
// Output types

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A scoring rule before positions are attached. */
export type RuleNoPos = DistributiveOmit<ScoringRule, "positions">;

export type MflMappingStatus = "mapped" | "approximate" | "unmapped";

export interface MflRuleMapping {
  /** JSON path in the TYPE=rules body. */
  path: string;
  /** The rule as MFL shows it: "QB|RB|WR|TE: PY -50-999 *.04". */
  rule: string;
  event: string;
  /** MFL positions this record covers (a rule can map differently per position). */
  positions: string[];
  status: MflMappingStatus;
  /** What it became ("pass_yd ×0.04", "stepped rush_yd: 1 per 10") or why it couldn't map. */
  detail: string;
}

export interface MflScoringResult {
  scoring: Scoring;
  mappings: MflRuleMapping[];
  warnings: ImportWarning[];
  /** MFL positions with rules behind each model position (DT/DE → DL …). */
  positions: Partial<Record<Pos, string[]>>;
}

// ---------------------------------------------------------------------------------------------
// Helpers

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6;

function grid(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let i = 0; ; i++) {
    const v = round6(lo + i * step);
    if (v > hi + 1e-9) break;
    out.push(v);
  }
  return out;
}

/** Constant value of f over the integers [lo, hi], or undefined if it varies. */
function constantOn(f: (v: number) => number, lo: number, hi: number): number | undefined {
  const first = f(lo);
  for (let v = lo + 1; v <= hi; v++) if (!eq(f(v), first)) return undefined;
  return first;
}

const fmt = (x: number) => String(round6(x));
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const statText = (s: StatExpr) => (typeof s === "string" ? s : s.sum.join("+"));

/** One-line description of a model rule (mapping details and warnings). */
export function describePiece(r: RuleNoPos): string {
  const bounds = (min?: number, max?: number) => (min !== undefined && max !== undefined ? `${fmt(min)}–${fmt(max)}` : min !== undefined ? `≥ ${fmt(min)}` : max !== undefined ? `≤ ${fmt(max)}` : "any");
  switch (r.kind) {
    case "perGame":
      return `${fmt(r.points)} per game`;
    case "threshold":
      return `${fmt(r.points)} when ${statText(r.stat)} ≥ ${fmt(r.min)}`;
    case "range":
      return `${fmt(r.points)} when ${statText(r.stat)} ${bounds(r.min, r.max)}`;
    case "perUnit":
      return `${statText(r.stat)} ×${fmt(r.points)}${r.min !== undefined || r.max !== undefined ? ` when ${bounds(r.min, r.max)}` : ""}`;
    case "stepped":
      return `stepped ${statText(r.stat)}: ${fmt(r.points)} per ${fmt(r.every)}${r.min !== undefined ? ` from ${fmt(r.min)}` : ""}${r.max !== undefined ? ` up to ${fmt(r.max)}` : ""}`;
  }
}

function numericPoints(r: MflRule): number {
  const p = r.points;
  switch (p.kind) {
    case "each":
    case "flat":
      return p.n;
    case "every":
      return p.a;
    case "formula":
      return p.threshold;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Translating one per-game ("total") rule

/** One MFL rule in model terms. */
export interface Translation {
  /** A plain per-unit rate on every key of the stat. */
  rate?: number;
  rules: RuleNoPos[];
}

interface Grid {
  xs: number[];
  min: number;
  max: number;
}

/** Sum of a candidate's points for Sleeper-stat value x (the whole value on the first key). */
function candidateValue(t: Translation, stat: StatExpr, x: number): number {
  const key = typeof stat === "string" ? stat : (stat.sum[0] as string);
  const line = { [key]: x, gp: 1 };
  let total = (t.rate ?? 0) * x;
  for (const r of t.rules) total += rulePoints(r as ScoringRule, line);
  return total;
}

/** Drop pieces that can never score (a cancelling threshold of 0 points …). */
const scoring = (rules: RuleNoPos[]): RuleNoPos[] => rules.filter((r) => r.points !== 0);

function verifies(t: Translation, stat: StatExpr, g: Grid, truth: (x: number) => number): boolean {
  return g.xs.every((x) => Math.abs(candidateValue(t, stat, x) - truth(x)) < 1e-6);
}

/**
 * Candidate translations of one MFL rule in Sleeper-stat units, simplest first; the first one that
 * reproduces MFL's semantics on the whole grid wins.
 */
function candidates(r: MflRule, stat: StatExpr, scale: number, g: Grid): Translation[] {
  const lo = round6(r.lo / scale);
  const hi = round6(r.hi / scale);
  const lower = lo > g.min + 1e-9 ? lo : undefined;
  const upper = hi < g.max - 1e-9 ? hi : undefined;
  const bounds = { ...(lower !== undefined ? { min: lower } : {}), ...(upper !== undefined ? { max: upper } : {}) };
  /** The first grid value above the range (for thresholds that cancel a capped stepped count). */
  const above = g.xs.find((x) => x > hi + 1e-9);
  /** A per-unit rate: plain when that's exact everywhere, else only inside the range. */
  const perUnit = (n: number): Translation[] => [{ rate: n, rules: [] }, { rules: [{ kind: "perUnit", stat, points: n, ...bounds }] }];
  const p = r.points;
  const out: Translation[] = [];
  switch (p.kind) {
    case "each":
      out.push(...perUnit(round6(p.n * scale)));
      break;
    case "flat":
      out.push({ rules: p.n === 0 ? [] : [{ kind: "range", stat, points: p.n, ...bounds }] });
      break;
    case "every": {
      const every = round6(p.b / scale);
      // Exactly linear when every step lands on a grid point ("1.5/0.5" on half sacks = 3 per
      // sack): a per-unit rate, whose expected value is exact. The grid check rejects true steps
      // ("1/10" yards: 128 yards is 12, not 12.8), which fall through to the stepped forms.
      out.push(...perUnit(round6(p.a / every)));
      const cap = (from: number) => (upper !== undefined && above !== undefined ? [{ kind: "threshold" as const, stat, min: above, points: round6(-p.a * Math.floor((hi - from) / every + 1e-9)) }] : []);
      const stepped = (from: number): RuleNoPos => ({ kind: "stepped", stat, every, points: p.a, ...(from !== 0 ? { min: from } : {}), ...(upper !== undefined ? { max: upper } : {}) });
      out.push({ rules: [stepped(0), ...cap(0)] });
      // Counted from 0 but only inside [lo, hi]: step from the multiple of b at or below lo, plus
      // the points already earned there once the range is reached.
      const m = round6(Math.floor(lo / every + 1e-9) * every);
      const base = round6((p.a * m) / every);
      out.push({ rules: [...(base !== 0 ? [{ kind: "range" as const, stat, points: base, min: lo, ...(upper !== undefined ? { max: upper } : {}) }] : []), stepped(m), ...cap(m)] });
      break;
    }
    case "formula": {
      const every = round6(p.b / scale);
      /** A constant for reaching the range low (inside the range). */
      const reach = (points: number): RuleNoPos[] => (points !== 0 ? [{ kind: "range", stat, points, min: lo, ...(upper !== undefined ? { max: upper } : {}) }] : []);
      // threshold + a per b beyond lo is linear on the grid when every step lands on a grid point:
      // (threshold − rate·lo) on reaching lo, plus rate per unit inside the range.
      const rate = round6(p.a / every);
      const offset = round6(p.threshold - rate * lo);
      if (offset === 0) out.push(...perUnit(rate));
      else out.push({ rules: [...reach(offset), { kind: "perUnit", stat, points: rate, ...bounds }] });
      out.push({
        rules: [
          ...reach(p.threshold),
          { kind: "stepped", stat, every, points: p.a, min: lo, ...(upper !== undefined ? { max: upper } : {}) },
          ...(upper !== undefined && above !== undefined ? [{ kind: "threshold" as const, stat, min: above, points: round6(-p.a * Math.floor((hi - lo) / every + 1e-9)) }] : []),
        ],
      });
      break;
    }
    default:
      break;
  }
  return out.map((t) => ({ ...t, rules: scoring(t.rules) }));
}

export function translateTotalRule(r: MflRule, stat: StatExpr, ev: MflEventMap): Translation | undefined {
  const scale = ev.scale ?? 1;
  const min = ev.min ?? 0;
  const max = ev.max ?? 20;
  const g: Grid = { xs: grid(min, max, ev.step ?? 1), min, max };
  const truth = (x: number) => mflRuleValue(r, scale * x);
  if (g.xs.some((x) => !Number.isFinite(truth(x)))) return undefined;
  return candidates(r, stat, scale, g).find((t) => verifies(t, stat, g, truth));
}

// ---------------------------------------------------------------------------------------------
// Compiling one MFL position

interface PositionCompile {
  mflPos: string;
  rates: Record<string, number>;
  rules: RuleNoPos[];
  mappings: MflRuleMapping[];
  /** Contributions to MERGED_KEYS, by MFL event, before folding into rates. */
  shared: Record<string, Record<string, number>>;
}

function note(c: PositionCompile, rows: MflRule[], status: MflMappingStatus, detail: string): void {
  for (const r of rows) c.mappings.push({ path: r.path, rule: describeRule(r), event: r.event, positions: [c.mflPos], status, detail });
}

function addRate(c: PositionCompile, key: string, rate: number, event: string): void {
  if (eq(rate, 0)) return;
  if (MERGED_KEYS.has(key)) {
    const byEvent = (c.shared[key] ??= {});
    byEvent[event] = round6((byEvent[event] ?? 0) + rate);
    return;
  }
  c.rates[key] = round6((c.rates[key] ?? 0) + rate);
}

export function keyClassOf(mflPos: string): KeyClass {
  if (mflPos === "Def") return "def";
  if (MFL_IDP_POSITIONS.has(mflPos)) return "idp";
  return "off";
}

function keysFor(ev: MflEventMap, mflPos: string): string[] | undefined {
  return ev[keyClassOf(mflPos)];
}

/** Why an event's mapping is only approximate at this MFL position (undefined = exact). */
function approxFor(ev: MflEventMap, mflPos: string): string | undefined {
  return typeof ev.approx === "string" ? ev.approx : ev.approx?.[keyClassOf(mflPos)];
}

function compileTotal(c: PositionCompile, ev: MflEventMap, keys: string[], rows: MflRule[], event: string): void {
  const stat: StatExpr = keys.length === 1 ? (keys[0] as string) : { sum: [...keys] };
  const merged = keys.some((k) => MERGED_KEYS.has(k));
  for (const r of rows) {
    const t = translateTotalRule(r, stat, ev);
    if (!t) {
      note(c, [r], "unmapped", "can't be expressed exactly with the scoring model");
      continue;
    }
    if (merged && t.rules.length) {
      note(c, [r], "unmapped", `range or stepped rule on ${statText(stat)}, which Sleeper shares with other event types`);
      continue;
    }
    if (t.rate !== undefined) for (const k of keys) addRate(c, k, t.rate, event);
    c.rules.push(...t.rules);
    const parts = [...(t.rate !== undefined ? [`${statText(stat)} ×${fmt(t.rate)}`] : []), ...t.rules.map(describePiece)];
    const detail = `→ ${parts.join("; ") || "no points"}${merged ? " (Sleeper key shared with other event types; checked after all rules)" : ""}`;
    const approx = approxFor(ev, c.mflPos);
    if (approx) note(c, [r], "approximate", `${detail}; ${approx}`);
    else note(c, [r], "mapped", detail);
  }
}

/** Per-play length rules: Sleeper's TD length keys or FG distance buckets. */
function compileLength(c: PositionCompile, ev: MflEventMap, rows: MflRule[], event: string): void {
  const f = (len: number) => rows.reduce((s, r) => s + mflRuleValue(r, len), 0);
  const fam = ev.family as LengthFamily;
  const kind = keyClassOf(c.mflPos);
  const approx = approxFor(ev, c.mflPos);
  const done = (to: string) => (approx ? note(c, rows, "approximate", `→ ${to}; ${approx}`) : note(c, rows, "mapped", `→ ${to}${ev.merged ? " (Sleeper key shared with other event types; checked after all rules)" : ""}`));
  const where = kind === "off" ? "player" : kind === "idp" ? "defensive player" : "team defense";
  if (kind !== "off" && OFFENSIVE_FAMILIES.has(fam)) {
    // Sleeper fills passing/rushing/receiving TD and field-goal keys only on offensive and kicker rows.
    note(c, rows, "unmapped", `no Sleeper key for this rule at a ${where} position`);
    return;
  }
  if (fam === "pass_td" || fam === "rush_td" || fam === "rec_td") {
    const [b40, b50] = TD_BONUS_BREAKS;
    const base = constantOn(f, 1, b40 - 1);
    const p40 = constantOn(f, b40, b50 - 1);
    const p50 = constantOn(f, b50, 99);
    if (base === undefined || p40 === undefined || p50 === undefined) {
      note(c, rows, "unmapped", "points vary inside Sleeper's TD length buckets (1–39, 40–49, 50+ yards)");
      return;
    }
    addRate(c, fam, base, event);
    addRate(c, `${fam}_40p`, p40 - base, event);
    addRate(c, `${fam}_50p`, p50 - p40, event);
    done(`${fam} ${fmt(base)} per TD${!eq(p40, base) ? `, ${fam}_40p +${fmt(p40 - base)}` : ""}${!eq(p50, p40) ? `, ${fam}_50p +${fmt(p50 - p40)}` : ""}`);
    return;
  }
  if (fam === "fgm" || fam === "fgmiss") {
    const all = constantOn(f, 18, 70);
    if (all !== undefined) {
      addRate(c, fam, all, event);
      done(`${fam} ${fmt(all)} (every distance)`);
      return;
    }
    const vals = FG_BUCKETS.map(([lo, hi, suffix]) => ({ suffix, v: constantOn(f, lo, hi) }));
    if (vals.every((x) => x.v !== undefined)) {
      const v5059 = vals[4]?.v as number;
      const v60 = vals[5]?.v as number;
      for (const x of vals.slice(0, 4)) addRate(c, `${fam}_${x.suffix}`, x.v as number, event);
      if (eq(v5059, v60)) addRate(c, `${fam}_50p`, v5059, event);
      else {
        addRate(c, `${fam}_50_59`, v5059, event);
        addRate(c, `${fam}_60p`, v60, event);
      }
      done(`${fam} distance buckets ${vals.map((x) => `${x.suffix}:${fmt(x.v as number)}`).join(" ")}`);
      return;
    }
    if (fam === "fgm") {
      const slope = f(41) - f(40);
      const intercept = f(40) - slope * 40;
      if (grid(18, 70, 1).every((len) => eq(f(len), slope * len + intercept))) {
        addRate(c, "fgm_yds", slope, event);
        addRate(c, "fgm", intercept, event);
        done(`fgm_yds ×${fmt(slope)}${!eq(intercept, 0) ? ` + fgm ${fmt(intercept)}` : ""}`);
        return;
      }
    }
    note(c, rows, "unmapped", "points vary inside Sleeper's FG distance buckets (0–19, 20–29, 30–39, 40–49, 50–59, 60+)");
    return;
  }
  const key = SIMPLE_FAMILY_KEY[fam]?.[kind];
  if (!key) {
    note(c, rows, "unmapped", `no Sleeper key for this rule at a ${where} position`);
    return;
  }
  const v = constantOn(f, 1, 99);
  if (v === undefined) {
    note(c, rows, "unmapped", "points depend on the play's length; Sleeper has no length key for it");
    return;
  }
  addRate(c, key, v, event);
  done(`${key} ${fmt(v)} per TD`);
}

function compilePosition(rules: MflRule[], mflPos: string): PositionCompile {
  const c: PositionCompile = { mflPos, rates: {}, rules: [], mappings: [], shared: {} };
  const byEvent = new Map<string, MflRule[]>();
  for (const r of rules) if (r.positions.includes(mflPos)) byEvent.set(r.event, [...(byEvent.get(r.event) ?? []), r]);
  for (const [event, rows] of byEvent) {
    const ev = MFL_EVENTS[event];
    if (!ev) {
      note(c, rows, "unmapped", "no Sleeper stat key for this MFL rule code");
      continue;
    }
    if (rows.some((r) => r.points.kind === "unknown" || !Number.isFinite(r.lo))) {
      note(c, rows, "unmapped", "range or points format not recognized");
      continue;
    }
    const options = [...new Set(rows.flatMap((r) => Object.keys(r.extra)))];
    if (options.length) {
      note(c, rows, "unmapped", `extra rule options (${options.join(", ")}): conditional scoring isn't modeled`);
      continue;
    }
    if (ev.kind === "length") {
      compileLength(c, ev, rows, event);
      continue;
    }
    const keys = keysFor(ev, mflPos);
    if (!keys?.length) note(c, rows, "unmapped", `no Sleeper key for this rule at MFL position ${mflPos}`);
    else compileTotal(c, ev, keys, rows, event);
  }
  // Merged keys: one per-play value. A count rule and a length rule for the same kind of play add up
  // (MFL scores both on that play); different type-specific rules (pick-six, fumble-return TD,
  // blocked FG, punt or kickoff return TD …) are exact when they all score the same and, where the
  // key's types are known (st_td), every type is scored; an all-TD rule (#D, #T) is added on top, as
  // MFL does.
  for (const [key, byEv] of Object.entries(c.shared)) {
    const byType = new Map<string, { value: number; aggregate: boolean }>();
    for (const [e, v] of Object.entries(byEv)) {
      const t = byType.get(eventType(e));
      byType.set(eventType(e), { value: round6((t?.value ?? 0) + v), aggregate: AGGREGATE_EVENTS.has(e) });
    }
    const typed = [...byType.values()];
    const agg = typed.filter((t) => t.aggregate).map((t) => t.value);
    const spec = typed.filter((t) => !t.aggregate).map((t) => t.value);
    const aggTop = agg.length ? Math.max(...agg) : 0;
    const specTop = spec.length ? Math.max(...spec) : 0;
    c.rates[key] = round6((c.rates[key] ?? 0) + aggTop + specTop);
    const why: string[] = [];
    if (!spec.every((v) => eq(v, specTop))) why.push("the league scores these event types differently but Sleeper merges them (the highest is used)");
    if (agg.length && spec.length) why.push("an all-TD rule and type-specific rules both apply (MFL adds them); types without a specific rule get only the all-TD points");
    const unscored = agg.length ? [] : (MERGED_TYPES[key] ?? []).filter((t) => !byType.has(t));
    if (unscored.length) why.push(`Sleeper's ${key} also counts ${unscored.map((t) => `${t}s`).join(" and ")}, which the league doesn't score here, so they get the same points`);
    if (why.length) {
      const events = new Set(Object.keys(byEv));
      for (const m of c.mappings) {
        if (m.status === "mapped" && events.has(m.event)) {
          m.status = "approximate";
          m.detail = `${m.detail}; ${key} ${fmt(aggTop + specTop)}: ${why.join("; ")}`;
        }
      }
    }
  }
  return c;
}

// ---------------------------------------------------------------------------------------------
// Assembling the Scoring

const signature = (c: PositionCompile) => JSON.stringify({ rates: Object.entries(c.rates).sort(), rules: c.rules });

function collapseMappings(mappings: MflRuleMapping[]): MflRuleMapping[] {
  const out = new Map<string, MflRuleMapping>();
  for (const m of mappings) {
    const key = `${m.path}\u0000${m.status}\u0000${m.detail}`;
    const prev = out.get(key);
    if (prev) prev.positions = [...new Set([...prev.positions, ...m.positions])];
    else out.set(key, { ...m, positions: [...m.positions] });
  }
  return [...out.values()];
}

/** Compile parsed MFL rules into the normalized Scoring. */
export function compileMflScoring(rules: MflRule[]): MflScoringResult {
  const warnings: ImportWarning[] = [];
  const mappings: MflRuleMapping[] = [];
  const mflPositions = [...new Set(rules.flatMap((r) => r.positions))];

  // Positions the model can't hold (Coach = HC, team units): their rules are unmapped.
  for (const p of mflPositions.filter((x) => !MFL_POS[x])) {
    const rows = rules.filter((r) => r.positions.includes(p));
    for (const r of rows) mappings.push({ path: r.path, rule: describeRule(r), event: r.event, positions: [p], status: "unmapped", detail: `MFL position ${p}: ${unsupportedReason(p)}` });
    warnings.push({ code: "SCORING_POSITION_UNSUPPORTED", message: `MFL scores position ${p} (${rows.length} rule${rows.length === 1 ? "" : "s"}), but ${unsupportedReason(p)}; those rules are not used.`, platformPath: rows[0]?.path });
  }

  const compiled = new Map<string, PositionCompile>();
  for (const p of mflPositions) if (MFL_POS[p]) compiled.set(p, compilePosition(rules, p));
  for (const c of compiled.values()) mappings.push(...c.mappings);

  // Model positions: DT/DE → DL and CB/S → DB can hold only one set of rates.
  const byModel = new Map<Pos, PositionCompile>();
  const sources: Partial<Record<Pos, string[]>> = {};
  for (const pos of POSITIONS) {
    const from = [...compiled.values()].filter((c) => MFL_POS[c.mflPos] === pos);
    if (!from.length) continue;
    sources[pos] = from.map((c) => c.mflPos);
    const distinct = new Set(from.map(signature));
    const preferred = (MERGE_PREFERENCE[pos] ?? []).map((p) => compiled.get(p)).find((c): c is PositionCompile => c !== undefined) ?? (from[0] as PositionCompile);
    byModel.set(pos, preferred);
    if (distinct.size > 1) {
      warnings.push({
        code: "SCORING_POSITIONS_MERGED",
        message: `MFL scores ${from.map((c) => c.mflPos).join(" and ")} differently, but the model has one ${pos} position; ${pos} uses ${preferred.mflPos}'s rules, so ${from
          .filter((c) => c !== preferred)
          .map((c) => c.mflPos)
          .join("/")} players are scored like ${preferred.mflPos}s.`,
      });
    }
  }

  // Rates: perStat holds a key only when every scored position has the same non-zero rate;
  // everything else goes to byPosition (a REPLACEMENT rate, CLAUDE.md §5). Positions with no MFL
  // rules score 0 on MFL, so they get explicit zero overrides for the perStat keys.
  const scored = [...byModel.keys()];
  const perStat: Record<string, number> = {};
  const byPosition: Partial<Record<Pos, Record<string, number>>> = {};
  const allKeys = [...new Set(scored.flatMap((p) => Object.keys(byModel.get(p)?.rates ?? {})))].sort();
  for (const k of allKeys) {
    const vals = scored.map((p) => byModel.get(p)?.rates[k] ?? 0);
    const first = vals[0] as number;
    if (!eq(first, 0) && vals.every((v) => eq(v, first))) perStat[k] = first;
    else
      scored.forEach((p, i) => {
        const v = vals[i] as number;
        if (!eq(v, 0)) (byPosition[p] ??= {})[k] = v;
      });
  }
  if (Object.keys(perStat).length) for (const u of POSITIONS.filter((p) => !byModel.has(p))) byPosition[u] = Object.fromEntries(Object.keys(perStat).map((k) => [k, 0]));

  // Rules: identical rules across positions become one rule with a position list.
  const ruleOrder: string[] = [];
  const ruleByKey = new Map<string, { rule: RuleNoPos; positions: Set<Pos> }>();
  for (const p of scored) {
    for (const r of byModel.get(p)?.rules ?? []) {
      const key = JSON.stringify(r);
      let entry = ruleByKey.get(key);
      if (!entry) {
        entry = { rule: r, positions: new Set() };
        ruleByKey.set(key, entry);
        ruleOrder.push(key);
      }
      entry.positions.add(p);
    }
  }
  // MFL shuffles key and array order between requests (Phase 0), so the output is sorted.
  const scoringRules: ScoringRule[] = ruleOrder
    .map((key) => {
      const e = ruleByKey.get(key) as { rule: RuleNoPos; positions: Set<Pos> };
      return { ...e.rule, positions: POSITIONS.filter((p) => e.positions.has(p)) } as ScoringRule;
    })
    .sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));

  const collapsed = collapseMappings(mappings).sort((a, b) => compareText(`${a.rule}\u0000${a.positions.join()}`, `${b.rule}\u0000${b.positions.join()}`));
  const unmapped: Scoring["unmapped"] = [];
  for (const m of collapsed) {
    if (m.status === "unmapped") {
      const r = rules.find((x) => x.path === m.path);
      unmapped.push({ platformKey: m.event, label: `${m.rule} [${m.positions.join("/")}]: ${m.detail}`, points: r ? numericPoints(r) : 0 });
      // Rules of positions the model can't hold are summed up in one warning per position (above).
      if (m.positions.some((p) => MFL_POS[p])) warnings.push({ code: "SCORING_RULE_UNMAPPED", message: `Scoring rule "${m.rule}" (${m.positions.join("/")}) isn't used: ${m.detail}.`, platformPath: m.path });
    } else if (m.status === "approximate") {
      warnings.push({ code: "SCORING_RULE_APPROXIMATE", message: `Scoring rule "${m.rule}" (${m.positions.join("/")}) is approximate: ${m.detail}.`, platformPath: m.path });
    }
  }

  if (!rules.length) warnings.push({ code: "SCORING_EMPTY", message: "MFL returned no scoring rules; every player would score 0.", platformPath: "rules.positionRules" });

  return { scoring: { perStat, byPosition, rules: scoringRules, unmapped }, mappings: collapsed, warnings, positions: sources };
}

/** MFL TYPE=rules body → Scoring. Throws LeagueImportError BAD_RESPONSE on a malformed body. */
export function mflRulesToScoring(json: unknown): MflScoringResult {
  return compileMflScoring(parseMflRules(json));
}
