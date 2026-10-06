/**
 * Import Report view model (CLAUDE.md §14 item 2, "Here's what we understood"). A PURE function
 * from the import response to display-ready sections, so the page only lays things out and the
 * wording is unit-tested. Time zone is passed in (no clock reads here).
 *
 * The goal: a user can tell at a glance whether we got their league right. So everything shown is
 * read straight from the normalized snapshot; nothing is guessed or back-filled. Two additions come
 * from Phase 2: the FantasyCalc format the league's trade values use (§2.9, with a note for each
 * substitution) and, once the League page has loaded this league's model inputs, which projections
 * are used (§6: ESPN's are averaged with Sleeper's only when the two agree). Phase 3 adds what the
 * season simulation reads (§8): how ties in the standings are broken (the league's seeding
 * tiebreaker, or unknown with points for assumed) and the weeks with final scores; a matchup that
 * spans several NFL weeks counts in all of them. Phase 4c adds the "Waiver order used" row (§7 one
 * free agent, one team; planner reply to Checkpoint 4b, change 5): the order the engine hands free
 * agents out in, read from the same snapshot (waiverOrderText). Phase 7a adds the "Inactive teams" row
 * (planner reply to Checkpoint 4c, A4: "Team 6: inactive, no pickups assumed."; inactiveTeamsView), the
 * engine's own rule on the same snapshot (acceptance.inactiveTeams).
 *
 * Phase 7b (planner reply to Checkpoint 7a, §5.1: plain-language data notices; src/lib/notices.ts decides): the user never
 * sees a warning code, a JSON path, a stat ID or ID-matching talk outside the technical details. "Things to know" lists the
 * notices (only what can change what the user sees or decides; the "Notices" tile counts them); the scoring section says
 * which uncounted rules matter and, quietly, the rare ones; and a collapsed "Technical details (for bug reports)" at the
 * bottom keeps everything raw (every warning with its code and path, the import's notes, the player-ID matching, the
 * players without projections, the schedule's gaps, the uncounted rules with their stat IDs). With no League model here,
 * other teams' players are judged there (the notices say so). The model inputs the notices read must be fresh for this
 * league data (ReportOptions.freshModel); older ones only name the projection source. ESPN's settings read with a caveat
 * show a plain "our reading" line under their rows (readings), and the "Your team" card says why the platform couldn't tell
 * which team is the user's (notices.ts myTeamWarningText).
 */
import { inactiveRuleBlock, inactiveTeams, transactedWithin, transactionWeek } from "@/engine/acceptance";
import { config } from "@/engine/config";
import type { ModelInputs } from "@/engine/inputs";
import { fantasyCalcFormat, fantasyCalcFormatLabel } from "@/engine/market";
import { POSITIONS, type ImportWarning, type LeagueSettings, type LeagueSnapshot, type Platform, type Pos, type Scoring, type ScoringRule, type SeedingTiebreaker, type StatExpr, type Team, type UnknownSetting } from "@/engine/model";
import { espnSleeperAgreement } from "@/engine/projections";
import { rateFor, ruleApplies } from "@/engine/scoring";
import { reseedRuleAssumed } from "@/engine/season";
import { browserFetchLimits } from "@/server/limits";
import type { EspnCookieSource, ImportReader, ImportResponse } from "./api";
import { fmtNum, fmtPoints, fmtSigned, formatDate, formatDateTime, formatTime, plural, recordText, weeksText } from "./format";
import type { MyTeamPickSource } from "./importStore";
import { LEAGUE_TYPE_LABEL, PLATFORM_LABEL, TRADE_REVIEW_LABEL, posLabel, statGroup, statLabel } from "./labels";
import { resolveMyTeam, type MyTeamSource } from "./myTeam";
import { buildDataNotices, myTeamWarningText, unjudgedText, type Notice } from "./notices";

/** How a setting the platform doesn't expose (or we couldn't read) is shown (§14 item 2). */
export const UNKNOWN_SETTING_TEXT = "Unknown — check your league's settings";
const UNKNOWN_SETTINGS: readonly UnknownSetting[] = ["tradeDeadline", "tradeReview", "playoffs", "playoffSeeding", "seedingTiebreaker"];

/** The seeding tiebreaker (§8) as the Season card's "Ties in the standings" row shows it. */
export const TIEBREAKER_TEXT: Readonly<Record<SeedingTiebreaker, string>> = { pointsFor: "Points for", headToHead: "Head-to-head record", divisionRecord: "Division record" };
/**
 * A tiebreaker the platform doesn't report or reports one we don't model (ESPN: a missing or UNKNOWN
 * playoffSeedingRule, TOTAL_POINTS_AGAINST …): the simulator uses points for. Sleeper's is documented
 * (more points for, then more points against), so its leagues show "Points for", with the adapter's
 * note that a commissioner can also seed by hand, which the API doesn't show.
 */
export const TIEBREAKER_UNKNOWN_TEXT = "Unknown (points for assumed)";

export interface GlanceTile {
  id: "league" | "scoring" | "starters" | "roster" | "playoffs" | "deadline" | "myTeam" | "notices";
  label: string;
  value: string;
  detail?: string;
  tone: "normal" | "warn";
}

export interface LabeledValue {
  label: string;
  value: string;
}

export interface ScoringRow {
  key: string;
  label: string;
  /** e.g. "0.5", "0 (TE: 1)", "D/ST: 2". */
  value: string;
}

export interface BucketLine {
  range: string;
  points: number;
  text: string;
}

export interface TeamRow {
  id: string;
  rank: number;
  name: string;
  owner: string;
  record: string;
  pointsFor: string;
  pointsAgainst: string;
  rosterCount: number;
  irCount: number;
  taxiCount: number;
  division?: string;
  isMine: boolean;
}

export interface ImportReportView {
  league: {
    name: string;
    platform: Platform;
    platformLabel: string;
    season: number;
    currentWeek: number;
    numTeams: number;
    leagueTypeLabel: string;
    bestBall: boolean;
    usedEspnCookies?: boolean;
    espnCookieSource?: EspnCookieSource;
    /** Which ESPN cookies the import used, in words ("…from this browser session."). */
    cookieNote?: string;
    /** The import used cookies saved in this browser session, so the report offers "Forget my ESPN cookies". */
    canForgetEspnCookies: boolean;
    /** Who read the league (Part B, track BF; absent for an import saved before browser reading). */
    readBy?: ImportReader;
  };
  /** Settings the platform doesn't expose, shown as UNKNOWN_SETTING_TEXT in the warn tone. */
  unknown: UnknownSetting[];
  /** Settings read with a caveat (ESPN's inferred readings: espnReadings), each a plain line under its row (the league type's: the League tile's detail). */
  readings: Partial<Record<ReadingKey, string>>;
  glance: GlanceTile[];
  scoring: {
    formatLabel: string;
    receptions: { pos: string; points: number; text: string }[];
    tePremium: number;
    highlights: LabeledValue[];
    bonuses: string[];
    defenseBuckets: { title: string; lines: BucketLine[] }[];
    defenseSummary?: string;
    allRules: ScoringRow[];
    /** Every rule the import couldn't count, as the platform names it (the technical details list them with their stat IDs). */
    unmapped: { label: string; platformKey: string; points: number; scoredThisSeason?: boolean; text: string }[];
    /** The uncounted rules that matter (common, or scored this season), in plain words; also one of the notices. */
    uncounted: string | null;
    /** The quiet line for rare uncounted rules ("Two rare rules aren't counted: … They almost never happen."). */
    quiet: string | null;
  };
  lineup: {
    starters: { slot: string; count: number; eligible: string }[];
    startersText: string;
    bench: number;
    ir: number;
    taxi: number;
    maxRosterSize: number;
    limits: LabeledValue[];
    bestBall: boolean;
  };
  season: {
    currentWeek: number;
    regularSeason: string;
    playoffs: string;
    playoffTeams: number;
    playoffTeamsText: string;
    byes: string;
    rounds?: string;
    seeding: string;
    /** "Ties in the standings" (§8): the league's seeding tiebreaker, or TIEBREAKER_UNKNOWN_TEXT. */
    tiebreaker: string;
    medianGame: boolean;
    pointsOnly: boolean;
    divisions: { name: string; teams: string[] }[];
  };
  /**
   * waiverOrder: the "Waiver order used" row (waiverOrderText), e.g. "Weekly reset (reverse standings)"; inactive: the
   * "Inactive teams" row (inactiveTeamsView): one line per inactive team ("Team 6: inactive, no pickups assumed.") and a
   * note saying what the rule is, or why nobody is.
   */
  trades: { deadline: string; review: string; faab: string; waiverOrder: string; inactive: InactiveTeamsView };
  teams: {
    rows: TeamRow[];
    /** For the "Your team" picker, alphabetical; `note` marks the platform's team or the one from the user's link. */
    options: { id: string; name: string; note?: string }[];
    myTeamId: string | null;
    /**
     * Where "my team" came from: the platform (ESPN cookies / Sleeper username), the user's pick, the
     * teamId of a pasted ESPN team link (to confirm: ESPN uses such links for every team), or nowhere yet.
     */
    myTeamSource: MyTeamSource;
    /** One sentence for the "Your team" card. */
    explain: string;
  };
  players: {
    total: number;
    rostered: number;
    onIr: number;
    onTaxi: number;
    freeAgents: number;
    unmatched: { name: string; pos: string; team: string }[];
    missingDetails: number;
  };
  /**
   * matchups and weeks count every NFL week a matchup spans (ESPN multi-week periods); `results`
   * names the weeks with final scores from the platform ("None yet" before any).
   */
  schedule: { matchups: number; weeks: string; missingRegularWeeks: number[]; thisWeek?: string; results: string };
  activity: { trades: number; adds: number; drops: number; waivers: number; tradedPicks?: number };
  /** The platform's notes, passed through (raw: the technical details list them). */
  notes: string[];
  /** FantasyCalc trade values (§2.9): the format(s) requested for this league, in words. */
  values: { text: string; formats: string[] };
  /** One note per place the FantasyCalc format differs from the league (§14: "a substituted FantasyCalc format"). */
  valueNotes: string[];
  /** From this league's stored model inputs, once the League page has loaded them: the projection source, then the inputs' own notes. */
  modelNotes: string[];
  /** The import's warnings, passed through (raw: the technical details list them, with their codes and paths). */
  warnings: ImportWarning[];
  /** Plain-language notices (src/lib/notices.ts): only what can change what the user sees or decides. */
  notices: Notice[];
  /** Technical details (for bug reports): everything raw, under a line when other teams' players are listed there unjudged. */
  technical: { note: string | null; sections: TechnicalSection[] };
  timestamps: LabeledValue[];
}

