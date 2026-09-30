/**
 * Human labels for the normalized model (pure, client-safe): platforms, league types, trade review,
 * positions, injury statuses (CLAUDE.md §6 step 3) and canonical (Sleeper) stat keys (§5). Unknown
 * stat keys get a readable fallback built from the key's parts, so a new key never shows up blank.
 */
import type { InjuryStatus, LeagueSettings, Platform, Pos } from "@/engine/model";

export const PLATFORM_LABEL: Record<Platform, string> = {
  espn: "ESPN",
  sleeper: "Sleeper",
  yahoo: "Yahoo",
  fleaflicker: "Fleaflicker",
  mfl: "MyFantasyLeague",
  fantrax: "Fantrax",
  manual: "Manual entry",
};

export const LEAGUE_TYPE_LABEL: Record<LeagueSettings["leagueType"], string> = {
  redraft: "Redraft",
  keeper: "Keeper",
  dynasty: "Dynasty",
};

export const TRADE_REVIEW_LABEL: Record<LeagueSettings["tradeReview"], string> = {
  none: "No review: accepted trades go through",
  commissioner: "The commissioner reviews trades",
  league_vote: "League vote: managers can veto trades",
};

/** Position as the platform's users know it (ESPN calls team defenses "D/ST"). */
export function posLabel(pos: Pos, platform?: Platform): string {
  if (pos === "DEF") return platform === "espn" ? "D/ST" : "DEF";
  return pos;
}

/**
 * Injury status badges for roster tables (CLAUDE.md §6 step 3): a short tag and the words behind it.
 * ACTIVE (healthy) has no badge. PROBABLE is ESPN's own status (planner reply to Checkpoint 1).
 */
export const INJURY_LABEL: Record<InjuryStatus, { short: string; long: string } | null> = {
  ACTIVE: null,
  PROBABLE: { short: "P", long: "Probable" },
  QUESTIONABLE: { short: "Q", long: "Questionable" },
  DOUBTFUL: { short: "D", long: "Doubtful" },
  OUT: { short: "O", long: "Out" },
  IR: { short: "IR", long: "Injured reserve" },
  PUP: { short: "PUP", long: "Physically unable to perform" },
  SUSPENDED: { short: "SUS", long: "Suspended" },
  NA: { short: "NA", long: "Not an active NFL player" },
};

const STAT_LABELS: Record<string, string> = {
  gp: "Games played",
  // Passing
  pass_yd: "Passing yards",
  pass_td: "Passing TDs",
  pass_int: "Interceptions thrown",
  pass_int_td: "Pick-sixes thrown",
  pass_2pt: "2-pt conversion passes",
  pass_att: "Pass attempts",
  pass_cmp: "Completions",
  pass_inc: "Incompletions",
  pass_fd: "Passing first downs",
  pass_sack: "Times sacked",
  pass_cmp_40p: "40+ yard completions",
  pass_td_40p: "40+ yard TD passes",
  pass_td_50p: "50+ yard TD passes",
  // Rushing
  rush_yd: "Rushing yards",
  rush_td: "Rushing TDs",
  rush_att: "Rush attempts",
  rush_2pt: "2-pt conversion runs",
  rush_fd: "Rushing first downs",
  rush_40p: "40+ yard runs",
  rush_td_40p: "40+ yard rushing TDs",
  rush_td_50p: "50+ yard rushing TDs",
  // Receiving
  rec: "Receptions",
  rec_yd: "Receiving yards",
  rec_td: "Receiving TDs",
  rec_2pt: "2-pt conversion catches",
  rec_fd: "Receiving first downs",
  rec_tgt: "Targets",
  rec_40p: "40+ yard catches",
  rec_td_40p: "40+ yard receiving TDs",
  rec_td_50p: "50+ yard receiving TDs",
  bonus_rec_rb: "Bonus per RB reception",
  bonus_rec_wr: "Bonus per WR reception",
  bonus_rec_te: "Bonus per TE reception (TE premium)",
  bonus_rec_qb: "Bonus per QB reception",
  // Yardage and volume bonuses
  bonus_pass_yd_300: "300+ yard passing game",
  bonus_pass_yd_400: "400+ yard passing game",
  bonus_rush_yd_100: "100+ yard rushing game",
  bonus_rush_yd_200: "200+ yard rushing game",
  bonus_rec_yd_100: "100+ yard receiving game",
  bonus_rec_yd_200: "200+ yard receiving game",
  bonus_rush_rec_yd_100: "100+ scrimmage yard game",
  bonus_rush_rec_yd_200: "200+ scrimmage yard game",
  bonus_pass_cmp_25: "25+ completion game",
  bonus_rush_att_20: "20+ carry game",
  bonus_fd_qb: "First-down bonus (QB)",
  bonus_fd_rb: "First-down bonus (RB)",
  bonus_fd_wr: "First-down bonus (WR)",
  bonus_fd_te: "First-down bonus (TE)",
  // Fumbles
  fum: "Fumbles",
  fum_lost: "Fumbles lost",
  fum_rec_td: "Fumble recovery TDs",
  // Kicking
  fgm: "Field goals made",
  fga: "Field goal attempts",
  fgmiss: "Missed field goals",
  fgm_yds: "Field goal yards",
  fgm_yds_over_30: "Field goal yards over 30",
  xpm: "Extra points made",
  xpa: "Extra point attempts",
  xpmiss: "Missed extra points",
  // Team defense / special teams
  def_td: "Defensive TDs",
  def_st_td: "Special-teams TDs (defense)",
  def_st_ff: "Special-teams forced fumbles (defense)",
  def_st_fum_rec: "Special-teams fumble recoveries (defense)",
  def_st_tkl_solo: "Special-teams solo tackles (defense)",
  def_kr_td: "Kick return TDs (defense)",
  def_pr_td: "Punt return TDs (defense)",
  def_kr_yd: "Kick return yards (defense)",
  def_pr_yd: "Punt return yards (defense)",
  def_2pt: "Defensive 2-pt returns",
  def_pass_def: "Passes defended (defense)",
  def_fum_td: "Fumble return TDs (defense)",
  int: "Interceptions",
  fum_rec: "Fumble recoveries",
  sack: "Sacks",
  safe: "Safeties",
  blk_kick: "Blocked kicks",
  ff: "Forced fumbles",
  pts_allow: "Points allowed",
  yds_allow: "Yards allowed",
  int_ret_yd: "Interception return yards",
  fum_ret_yd: "Fumble return yards",
  blk_kick_ret_yd: "Blocked-kick return yards",
  fg_ret_yd: "Missed-FG return yards",
  // Returns (players)
  st_td: "Special-teams TDs",
  st_ff: "Special-teams forced fumbles",
  st_fum_rec: "Special-teams fumble recoveries",
  st_tkl_solo: "Special-teams solo tackles",
  kr_yd: "Kick return yards",
  pr_yd: "Punt return yards",
  kr_td: "Kick return TDs",
  pr_td: "Punt return TDs",
  // IDP
  tkl: "Tackles",
  tkl_solo: "Solo tackles",
  tkl_ast: "Assisted tackles",
  tkl_loss: "Tackles for loss",
  qb_hit: "QB hits",
  sack_yd: "Sack yards",
  idp_tkl: "Tackles (IDP)",
  idp_tkl_solo: "Solo tackles (IDP)",
  idp_tkl_ast: "Assisted tackles (IDP)",
  idp_tkl_loss: "Tackles for loss (IDP)",
  idp_sack: "Sacks (IDP)",
  idp_sack_yd: "Sack yards (IDP)",
  idp_qb_hit: "QB hits (IDP)",
  idp_int: "Interceptions (IDP)",
  idp_ff: "Forced fumbles (IDP)",
  idp_fum_rec: "Fumble recoveries (IDP)",
  idp_pass_def: "Passes defended (IDP)",
  idp_def_td: "Defensive TDs (IDP)",
  idp_safe: "Safeties (IDP)",
  idp_blk_kick: "Blocked kicks (IDP)",
  bonus_sack_2p: "2+ sack game",
  bonus_tkl_10p: "10+ tackle game",
  idp_pass_def_3p: "3+ passes defended game",
};

