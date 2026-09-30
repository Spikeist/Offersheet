/**
 * ESPN scoring → canonical Scoring (CLAUDE.md §4, §5). Pure.
 *
 * Canonical stat keys are Sleeper's. Every ESPN statId has a READING: what quantity the ESPN stat
 * measures in canonical terms. The same table drives both directions:
 *   - buildEspnScoring(): ESPN scoringItems → Scoring (perStat, byPosition, rules, unmapped)
 *   - toCanonicalStats(): an ESPN stat line (statId → value) → canonical keys
 * so ESPN's own points are reproduced exactly through the canonical form (the oracle tests prove it).
 *
 * ESPN semantics (Phase 0, reports/probe-output/espn.md):
 *   points = Σ rate × stats[statId]; pointsOverrides is keyed by the player's defaultPositionId and
 *   its value REPLACES `points` for that position (K.overrideKeys; planner answer 3).
 *
 * Reading kinds:
 *   stat       the stat IS a canonical key (per position group: team D/ST vs individual players,
 *              because Sleeper keeps team-defense stats under separate keys: int vs idp_int)
 *   part       one part of a canonical key ESPN splits (INT-return + fumble-return TDs = def_td);
 *              parts scored at equal rates are exact, unequal rates are approximated with a warning
 *   composite  the stat is a SUM of canonical keys (FG made 0–39 = fgm_0_19 + fgm_20_29 + fgm_30_39)
 *              → a perUnit rule on { sum: [...] }
 *   range      a 0/1 flag for "raw stat within ESPN's bounds" (D/ST 14–17 points allowed, 300–399 yard
 *              passing game) → range / threshold rules with ESPN's own bounds, parsed from espn-api's
 *              labels, so projections can take expected values (§5 distributions, engine/scoring.ts)
 *   every      floor(max(0, raw) / N) ("Every 5 passing yards") → a stepped rule
 *   perGame    points per game played (stat 210 GP) → a perGame rule
 *   none       no canonical equivalent → scoring.unmapped + an ImportWarning (never dropped silently;
 *              only head-coach team-result rules no head coach can score are skipped, see below)
 *
 * Team D/ST vs player keys: a key only D/ST lines carry (int, sack, def_kr_td …) is a D/ST rate
 * (byPosition.DEF), and a player key of a split (kr_td, idp_int …) gets a 0 D/ST rate, so neither
 * leaks to the other side through perStat. Sleeper's special-teams keys get ESPN's rates through
 * aliases (def_st_* for D/ST, st_td for players).
 *
 * Verified on data (constants/scoringMap tests on Parker's committed weeks 2–3 lines and the
 * minimized public test league): the "every" stats equal floor(max(0, raw)/N) (and the engine's
 * stepped rule reproduces ESPN's own counts: the every-n oracle suite); every range flag matches the
 * raw stat against the label's bounds; the composites (81 = 80 + 82, 94 = 103 + 104 …) and the
 * aliases (41 = 53, 120 = 187, 3 = 22 …) hold line by line. Which Sleeper key a "stat" reading names
 * is judgement from Phase 0 (scripts/lib/espn/canonical.ts), exact for ESPN's own lines by
 * construction, and checked against Sleeper's stats by the cross-source oracle test.
 */
import type { ImportWarning, Pos, Scoring, ScoringRule, StatExpr, StatLine } from "@/engine/model";
import { POSITIONS } from "@/engine/model";
import { ESPN_DEFAULT_POSITIONS, ESPN_SCORING_FORMAT } from "./constants";
import { POSITION_ID, positionOf } from "./positions";

/** A canonical key, or one key for team D/ST and another for individual players. */
export type StatRef = string | { DEF: string; other: string };

export type EspnReading =
  | { kind: "stat"; stat: StatRef; /** a second ESPN stat that carries the same value (41 = 53) */ alias?: boolean }
  | { kind: "part"; stat: StatRef; /** the ESPN stat that carries the whole */ whole: number }
  | { kind: "composite"; keys: string[]; /** ESPN reports this sum as one count: toCanonicalStats puts it on keys[0] */ source?: boolean }
  | { kind: "range"; stat: StatRef; min?: number; max?: number; /** positions whose lines carry the stat */ positions?: Pos[] }
  | { kind: "every"; stat: StatRef; every: number }
  | { kind: "perGame" }
  | { kind: "none"; why: string };

// ---------------------------------------------------------------------------------------------
// Readings

