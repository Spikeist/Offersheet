/**
 * Import Report view model (CLAUDE.md §14 item 2, "Here's what we understood"). A PURE function
 * from the import response to display-ready sections, so the page only lays things out and the
 * wording is unit-tested. Time zone is passed in (no clock reads here).
 *
 * The goal: a user can tell at a glance whether we got their league right. So everything shown is
 * read straight from the normalized snapshot; nothing is guessed or back-filled.
 */
import { POSITIONS, type ImportWarning, type LeagueSettings, type LeagueSnapshot, type Platform, type Pos, type Scoring, type ScoringRule, type StatExpr, type Team, type UnknownSetting } from "@/engine/model";
import { rateFor, ruleApplies } from "@/engine/scoring";
import type { EspnCookieSource, ImportResponse } from "./api";
import { fmtNum, fmtPoints, fmtSigned, formatDate, formatDateTime, formatTime, plural, recordText, weeksText } from "./format";
import type { MyTeamPickSource } from "./importStore";
import { LEAGUE_TYPE_LABEL, PLATFORM_LABEL, TRADE_REVIEW_LABEL, posLabel, statGroup, statLabel } from "./labels";

/** How a setting the platform doesn't expose (or we couldn't read) is shown (§14 item 2). */
export const UNKNOWN_SETTING_TEXT = "Unknown — check your league's settings";
const UNKNOWN_SETTINGS: readonly UnknownSetting[] = ["tradeDeadline", "tradeReview", "playoffs", "playoffSeeding"];

export interface GlanceTile {
  id: "league" | "scoring" | "starters" | "roster" | "playoffs" | "deadline" | "myTeam" | "warnings";
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
  };
  /** Settings the platform doesn't expose, shown as UNKNOWN_SETTING_TEXT in the warn tone. */
  unknown: UnknownSetting[];
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
    unmapped: { label: string; platformKey: string; points: number; text: string }[];
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
    medianGame: boolean;
    pointsOnly: boolean;
    divisions: { name: string; teams: string[] }[];
  };
  trades: { deadline: string; review: string; faab: string };
  teams: {
    rows: TeamRow[];
    /** For the "Your team" picker, alphabetical; `note` marks the platform's team or the one from the user's link. */
    options: { id: string; name: string; note?: string }[];
    myTeamId: string | null;
    /**
     * Where "my team" came from: the platform (ESPN cookies / Sleeper username), the user's pick, the
     * teamId of a pasted ESPN team link (to confirm: ESPN uses such links for every team), or nowhere yet.
     */
    myTeamSource: "platform" | "you" | "link" | "none";
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
  schedule: { matchups: number; weeks: string; missingRegularWeeks: number[]; thisWeek?: string };
  activity: { trades: number; adds: number; drops: number; waivers: number; tradedPicks?: number };
  notes: string[];
  warnings: ImportWarning[];
  timestamps: LabeledValue[];
}