/** One part of the technical details: every warning (code and path), note and player-ID gap of one kind. */
export interface TechnicalSection {
  title: string;
  items: TechnicalItem[];
}

export interface TechnicalItem {
  text: string;
  /** A warning's code. */
  code?: string;
  /** Where it was read: a warning's platform path, an uncounted rule's stat ID. */
  path?: string;
}

export interface ReportOptions {
  /** IANA time zone for dates (the viewer's own). */
  timeZone: string;
  /** The stored pick of "my team" (sessionStorage). The user's own pick overrides the platform's; a link's doesn't. */
  myTeamId?: string | null;
  /** Where the stored pick came from (default "you"). */
  myTeamSource?: MyTeamPickSource;
  /**
   * This league's model inputs as the League page stored them, of any age and for any of this league's data: only the
   * projection-source note reads them (it names the week it measured).
   */
  model?: ModelInputs | null;
  /**
   * The same inputs when they're fresh for this very league data (modelStore.modelForSnapshot: built for this snapshot,
   * under 6 hours old), else null: the notices, the inputs' own notes and their warnings in the technical details read only
   * these, so an outage that's over, or a check made on older rosters, never shows as current (a review of Phase 7b).
   */
  freshModel?: ModelInputs | null;
}

// ---------------------------------------------------------------------------------------------
// Scoring helpers

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const upperFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const RANGE_KEY = /^(fgmiss|fgm|fga|pts_allow|yds_allow|rec|rush)_(\d+)(?:_(\d+)|(p))?$/;

/**
 * A sum of adjacent buckets of one family reads as one range: fgm_0_19 + fgm_20_29 + fgm_30_39 is
 * "field goals made (0–39 yds)" (how ESPN's "FG 0-39" rule arrives in canonical keys).
 */
function mergedRangeKey(keys: readonly string[]): string | undefined {
  const parts = keys.map((k) => RANGE_KEY.exec(k)).map((m) => (m ? { family: m[1] as string, lo: Number(m[2]), hi: m[4] ? null : m[3] !== undefined ? Number(m[3]) : Number(m[2]) } : undefined));
  if (parts.length < 2 || parts.some((p) => !p)) return undefined;
  const sorted = (parts as { family: string; lo: number; hi: number | null }[]).sort((a, b) => a.lo - b.lo);
  const family = sorted[0]?.family;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (!prev || !cur || cur.family !== family || prev.hi === null || cur.lo !== prev.hi + 1) return undefined;
  }
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return undefined;
  return last.hi === null ? `${family}_${first.lo}p` : `${family}_${first.lo}_${last.hi}`;
}

function exprLabel(stat: StatExpr): string {
  if (typeof stat === "string") return lowerFirst(statLabel(stat));
  const merged = mergedRangeKey(stat.sum);
  if (merged) return lowerFirst(statLabel(merged));
  return stat.sum.map((k) => lowerFirst(statLabel(k))).join(" + ");
}

/** "rushing yards" → "rushing yard", "passing TDs" → "passing TD". */
function singular(label: string): string {
  return label.replace(/(\w+)s$/, "$1");
}

function positionsSuffix(positions: Pos[] | undefined, platform: Platform): string {
  return positions?.length ? ` (${positions.map((p) => posLabel(p, platform)).join(", ")} only)` : "";
}

function boundsText(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) return `${fmtNum(min)}–${fmtNum(max)}`;
  if (min !== undefined) return `${fmtNum(min)}+`;
  if (max !== undefined) return `up to ${fmtNum(max)}`;
  return "";
}

/** One scoring rule in plain English. */
export function ruleText(rule: ScoringRule, platform: Platform): string {
  const where = positionsSuffix(rule.positions, platform);
  switch (rule.kind) {
    case "perGame":
      return `${fmtSigned(rule.points)} per game played${where}`;
    case "threshold":
      return `${fmtNum(rule.min)}+ ${exprLabel(rule.stat)} in a game: ${fmtSigned(rule.points)}${where}`;
    case "range": {
      const b = boundsText(rule.min, rule.max);
      return `${b ? `${b.charAt(0).toUpperCase()}${b.slice(1)} ` : "Any "}${exprLabel(rule.stat)}: ${fmtSigned(rule.points)}${where}`;
    }
    case "stepped": {
      const counted = rule.min !== undefined || rule.max !== undefined ? ` (counting ${boundsText(rule.min ?? 0, rule.max)})` : "";
      return `${fmtSigned(rule.points)} for every ${fmtNum(rule.every)} ${exprLabel(rule.stat)}${counted}${where}`;
    }
    case "perUnit": {
      const b = boundsText(rule.min, rule.max);
      if (typeof rule.stat !== "string" && !b) return `${upperFirst(exprLabel(rule.stat))}: ${fmtSigned(rule.points, 3)} each${where}`;
      const unit = typeof rule.stat === "string" ? singular(exprLabel(rule.stat)) : `unit of (${exprLabel(rule.stat)})`;
      return `${fmtSigned(rule.points, 3)} per ${unit}${b ? ` when the total is ${b}` : ""}${where}`;
    }
  }
}

/** Per-unit points for one reception at a position, including position bonus keys and per-unit rules. */
function receptionPoints(scoring: Scoring, pos: Pos): number {
  let pts = rateFor(scoring, "rec", pos) + rateFor(scoring, `bonus_rec_${pos.toLowerCase()}`, pos);
  for (const rule of scoring.rules) {
    if (rule.kind === "perUnit" && rule.stat === "rec" && rule.min === undefined && rule.max === undefined && ruleApplies(rule, pos)) pts += rule.points;
  }
  return pts;
}

function formatLabel(ppr: number): string {
  if (ppr === 1) return "PPR";
  if (ppr === 0.5) return "Half-PPR";
  if (ppr === 0) return "Standard (no points per catch)";
  return `${fmtNum(ppr)} per catch`;
}

/** "1 pt per 25 yds", "+1 every 10 yds", "0.04 per yd", or "0". */
function yardageText(scoring: Scoring, key: string, pos: Pos): string {
  const parts: string[] = [];
  const rate = rateFor(scoring, key, pos);
  if (rate) {
    const per = 1 / Math.abs(rate);
    const whole = Math.round(per);
    parts.push(Math.abs(per - whole) < 1e-6 && whole > 1 ? `${rate > 0 ? "1" : fmtNum(-1)} pt per ${whole} yds` : `${fmtNum(rate, 3)} per yd`);
  }
  for (const rule of scoring.rules) {
    if (rule.kind === "stepped" && rule.stat === key && ruleApplies(rule, pos)) parts.push(`${fmtSigned(rule.points)} every ${fmtNum(rule.every)} yds`);
  }
  return parts.length ? parts.join(" + ") : "0";
}