/** "14-17 points allowed" → 14–17; "46+ …" → 46+; "Less than 100 …" → ≤ 99; "0 points allowed" → 0. */
export function boundsFromLabel(label: string): { min?: number; max?: number } | undefined {
  const span = /(\d+)\s*-\s*(\d+)/.exec(label);
  if (span) return { min: Number(span[1]), max: Number(span[2]) };
  const plus = /(\d+)\s*\+/.exec(label);
  if (plus) return { min: Number(plus[1]) };
  const less = /less than (\d+)/i.exec(label);
  if (less) return { max: Number(less[1]) - 1 };
  const single = /(?:^|\s)(\d+) points allowed$/i.exec(label);
  if (single) return { min: Number(single[1]), max: Number(single[1]) };
  return undefined;
}

/** "Every 25 passing yards" → 25. */
export function everyFromLabel(label: string): number | undefined {
  const m = /^every (\d+) /i.exec(label);
  return m ? Number(m[1]) : undefined;
}

const labelOf = (statId: number) => ESPN_SCORING_FORMAT[statId]?.label ?? `ESPN stat ${statId}`;

const stat = (s: StatRef, alias = false): EspnReading => (alias ? { kind: "stat", stat: s, alias } : { kind: "stat", stat: s });
const none = (why: string): EspnReading => ({ kind: "none", why });

/** Resolved lazily from espn-api's label so bounds are computed, not hand-typed. */
function range(statId: number, s: StatRef, positions?: Pos[]): EspnReading {
  const b = boundsFromLabel(labelOf(statId));
  if (!b) throw new Error(`no bounds in the label of ESPN stat ${statId}`);
  return { kind: "range", stat: s, ...b, ...(positions ? { positions } : {}) };
}
function every(statId: number, s: StatRef): EspnReading {
  const n = everyFromLabel(labelOf(statId));
  if (!n) throw new Error(`no "every N" in the label of ESPN stat ${statId}`);
  return { kind: "every", stat: s, every: n };
}

const DEF_ONLY: Pos[] = ["DEF"];
const TEAM_OR_PLAYER = (team: string, player: string): StatRef => ({ DEF: team, other: player });
const DEF_TD = TEAM_OR_PLAYER("def_td", "idp_def_td");
const TACKLES = TEAM_OR_PLAYER("tkl", "idp_tkl");
const KR_YD = TEAM_OR_PLAYER("def_kr_yd", "kr_yd");
const PR_YD = TEAM_OR_PLAYER("def_pr_yd", "pr_yd");
export const FGM_0_39 = ["fgm_0_19", "fgm_20_29", "fgm_30_39"];
export const FGMISS_0_39 = ["fgmiss_0_19", "fgmiss_20_29", "fgmiss_30_39"];

