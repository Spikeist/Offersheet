/**
 * FROZEN PHASE 0 EVIDENCE: the probes still use this copy; the app uses src/adapters/mfl/scoringMap.ts. A fix here doesn't
 * reach the app (and the reverse); `npm run import:report -- --live` is the live check of the shipped adapters.
 *
 * MFL scoring rule codes (TYPE=allRules abbreviations) → canonical Sleeper stat keys (CLAUDE.md §5).
 * Draft for Phase 0; Phase 5 moves it to src/adapters/mfl/scoringMap.ts. Codes not listed here are
 * reported as unmapped with their points (never dropped silently).
 *
 * Kinds (from allRules descriptions and MFL's "Scoring Rules Setup" help, read 2026-09-29):
 * - "total":   the rule's range is tested against the per-game total ("Number of …", yards, …).
 * - "length":  "Length of … TD / Field Goal" rules are evaluated once per play, against its length.
 * - "allowed": team-defense points/yards allowed, scored by range (Sleeper uses bucket keys).
 * Keys are split by who the rule is for: offense and kickers (off), IDP players (idp), team DEF.
 */

export type LengthFamily = "pass_td" | "rush_td" | "rec_td" | "fgm" | "fgmiss" | "pass_int_td" | "pr_td" | "kr_td" | "fum_rec_td" | "def_td";

export interface EventMap {
  kind: "total" | "length" | "allowed";
  off?: string[];
  idp?: string[];
  def?: string[];
  family?: LengthFamily;
  allowed?: "pts" | "yds";
  /** Multiplier on the stat before scoring (AS2 = assists ÷ 2). */
  scale?: number;
  /** Realistic per-game range; a per-unit rule "covers" the stat when its range spans it. */
  min?: number;
  max?: number;
  /** Why the mapping is only approximate (shown in the report). */
  approx?: string;
  /**
   * Sleeper counts this event together with other MFL event types (defensive TDs, blocked kicks,
   * special-teams TDs for DEF). Exact when every merged type scores the same; rules.ts checks that.
   */
  merged?: boolean;
}

export const MFL_EVENTS: Readonly<Record<string, EventMap>> = {
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
  "#UT": { kind: "total", off: ["pr_td"], def: ["def_st_td"], max: 3, merged: true },
  PR: { kind: "length", family: "pr_td" },
  "#U": { kind: "total", off: ["pr"], max: 10 },
  UY: { kind: "total", off: ["pr_yd"], min: -20, max: 300 },
  "#KT": { kind: "total", off: ["kr_td"], def: ["def_st_td"], max: 3, merged: true },
  KO: { kind: "length", family: "kr_td" },
  "#K": { kind: "total", off: ["kr"], max: 10 },
  KY: { kind: "total", off: ["kr_yd"], max: 400 },
  // Fumbles
  FU: { kind: "total", off: ["fum"], max: 5 },
  FL: { kind: "total", off: ["fum_lost"], max: 5 },
  FLO: { kind: "total", off: ["fum_lost"], max: 5, approx: "Sleeper fum_lost also counts special-teams fumbles" },
  "#FR": { kind: "total", off: ["fum_rec_td"], max: 3 },
  FR: { kind: "length", family: "fum_rec_td" },
  FC: { kind: "total", off: ["fum_rec"], idp: ["idp_fum_rec"], def: ["fum_rec"], max: 5 },
  FCY: { kind: "total", idp: ["idp_fum_ret_yd"], def: ["fum_ret_yd"], max: 200 },
  FF: { kind: "total", off: ["ff"], idp: ["idp_ff"], def: ["ff"], max: 5 },
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
  TK: { kind: "total", idp: ["idp_tkl_solo"], max: 30, approx: "MFL TK also counts offensive and special-teams tackles" },
  AS: { kind: "total", idp: ["idp_tkl_ast"], max: 30, approx: "MFL AS also counts offensive and special-teams assists" },
  AS2: { kind: "total", idp: ["idp_tkl_ast"], scale: 0.5, max: 30 },
  SK: { kind: "total", idp: ["idp_sack"], def: ["sack"], max: 10 },
  SKY: { kind: "total", idp: ["idp_sack_yd"], def: ["sack_yd"], max: 100 },
  QH: { kind: "total", idp: ["idp_qb_hit"], def: ["qb_hit"], max: 10 },
  TKL: { kind: "total", idp: ["idp_tkl_loss"], def: ["tkl_loss"], max: 10 },
  SF: { kind: "total", idp: ["idp_safe"], def: ["safe"], max: 3 },
  TPA: { kind: "allowed", allowed: "pts" },
  TYA: { kind: "allowed", allowed: "yds" },
};

/** Sleeper length/allowed buckets. Lengths below 18 can't happen for field goals. */
export const FG_BUCKETS: ReadonlyArray<[number, number, string]> = [
  [18, 19, "0_19"],
  [20, 29, "20_29"],
  [30, 39, "30_39"],
  [40, 49, "40_49"],
  [50, 59, "50_59"],
  [60, 70, "60p"],
];
export const TD_BONUS_BREAKS = [40, 50] as const;
export const PTS_ALLOWED_BUCKETS: ReadonlyArray<[number, number, string]> = [
  [0, 0, "pts_allow_0"],
  [1, 6, "pts_allow_1_6"],
  [7, 13, "pts_allow_7_13"],
  [14, 20, "pts_allow_14_20"],
  [21, 27, "pts_allow_21_27"],
  [28, 34, "pts_allow_28_34"],
  [35, 80, "pts_allow_35p"],
];
export const YDS_ALLOWED_BUCKETS: ReadonlyArray<[number, number, string]> = [
  [0, 99, "yds_allow_0_100"],
  [100, 199, "yds_allow_100_199"],
  [200, 299, "yds_allow_200_299"],
  [300, 349, "yds_allow_300_349"],
  [350, 399, "yds_allow_350_399"],
  [400, 449, "yds_allow_400_449"],
  [450, 499, "yds_allow_450_499"],
  [500, 549, "yds_allow_500_549"],
  [550, 900, "yds_allow_550p"],
];

/** Which key list applies to an MFL position: offense/kicker, IDP, or team defense. */
export function keysFor(ev: EventMap, mflPos: string): string[] | undefined {
  if (mflPos === "Def") return ev.def;
  if (["DT", "DE", "LB", "CB", "S"].includes(mflPos)) return ev.idp;
  if (["QB", "RB", "WR", "TE", "PK", "PN"].includes(mflPos)) return ev.off;
  return undefined;
}