const BUCKET_KEY = /^(pts_allow|yds_allow)_(\d+)(?:_(\d+)|(p))?$/;

interface Bucket {
  lo: number;
  hi: number | null;
  points: number;
}

function bucketRange(b: Bucket): string {
  if (b.hi === null) return `${b.lo}+`;
  return b.lo === b.hi ? `${b.lo}` : `${b.lo}–${b.hi}`;
}

type BucketRule = Extract<ScoringRule, { kind: "range" | "threshold" }>;

/** A D/ST points- or yards-allowed rule, shown with the buckets rather than with the bonuses. */
function isDefenseBucketRule(rule: ScoringRule): rule is BucketRule {
  return (rule.kind === "range" || rule.kind === "threshold") && (rule.stat === "pts_allow" || rule.stat === "yds_allow");
}

/** D/ST buckets from range and threshold rules ("46+") and from Sleeper's bucket keys (pts_allow_14_20 etc.). */
function defenseBuckets(scoring: Scoring, family: "pts_allow" | "yds_allow"): Bucket[] {
  const out: Bucket[] = [];
  for (const rule of scoring.rules) {
    if (!isDefenseBucketRule(rule) || rule.stat !== family || !ruleApplies(rule, "DEF")) continue;
    if (rule.kind === "threshold") out.push({ lo: rule.min, hi: null, points: rule.points });
    else out.push({ lo: rule.min ?? 0, hi: rule.max ?? null, points: rule.points });
  }
  const keys = new Set<string>([...Object.keys(scoring.perStat), ...Object.keys(scoring.byPosition?.DEF ?? {})]);
  for (const key of keys) {
    const m = BUCKET_KEY.exec(key);
    if (!m || m[1] !== family) continue;
    const points = rateFor(scoring, key, "DEF");
    if (!points) continue;
    const lo = Number(m[2]);
    out.push({ lo, hi: m[4] ? null : m[3] !== undefined ? Number(m[3]) : lo, points });
  }
  out.sort((a, b) => a.lo - b.lo || (a.hi ?? Infinity) - (b.hi ?? Infinity));
  // A range no rule covers scores 0 (ESPN has no item for a 0-point bucket such as 18–21), so show it
  // as 0 between the defined buckets instead of leaving a hole. Nothing is added past either end.
  const filled: Bucket[] = [];
  for (const b of out) {
    const prev = filled[filled.length - 1];
    if (prev && prev.hi !== null && b.lo > prev.hi + 1) filled.push({ lo: prev.hi + 1, hi: b.lo - 1, points: 0 });
    filled.push(b);
  }
  return filled;
}

/**
 * Sleeper's per-occurrence bonus keys: threshold games and first-down bonuses (bonus_*, but not the
 * per-catch position premiums shown with receptions), and long plays (pass_td_40p, rec_40p …).
 */
const BONUS_KEY = /^bonus_(?!rec_(rb|wr|te|qb)$)|^(pass|rush|rec)(_td|_cmp)?_(40p|50p)$/;

type PlainCompositeRate = Extract<ScoringRule, { kind: "perUnit" }> & { stat: { sum: string[] } };

/**
 * A per-unit rate on a sum of stats with no bounds (ESPN "FG 0–39: 3 each", Fleaflicker's merged
 * keys): a plain rate, so it's listed with the other per-unit rates rather than with the bonuses.
 */
function isPlainCompositeRate(rule: ScoringRule): rule is PlainCompositeRate {
  return rule.kind === "perUnit" && typeof rule.stat !== "string" && rule.min === undefined && rule.max === undefined;
}

type SortableRow = ScoringRow & { group: number };

function compositeRateRows(scoring: Scoring, platform: Platform): SortableRow[] {
  const rows: SortableRow[] = [];
  scoring.rules.forEach((rule, i) => {
    if (!isPlainCompositeRate(rule)) return;
    rows.push({
      key: `rule-${i}`,
      label: `${upperFirst(exprLabel(rule.stat))}${positionsSuffix(rule.positions, platform)}`,
      value: fmtNum(rule.points, 3),
      group: statGroup(rule.stat.sum[0] ?? ""),
    });
  });
  return rows;
}

function scoringRows(scoring: Scoring, platform: Platform): ScoringRow[] {
  const keys = new Set<string>(Object.keys(scoring.perStat));
  for (const table of Object.values(scoring.byPosition ?? {})) for (const k of Object.keys(table ?? {})) keys.add(k);
  const rows: SortableRow[] = compositeRateRows(scoring, platform);
  for (const key of keys) {
    const base = scoring.perStat[key] ?? 0;
    const overrides = POSITIONS.flatMap((pos) => {
      const v = scoring.byPosition?.[pos]?.[key];
      // A D/ST 0 on a player-only stat (e.g. kick-return TDs, which D/ST scores under its own key) is noise.
      if (v === undefined || (v === 0 && pos === "DEF" && base !== 0)) return [];
      return [{ pos, v }];
    });
    if (!base && overrides.every((o) => !o.v)) continue;
    const overrideText = overrides.map((o) => `${posLabel(o.pos, platform)}: ${fmtNum(o.v, 3)}`).join(", ");
    const value = base || !overrideText ? `${fmtNum(base, 3)}${overrideText ? ` (${overrideText})` : ""}` : overrideText;
    rows.push({ key, label: statLabel(key), value, group: statGroup(key) });
  }
  return rows.sort((a, b) => a.group - b.group || a.label.localeCompare(b.label)).map(({ key, label, value }) => ({ key, label, value }));
}

function buildScoring(settings: LeagueSettings, platform: Platform, hasDefSlot: boolean): Omit<ImportReportView["scoring"], "uncounted" | "quiet"> {
  const s = settings.scoring;
  const receptions = (["RB", "WR", "TE"] as const).map((pos) => {
    const points = receptionPoints(s, pos);
    return { pos, points, text: fmtPoints(points) };
  });
  const wr = receptionPoints(s, "WR");
  const te = receptionPoints(s, "TE");
  const tePremium = te > wr ? te - wr : 0;

  const highlights: LabeledValue[] = [
    { label: "Passing TD", value: fmtPoints(rateFor(s, "pass_td", "QB")) },
    { label: "Passing yards", value: yardageText(s, "pass_yd", "QB") },
    { label: "Rushing yards", value: yardageText(s, "rush_yd", "RB") },
    { label: "Receiving yards", value: yardageText(s, "rec_yd", "WR") },
    { label: "Rushing or receiving TD", value: fmtPoints(rateFor(s, "rush_td", "RB")) + (rateFor(s, "rec_td", "WR") !== rateFor(s, "rush_td", "RB") ? ` / ${fmtPoints(rateFor(s, "rec_td", "WR"))}` : "") },
    { label: "Interception thrown", value: fmtPoints(rateFor(s, "pass_int", "QB")) },
    { label: "Fumble lost", value: fmtPoints(rateFor(s, "fum_lost", "RB")) },
  ];
  const firstDowns = (["pass_fd", "rush_fd", "rec_fd"] as const).map((k) => rateFor(s, k, k === "pass_fd" ? "QB" : "RB"));
  if (firstDowns.some((v) => v)) highlights.push({ label: "First downs (pass / rush / catch)", value: firstDowns.map((v) => fmtNum(v)).join(" / ") });

  const bonuses: string[] = [];
  for (const rule of s.rules) {
    if (isDefenseBucketRule(rule) && ruleApplies(rule, "DEF")) continue;
    if (isPlainCompositeRate(rule)) continue; // listed with the per-unit rates (scoringRows)
    bonuses.push(ruleText(rule, platform));
  }
  for (const key of Object.keys(s.perStat).sort()) {
    const v = s.perStat[key] ?? 0;
    if (v && BONUS_KEY.test(key)) bonuses.push(`${statLabel(key)}: ${fmtSigned(v)}`);
  }

  const defense: ImportReportView["scoring"]["defenseBuckets"] = [];
  const pa = defenseBuckets(s, "pts_allow");
  if (pa.length) defense.push({ title: "Points allowed", lines: pa.map((b) => ({ range: bucketRange(b), points: b.points, text: `${bucketRange(b)} points allowed: ${fmtSigned(b.points)}` })) });
  const ya = defenseBuckets(s, "yds_allow");
  if (ya.length) defense.push({ title: "Yards allowed", lines: ya.map((b) => ({ range: bucketRange(b), points: b.points, text: `${bucketRange(b)} yards allowed: ${fmtSigned(b.points)}` })) });

  let defenseSummary: string | undefined;
  if (hasDefSlot) {
    const parts = [
      ["Sack", "sack"],
      ["INT", "int"],
      ["Fumble recovery", "fum_rec"],
      ["Defensive TD", "def_td"],
      ["Safety", "safe"],
      ["Blocked kick", "blk_kick"],
    ].map(([label, key]) => `${label} ${fmtNum(rateFor(s, key as string, "DEF"))}`);
    defenseSummary = parts.join(" · ");
  }

  return {
    formatLabel: formatLabel(wr),
    receptions,
    tePremium,
    highlights,
    bonuses,
    defenseBuckets: defense,
    defenseSummary,
    allRules: scoringRows(s, platform),
    unmapped: s.unmapped.map((u) => ({ ...u, text: `${u.label}: ${fmtSigned(u.points)}` })),
  };
}