function buildReadings(): Record<number, EspnReading> {
  const r: Record<number, EspnReading> = {
    0: stat("pass_att"),
    1: stat("pass_cmp"),
    2: stat("pass_inc"),
    3: stat("pass_yd"),
    4: stat("pass_td"),
    15: stat("pass_td_40p"),
    16: stat("pass_td_50p"),
    19: stat("pass_2pt"),
    20: stat("pass_int"),
    21: none("completion percentage has no canonical stat"),
    // "Per game" stats equal the week's value on every weekly line (3 = 22, 24 = 40, 42 = 61).
    22: stat("pass_yd", true),
    23: stat("rush_att"),
    24: stat("rush_yd"),
    25: stat("rush_td"),
    26: stat("rush_2pt"),
    35: stat("rush_td_40p"),
    36: stat("rush_td_50p"),
    39: none("yards per rush has no canonical stat"),
    40: stat("rush_yd", true),
    41: stat("rec", true),
    42: stat("rec_yd"),
    43: stat("rec_td"),
    44: stat("rec_2pt"),
    45: stat("rec_td_40p"),
    46: stat("rec_td_50p"),
    53: stat("rec"),
    58: stat("rec_tgt"),
    59: none("yards after catch has no verified canonical stat"),
    60: none("yards per catch has no canonical stat"),
    61: stat("rec_yd", true),
    62: { kind: "composite", keys: ["pass_2pt", "rush_2pt", "rec_2pt"] },
    63: stat("fum_rec_td"),
    64: stat("pass_sack"),
    65: none("fumbles by play type: the canonical stats only count all fumbles"),
    66: none("fumbles by play type: the canonical stats only count all fumbles"),
    67: none("fumbles by play type: the canonical stats only count all fumbles"),
    68: stat("fum"),
    69: none("fumbles lost by play type: the canonical stats only count all fumbles lost"),
    70: none("fumbles lost by play type: the canonical stats only count all fumbles lost"),
    71: none("fumbles lost by play type: the canonical stats only count all fumbles lost"),
    72: stat("fum_lost"),
    73: { kind: "composite", keys: ["pass_int", "fum_lost"] },
    74: stat("fgm_50p"),
    75: { kind: "composite", keys: ["fgm_50p", "fgmiss_50p"] },
    76: stat("fgmiss_50p"),
    77: stat("fgm_40_49"),
    78: { kind: "composite", keys: ["fgm_40_49", "fgmiss_40_49"] },
    79: stat("fgmiss_40_49"),
    80: { kind: "composite", keys: FGM_0_39, source: true },
    81: { kind: "composite", keys: [...FGM_0_39, ...FGMISS_0_39] },
    82: { kind: "composite", keys: FGMISS_0_39, source: true },
    83: stat("fgm"),
    84: stat("fga"),
    85: stat("fgmiss"),
    86: stat("xpm"),
    87: stat("xpa"),
    88: stat("xpmiss"),
    93: none("blocked punt or field-goal return TDs have no canonical stat"),
    94: stat(DEF_TD),
    95: stat(TEAM_OR_PLAYER("int", "idp_int")),
    96: stat(TEAM_OR_PLAYER("fum_rec", "idp_fum_rec")),
    97: stat(TEAM_OR_PLAYER("blk_kick", "idp_blk_kick")),
    98: stat(TEAM_OR_PLAYER("safe", "idp_safe")),
    99: stat(TEAM_OR_PLAYER("sack", "idp_sack")),
    100: none("half sacks have no canonical stat"),
    101: stat(TEAM_OR_PLAYER("def_kr_td", "kr_td")),
    102: stat(TEAM_OR_PLAYER("def_pr_td", "pr_td")),
    103: { kind: "part", stat: DEF_TD, whole: 94 },
    104: { kind: "part", stat: DEF_TD, whole: 94 },
    105: none("total return TDs have no single canonical stat"),
    106: stat(TEAM_OR_PLAYER("ff", "idp_ff")),
    107: stat(TEAM_OR_PLAYER("tkl_ast", "idp_tkl_ast")),
    108: stat(TEAM_OR_PLAYER("tkl_solo", "idp_tkl_solo")),
    109: stat(TACKLES),
    112: none("stuffs have no canonical stat"),
    113: stat(TEAM_OR_PLAYER("def_pass_def", "idp_pass_def")),
    114: stat(KR_YD),
    115: stat(PR_YD),
    120: stat("pts_allow"),
    126: none("points allowed per game never appears on weekly lines"),
    127: stat("yds_allow"),
    137: none("yards allowed per game never appears on weekly lines"),
    187: stat("pts_allow", true),
    197: none("points allowed per game never appears on weekly lines"),
    198: stat("fgm_50_59"),
    199: { kind: "composite", keys: ["fgm_50_59", "fgmiss_50_59"] },
    200: stat("fgmiss_50_59"),
    201: stat("fgm_60p"),
    202: { kind: "composite", keys: ["fgm_60p", "fgmiss_60p"] },
    203: stat("fgmiss_60p"),
    204: none("offensive 2-point returns have no canonical stat"),
    205: stat(TEAM_OR_PLAYER("def_2pt", "def_2pt"), true),
    206: stat(TEAM_OR_PLAYER("def_2pt", "def_2pt")),
    207: none("1-point safeties have no canonical stat"),
    208: none("1-point safeties have no canonical stat"),
    209: none("1-point safeties have no canonical stat"),
    210: { kind: "perGame" },
    211: stat("pass_fd"),
    212: stat("rush_fd"),
    213: stat("rec_fd"),
    214: stat("fgm_yds"),
    215: none("missed field-goal yards have no canonical stat"),
    216: none("attempted field-goal yards have no canonical stat"),
  };
  const add = (ids: number[], f: (id: number) => EspnReading) => ids.forEach((id) => (r[id] = f(id)));
  add([5, 6, 7, 8, 9, 10], (id) => every(id, "pass_yd"));
  add([11, 12], (id) => every(id, "pass_cmp"));
  add([13, 14], (id) => every(id, "pass_inc"));
  add([17, 18], (id) => range(id, "pass_yd"));
  add([27, 28, 29, 30, 31, 32], (id) => every(id, "rush_yd"));
  add([33, 34], (id) => every(id, "rush_att"));
  add([37, 38], (id) => range(id, "rush_yd"));
  add([47, 48, 49, 50, 51, 52], (id) => every(id, "rec_yd"));
  add([54, 55], (id) => every(id, "rec"));
  add([56, 57], (id) => range(id, "rec_yd"));
  add([89, 90, 91, 92, 121, 122, 123, 124, 125, 188, 189, 190, 191, 192, 193, 194, 195, 196], (id) => range(id, "pts_allow", DEF_ONLY));
  add([110, 111], (id) => every(id, TACKLES));
  add([116, 117], (id) => every(id, KR_YD));
  add([118, 119], (id) => every(id, PR_YD));
  add([128, 129, 130, 131, 132, 133, 134, 135, 136], (id) => range(id, "yds_allow", DEF_ONLY));
  add([217, 218, 219, 220, 221, 222], (id) => every(id, "fgm_yds"));
  add(range0(138, 154), () => none("punting stats have no canonical keys"));
  add(range0(155, 174), () => none("team results (head-coach scoring) have no canonical stat"));
  add(range0(175, 186), () => none("TD-length bonus bands have no canonical stat"));
  add(range0(223, 234), () => none("missed/attempted field-goal yards have no canonical stat"));
  return r;
}