export interface ReportOptions {
  /** IANA time zone for dates (the viewer's own). */
  timeZone: string;
  /** The stored pick of "my team" (sessionStorage). The user's own pick overrides the platform's; a link's doesn't. */
  myTeamId?: string | null;
  /** Where the stored pick came from (default "you"). */
  myTeamSource?: MyTeamPickSource;
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

function buildScoring(settings: LeagueSettings, platform: Platform, hasDefSlot: boolean): ImportReportView["scoring"] {
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

function buildLineup(settings: LeagueSettings, platform: Platform): ImportReportView["lineup"] {
  const starters = settings.lineup.map((s) => ({ slot: slotName(s, platform), count: s.count, eligible: s.eligible.map((p) => posLabel(p, platform)).join("/") }));
  const startersText = starters.map((s) => (s.count > 1 ? `${s.count} ${s.slot}` : s.slot)).join(", ") || "None";
  const limits: LabeledValue[] = [];
  const max = limitText(settings.positionLimits, platform);
  if (max) limits.push({ label: "Most players allowed per position", value: max });
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

const STANDARD_SEEDING = "We'll assume standard seeding: wins, then points for.";

function buildSeason(snapshot: LeagueSnapshot, teamName: (id: string) => string, unknown: ReadonlySet<UnknownSetting>): ImportReportView["season"] {
  const st = snapshot.settings;
  const playoffsUnknown = unknown.has("playoffs");
  const rounds = !playoffsUnknown && st.playoffRoundWeeks?.some((n) => n > 1) ? `Rounds last ${st.playoffRoundWeeks.join(", ")} weeks` : undefined;
  let seeding: string;
  if (unknown.has("playoffSeeding")) seeding = `${UNKNOWN_SETTING_TEXT}. ${STANDARD_SEEDING}`;
  else if (!st.playoffSeeding) seeding = `Not reported by the platform. ${STANDARD_SEEDING}`;
  else {
    const parts = [st.playoffSeeding.reseed ? "Re-seeded after each round" : "Fixed bracket (no re-seeding)"];
    if (st.playoffSeeding.divisionWinnersFirst) parts.push("division winners are seeded first");
    seeding = parts.join("; ");
  }
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
    medianGame: st.medianGame,
    pointsOnly: st.pointsOnly,
    divisions,
  };
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

function buildSchedule(snapshot: LeagueSnapshot, myTeamId: string | null, teamName: (id: string) => string): ImportReportView["schedule"] {
  const weeks = [...new Set(snapshot.schedule.map((m) => m.week))];
  const missingRegularWeeks = snapshot.settings.pointsOnly ? [] : snapshot.settings.regularSeasonWeeks.filter((w) => !weeks.includes(w));
  let thisWeek: string | undefined;
  if (myTeamId) {
    const m = snapshot.schedule.find((x) => x.week === snapshot.currentWeek && (x.teamA === myTeamId || x.teamB === myTeamId));
    if (m) {
      const opp = m.teamA === myTeamId ? m.teamB : m.teamA;
      thisWeek = `Week ${snapshot.currentWeek}: ${opp ? `vs ${teamName(opp)}` : "bye"}${m.isPlayoff ? " (playoffs)" : ""}`;
    }
  }
  return { matchups: snapshot.schedule.length, weeks: weeksText(weeks), missingRegularWeeks, thisWeek };
}

// ---------------------------------------------------------------------------------------------

type MyTeamSource = ImportReportView["teams"]["myTeamSource"];

/**
 * "My team": the user's own pick beats the platform's; the platform's (a cookie SWID or Sleeper
 * username match) beats a team taken from a pasted link, which is only a guess to confirm.
 */
function resolveMyTeam(snapshot: LeagueSnapshot, opts: ReportOptions, isTeam: (id: string) => boolean): { myTeamId: string | null; source: MyTeamSource } {
  const picked = opts.myTeamId && isTeam(opts.myTeamId) ? opts.myTeamId : null;
  const pickSource = opts.myTeamSource ?? "you";
  const fromPlatform = snapshot.myTeamId && isTeam(snapshot.myTeamId) ? snapshot.myTeamId : null;
  if (picked && pickSource === "you" && picked !== fromPlatform) return { myTeamId: picked, source: "you" };
  if (fromPlatform) return { myTeamId: fromPlatform, source: "platform" };
  if (picked) return { myTeamId: picked, source: pickSource };
  return { myTeamId: null, source: "none" };
}

function myTeamExplain(source: MyTeamSource, platformLabel: string): string {
  switch (source) {
    case "platform":
      return `${platformLabel} told us which team is yours. You can change it here if that's wrong.`;
    case "you":
      return "You picked this team. It's saved for this browser session.";
    case "link":
      return `We took this team from the ${platformLabel} link you pasted. ${platformLabel} uses the same kind of link for every team's page, so check that it's yours, or pick the right one.`;
    case "none":
      return `We couldn't tell which team is yours (${platformLabel} doesn't say for this kind of import). Pick it so trade ideas are for your team.`;
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
  if (response.espnCookieSource === "dev-env") return { note: "Imported with ESPN cookies from .env.local (development only).", canForget: false };
  return { note: "Imported with your ESPN cookies from this browser session.", canForget: true };
}

export function buildImportReport(response: ImportResponse, opts: ReportOptions): ImportReportView {
  const snapshot = response.snapshot;
  const { settings, platform } = snapshot;
  const platformLabel = PLATFORM_LABEL[platform];
  const teamById = new Map(snapshot.teams.map((t) => [t.id, t]));
  const teamName = (id: string) => teamById.get(id)?.name ?? `Team ${id}`;

  const { myTeamId, source: myTeamSource } = resolveMyTeam(snapshot, opts, (id) => teamById.has(id));
  const fromPlatform = snapshot.myTeamId && teamById.has(snapshot.myTeamId) ? snapshot.myTeamId : null;

  const unknownSet = new Set(settings.unknownSettings ?? []);
  const unknown = UNKNOWN_SETTINGS.filter((s) => unknownSet.has(s));
  const deadlineUnknown = unknownSet.has("tradeDeadline");
  const reviewUnknown = unknownSet.has("tradeReview");
  const playoffsUnknown = unknownSet.has("playoffs");

  const hasDefSlot = settings.lineup.some((s) => s.eligible.includes("DEF"));
  const scoring = buildScoring(settings, platform, hasDefSlot);
  const lineup = buildLineup(settings, platform);
  const season = buildSeason(snapshot, teamName, unknownSet);
  const players = buildPlayers(snapshot);
  const warnings = snapshot.warnings;

  const trades = {
    deadline: deadlineUnknown ? UNKNOWN_SETTING_TEXT : deadlineText(settings, opts.timeZone, false),
    review: reviewUnknown ? UNKNOWN_SETTING_TEXT : TRADE_REVIEW_LABEL[settings.tradeReview],
    faab: settings.faabBudget !== undefined ? `$${fmtNum(settings.faabBudget)} FAAB budget` : "No FAAB budget reported",
  };
  const deadlineTile: GlanceTile = {
    id: "deadline",
    label: "Trade deadline",
    value: deadlineUnknown ? "Unknown" : deadlineText(settings, opts.timeZone, true),
    detail: reviewUnknown ? "Review unknown — check your league's settings" : deadlineUnknown ? `Check your league's settings · ${TRADE_REVIEW_LABEL[settings.tradeReview]}` : TRADE_REVIEW_LABEL[settings.tradeReview],
    tone: deadlineUnknown || reviewUnknown ? "warn" : "normal",
  };

  const benchText = [`${lineup.bench} bench`, `${lineup.ir} IR`, ...(lineup.taxi ? [`${lineup.taxi} taxi`] : [])].join(" · ");
  // Adapters warn once per unmapped scoring rule (ESPN_SCORING_UNMAPPED, SCORING_RULE_UNMAPPED/PARTIAL);
  // count only the unmapped rules no warning already covers, so nothing is counted twice.
  const unmappedWarned = warnings.filter((w) => /SCORING/.test(w.code) && /UNMAPPED|PARTIAL/.test(w.code)).length;
  const warnCount = warnings.length + Math.max(0, scoring.unmapped.length - unmappedWarned);
  const glance: GlanceTile[] = [
    { id: "league", label: "League", value: `${settings.numTeams} teams · ${LEAGUE_TYPE_LABEL[settings.leagueType]}`, detail: settings.bestBall ? "Best ball" : PLATFORM_LABEL[platform], tone: "normal" },
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
    {
      id: "warnings",
      label: "Warnings",
      value: warnCount ? plural(warnCount, "item") : "None",
      detail: scoring.unmapped.length ? `${plural(scoring.unmapped.length, "scoring rule")} we couldn't map` : undefined,
      tone: warnCount ? "warn" : "normal",
    },
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
    },
    unknown,
    glance,
    scoring,
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
      explain: myTeamExplain(myTeamSource, platformLabel),
    },
    players,
    schedule: buildSchedule(snapshot, myTeamId, teamName),
    activity,
    notes: response.notes,
    warnings,
    timestamps,
  };
}

/**
 * What the Refresh button achieved, for an always-mounted status line (§2.10: league data cached
 * under a minute ago is served again, so a second Refresh within the minute changes nothing).
 * `before`/`after` are the snapshot's fetchedAt; the time is passed in.
 */
export function refreshOutcomeText(args: { before: string; after: string; now: Date; platform: Platform; timeZone: string }): string {
  const before = Date.parse(args.before);
  const after = Date.parse(args.after);
  if (Number.isFinite(after) && !(Number.isFinite(before) && after <= before)) return `Refreshed: ${PLATFORM_LABEL[args.platform]} data from ${formatTime(args.after, args.timeZone)}`;
  const seconds = Number.isFinite(after) ? Math.max(0, Math.round((args.now.getTime() - after) / 1000)) : 0;
  const ago = seconds < 120 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
  return `Already up to date (fetched ${ago} ago; Refresh works once a minute)`;
}