// ---------------------------------------------------------------------------------------------
// Lineup, season, trades

function slotName(slot: { slot: string; eligible: Pos[] }, platform: Platform): string {
  const only = slot.eligible.length === 1 ? slot.eligible[0] : undefined;
  if (only && (slot.slot === only || slot.slot === "D/ST")) return posLabel(only, platform);
  return slot.slot;
}

function limitText(table: Partial<Record<Pos, number>> | undefined, platform: Platform): string {
  return POSITIONS.flatMap((pos) => (table?.[pos] === undefined ? [] : [`${posLabel(pos, platform)} ${table[pos]}`])).join(" · ");
}

/** The Lineup card's row for the position limits (LeagueSettings.positionLimits): ESPN's carries an "our reading" line. */
export const POSITION_LIMITS_LABEL = "Most players allowed per position";

function buildLineup(settings: LeagueSettings, platform: Platform): ImportReportView["lineup"] {
  const starters = settings.lineup.map((s) => ({ slot: slotName(s, platform), count: s.count, eligible: s.eligible.map((p) => posLabel(p, platform)).join("/") }));
  const startersText = starters.map((s) => (s.count > 1 ? `${s.count} ${s.slot}` : s.slot)).join(", ") || "None";
  const limits: LabeledValue[] = [];
  const max = limitText(settings.positionLimits, platform);
  if (max) limits.push({ label: POSITION_LIMITS_LABEL, value: max });
  const starterLimits = POSITIONS.flatMap((pos) => {
    const l = settings.starterLimits?.[pos];
    return l ? [`${posLabel(pos, platform)} ${l.min === l.max ? l.min : `${l.min}–${l.max}`}`] : [];
  }).join(" · ");
  if (starterLimits) limits.push({ label: "Starters per position", value: starterLimits });
  const mins = limitText(settings.rosterMinimums, platform);
  if (mins) limits.push({ label: "Roster minimums", value: mins });
  return {
    starters,
    startersText,
    bench: settings.benchSlots,
    ir: settings.irSlots,
    taxi: settings.taxiSlots,
    maxRosterSize: settings.maxRosterSize,
    limits,
    bestBall: settings.bestBall === true,
  };
}

/**
 * The seeding the season simulation assumes when the platform doesn't report its re-seeding (§8): a fixed
 * bracket seeded by the standings, after the division winners when the league seeds them first (that rule
 * doesn't depend on re-seeding: ESPN documents it, and Sleeper's adapter keeps it whatever its seed type
 * says, so the season simulation seeds them first). It names no tiebreaker: the "Ties in the standings" row
 * does, and that can be the league's own even when re-seeding is unknown (ESPN).
 */
function standardSeedingText(st: LeagueSettings): string {
  const by = st.pointsOnly ? "points for" : "record";
  const divisionsFirst = st.playoffSeeding?.divisionWinnersFirst === true && (st.divisions?.length ?? 0) >= 2;
  return `We'll assume standard seeding: a fixed bracket (no re-seeding), ${divisionsFirst ? `the division winners seeded first, then the other teams by ${by}` : `seeded by ${by}`}.`;
}

function buildSeason(snapshot: LeagueSnapshot, teamName: (id: string) => string, unknown: ReadonlySet<UnknownSetting>): ImportReportView["season"] {
  const st = snapshot.settings;
  const playoffsUnknown = unknown.has("playoffs");
  const rounds = !playoffsUnknown && st.playoffRoundWeeks?.some((n) => n > 1) ? `Rounds last ${st.playoffRoundWeeks.join(", ")} weeks` : undefined;
  let seeding: string;
  if (unknown.has("playoffSeeding")) seeding = `${UNKNOWN_SETTING_TEXT}. ${standardSeedingText(st)}`;
  // No seeding reported, or only its division rule: the re-seeding is a default (season.ts reseedRuleAssumed,
  // as the season simulation reads it), so it isn't shown as the league's own.
  else if (!st.playoffSeeding || reseedRuleAssumed(snapshot))
    seeding = `${snapshot.warnings.some((w) => w.code === "PLAYOFF_SEED_TYPE_UNKNOWN") ? "Reported with a code we don't know" : "Not reported by the platform"}. ${standardSeedingText(st)}`;
  else {
    const parts = [st.playoffSeeding.reseed ? "Re-seeded after each round" : "Fixed bracket (no re-seeding)"];
    if (st.playoffSeeding.divisionWinnersFirst) parts.push("division winners are seeded first");
    seeding = parts.join("; ");
  }
  // Ties in the standings (§8): unknown when the platform doesn't report the rule or reports one we
  // don't model (TIEBREAKER_UNKNOWN_TEXT); the season simulation then breaks ties by points for.
  const tiebreaker = st.seedingTiebreaker && !unknown.has("seedingTiebreaker") ? TIEBREAKER_TEXT[st.seedingTiebreaker] : TIEBREAKER_UNKNOWN_TEXT;
  const byes = playoffsUnknown ? UNKNOWN_SETTING_TEXT : st.playoffByes === undefined ? "Not reported" : st.playoffByes === 0 ? "No byes" : `${plural(st.playoffByes, "bye")} for the top seeds`;
  const divisions = st.divisions && st.divisions.length > 1 ? st.divisions.map((d, i) => ({ name: `Division ${i + 1}`, teams: d.teamIds.map(teamName) })) : [];
  return {
    currentWeek: snapshot.currentWeek,
    regularSeason: st.regularSeasonWeeks.length ? `${weeksText(st.regularSeasonWeeks)} (${plural(st.regularSeasonWeeks.length, "week")})` : "None",
    playoffs: playoffsUnknown ? UNKNOWN_SETTING_TEXT : st.playoffWeeks.length ? weeksText(st.playoffWeeks) : "No playoffs",
    playoffTeams: st.playoffTeams,
    playoffTeamsText: playoffsUnknown ? UNKNOWN_SETTING_TEXT : st.playoffTeams ? String(st.playoffTeams) : "None",
    byes,
    rounds,
    seeding,
    tiebreaker,
    medianGame: st.medianGame,
    pointsOnly: st.pointsOnly,
    divisions,
  };
}

/**
 * The adapters' warning codes for a waiver order read with a caveat (src/adapters/espn/waivers.ts ESPN_WAIVER_CODES,
 * src/adapters/sleeper/waivers.ts WAIVER_TYPE_UNKNOWN and WAIVER_RESET_BEFORE_GAMES; importReport.test.ts checks they
 * match), as literals so this page doesn't load the adapters. A pair lists ESPN's code, then Sleeper's.
 */
export const WAIVER_WARNING_CODES = {
  noWaivers: "ESPN_NO_WAIVERS",
  edited: "ESPN_WAIVER_ORDER_EDITED",
  resetUnknown: ["ESPN_WAIVER_RESET_UNKNOWN", "WAIVER_TYPE_UNKNOWN"],
  beforeGames: ["ESPN_WAIVER_RESET_BEFORE_GAMES", "WAIVER_RESET_BEFORE_GAMES"],
} as const;

/**
 * What the engine hands free agents out by (§7 one free agent, one team): src/engine/league.ts allocationOrder's basis
 * from the same snapshot, its two checks restated so this page doesn't load the engine's league model
 * (importReport.test.ts checks they agree): FAAB budgets left when the league uses FAAB and every team reports a budget
 * (a finite number ≥ 0); else the waiver ranks when every team has one (a whole number ≥ 1); else the biggest gain first.
 */