function range0(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

/** Every ESPN statId the adapter understands → its canonical reading. */
export const ESPN_READINGS: Readonly<Record<number, EspnReading>> = buildReadings();

/** The canonical key a StatRef names for a position (team D/ST vs everyone else). */
export function keyFor(ref: StatRef, pos: Pos): string {
  return typeof ref === "string" ? ref : pos === "DEF" ? ref.DEF : ref.other;
}

// ---------------------------------------------------------------------------------------------
// ESPN stat line → canonical stat line

interface Source {
  key: string;
  /** ESPN stat ids carrying the value, in priority order (primary first, then aliases). */
  ids: number[];
  /** When none of `ids` is present: the sum of these parts (def_td = INT-return + fumble-return TDs). */
  parts?: number[];
}

function sourcesFor(pos: Pos): Source[] {
  const byKey = new Map<string, Source>();
  const entry = (key: string) => {
    let s = byKey.get(key);
    if (!s) byKey.set(key, (s = { key, ids: [] }));
    return s;
  };
  const ids = Object.keys(ESPN_READINGS)
    .map(Number)
    .sort((a, b) => a - b);
  // Primaries before aliases.
  for (const pass of ["primary", "alias"] as const)
    for (const id of ids) {
      const r = ESPN_READINGS[id] as EspnReading;
      if (r.kind === "stat" && (pass === "alias") === !!r.alias) entry(keyFor(r.stat, pos)).ids.push(id);
      if (pass === "primary" && r.kind === "composite" && r.source) entry(r.keys[0] as string).ids.push(id);
      if (pass === "primary" && r.kind === "perGame") entry("gp").ids.push(id);
      if (pass === "primary" && r.kind === "part") (entry(keyFor(r.stat, pos)).parts ??= []).push(id);
    }
  return [...byKey.values()];
}

const SOURCES: Readonly<Record<Pos, Source[]>> = Object.fromEntries(POSITIONS.map((p) => [p, sourcesFor(p)])) as Record<Pos, Source[]>;

/**
 * An ESPN stat line (stats[statId] → value, as in player.stats[].stats) → canonical keys.
 * Each canonical key takes its value from ONE ESPN stat (aliases only as a fallback), so nothing is
 * counted twice. ESPN reports FGs made/missed 0–39 as one count; it goes on the composite's first
 * key (fgm_0_19 / fgmiss_0_19), which is exact because every ESPN rule reads 0–39 as a whole
 * (asserted by a unit test over ESPN_READINGS). Derived ESPN stats (every-N counts, range flags)
 * are dropped: the rules recompute them from the raw stat.
 */
export function toCanonicalStats(espnStats: Readonly<Record<string, number>>, pos: Pos): StatLine {
  const out: StatLine = {};
  for (const s of SOURCES[pos]) {
    let v: number | undefined;
    for (const id of s.ids) {
      const x = espnStats[String(id)];
      if (x !== undefined) {
        v = x;
        break;
      }
    }
    if (v === undefined && s.parts) {
      let sum = 0;
      let any = false;
      for (const id of s.parts) {
        const x = espnStats[String(id)];
        if (x !== undefined) {
          sum += x;
          any = true;
        }
      }
      if (any) v = sum;
    }
    if (v !== undefined && v !== 0) out[s.key] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// ESPN scoringItems → Scoring

export interface EspnScoringItem {
  statId: number;
  points: number;
  pointsOverrides?: Record<string, number> | null;
  isReverseItem?: boolean | null;
}

/**
 * Sleeper's stats key some team-D/ST plays under special-teams keys that ESPN folds into its own
 * D/ST stats: a D/ST punt- or kick-return TD is def_st_td, and special-teams fumble recoveries and
 * forced fumbles are def_st_fum_rec / def_st_ff (ESPN counts them in FR / FF). Evidence: the
 * cross-source oracle, 3 of 316 player-weeks in Parker's weeks 2–3 (espn/oracle.test.ts; ⚠️ fitted
 * on those same 3 cases, def_st_ff never scored). ESPN's own canonical lines never carry these
 * keys, so the aliases change nothing for ESPN-native scoring; they matter when Sleeper stats or
 * projections are scored with ESPN rules (Phase 2). Sleeper projection rows reach these keys only
 * through normalizeProjectionStats (sleeper/scoringMap.ts), which ESPN leagues must use too.
 */
export const SLEEPER_DEF_ALIASES: ReadonlyArray<{ key: string; from: string[] }> = [
  { key: "def_st_td", from: ["def_kr_td", "def_pr_td"] },
  { key: "def_st_fum_rec", from: ["fum_rec"] },
  { key: "def_st_ff", from: ["ff"] },
];

/**
 * The player side of the same split: Sleeper keys a PLAYER's kick- or punt-return TD as st_td (in
 * /stats, and in projections after normalizeProjectionStats), where ESPN has stats 101 / 102 →
 * kr_td / pr_td. Without this alias a return TD scores 0 on Sleeper-based lines (review ENG-5).
 */
export const SLEEPER_PLAYER_ALIASES: ReadonlyArray<{ key: string; from: string[] }> = [{ key: "st_td", from: ["kr_td", "pr_td"] }];

const PLAYER_POSITIONS: readonly Pos[] = POSITIONS.filter((p) => p !== "DEF");

/**
 * Team results (wins, points scored, win and loss margins …): ESPN carries these stats only on
 * head-coach lines (Phase 0: statIdToOverridePosition 14 for 155–174), so only an HC's rate counts.
 */
export const TEAM_RESULT_STAT_IDS: ReadonlySet<number> = new Set(range0(155, 174));

export interface ScoringContext {
  /**
   * Which ESPN QB position feeds Pos QB when both could (overrides keyed 1 = QB vs 15 = TQB):
   * "TQB" in a league that starts a TQB and no QB/OP slot, else "QB".
   */
  qbSource: "QB" | "TQB";
  /** The league starts both kinds (QB/OP and TQB slots), so a QB/TQB rate difference matters. */
  bothQbKinds?: boolean;
  /** The league starts a head coach (HC slot): only then are head-coach rules worth listing as unmapped. */
  startsHeadCoach?: boolean;
}

export interface EspnScoringResult {
  scoring: Scoring;
  warnings: ImportWarning[];
}

const itemPath = (i: number, statId: number) => `settings.scoringSettings.scoringItems[${i}] (statId ${statId})`;
const posLabel = (p: Pos) => (p === "DEF" ? "D/ST" : p);

/** The rate an item gives each Pos, applying pointsOverrides (keyed by defaultPositionId, REPLACING points). */
function ratesByPos(item: EspnScoringItem, index: number, ctx: ScoringContext, warnings: ImportWarning[]): Map<Pos, number> {
  const overrides = new Map<number, number>();
  for (const [key, rate] of Object.entries(item.pointsOverrides ?? {})) {
    const id = Number(key);
    if (positionOf(id).name === undefined) {
      warnings.push({ code: "ESPN_SCORING_OVERRIDE_UNKNOWN", message: `The rule “${labelOf(item.statId)}” has a position-specific value for an ESPN position id we don't know (${key}); it was ignored.`, platformPath: `${itemPath(index, item.statId)}.pointsOverrides["${key}"]` });
      continue;
    }
    overrides.set(id, rate);
  }
  const out = new Map<Pos, number>();
  for (const pos of POSITIONS) {
    // Every ESPN position of this Pos, with the rate it gets: its override, else the base points.
    const rates = Object.keys(ESPN_DEFAULT_POSITIONS)
      .map(Number)
      .filter((id) => positionOf(id).pos === pos)
      .map((id) => ({ id, rate: overrides.get(id) ?? item.points }));
    const distinct = new Set(rates.map((r) => r.rate)).size > 1;
    let chosen = rates[0]?.rate ?? item.points;
    if (pos === "QB") {
      const want = ctx.qbSource === "TQB" ? POSITION_ID.TQB : POSITION_ID.QB;
      chosen = rates.find((r) => r.id === want)?.rate ?? chosen;
      if (distinct && ctx.bothQbKinds) warnings.push({ code: "ESPN_SCORING_OVERRIDE_CONFLICT", message: `ESPN scores “${labelOf(item.statId)}” differently for QB and TQB, which we model as one position; we use the ${ctx.qbSource} value (${chosen}).`, platformPath: `${itemPath(index, item.statId)}.pointsOverrides` });
    } else if (distinct) {
      warnings.push({ code: "ESPN_SCORING_OVERRIDE_CONFLICT", message: `ESPN scores “${labelOf(item.statId)}” differently for ${rates.map((r) => ESPN_DEFAULT_POSITIONS[r.id]).join(" and ")}, which we model as one position (${pos}); we use the ${ESPN_DEFAULT_POSITIONS[rates[0]?.id ?? -1]} value (${chosen}).`, platformPath: `${itemPath(index, item.statId)}.pointsOverrides` });
    }
    out.set(pos, chosen);
  }
  return out;
}

/** Group positions by rate, dropping zero rates. positions undefined = every position. */
function groupsByRate(rates: Map<Pos, number>, restrict?: readonly Pos[]): Array<{ points: number; positions?: Pos[] }> {
  const groups = new Map<number, Pos[]>();
  for (const p of POSITIONS) {
    if (restrict && !restrict.includes(p)) continue;
    const r = rates.get(p) ?? 0;
    if (r !== 0) groups.set(r, [...(groups.get(r) ?? []), p]);
  }
  return [...groups].map(([points, positions]) => (positions.length === POSITIONS.length ? { points } : { points, positions }));
}

/** Plain-English rule name with the positions it applies to ("Each Sack (D/ST)") and its points. */
function describe(statId: number, rates: Map<Pos, number>): { label: string; points: number } {
  const nonzero = POSITIONS.filter((p) => (rates.get(p) ?? 0) !== 0);
  const points = nonzero.length ? (rates.get(nonzero[0] as Pos) as number) : 0;
  const varies = new Set(nonzero.map((p) => rates.get(p))).size > 1;
  const who = nonzero.length && nonzero.length < POSITIONS.length ? ` (${nonzero.map(posLabel).join(", ")}${varies ? "; points vary by position" : ""})` : "";
  return { label: `${labelOf(statId)}${who}`, points };
}

/**
 * Build the canonical Scoring for an ESPN league's scoringItems.
 * - "stat" readings become perStat (ESPN's base rate) + byPosition (where a position's rate differs,
 *   i.e. ESPN's pointsOverrides, as replacement rates). Several ESPN stats reading one key add up,
 *   exactly as ESPN adds them (41 and 53 are both receptions).
 * - Keys only one side reads can't leak to the other through perStat: a team-D/ST key (int, sack,
 *   def_kr_td …) goes to byPosition.DEF only, and a player key of a D/ST-vs-player split (kr_td,
 *   idp_int …) gets a 0 replacement rate for DEF.
 * - Every other reading becomes a rule; position-specific rates become rules with `positions`.
 * - Head-coach team-result rules (155–174) count only for an HC: skipped when the HC value is 0,
 *   and listed as unmapped only when the league starts an HC (otherwise nobody can score them).
 * Warnings carry the platform path of every rule we couldn't map exactly; unmapped rules also go to
 * scoring.unmapped (shown in the Import Report).
 */
export function buildEspnScoring(items: readonly EspnScoringItem[], ctx: ScoringContext = { qbSource: "QB" }): EspnScoringResult {
  const warnings: ImportWarning[] = [];
  const unmapped: Scoring["unmapped"] = [];
  const rules: ScoringRule[] = [];
  /** canonical key → Pos → accumulated rate (only positions whose lines carry the key). */
  const perKey = new Map<string, Map<Pos, number>>();
  /** canonical key → Σ base points of the items that read it for at least one non-overridden position. */
  const baseSum = new Map<string, number>();
  /** Split keys (def_td): key → Pos → part statId → rate. */
  const parts = new Map<string, Map<Pos, Map<number, number>>>();

  const add = (key: string, pos: Pos, rate: number) => {
    const m = perKey.get(key) ?? new Map<Pos, number>();
    m.set(pos, (m.get(pos) ?? 0) + rate);
    perKey.set(key, m);
  };

  items.forEach((item, index) => {
    const overriddenIds = Object.keys(item.pointsOverrides ?? {}).map(Number);
    if (TEAM_RESULT_STAT_IDS.has(item.statId)) {
      // Only head-coach lines carry team results, so only the HC value matters (Phase 0).
      const hcRate = item.pointsOverrides?.[String(POSITION_ID.HC)] ?? item.points;
      if (hcRate === 0 || !ctx.startsHeadCoach) return; // worth nothing, or no HC can be started
      const label = `${labelOf(item.statId)} (head coach)`;
      unmapped.push({ platformKey: String(item.statId), label, points: hcRate });
      warnings.push({ code: "ESPN_SCORING_UNMAPPED", message: `ESPN scoring rule “${label}” (${hcRate} pts) isn't counted: head coaches aren't supported.`, platformPath: itemPath(index, item.statId) });
      return;
    }
    if (item.isReverseItem) warnings.push({ code: "ESPN_SCORING_REVERSE_ITEM", message: `ESPN marks the rule “${labelOf(item.statId)}” as a reverse item; we don't know what that changes in a points league, so it is scored normally.`, platformPath: `${itemPath(index, item.statId)}.isReverseItem` });
    const reading = ESPN_READINGS[item.statId];
    const rates = ratesByPos(item, index, ctx, warnings);
    if (!reading) {
      const d = describe(item.statId, rates);
      if (d.points === 0) return;
      unmapped.push({ platformKey: String(item.statId), label: d.label, points: d.points });
      warnings.push({ code: "ESPN_SCORING_UNKNOWN_STAT", message: `ESPN scoring rule “${d.label}” (${d.points} pts) uses a stat id we don't know, so it isn't counted.`, platformPath: itemPath(index, item.statId) });
      return;
    }
    switch (reading.kind) {
      case "stat": {
        const overriddenPos = new Set(overriddenIds.map((id) => positionOf(id).pos));
        const baseKeys = new Set<string>();
        for (const pos of POSITIONS) {
          const key = keyFor(reading.stat, pos);
          add(key, pos, rates.get(pos) ?? 0);
          if (!overriddenPos.has(pos)) baseKeys.add(key);
        }
        for (const key of baseKeys) baseSum.set(key, (baseSum.get(key) ?? 0) + item.points);
        return;
      }
      case "part":
        for (const pos of POSITIONS) {
          const key = keyFor(reading.stat, pos);
          const byPos = parts.get(key) ?? new Map<Pos, Map<number, number>>();
          const m = byPos.get(pos) ?? new Map<number, number>();
          m.set(item.statId, (m.get(item.statId) ?? 0) + (rates.get(pos) ?? 0));
          byPos.set(pos, m);
          parts.set(key, byPos);
        }
        return;
      case "composite":
        for (const g of groupsByRate(rates)) rules.push({ kind: "perUnit", stat: { sum: [...reading.keys] }, points: g.points, ...(g.positions ? { positions: g.positions } : {}) });
        return;
      case "range":
        for (const g of groupsByRate(rates, reading.positions))
          for (const [s, positions] of statGroups(reading.stat, g.positions)) {
            const common = { stat: s, points: g.points, ...(positions ? { positions } : {}) };
            rules.push(reading.max === undefined ? { kind: "threshold", min: reading.min ?? 0, ...common } : { kind: "range", ...(reading.min !== undefined ? { min: reading.min } : {}), max: reading.max, ...common });
          }
        return;
      case "every":
        for (const g of groupsByRate(rates)) for (const [s, positions] of statGroups(reading.stat, g.positions)) rules.push({ kind: "stepped", stat: s, every: reading.every, points: g.points, ...(positions ? { positions } : {}) });
        return;
      case "perGame":
        for (const g of groupsByRate(rates)) rules.push({ kind: "perGame", points: g.points, ...(g.positions ? { positions: g.positions } : {}) });
        return;
      case "none": {
        const d = describe(item.statId, rates);
        if (d.points === 0) return; // worth nothing to any modeled position
        unmapped.push({ platformKey: String(item.statId), label: d.label, points: d.points });
        warnings.push({ code: "ESPN_SCORING_UNMAPPED", message: `ESPN scoring rule “${d.label}” (${d.points} pts) isn't counted: ${reading.why}.`, platformPath: itemPath(index, item.statId) });
        return;
      }
    }
  });

  // Split keys (def_td = INT-return TDs + fumble-return TDs): exact when every part has one rate.
  for (const [key, byPos] of parts) {
    const unequal: string[] = [];
    for (const [pos, m] of byPos) {
      const partRates = Object.entries(ESPN_READINGS)
        .filter(([, r]) => r.kind === "part" && keyFor(r.stat, pos) === key)
        .map(([id]) => m.get(Number(id)) ?? 0);
      const scored = partRates.find((r) => r !== 0);
      if (scored !== undefined && new Set(partRates).size > 1) unequal.push(posLabel(pos));
      // A position scoring 0 is kept too, so it gets a 0 rate rather than another position's.
      add(key, pos, scored ?? 0);
    }
    if (unequal.length)
      warnings.push({
        code: "ESPN_SCORING_SHARED_KEY",
        message: `ESPN scores interception-return and fumble-return TDs differently (${unequal.join(", ")}), but the canonical stats count both as one stat (${key}); both are scored at the ${ESPN_SCORING_FORMAT[103]?.label ?? "interception-return"} value.`,
        platformPath: "settings.scoringSettings.scoringItems (statIds 103, 104)",
      });
  }

  // Sleeper keys some special-teams plays differently from ESPN: give those keys ESPN's rates, for
  // D/ST (def_st_*) and for players (st_td). When the two ESPN rates an alias merges differ (one of
  // them may be 0), Sleeper-based lines can only get one of them: the first, with a warning.
  const alias = (a: { key: string; from: string[] }, positions: readonly Pos[], what: string) => {
    if (perKey.has(a.key)) return; // ESPN scores the key itself
    const m = new Map<Pos, number>();
    let differs = false;
    for (const pos of positions) {
      const rates = a.from.map((k) => perKey.get(k)?.get(pos) ?? 0);
      const chosen = rates.find((r) => r !== 0) ?? 0;
      if (chosen !== 0 && new Set(rates).size > 1) differs = true;
      m.set(pos, chosen); // 0 too, so a position ESPN doesn't pay gets a 0 rate, not another position's
    }
    if ([...m.values()].every((r) => r === 0)) return;
    if (differs)
      warnings.push({
        code: "ESPN_SCORING_SHARED_KEY",
        message: `ESPN scores ${what} kick-return and punt-return TDs differently, but Sleeper's stats count both as ${a.key}; Sleeper-based stats and projections get the kick-return value (the punt-return value when kick returns score 0).`,
        platformPath: "settings.scoringSettings.scoringItems (statIds 101, 102)",
      });
    perKey.set(a.key, m);
  };
  for (const a of SLEEPER_DEF_ALIASES) alias(a, ["DEF"], "D/ST");
  for (const a of SLEEPER_PLAYER_ALIASES) alias(a, PLAYER_POSITIONS, "players'");

  const perStat: Record<string, number> = {};
  const byPosition: Partial<Record<Pos, Record<string, number>>> = {};
  for (const [key, m] of perKey) {
    const readers = POSITIONS.filter((p) => m.has(p));
    if (readers.every((p) => (m.get(p) ?? 0) === 0)) continue;
    // A team-D/ST key (only D/ST lines carry it): a D/ST rate, never a rate for every position.
    if (readers.every((p) => p === "DEF")) {
      (byPosition.DEF ??= {})[key] = round(m.get("DEF") as number);
      continue;
    }
    // perStat = ESPN's base rate when some position scores at it; else the first reader's rate.
    const base = baseSum.get(key);
    const rate = base !== undefined && readers.some((p) => m.get(p) === base) ? base : (m.get(readers[0] as Pos) as number);
    if (rate !== 0) perStat[key] = round(rate);
    for (const p of readers) {
      const r = m.get(p) as number;
      if (r !== rate) (byPosition[p] ??= {})[key] = round(r);
    }
    // A player key of a D/ST-vs-player split (kr_td, idp_int …): D/ST lines use the team key.
    if (!m.has("DEF") && rate !== 0) (byPosition.DEF ??= {})[key] = 0;
  }

  const scoring: Scoring = { perStat, rules, unmapped };
  if (Object.keys(byPosition).length) scoring.byPosition = byPosition;
  return { scoring, warnings };
}

/** Split a rule's positions by the canonical key each reads (team D/ST vs players). */
function statGroups(ref: StatRef, positions: Pos[] | undefined): Array<[StatExpr, Pos[] | undefined]> {
  if (typeof ref === "string") return [[ref, positions]];
  const all = positions ?? [...POSITIONS];
  const team = all.filter((p) => p === "DEF");
  const players = all.filter((p) => p !== "DEF");
  const out: Array<[StatExpr, Pos[] | undefined]> = [];
  if (team.length) out.push([ref.DEF, team]);
  if (players.length) out.push([ref.other, players]);
  return out;
}

/** Scoring rates are decimals like 0.04; keep sums (0.1 + 0.2) from printing as 0.30000000000000004. */
function round(x: number): number {
  return Math.round(x * 1e9) / 1e9;
}