/** Families whose trailing numbers are a range or a threshold ("pts_allow_14_20", "fgm_50p"). */
const RANGE_FAMILIES: Array<{ prefix: string; label: (range: string) => string }> = [
  { prefix: "pts_allow", label: (r) => `${r} points allowed` },
  { prefix: "yds_allow", label: (r) => `${r} yards allowed` },
  { prefix: "fgmiss", label: (r) => `Missed field goals (${r} yds)` },
  { prefix: "fgm", label: (r) => `Field goals made (${r} yds)` },
  { prefix: "fga", label: (r) => `Field goal attempts (${r} yds)` },
  { prefix: "rec", label: (r) => `Catches of ${r} yds` },
  { prefix: "rush", label: (r) => `Runs of ${r} yds` },
];

/** "14_20" → "14–20"; "50p" → "50+"; "0" → "0". */
function rangeSuffix(parts: string): string | undefined {
  const two = /^(\d+)_(\d+)$/.exec(parts);
  if (two) return `${two[1]}–${two[2]}`;
  const plus = /^(\d+)p$/.exec(parts);
  if (plus) return `${plus[1]}+`;
  const one = /^(\d+)$/.exec(parts);
  if (one) return one[1];
  return undefined;
}

/** Readable label for a canonical stat key; falls back to the key's words. */
export function statLabel(key: string): string {
  const known = STAT_LABELS[key];
  if (known) return known;
  for (const f of RANGE_FAMILIES) {
    if (!key.startsWith(`${f.prefix}_`)) continue;
    const suffix = rangeSuffix(key.slice(f.prefix.length + 1));
    if (suffix) return f.label(suffix);
  }
  const words = key.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/** Stat group used to order scoring tables (passing first, IDP last). */
export function statGroup(key: string): number {
  if (/^(pass|bonus_pass)/.test(key)) return 0;
  if (/^(rush|bonus_rush)/.test(key)) return 1;
  if (/^(rec|bonus_rec|bonus_fd)/.test(key)) return 2;
  if (/^(fum)/.test(key)) return 3;
  if (/^(fg|xp)/.test(key)) return 4;
  if (/^(pts_allow|yds_allow|def_|int$|int_ret|fum_rec$|sack$|safe$|blk_kick|ff$|fg_ret)/.test(key)) return 5;
  if (/^(st_|kr_|pr_)/.test(key)) return 6;
  if (/^(idp_|tkl|qb_hit|sack_yd|bonus_sack|bonus_tkl)/.test(key)) return 7;
  return 8;
}