export function allocationBasis(snapshot: Pick<LeagueSnapshot, "settings" | "teams">): "faab" | "waiver" | "gain" {
  const teams = snapshot.teams;
  const budget = (b: number | undefined) => typeof b === "number" && Number.isFinite(b) && b >= 0;
  const rank = (r: number | undefined) => typeof r === "number" && Number.isInteger(r) && r >= 1;
  if (snapshot.settings.faabBudget !== undefined && teams.length > 0 && teams.every((t) => budget(t.faabRemaining))) return "faab";
  if (teams.length > 0 && teams.every((t) => rank(t.waiverRank))) return "waiver";
  return "gain";
}

/**
 * The "Waiver order used" row (Phase 4c; planner reply to Checkpoint 4b, change 5): the engine's basis (allocationBasis),
 * worded by LeagueSettings.waiverOrderUsed and the adapter's caveats (WAIVER_WARNING_CODES). A weekly reset order says
 * when the commissioner's edited order is in place until the reset (ESPN keeps the reset order then). A live order is
 * qualified by the reason its adapter gave: a reset rule the league doesn't report, or a league that resets weekly but
 * hasn't played a game (no standings to reset to); with neither it is rolling waivers. A FAAB league says what breaks ties
 * between equal budgets when it's the weekly reset order (an ESPN league whose order resets weekly: its teams carry
 * ESPN's live rank apart, Team.liveWaiverRank), and one whose budgets the engine can't use says which budget is missing:
 * the league's own (settings.faabBudget), or some team's.
 */
export function waiverOrderText(snapshot: Pick<LeagueSnapshot, "settings" | "teams" | "warnings">): string {
  const basis = allocationBasis(snapshot);
  const warned = new Set(snapshot.warnings.map((w) => w.code));
  const warnedAny = (codes: readonly string[]) => codes.some((c) => warned.has(c));
  const used = snapshot.settings.waiverOrderUsed;
  // A FAAB league whose ties go by the weekly reset order (the adapter kept the platform's live rank apart).
  const resetTies = used === "faab" && snapshot.teams.some((t) => t.liveWaiverRank !== undefined);
  if (basis === "faab") return resetTies ? "FAAB budget left (the most left picks first; ties by the weekly reset order)" : "FAAB budget left (the most left picks first)";
  if (basis === "gain") return warned.has(WAIVER_WARNING_CODES.noWaivers) ? "None, free agency: the team that gains the most picks first" : "Not reported (the team that gains the most picks first)";
  if (used === "weeklyReset") return warned.has(WAIVER_WARNING_CODES.edited) ? "Weekly reset (reverse standings; the commissioner's edited order lasts until the reset)" : "Weekly reset (reverse standings)";
  if (used === "faab") {
    const order = resetTies ? "Weekly reset order" : "Waiver order";
    return snapshot.settings.faabBudget === undefined ? `${order} (the league's FAAB budget wasn't reported)` : `${order} (not every team's FAAB budget was reported)`;
  }
  if (used !== "live") return "The league's waiver order";
  if (warnedAny(WAIVER_WARNING_CODES.resetUnknown)) return "Live order (the league doesn't say whether it resets weekly)";
  if (warnedAny(WAIVER_WARNING_CODES.beforeGames)) return "Live order (no games played yet)";
  return "Live order (rolling waivers)";
}

/** The "Inactive teams" row (inactiveTeamsView). */
export interface InactiveTeamsView {
  /** One line per inactive team, in snapshot order: "Team 6: inactive, no pickups assumed." (the planner's words). */
  lines: string[];
  /** What the rule is (with inactive teams), or why nobody is inactive. */
  note: string;
}

/**
 * The window the inactive rule reads, in words (planner reply to Checkpoint 4c, A4; acceptance.withinLastWeeks: the
 * transactions whose week is above the league week − config.allocation.inactiveWeeks): "this season" while that covers
 * every week from 0 on (fewer weeks played than the rule's), else "in the last 5 weeks".
 */
export function inactiveWindowText(snapshot: Pick<LeagueSnapshot, "currentWeek" | "leagueWeek">): string {
  const n = config.allocation.inactiveWeeks;
  return transactionWeek(snapshot) - n < 0 ? "this season" : `in the last ${plural(n, "week")}`;
}

/**
 * The "Inactive teams" row (planner reply to Checkpoint 4c, A4: "Show this in the Import Report, for example 'Team 6:
 * inactive, no pickups assumed.'"): the engine's own list (acceptance.inactiveTeams with config.allocation.inactiveWeeks:
 * no transaction in that window, never `myTeamId`, the user's team; nobody when the transactions can't tell,
 * acceptance.inactiveRuleBlock), one line per team in snapshot order, and a note: the rule when some team is inactive;
 * else why nobody is: every team has made a move in the window ("every other team", review of track AL, finding AL-4,
 * when mine hasn't: it always counts as active); some of the league's transactions didn't load or couldn't be read, or a
 * trade in the window came back without one of its teams (finding AL-1: then nobody can be told inactive); the league shows
 * no transaction at all; or the rule is off. Each "nobody" case says every team is assumed to make its pickups. When some
 * team is inactive and mine made no move either, the note says mine still counts as active. The League page's rosters
 * say the same for each inactive team (leagueView.ts).
 */
export function inactiveTeamsView(snapshot: Pick<LeagueSnapshot, "teams" | "transactions" | "warnings" | "currentWeek" | "leagueWeek">, myTeamId: string | null, teamName: (id: string) => string): InactiveTeamsView {
  const n = config.allocation.inactiveWeeks;
  const ids = inactiveTeams(snapshot, myTeamId, n);
  const window = inactiveWindowText(snapshot);
  // My team never counts as inactive (the user is acting), so the note mustn't say every team has moved when mine hasn't.
  const mineQuiet = myTeamId !== null && snapshot.teams.some((t) => t.id === myTeamId) && !transactedWithin(snapshot.transactions ?? [], myTeamId, transactionWeek(snapshot), n);
  if (ids.length) {
    const yours = mineQuiet ? " Your team hasn't made one either, but yours always counts as active." : "";
    return { lines: ids.map((id) => `${teamName(id)}: inactive, no pickups assumed.`), note: `No transactions ${window}, so we assume ${ids.length === 1 ? "it makes" : "they make"} no free-agent pickups.${yours}` };
  }
  const everyTeam = "every team is assumed to make its free-agent pickups.";
  switch (inactiveRuleBlock(snapshot, n)) {
    case "off":
      return { lines: [], note: `None: ${everyTeam}` };
    case "missing":
      return { lines: [], note: `None assumed: some of this league's transactions didn't load or couldn't be read, so we can't tell which teams have been inactive, and ${everyTeam}` };
    case "noTransactions":
      return { lines: [], note: `None assumed: this league shows no transactions this season, so ${everyTeam}` };
    case "partnerUnknown":
      return { lines: [], note: `None assumed: a trade ${window} came back without one of its teams, so we can't tell which teams have been inactive, and ${everyTeam}` };
    default:
      return { lines: [], note: mineQuiet ? `None: every other team has made a transaction ${window} (yours always counts as active).` : `None: every team has made a transaction ${window}.` };
  }
}

/** A setting read with a caveat, for the plain "our reading" line under its row (ImportReportView.readings). */
export type ReadingKey = "leagueType" | "review" | "byes" | "pointsOnly" | "tiebreaker" | "positionLimits";

/**
 * ESPN's settings the adapter reads with a caveat (src/adapters/espn/normalize.ts settingsOf: its own notes say so, in
 * the technical details), as plain lines under their rows, so a card never shows a guess as a fact (§0.12; a review of
 * Phase 7b: Sleeper's such readings are notices, SETTING_INFERRED). The league type from the keeper counts (ESPN has no
 * dynasty flag); a commissioner's review read from a review period without veto votes (tradeReviewOf); byes worked out from
 * the bracket; a points-only league read from ESPN's scoring type; a standings tiebreaker read from its name alone (only
 * points for has been seen in a live league: SEEDING_RULES_SEEN_LIVE); the position limits, read from a field ESPN doesn't
 * document. None for a setting the card already shows as unknown.
 */
export function espnReadings(st: LeagueSettings, unknown: ReadonlySet<UnknownSetting>): Partial<Record<ReadingKey, string>> {
  const out: Partial<Record<ReadingKey, string>> = {};
  if (st.leagueType !== "redraft") out.leagueType = "Read from ESPN's keeper count: ESPN has no dynasty setting.";
  if (st.tradeReview === "commissioner" && !unknown.has("tradeReview")) out.review = "Our reading: ESPN reports a review period but no veto votes.";
  if ((st.playoffByes ?? 0) > 0 && !unknown.has("playoffs")) out.byes = "Worked out from the bracket: ESPN doesn't list byes.";
  if (st.pointsOnly) out.pointsOnly = "Our reading of ESPN's scoring type.";
  if ((st.seedingTiebreaker === "headToHead" || st.seedingTiebreaker === "divisionRecord") && !unknown.has("seedingTiebreaker")) out.tiebreaker = "Our reading of ESPN's setting: not yet checked on a league like yours.";
  if (st.positionLimits) out.positionLimits = "Our reading of a setting ESPN doesn't document.";
  return out;
}

function deadlineText(st: LeagueSettings, timeZone: string, short: boolean): string {
  const d = st.tradeDeadline;
  if (!d || (d.date === undefined && d.week === undefined)) return "No trade deadline";
  const week = d.week !== undefined ? `week ${d.week}` : "";
  if (d.date) {
    const when = short ? formatDate(d.date, timeZone) : formatDateTime(d.date, timeZone);
    return week ? `${when} (${week})` : when;
  }
  return `Week ${d.week}`;
}

// ---------------------------------------------------------------------------------------------
// Teams, players, schedule

function winPct(t: Team): number {
  const games = t.record.w + t.record.l + t.record.t;
  return games ? (t.record.w + 0.5 * t.record.t) / games : 0;
}

function buildTeams(snapshot: LeagueSnapshot, myTeamId: string | null): TeamRow[] {
  const divisionOf = new Map<string, string>();
  const divisions = snapshot.settings.divisions;
  if (divisions && divisions.length > 1) divisions.forEach((d, i) => d.teamIds.forEach((id) => divisionOf.set(id, `Division ${i + 1}`)));
  const sorted = [...snapshot.teams].sort((a, b) => winPct(b) - winPct(a) || b.pointsFor - a.pointsFor || a.name.localeCompare(b.name));
  return sorted.map((t, i) => ({
    id: t.id,
    rank: i + 1,
    name: t.name,
    owner: t.ownerName,
    record: recordText(t.record),
    pointsFor: fmtNum(t.pointsFor, 1),
    pointsAgainst: fmtNum(t.pointsAgainst, 1),
    rosterCount: t.roster.length,
    irCount: t.ir.length,
    taxiCount: t.taxi.length,
    division: divisionOf.get(t.id),
    isMine: t.id === myTeamId,
  }));
}

function buildPlayers(snapshot: LeagueSnapshot): ImportReportView["players"] {
  const rostered = new Set<string>();
  let onIr = 0;
  let onTaxi = 0;
  for (const t of snapshot.teams) {
    for (const id of t.roster) rostered.add(id);
    for (const id of t.ir) rostered.add(id);
    for (const id of t.taxi) rostered.add(id);
    onIr += t.ir.length;
    onTaxi += t.taxi.length;
  }
  let missingDetails = 0;
  const unmatched: ImportReportView["players"]["unmatched"] = [];
  for (const id of rostered) {
    const p = snapshot.players[id];
    if (!p) {
      missingDetails++;
      continue;
    }
    // Canonical ids are Sleeper ids; `${platform}:${id}` means no source mapped the player (§4).
    if (id.includes(":")) unmatched.push({ name: p.name, pos: posLabel(p.pos, snapshot.platform), team: p.nflTeam ?? "FA" });
  }
  unmatched.sort((a, b) => a.name.localeCompare(b.name));
  return { total: Object.keys(snapshot.players).length, rostered: rostered.size, onIr, onTaxi, freeAgents: snapshot.freeAgents.length, unmatched, missingDetails };
}

/** Every NFL week a matchup covers: all of a multi-week period's weeks (ESPN), else its one week. */
const weeksOf = (m: LeagueSnapshot["schedule"][number]): readonly number[] => m.weeks ?? [m.week];

function buildSchedule(snapshot: LeagueSnapshot, myTeamId: string | null, teamName: (id: string) => string): ImportReportView["schedule"] {
  const weeks = [...new Set(snapshot.schedule.flatMap(weeksOf))];
  const missingRegularWeeks = snapshot.settings.pointsOnly ? [] : snapshot.settings.regularSeasonWeeks.filter((w) => !weeks.includes(w));
  let thisWeek: string | undefined;
  if (myTeamId) {
    const m = snapshot.schedule.find((x) => weeksOf(x).includes(snapshot.currentWeek) && (x.teamA === myTeamId || x.teamB === myTeamId));
    if (m) {
      const opp = m.teamA === myTeamId ? m.teamB : m.teamA;
      const span = m.weeks ? ` (weeks ${m.weeks.join(" + ")})` : "";
      thisWeek = `Week ${snapshot.currentWeek}: ${opp ? `vs ${teamName(opp)}` : "bye"}${span}${m.isPlayoff ? " (playoffs)" : ""}`;
    }
  }
  const resultWeeks = snapshot.schedule.filter((m) => m.result).flatMap(weeksOf);
  return { matchups: snapshot.schedule.length, weeks: weeksText(weeks), missingRegularWeeks, thisWeek, results: resultWeeks.length ? weeksText(resultWeeks) : "None yet" };
}

// ---------------------------------------------------------------------------------------------

/**
 * The "Your team" card's sentence. With no team yet, the import's own reason when it gave one (a Sleeper username we
 * couldn't find or look up, ESPN cookies whose account owns no team here: notices.ts myTeamWarningText, a review of Phase
 * 7b), else that the platform doesn't say for this kind of import (a public link, a Sleeper league without a username).
 */
function myTeamExplain(source: MyTeamSource, platformLabel: string, warnings: readonly ImportWarning[]): string {
  switch (source) {
    case "platform":
      return `${platformLabel} told us which team is yours. You can change it here if that's wrong.`;
    case "you":
      return "You picked this team. It's saved for this browser session.";
    case "link":
      return `We took this team from the ${platformLabel} link you pasted. ${platformLabel} uses the same kind of link for every team's page, so check that it's yours, or pick the right one.`;
    case "none":
      return myTeamWarningText(warnings) ?? `We couldn't tell which team is yours (${platformLabel} doesn't say for this kind of import). Pick it so trade ideas are for your team.`;
  }
}

const MY_TEAM_DETAIL: Record<MyTeamSource, (platformLabel: string) => string> = {
  platform: (p) => `Found by ${p}`,
  you: () => "Picked by you",
  link: () => "From your link — check it",
  none: () => "Pick it below",
};

function cookieNote(response: ImportResponse): { note?: string; canForget: boolean } {
  if (!response.usedEspnCookies) return { canForget: false };
  if (response.espnCookieSource === "dev-env") return { note: "Imported with ESPN cookies from .env.local (USE_ENV_COOKIES=1, development only).", canForget: false };
  return { note: "Imported with your ESPN cookies from this browser session.", canForget: true };
}

// ---------------------------------------------------------------------------------------------
// Trade values and projections (Phase 2)

/**
 * The FantasyCalc format(s) for this league (§2.9). Keeper leagues use two: dynasty values for
 * long-term worth and redraft values for how managers see a trade (§9); their size, PPR and TE
 * notes are the same, so each note is listed once.
 */
function tradeValues(settings: LeagueSettings): { values: ImportReportView["values"]; notes: string[] } {
  const formats = settings.leagueType === "keeper" ? [fantasyCalcFormat(settings, "dynasty"), fantasyCalcFormat(settings, "redraft")] : [fantasyCalcFormat(settings)];
  const labels = formats.map(fantasyCalcFormatLabel);
  const text = `FantasyCalc · ${labels[0] ?? ""}${labels.length > 1 ? " (long-term), plus redraft values for this season" : ""}`;
  const notes = [...new Set(formats.flatMap((f) => f.substitutions))].map((sub) => `Trade values: ${sub}.`);
  return { values: { text, formats: labels }, notes };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Which projections the League page uses (§6): Sleeper's × league scoring; in ESPN leagues averaged
 * with ESPN's own league-scored projections only when the two agree within
 * config.projections.espnSleeperAgreement on average over rostered players in the inputs' week
 * (the engine's espnSleeperAgreement: the same test the League model runs).
 */
function projectionNote(snapshot: LeagueSnapshot, model: ModelInputs): string | null {
  if (model.currentWeek > model.lastWeek) return null; // the season is over: nothing is projected
  const sleeperOnly = "Projection source: Sleeper's projections, scored with your league's rules";
  const hasSleeper = Object.values(model.players).some((p) => Object.values(p.sleeper).some((v) => v !== null && v !== undefined));
  if (!hasSleeper) {
    // Review PERF-3: name the source that actually loaded.
    if (snapshot.platform === "espn" && model.espnProjections) return "Projection source: ESPN's own league-scored projections. Sleeper's didn't load, so they aren't averaged in.";
    if (Object.values(model.players).some((p) => typeof p.sleeperSeasonPerGame === "number")) return "Projection source: Sleeper's season projections per game, scored with your league's rules (its weekly projections didn't load).";
    return "Projections didn't load from Sleeper, so players are rated on their season so far.";
  }
  if (snapshot.platform !== "espn") return `${sleeperOnly}.`;
  if (!model.espnProjections) return `${sleeperOnly}. ESPN's own projections didn't load, so they aren't averaged in.`;
  const rostered = snapshot.teams.flatMap((t) => [...t.roster, ...t.ir, ...t.taxi]);
  const { agree, agreement } = espnSleeperAgreement(rostered, model.players, model.currentWeek);
  const limit = pct(config.projections.espnSleeperAgreement);
  if (!agreement) return `${sleeperOnly}. No rostered player had both ESPN's and Sleeper's projection in week ${model.currentWeek}, so they aren't averaged.`;
  const measured = `in week ${agreement.week} (${plural(agreement.players, "rostered player")})`;
  if (agree) return `Projection source: ESPN's and Sleeper's projections, averaged. They differ by ${pct(agreement.meanRelDiff)} on average ${measured}, within the ${limit} we allow.`;
  return `${sleeperOnly}. ESPN's own projections differ from them by ${pct(agreement.meanRelDiff)} on average ${measured}, more than the ${limit} we allow, so we don't average them in.`;
}

/**
 * The projection-source note (from the stored inputs, of any age: it names the week it measured), then the fresh inputs'
 * own notes (a saved FantasyCalc list's date is an outage's: only while the inputs are fresh) minus what the "Trade values"
 * row and its notes already say.
 */
function modelNotes(
  snapshot: LeagueSnapshot,
  model: ModelInputs | null | undefined,
  fresh: ModelInputs | null | undefined,
  values: ImportReportView["values"],
  valueNotes: readonly string[],
): string[] {
  const said = [...values.formats, ...valueNotes.map((n) => n.replace(/^Trade values: /, "").replace(/[.]$/, ""))].filter(Boolean);
  const own = (fresh?.notes ?? []).filter((n) => !said.some((s) => n.includes(s)));
  const source = model ? projectionNote(snapshot, model) : null;
  return [...new Set([...(source ? [source] : []), ...own])];
}

export function buildImportReport(response: ImportResponse, opts: ReportOptions): ImportReportView {
  const snapshot = response.snapshot;
  const { settings, platform } = snapshot;
  const platformLabel = PLATFORM_LABEL[platform];
  const teamById = new Map(snapshot.teams.map((t) => [t.id, t]));
  const teamName = (id: string) => teamById.get(id)?.name ?? `Team ${id}`;

  // "My team" (src/lib/myTeam.ts, shared with the League page): the user's own pick beats the platform's, which beats a link guess.
  const { myTeamId, source: myTeamSource } = resolveMyTeam(snapshot, { teamId: opts.myTeamId ?? null, ...(opts.myTeamSource ? { source: opts.myTeamSource } : {}) });
  const fromPlatform = snapshot.myTeamId && teamById.has(snapshot.myTeamId) ? snapshot.myTeamId : null;

  const unknownSet = new Set(settings.unknownSettings ?? []);
  const unknown = UNKNOWN_SETTINGS.filter((s) => unknownSet.has(s));
  const deadlineUnknown = unknownSet.has("tradeDeadline");
  const reviewUnknown = unknownSet.has("tradeReview");
  const playoffsUnknown = unknownSet.has("playoffs");

  const hasDefSlot = settings.lineup.some((s) => s.eligible.includes("DEF"));
  const scoring = buildScoring(settings, platform, hasDefSlot);
  const market = tradeValues(settings);
  const lineup = buildLineup(settings, platform);
  const season = buildSeason(snapshot, teamName, unknownSet);
  const players = buildPlayers(snapshot);
  const schedule = buildSchedule(snapshot, myTeamId, teamName);
  const warnings = snapshot.warnings;

  const trades = {
    deadline: deadlineUnknown ? UNKNOWN_SETTING_TEXT : deadlineText(settings, opts.timeZone, false),
    review: reviewUnknown ? UNKNOWN_SETTING_TEXT : TRADE_REVIEW_LABEL[settings.tradeReview],
    faab: settings.faabBudget !== undefined ? `$${fmtNum(settings.faabBudget)} FAAB budget` : "No FAAB budget reported",
    waiverOrder: waiverOrderText(snapshot),
    inactive: inactiveTeamsView(snapshot, myTeamId, teamName),
  };
  const deadlineTile: GlanceTile = {
    id: "deadline",
    label: "Trade deadline",
    value: deadlineUnknown ? "Unknown" : deadlineText(settings, opts.timeZone, true),
    detail: reviewUnknown ? "Review unknown — check your league's settings" : deadlineUnknown ? `Check your league's settings · ${TRADE_REVIEW_LABEL[settings.tradeReview]}` : TRADE_REVIEW_LABEL[settings.tradeReview],
    tone: deadlineUnknown || reviewUnknown ? "warn" : "normal",
  };

  const benchText = [`${lineup.bench} bench`, `${lineup.ir} IR`, ...(lineup.taxi ? [`${lineup.taxi} taxi`] : [])].join(" · ");
  // The notices (src/lib/notices.ts): the import and, once the League page has loaded them and while they're fresh for this
  // league data, the model inputs; no League model here, so other teams' players are judged on the League page (the
  // technical details say so).
  const fresh = opts.freshModel ?? null;
  const data = buildDataNotices({ snapshot, myTeamId, inputs: fresh });
  const noticeCount = data.notices.length;
  const readings = platform === "espn" ? espnReadings(settings, unknownSet) : {};
  // The league type has no row of its own: its reading is the League tile's detail.
  const leagueDetail = settings.bestBall ? "Best ball" : (readings.leagueType ?? PLATFORM_LABEL[platform]);
  const glance: GlanceTile[] = [
    { id: "league", label: "League", value: `${settings.numTeams} teams · ${LEAGUE_TYPE_LABEL[settings.leagueType]}`, detail: leagueDetail, tone: "normal" },
    {
      id: "scoring",
      label: "Scoring",
      value: scoring.formatLabel,
      detail: [`${fmtNum(rateFor(settings.scoring, "pass_td", "QB"))}-pt passing TD`, scoring.tePremium ? `TE premium ${fmtSigned(scoring.tePremium)}` : "no TE premium"].join(" · "),
      tone: "normal",
    },
    { id: "starters", label: "Starters", value: lineup.startersText, tone: "normal" },
    { id: "roster", label: "Bench and IR", value: benchText, detail: `${lineup.maxRosterSize} active roster spots`, tone: "normal" },
    playoffsUnknown
      ? { id: "playoffs", label: "Playoffs", value: "Unknown", detail: "Check your league's settings", tone: "warn" }
      : {
          id: "playoffs",
          label: "Playoffs",
          value: settings.playoffTeams ? `${settings.playoffTeams} teams` : "None",
          detail: settings.playoffWeeks.length ? weeksText(settings.playoffWeeks) : undefined,
          tone: "normal",
        },
    deadlineTile,
    {
      id: "myTeam",
      label: "Your team",
      value: myTeamId ? teamName(myTeamId) : "Not picked yet",
      detail: MY_TEAM_DETAIL[myTeamSource](platformLabel),
      tone: myTeamId && myTeamSource !== "link" ? "normal" : "warn",
    },
    { id: "notices", label: "Notices", value: noticeCount ? plural(noticeCount, "notice") : "None", tone: noticeCount ? "warn" : "normal" },
  ];

  // Adds and drops count players moved (an add/drop pair is one transaction; a waiver claim is an add too).
  const nonTrade = snapshot.transactions.filter((t) => t.type !== "trade");
  const activity = {
    trades: snapshot.transactions.filter((t) => t.type === "trade").length,
    adds: nonTrade.reduce((n, t) => n + t.moves.filter((m) => m.from === null && m.to !== null).length, 0),
    drops: nonTrade.reduce((n, t) => n + t.moves.filter((m) => m.from !== null && m.to === null).length, 0),
    waivers: snapshot.transactions.filter((t) => t.type === "waiver").length,
    ...(snapshot.draftPicks ? { tradedPicks: snapshot.draftPicks.filter((p) => p.originalTeamId !== p.ownerTeamId).length } : {}),
  };

  const timestamps: LabeledValue[] = [{ label: `League data from ${platformLabel}`, value: formatDateTime(snapshot.fetchedAt, opts.timeZone) }];
  // Who read it (Part B, track BF): this browser, straight from the platform, or Offer Sheet's server.
  const reader = readerText(response.readBy, platformLabel);
  if (reader) timestamps.push({ label: "League data read by", value: reader });
  for (const src of response.dataSources ?? []) {
    let value: string;
    if (src.available === false) value = `Unavailable${src.note ? `: ${src.note}` : ""}`;
    // The server reports when each source was fetched, a cached copy's original fetch time included.
    else if (src.fetchedAt) value = formatDateTime(src.fetchedAt, opts.timeZone);
    else value = "Our saved copy (fetch time not recorded)";
    if (src.available !== false && src.note) value += ` (${src.note})`;
    timestamps.push({ label: src.name, value });
  }

  const cookies = cookieNote(response);
  const linkTeamId = myTeamSource === "link" ? myTeamId : null;
  const optionNote = (id: string): string | undefined => (id === fromPlatform ? `found by ${platformLabel}` : id === linkTeamId ? "from your link" : undefined);

  return {
    league: {
      name: snapshot.name,
      platform,
      platformLabel,
      season: snapshot.season,
      currentWeek: snapshot.currentWeek,
      numTeams: settings.numTeams,
      leagueTypeLabel: LEAGUE_TYPE_LABEL[settings.leagueType],
      bestBall: settings.bestBall === true,
      ...(response.usedEspnCookies !== undefined ? { usedEspnCookies: response.usedEspnCookies } : {}),
      ...(response.usedEspnCookies && response.espnCookieSource ? { espnCookieSource: response.espnCookieSource } : {}),
      ...(cookies.note ? { cookieNote: cookies.note } : {}),
      canForgetEspnCookies: cookies.canForget,
      ...(response.readBy ? { readBy: response.readBy } : {}),
    },
    unknown,
    readings,
    glance,
    scoring: { ...scoring, uncounted: data.scoring.notice, quiet: data.scoring.quiet },
    lineup,
    season,
    trades,
    teams: {
      rows: buildTeams(snapshot, myTeamId),
      options: [...snapshot.teams]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => {
          const note = optionNote(t.id);
          return { id: t.id, name: t.name, ...(note ? { note } : {}) };
        }),
      myTeamId,
      myTeamSource,
      explain: myTeamExplain(myTeamSource, platformLabel, warnings),
    },
    players,
    schedule,
    activity,
    notes: response.notes,
    values: market.values,
    valueNotes: market.notes,
    modelNotes: modelNotes(snapshot, opts.model ?? fresh, fresh, market.values, market.notes),
    warnings,
    notices: data.notices,
    technical: {
      note: unjudgedText(data.unjudged),
      sections: technicalSections(response, fresh, { players, unmapped: scoring.unmapped, platformLabel, missingWeeks: schedule.missingRegularWeeks, noProjections: data.noProjections, teamName }),
    },
    timestamps,
  };
}

/**
 * The technical details (for bug reports; §5.1): everything raw, notices included. The import's warnings and the fresh
 * model inputs' (each with its code and path), the import's own notes, how the rostered players matched Sleeper's player
 * database (ID matching is said nowhere else), the rostered players without projections (the League page says the ones
 * that matter), the regular-season weeks without matchups, and the scoring rules not counted, with their stat IDs.
 */
function technicalSections(
  response: ImportResponse,
  model: ModelInputs | null,
  c: {
    players: ImportReportView["players"];
    unmapped: ImportReportView["scoring"]["unmapped"];
    platformLabel: string;
    missingWeeks: readonly number[];
    noProjections: readonly string[];
    teamName: (id: string) => string;
  },
): TechnicalSection[] {
  const { players, unmapped, platformLabel } = c;
  const snapshot = response.snapshot;
  const warned = (ws: readonly ImportWarning[]): TechnicalItem[] => ws.map((w) => ({ text: w.message, code: w.code, ...(w.platformPath ? { path: w.platformPath } : {}) }));
  const sections: TechnicalSection[] = [];
  if (snapshot.warnings?.length) sections.push({ title: "Import warnings", items: warned(snapshot.warnings) });
  if (model?.warnings?.length) sections.push({ title: "Projection and trade-value warnings", items: warned(model.warnings) });
  if (response.notes?.length) sections.push({ title: "Import notes", items: response.notes.map((text) => ({ text })) });
  const matched = players.rostered - players.unmatched.length - players.missingDetails;
  const matching: TechnicalItem[] = [{ text: `${matched} of ${plural(players.rostered, "rostered player")} matched to Sleeper's player database.` }];
  if (players.unmatched.length) matching.push({ text: `Not in Sleeper's player database: ${players.unmatched.map((u) => `${u.name} (${u.pos}, ${u.team})`).join("; ")}.` });
  if (players.missingDetails) matching.push({ text: `${plural(players.missingDetails, "rostered player")} came without any player details.` });
  sections.push({ title: "Player matching", items: matching });
  if (c.noProjections.length) {
    const teamOf = new Map(snapshot.teams.flatMap((t) => [...t.roster, ...t.ir, ...t.taxi].map((id) => [id, t.id] as const)));
    const label = (id: string) => {
      const p = snapshot.players[id];
      const team = teamOf.get(id);
      return `${p?.name ?? id} (${[p ? posLabel(p.pos, snapshot.platform) : null, team !== undefined ? c.teamName(team) : null].filter(Boolean).join(", ")})`;
    };
    sections.push({ title: "Players without projections", items: [{ text: `Nothing to project from in any source, so they count as 0 points: ${c.noProjections.map(label).join("; ")}.` }] });
  }
  if (c.missingWeeks.length) sections.push({ title: "Schedule", items: [{ text: `No matchups in the league's schedule for ${weeksText(c.missingWeeks).toLowerCase()} of the regular season.` }] });
  if (unmapped.length)
    sections.push({
      title: "Scoring rules not counted",
      items: unmapped.map((u) => ({
        text: `${u.text}${u.scoredThisSeason === true ? " (scored this season)" : u.scoredThisSeason === false ? " (hasn't scored this season)" : ""}`,
        path: `${platformLabel} ${snapshot.platform === "espn" ? "statId" : "rule"} ${u.platformKey}`,
      })),
    });
  return sections;
}

/**
 * Who read the league, for the Import Report's data line (Part B, track BF): "Your browser, straight from ESPN" or
 * "Offer Sheet's server"; undefined for an import saved before browser reading (it doesn't say).
 */
export function readerText(readBy: ImportReader | undefined, platformLabel: string): string | undefined {
  if (readBy === "browser") return `Your browser, straight from ${platformLabel}`;
  if (readBy === "server") return "Offer Sheet's server";
  return undefined;
}

/**
 * Whether a Refresh now would ask for nothing newer (§2.10: at most once a minute, browserFetchLimits.refreshEveryMs; Part
 * B, track BF: the browser reads a league itself, with no copy of its own to serve, so the page holds Refresh back the
 * way the server's one-minute copies do). `ageMs` is the league data's age (src/lib/modelStore.ts importDataAgeMs: each
 * part on one clock, so a device clock set differently from the server's doesn't let every press through, review
 * BF-R4). An age that can't be told (not a number, or below 0) never holds it back.
 */
export function refreshTooSoon(ageMs: number): boolean {
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < browserFetchLimits.refreshEveryMs;
}

/**
 * What the Refresh button achieved, for an always-mounted status line (§2.10: league data cached
 * under a minute ago is served again, so a second Refresh within the minute changes nothing).
 * `before`/`after` are the snapshot's fetchedAt; the time is passed in. `ageMs`, when known, is the data's age for
 * "fetched … ago" (importDataAgeMs, on one clock at a time); otherwise `now` − `after`.
 */
export function refreshOutcomeText(args: { before: string; after: string; now: Date; platform: Platform; timeZone: string; ageMs?: number }): string {
  const before = Date.parse(args.before);
  const after = Date.parse(args.after);
  if (Number.isFinite(after) && !(Number.isFinite(before) && after <= before)) return `Refreshed: ${PLATFORM_LABEL[args.platform]} data from ${formatTime(args.after, args.timeZone)}`;
  const ageMs = args.ageMs !== undefined && Number.isFinite(args.ageMs) ? args.ageMs : Number.isFinite(after) ? args.now.getTime() - after : 0;
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  const ago = seconds < 120 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
  return `Already up to date (fetched ${ago} ago; Refresh works once a minute)`;
}
