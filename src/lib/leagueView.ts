/**
 * League page view model (CLAUDE.md §14 item 3): the team table with needs and surplus chips, the
 * positional strength heatmap, best trade partners (§7), roster tables with each team's best
 * free-agent move and each player's rest-of-season points and week-by-week breakdown (§6 step 7),
 * the best free agents, values (§9) and "how these numbers work". A PURE function from the snapshot,
 * the computed LeagueModel and its model inputs, so the page only lays things out and every word and
 * number is unit-tested. The time zone and "now" are passed in (no clock reads here).
 *
 * Team points shown here are plain projected lineup points (Σ LV over the weeks team numbers count).
 * The engine's ROS(T) weights playoff weeks by config.lineups.playoffWeight for trade math; "Lineup
 * cost" (MV_lose, §7) and the free-agent move's gain keep that weighting, so the page calls them
 * "lineup pts", never "ROS pts", says where playoff weeks count extra, and the explainer spells it out.
 *
 * Game days (LeagueModel.inProgressWeek; CLAUDE.md §7, Phase 2 review decisions): once a game of the
 * current week has kicked off, the team numbers (Proj/wk, team ROS points, strength, needs, lineup
 * costs, the free-agent move, partners) skip that week, as the engine's do. The header, the team table
 * and the heatmap say which weeks they count, and a player's row for a game already under way shows
 * "—" and "Game already started" (not a 0% chance to play).
 */
import { config } from "@/engine/config";
import type { FantasyCalcFormat, ModelInputs } from "@/engine/inputs";
import type { LeagueModel, LineupValues, PlayerModel, SlotStrength, TeamModel, ValueSource } from "@/engine/leagueModel";
import { fantasyCalcFormat, fantasyCalcFormatLabel } from "@/engine/market";
import { POSITIONS, type InjuryStatus, type LeagueSettings, type LeagueSnapshot, type PlayerInfo, type Pos, type Team } from "@/engine/model";
import { fmtNum, fmtSigned, fmtWhole, formatShortDateTime, plural, recordText } from "./format";
import { INJURY_LABEL, PLATFORM_LABEL, posLabel } from "./labels";
import type { MyTeamSource } from "./myTeam";

/** Free agents listed per startable position (a display choice, not a model number). */
export const FREE_AGENTS_SHOWN = 5;

export type StrengthWindow = "ros" | "next";
export type HeatStep = "strong" | "above" | "average" | "below" | "weak";
export type InjuryTone = "muted" | "warn" | "danger";

export const HEAT_STEPS: readonly HeatStep[] = ["strong", "above", "average", "below", "weak"];
export const HEAT_STEP_LABEL: Record<HeatStep, string> = {
  strong: "Strong",
  above: "Above average",
  average: "Average",
  below: "Below average",
  weak: "Weak",
};

export interface Chip {
  key: string;
  text: string;
  /** Hover and screen-reader detail. */
  title: string;
  kind: "need-ros" | "need-next" | "surplus";
}

export interface TeamRow {
  id: string;
  rank: number;
  name: string;
  isMine: boolean;
  record: string;
  pointsFor: string;
  /** Projected starting-lineup points per week (the rank key); null when no weeks remain. */
  perWeek: number | null;
  perWeekText: string;
  /** Projected starting-lineup points over the weeks team numbers count. */
  rosPoints: number;
  rosText: string;
  needs: Chip[];
  surplus: Chip[];
}

export interface HeatCell {
  key: string;
  value: number;
  text: string;
  z: number;
  step: HeatStep;
  title: string;
}

export interface HeatRow {
  teamId: string;
  name: string;
  isMine: boolean;
  cells: Record<StrengthWindow, HeatCell[]>;
}

export interface Heatmap {
  columns: { key: string; label: string }[];
  rows: HeatRow[];
  windowLabel: Record<StrengthWindow, string>;
  caption: Record<StrengthWindow, string>;
}

export interface PartnerPlayer {
  id: string;
  text: string;
  title: string;
}

export interface PartnerCard {
  teamId: string;
  name: string;
  /** false: their spare players would start for me, but I have no spare player they need (a trade would likely cost me a starter). */
  mutual: boolean;
  /** "Fit 2.4" for a mutual fit; "Would start for you" for a one-sided one (what was measured, whether or not I have needs). */
  fitText: string;
  theyCanGive: PartnerPlayer[];
  youCanGive: PartnerPlayer[];
}

export interface WeekRow {
  week: number;
  /** p_{i,w} (§6 step 4); 0 on his bye and once his game has started. */
  points: number;
  pointsText: string;
  availabilityText: string;
  /** Bye, a game already under way, a current injury… */
  note: string | null;
  playoff: boolean;
  /** His game this week has already kicked off: it no longer counts, and the row shows "—" like a bye. */
  started: boolean;
}

export interface PlayerRow {
  id: string;
  name: string;
  pos: string;
  nflTeam: string;
  injury: { short: string; long: string; tone: InjuryTone } | null;
  group: "active" | "ir" | "taxi" | "fa";
  /** Rest-of-season points (§6 step 7); null when the model has no projection for him. */
  ros: number | null;
  rosText: string;
  /** "98 / 32": regular season / playoffs (just the total when the league has no playoff weeks left). */
  splitText: string;
  gamesText: string;
  byeText: string;
  /** `srText`: what "~" means, for screen readers ("(our estimate)", "(our minimum value)"); null for FantasyCalc's own value. */
  value: { text: string; estimated: boolean; title: string; srText: string | null } | null;
  /** MV_lose (§7): lineup points his team loses without him (LeagueView.lineupCostTitle); null off the active roster. */
  lineupCost: string | null;
  weeks: WeekRow[];
  /** The week-by-week breakdown as plain text (hover). */
  weeksText: string;
}

/** How a team's best free-agent move is introduced in its roster header. */
export const FREE_AGENT_MOVE_LABEL = "Best free-agent move";

/** A team's best free-agent move (§7; TeamModel.waiver), for its roster header. */
export interface FreeAgentMove {
  /** "add Floopy Freeman (RB, CAR), drop Tobias Thimble", or "add Floopy Freeman (RB, CAR) into an open spot". */
  move: string;
  /** "+4.6 lineup pts": lineup points it gains over the rest of the season (scenario lineups when computed, else expected-value ones), weighted like lineup cost. */
  gain: string;
  /** "(playoffs count 1.25×)" while playoff weeks are counted, so the gain isn't read as plain ROS points; else null. */
  weighting: string | null;
  /** The whole line: "Best free-agent move: add …: +4.6 lineup pts (playoffs count 1.25×)". */
  text: string;
}

export interface RosterCard {
  teamId: string;
  name: string;
  isMine: boolean;
  summary: string;
  /** The team's best free-agent move, or null when none gains at least a tenth of a point. */
  waiver: FreeAgentMove | null;
  players: PlayerRow[];
}

export interface FreeAgentGroup {
  pos: string;
  players: PlayerRow[];
}

export interface ExplainItem {
  title: string;
  text: string;
}

export interface LeagueView {
  header: {
    name: string;
    platformLabel: string;
    season: number;
    /** "Week 4 · as of Wed, Sep 30, 9:08 PM" (the date always, and the year when it isn't this year). */
    weekLine: string;
    /** "Week 12 is under way, so team numbers start with week 13." while the current week is in progress; else null. */
    inProgress: string | null;
    /** Where the base rates came from (model.projection.sources): "Sleeper", "ESPN and Sleeper, averaged", "ESPN"… */
    projections: string;
    /** The FantasyCalc format label, or null when values are unavailable. */
    valuesFormat: string | null;
    /** "10 weeks left: 7 regular season, 3 playoffs". */
    weeksLeft: string;
  };
  myTeam: {
    id: string | null;
    name: string | null;
    source: MyTeamSource;
    /** Shown with a link to the Import Report's picker when the team is missing or only guessed. */
    hint: string | null;
  };
  teams: TeamRow[];
  /** Under the team table: what the ranking counts ("Ranked by projected points per week from week 13 on (week 12 is under way)."). */
  teamsNote: string;
  heatmap: Heatmap;
  partners: { cards: PartnerCard[]; empty: string | null };
  rosters: RosterCard[];
  freeAgents: FreeAgentGroup[];
  /** The Lineup cost column's definition (hover), with the playoff weighting when it applies. */
  lineupCostTitle: string;
  explain: ExplainItem[];
  sources: { label: string; value: string }[];
  warnings: string[];
  /** The model inputs' notes the page doesn't already show (the values' format and its substitutions are shown once, elsewhere). */
  notes: string[];
  /** The season has no weeks left to project. */
  over: boolean;
  /** Playoff weeks remain, so ROS points are split "regular / playoffs". */
  playoffsLeft: boolean;
}

export interface LeagueViewInput {
  snapshot: LeagueSnapshot;
  model: LeagueModel;
  inputs: ModelInputs;
  /** How "my team" (model.myTeamId) was chosen. */
  myTeamSource: MyTeamSource;
  /** IANA time zone for times (the viewer's own). */
  timeZone: string;
  /** The moment the model was computed for (ISO): a game that kicked off before it is marked. */
  now: string;
}

// ---------------------------------------------------------------------------------------------
// Small helpers

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** "a", "a and b", "a, b and c". */
function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "weeks 13–17", "week 17", or "" for no weeks (a sorted run). */
function weekSpan(weeks: readonly number[]): string {
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  if (first === undefined || last === undefined) return "";
  return first === last ? `week ${first}` : `weeks ${first}–${last}`;
}

const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
/** Words that belong to the last name ("St. Brown", "Van Noy", "De La Cruz"). */
const PARTICLE = /^(st\.?|van|von|vander|der|den|de|da|di|du|del|della|la|le)$/i;

/**
 * "Justin Jefferson" → "J. Jefferson": first initial and last name, suffixes and middle names
 * dropped ("Travis Etienne Jr." → "T. Etienne"), name particles kept ("Amon-Ra St. Brown" →
 * "A. St. Brown"). Team defenses stay as they are.
 */
export function shortName(name: string, pos?: Pos): string {
  const trimmed = name.trim();
  if (pos === "DEF") return trimmed;
  const parts = trimmed.split(/\s+/);
  while (parts.length > 2 && SUFFIX.test(parts[parts.length - 1] ?? "")) parts.pop();
  if (parts.length < 2) return trimmed;
  let start = parts.length - 1;
  while (start > 1 && PARTICLE.test(parts[start - 1] ?? "")) start--;
  return `${(parts[0] ?? "").charAt(0)}. ${parts.slice(start).join(" ")}`;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

const INJURY_TONE: Record<InjuryStatus, InjuryTone> = {
  ACTIVE: "muted",
  PROBABLE: "muted",
  QUESTIONABLE: "warn",
  DOUBTFUL: "warn",
  OUT: "danger",
  IR: "danger",
  PUP: "danger",
  SUSPENDED: "danger",
  NA: "muted",
};

/**
 * Heatmap step from a strength z-score. The steps are |needZThreshold| wide, so a "below" or "weak"
 * cell is exactly a need (§7: z ≤ needZThreshold).
 */
export function heatStep(z: number, needZThreshold: number = config.lineups.needZThreshold): HeatStep {
  const step = Math.abs(needZThreshold);
  if (z <= -2 * step) return "weak";
  if (z <= -step) return "below";
  if (z >= 2 * step) return "strong";
  if (z >= step) return "above";
  return "average";
}

/** The lineup values the page shows: availability scenarios when computed (§7), else expected-value lineups. */
function lineupOf(team: TeamModel): LineupValues {
  return team.scen ?? team.ev;
}

/**
 * The first index into model.weeks that team numbers count: 1 while the current week is in progress
 * (LeagueModel.inProgressWeek, when it is the first week), else 0. The engine's teamWeeks().from.
 */
function teamFrom(model: LeagueModel): number {
  return model.inProgressWeek !== null && model.weeks.length > 0 && model.weeks[0] === model.inProgressWeek ? 1 : 0;
}

/**
 * Points per week: PPW over the remaining regular season (the engine's, which skips a week in
 * progress); once no regular week is left to count, the average over the playoff weeks left.
 */
function perWeekOf(team: TeamModel, model: LeagueModel, from: number): number | null {
  const lv = lineupOf(team);
  const regular = new Set(model.regularWeeks);
  if (model.weeks.slice(from).some((w) => regular.has(w))) return lv.ppw;
  const rest = lv.lv.slice(from);
  return rest.length ? sum(rest) / rest.length : null;
}

const VALUE_TITLE: Record<ValueSource, string> = {
  fantasycalc: "FantasyCalc trade value",
  estimate: "Our estimate from his projected points (FantasyCalc doesn't value him)",
  floor: "Our minimum value (FantasyCalc values too few players at his position to estimate)",
};

/** What "~" means, read to screen readers after the value. */
const VALUE_SR: Record<ValueSource, string | null> = {
  fantasycalc: null,
  estimate: "(our estimate)",
  floor: "(our minimum value)",
};

// ---------------------------------------------------------------------------------------------
// Players

interface PlayerContext {
  snapshot: LeagueSnapshot;
  model: LeagueModel;
  inputs: ModelInputs;
  now: number;
  playoffWeeks: ReadonlySet<number>;
  hasPlayoffs: boolean;
}

function kickedOff(ctx: PlayerContext, info: PlayerInfo | undefined): boolean {
  const team = info?.nflTeam;
  if (!team) return false;
  const kickoff = ctx.inputs.nfl.kickoffs[ctx.snapshot.currentWeek]?.[team];
  if (!kickoff) return false;
  const t = Date.parse(kickoff);
  return Number.isFinite(t) && t <= ctx.now;
}

/** Why a week looks the way it does: his bye, a game already under way, his current injury status. */
function weekNote(info: PlayerInfo | undefined, index: number, w: { a: number; bye: boolean }, started: boolean): string | null {
  if (w.bye) return "Bye";
  if (started) return "Game already started";
  const label = INJURY_LABEL[info?.injury ?? "ACTIVE"];
  if (label && (index === 0 || w.a === 0)) return label.long;
  if (info && !info.nflTeam) return "No NFL team";
  if (w.a === 0) return "Out";
  return null;
}

function weekRows(ctx: PlayerContext, info: PlayerInfo | undefined, pm: PlayerModel | undefined): WeekRow[] {
  if (!pm) return [];
  return ctx.model.weeks.map((week, i) => {
    const w = pm.weekly[i] ?? { p: 0, a: 0, m: 1, bye: false, sd: 0 };
    // A game under way (or over) this week: the engine counts it 0 (§6 step 3). It isn't a 0% chance
    // he plays, so the row reads like a bye: "—" and the note.
    const started = !w.bye && i === 0 && week === ctx.snapshot.currentWeek && w.a === 0 && kickedOff(ctx, info);
    const blank = w.bye || started;
    return {
      week,
      points: blank ? 0 : w.p,
      pointsText: blank ? "—" : fmtNum(w.p, 1),
      availabilityText: blank ? "—" : pct(w.a),
      note: weekNote(info, i, w, started),
      playoff: ctx.playoffWeeks.has(week),
      started,
    };
  });
}

function weeksText(rows: readonly WeekRow[]): string {
  return rows
    .map((r) => {
      const detail = r.note === "Bye" ? "bye" : r.started ? "game already started" : `${r.pointsText} pts, ${r.availabilityText}${r.note ? ` · ${r.note}` : ""}`;
      return `Wk ${r.week}${r.playoff ? " (playoffs)" : ""}: ${detail}`;
    })
    .join("\n");
}

function byeText(pm: PlayerModel | undefined): string {
  const bye = pm?.ros.bye;
  if (!bye || bye.status === "unknown") return "bye unknown";
  if (bye.status === "done") return "bye done";
  return `bye wk ${bye.week}`;
}

function playerRow(ctx: PlayerContext, id: string, group: PlayerRow["group"], team: TeamModel | undefined): PlayerRow {
  const info = ctx.snapshot.players[id];
  const pm = ctx.model.players[id];
  const injury = info ? INJURY_LABEL[info.injury] : null;
  const weeks = weekRows(ctx, info, pm);
  const tv = team?.players[id];
  const cost = tv ? (tv.mvLoseScen ?? tv.mvLoseEv) : null;
  const ros = pm ? pm.ros.total : null;
  const value = pm?.value ?? null;
  return {
    id,
    name: info?.name ?? `Unknown player (${id})`,
    pos: info ? posLabel(info.pos, ctx.snapshot.platform) : "—",
    nflTeam: info?.nflTeam ?? "FA",
    injury: injury && info ? { ...injury, tone: INJURY_TONE[info.injury] } : null,
    group,
    ros,
    rosText: ros === null ? "—" : fmtWhole(ros),
    splitText: pm ? (ctx.hasPlayoffs ? `${fmtWhole(pm.ros.regular)} / ${fmtWhole(pm.ros.playoffs)}` : fmtWhole(pm.ros.regular)) : "—",
    gamesText: pm ? plural(pm.ros.gamesLeft, "game") : "—",
    byeText: byeText(pm),
    value: value
      ? { text: `${value.source === "fantasycalc" ? "" : "~"}${fmtWhole(value.value)}`, estimated: value.source !== "fantasycalc", title: VALUE_TITLE[value.source], srText: VALUE_SR[value.source] }
      : null,
    lineupCost: cost === null ? null : fmtNum(cost, 1),
    weeks,
    weeksText: weeksText(weeks),
  };
}

const POS_ORDER = new Map(POSITIONS.map((p, i) => [p, i]));

/** Roster order: by position (QB, RB, WR, TE, K, DEF, IDP), then ROS points, then name. */
function byPositionThenRos(snapshot: LeagueSnapshot, rows: PlayerRow[]): PlayerRow[] {
  const posIndex = (id: string) => {
    const pos = snapshot.players[id]?.pos;
    return pos ? (POS_ORDER.get(pos) ?? 99) : 99;
  };
  return rows.sort((a, b) => posIndex(a.id) - posIndex(b.id) || (b.ros ?? -1) - (a.ros ?? -1) || a.name.localeCompare(b.name));
}

/** A team defense's name that already says it's one ("Vikings D/ST", "MIN D/ST"). */
const DEFENSE_NAME = /(^|\s)(D\/ST|DST|DEF|Defense)(\s|$)/i;

/**
 * A team's best free-agent move (TeamModel.waiver): add the best free agent, dropping the player
 * whose loss hurts least, or into an open roster spot. Its gain uses scenario lineups when they were
 * computed, else expected-value lineups, like lineup cost, and is in the same lineup points (playoff
 * weeks weighted: `weighting` says so). Shown only when it gains at least 0.1 as printed: a scenario
 * gain can round to nothing even when the expected-value one doesn't. The added player gets his
 * position and NFL team; a team defense's name is its team, and says it's a defense too on ESPN
 * ("Vikings D/ST", but Sleeper's "Minnesota Vikings (DEF)").
 */
function freeAgentMove(snapshot: LeagueSnapshot, team: TeamModel | undefined, weighting: string | null): FreeAgentMove | null {
  const w = team?.waiver;
  if (!w) return null;
  const gain = w.gainScen ?? w.gainEv;
  if (!(Math.round(gain * 10) > 0)) return null;
  const add = snapshot.players[w.add];
  const pos = add ? posLabel(add.pos, snapshot.platform) : "";
  const addText = !add
    ? `Unknown player (${w.add})`
    : add.pos === "DEF"
      ? DEFENSE_NAME.test(add.name)
        ? add.name
        : `${add.name} (${pos})`
      : `${add.name} (${pos}${add.nflTeam ? `, ${add.nflTeam}` : ""})`;
  const move = w.drop === null ? `add ${addText} into an open spot` : `add ${addText}, drop ${snapshot.players[w.drop]?.name ?? `Unknown player (${w.drop})`}`;
  const gainText = `${fmtSigned(gain, 1)} lineup pts`;
  return { move, gain: gainText, weighting, text: `${FREE_AGENT_MOVE_LABEL}: ${move}: ${gainText}${weighting ? ` ${weighting}` : ""}` };
}

// ---------------------------------------------------------------------------------------------
// Teams

function slotLabels(model: LeagueModel): Map<string, string> {
  return new Map(model.slots.map((s) => [s.key, s.label]));
}

interface SlotMedians {
  ros: Map<string, number>;
  next: Map<string, number>;
}

function slotMedians(model: LeagueModel): SlotMedians {
  const ros = new Map<string, number>();
  const next = new Map<string, number>();
  for (const s of model.slots) {
    const values = model.teams.map((t) => t.strength[s.key]).filter((x): x is SlotStrength => !!x);
    ros.set(s.key, median(values.map((v) => v.ros)));
    next.set(s.key, median(values.map((v) => v.next)));
  }
  return { ros, next };
}

function needChips(team: TeamModel, labels: Map<string, string>, medians: SlotMedians, nextWeeks: number): Chip[] {
  return [...team.needs]
    .sort((a, b) => a.z - b.z)
    .slice(0, config.needs.needsShown)
    .map((n) => {
      const label = labels.get(n.slot) ?? n.slot;
      const s = team.strength[n.slot];
      const windowWords = n.window === "ros" ? "rest of season" : `next ${plural(nextWeeks, "week")}`;
      const value = s ? (n.window === "ros" ? s.ros : s.next) : null;
      const med = (n.window === "ros" ? medians.ros : medians.next).get(n.slot);
      const detail = value !== null && med !== undefined ? `: ${fmtNum(value, 1)} pts/wk vs the league median ${fmtNum(med, 1)}` : "";
      return {
        key: `${n.window}-${n.slot}`,
        text: n.window === "ros" ? label : `${label} · next ${nextWeeks} ${nextWeeks === 1 ? "wk" : "wks"}`,
        title: `Need at ${label} (${windowWords})${detail}`,
        kind: n.window === "ros" ? ("need-ros" as const) : ("need-next" as const),
      };
    });
}

function surplusChips(snapshot: LeagueSnapshot, team: TeamModel): Chip[] {
  return [...team.surplus]
    .sort((a, b) => b.score - a.score)
    .slice(0, config.needs.surplusShown)
    .map((s) => {
      const info = snapshot.players[s.playerId];
      const name = info?.name ?? s.playerId;
      return {
        key: s.playerId,
        text: shortName(name, info?.pos),
        title: `${name}${info ? ` (${posLabel(info.pos, snapshot.platform)})` : ""}: would start for ${plural(s.startsFor, "other team")}`,
        kind: "surplus" as const,
      };
    });
}

function heatCell(key: string, label: string, teamName: string, s: SlotStrength | undefined, window: StrengthWindow, med: number, windowWords: string): HeatCell {
  const value = s ? (window === "ros" ? s.ros : s.next) : 0;
  const z = s ? (window === "ros" ? s.zRos : s.zNext) : 0;
  const step = heatStep(z);
  return {
    key,
    value,
    text: fmtNum(value, 1),
    z,
    step,
    title: `${teamName} · ${label}: ${fmtNum(value, 1)} pts/wk, ${HEAT_STEP_LABEL[step].toLowerCase()} (league median ${fmtNum(med, 1)}, ${windowWords})`,
  };
}

// ---------------------------------------------------------------------------------------------
// Trade values and notes

interface ValuesShown {
  /** The FantasyCalc format the page's values are in (a keeper league's redraft list), or null without values. */
  label: string | null;
  /** Where that format differs from the league, for the explainer. */
  substitutions: string[];
  /** Everything the page says about the values' format (the server's notes repeating it are dropped). */
  said: string[];
}

/**
 * The values' FantasyCalc format (§2.9, §9). A keeper league's market format is its dynasty list (the
 * future term); the page shows its redraft values (perception). Both formats share their size, PPR
 * and TE substitutions and differ in one line saying which list is used, which the explainer's
 * keeper sentence covers, so only the shared ones are listed.
 */
function valuesShown(settings: LeagueSettings, market: FantasyCalcFormat | null): ValuesShown {
  if (!market) return { label: null, substitutions: [], said: [] };
  const keeper = settings.leagueType === "keeper";
  const shown = keeper ? fantasyCalcFormat(settings, "redraft") : market;
  const label = fantasyCalcFormatLabel(shown);
  const substitutions = keeper ? shown.substitutions.filter((s) => market.substitutions.includes(s)) : shown.substitutions;
  return { label, substitutions, said: [label, ...shown.substitutions, ...market.substitutions] };
}

/**
 * The inputs' notes minus what the page already says, filtered like the Import Report's model notes:
 * the server's "Trade values: FantasyCalc <format>." note and its one-per-substitution notes repeat
 * the header's format and the "Trade values" explanation, so a note containing any of that is dropped.
 */
function pageNotes(notes: readonly string[], said: readonly string[]): string[] {
  const shown = said.filter(Boolean);
  return [...new Set(notes.filter((n) => !shown.some((s) => n.includes(s))))];
}

/**
 * How the players FantasyCalc doesn't value got theirs (§9, src/engine/market.ts marketValues): a
 * curve estimate from projected points, or, at a position where FantasyCalc values too few players
 * for a curve (it has no kickers, defenses or IDP), a flat minimum whatever he projects. Says only
 * what this league's players actually got.
 */
function unvaluedText(snapshot: LeagueSnapshot, model: LeagueModel): string {
  let estimates = false;
  const floorPositions = new Set<Pos>();
  const floorValues = new Set<string>();
  for (const [id, pm] of Object.entries(model.players)) {
    if (pm.value?.source === "estimate") estimates = true;
    if (pm.value?.source !== "floor") continue;
    const pos = snapshot.players[id]?.pos;
    if (pos) floorPositions.add(pos);
    floorValues.add(fmtWhole(pm.value.value));
  }
  const estimate = "Players FantasyCalc doesn't value (it skips deep bench players) get our estimate from their projected points";
  let floor = "";
  if (floorPositions.size) {
    const positions = listText(POSITIONS.filter((p) => floorPositions.has(p)).map((p) => posLabel(p, snapshot.platform)));
    const [only] = floorValues;
    const amount = floorValues.size === 1 && only !== undefined ? ` (~${only})` : "";
    floor = `At ${positions}, FantasyCalc values too few players to estimate from, so those without a FantasyCalc value get a flat minimum value${amount}, whatever they project`;
  }
  if (estimates && floor) return ` ${estimate}. ${floor}. Both are marked ~.`;
  if (estimates) return ` ${estimate}, marked ~.`;
  if (floor) return ` ${floor}, marked ~.`;
  return "";
}

// ---------------------------------------------------------------------------------------------
// Projection source

interface ProjectionSource {
  /** The header's "Projected points: …". */
  label: string;
  /** Completes "A player's points per game start from …". */
  from: string;
  /** Sleeper's weekly projections loaded for someone (the matchup adjustment comes from them). */
  sleeperWeekly: boolean;
}

/**
 * Where the base rates actually came from (§6 step 1; model.projection.sources counts players by
 * source), rather than assuming Sleeper: ESPN's own projections carry an ESPN league when Sleeper's
 * didn't load, and Sleeper's season projections or points so far are last resorts.
 */
function projectionSource(snapshot: LeagueSnapshot, model: LeagueModel): ProjectionSource {
  const s = model.projection.sources;
  const agreement = model.projection.agreement;
  const sleeper = s.sleeper + s["espn+sleeper"];
  const espnAlone = s.espn;
  const scored = "scored with your league's rules";
  const espnFor = espnAlone ? `ESPN's own for ${plural(espnAlone, "player")} Sleeper doesn't project` : "";
  if (model.projection.espnAveraged && s["espn+sleeper"] > 0) {
    return {
      label: "ESPN and Sleeper, averaged",
      from: `Sleeper's projection, ${scored}, averaged with ESPN's own projection (they agree within ${pct(agreement?.meanRelDiff ?? 0)} on average this week)${espnFor ? `; ${espnFor}` : ""}`,
      sleeperWeekly: true,
    };
  }
  if (sleeper > 0 && sleeper >= espnAlone) {
    let from = `Sleeper's projection, ${scored}${espnFor ? ` (${espnFor})` : ""}`;
    if (snapshot.platform === "espn" && agreement) {
      from += `. ESPN's own projections differ from Sleeper's by ${pct(agreement.meanRelDiff)} on average this week, more than the ${pct(config.projections.espnSleeperAgreement)} we allow, so we don't average them in`;
    }
    return { label: "Sleeper", from, sleeperWeekly: true };
  }
  if (espnAlone > 0) {
    return { label: "ESPN", from: `ESPN's own projection, in your league's scoring (Sleeper's projections ${sleeper ? `cover only ${plural(sleeper, "player")}` : "didn't load"})`, sleeperWeekly: sleeper > 0 };
  }
  if (s.season > 0) return { label: "Sleeper's season projections", from: `Sleeper's season projection per game, ${scored} (its weekly projections didn't load)`, sleeperWeekly: false };
  if (s.actual > 0) return { label: "points scored so far", from: "his points per game so far (no projections loaded)", sleeperWeekly: false };
  return { label: "none loaded", from: "his projection, but none loaded", sleeperWeekly: false };
}

// ---------------------------------------------------------------------------------------------
// Explainer

function injuryTableText(): string {
  const inj = config.projections.injury;
  const out = inj.OUT.map((a, i) => `${pct(a)} ${i === 0 ? "this week" : i === 1 ? "next week" : `in ${i} weeks`}`).join(", ");
  return `Out: ${out}; Doubtful ${pct(inj.DOUBTFUL[0] ?? 0)}, Questionable ${pct(inj.QUESTIONABLE[0] ?? 0)} and Probable ${pct(inj.PROBABLE[0] ?? 0)} this week; IR: out until his expected return, or ${inj.irUnknown.outWeeks} weeks when none is known`;
}

function missShareText(): string {
  const m = config.projections.injuryRisk.missShare;
  return (["RB", "TE", "WR", "QB", "K"] as const).map((p) => `${p} ${pct(m[p])}`).join(", ");
}

interface ExplainContext {
  snapshot: LeagueSnapshot;
  model: LeagueModel;
  values: ValuesShown;
  keeper: boolean;
  source: ProjectionSource;
  /** The first model week team numbers count (teamFrom). */
  from: number;
  /** Playoff weeks are among the weeks team numbers count, so lineup points weight them. */
  playoffWeighted: boolean;
}

function buildExplain(c: ExplainContext): ExplainItem[] {
  const { snapshot, model, values } = c;
  const p = config.projections;
  const weeks = model.weeks;
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const seasonOver = weeks.length === 0;
  const matchup = seasonOver
    ? ""
    : c.source.sleeperWeekly
      ? ` Each week is then adjusted for the matchup (between ${p.weekShapeClamp[0]}× and ${p.weekShapeClamp[1]}× his usual).`
      : " There's no week-to-week matchup adjustment: it comes from Sleeper's weekly projections, which didn't load.";
  const lineupPoints = `starting-lineup points over the rest of the season${c.playoffWeighted ? `, with playoff weeks counted ${config.lineups.playoffWeight}× (they decide titles), so they don't add up exactly with ROS points` : ""}`;
  const items: ExplainItem[] = [
    {
      title: "Projected points",
      text: seasonOver
        ? "The season is over, so nothing is projected: projections aren't requested once no fantasy weeks are left."
        : `A player's points per game start from ${c.source.from}. Recent form counts too: up to ${pct(p.actualWeight)} once he has played ${p.actualFullGames} games.${matchup}`,
    },
    {
      title: "Availability",
      text: `Each week's points are multiplied by the chance he plays: 0 on his bye; for a current injury, ${injuryTableText()}; and the chance of a new injury, which grows the further ahead you look, toward each position's long-run share of games missed (${missShareText()}).`,
    },
    {
      title: "Depth counts",
      text: model.scenarios
        ? `Team numbers use each team's best lineup in ${model.scenarios} simulated runs of injuries and byes, so a bench player who fills in when a starter is hurt or on bye gets credit. A lineup built from average availability would miss that.`
        : "Team numbers use each team's best lineup from each week's average projections.",
    },
    {
      title: "Rest-of-season (ROS) points",
      text:
        first !== undefined && last !== undefined
          ? `ROS points count only the games left, from week ${first} through week ${last}${model.playoffWeeks.length ? " (the last playoff week), split into regular season and playoffs" : ""}. A player whose bye is done has one more game left than one whose bye is still coming. Lineup cost and each team's best free-agent move (shown at the top of its roster when one helps) are in lineup points: ${lineupPoints}. Lineup cost is how many his team would lose without him (it would pick up the best free agent in his place). It's measured after the team's best free-agent move, so it's never negative.`
          : "The season is over, so there are no games left to project.",
    },
  ];
  const inProgress = c.from > 0 ? model.inProgressWeek : null;
  if (inProgress !== null) {
    const next = weeks[c.from];
    items.push({
      title: `Week ${inProgress} is under way`,
      text: `Once a week's first game kicks off, the team numbers (points per week, team ROS points, positional strength, needs, lineup cost, free-agent moves and trade partners) ${next === undefined ? "have no full week left to count" : `count from the next week, week ${next}`}: lineups are locking and week ${inProgress}'s points are being scored, so it no longer says how good a team is. A player's own ROS points still count his week ${inProgress} game if it hasn't kicked off; one that has shows "Game already started".`,
    });
  }
  items.push(
    {
      title: "Trade values",
      text: values.label
        ? `Values come from FantasyCalc in your league's format (${values.label}).${c.keeper ? (model.market.format?.isDynasty === false ? " In a keeper league these are its redraft values, how managers see a trade this season; its dynasty values, for long-term worth, didn't load this time." : " In a keeper league these are its redraft values, how managers see a trade this season; its dynasty values, for long-term worth, come into play with trade suggestions.") : ""}${values.substitutions.length ? ` Where your league doesn't match one of FantasyCalc's formats exactly: ${values.substitutions.join("; ")}.` : ""}${unvaluedText(snapshot, model)}`
        : "FantasyCalc's values couldn't be loaded, so trade values are missing for now. Refresh to try again.",
    },
    {
      title: "Needs, surplus and partners",
      text: `A need is a lineup slot where a team's starter is at least ${Math.abs(config.lineups.needZThreshold)} standard deviations below the league median, for the rest of the season or just the next ${config.lineups.strengthWeeks} weeks. Surplus is a valuable player his team would barely miss who would start for another team. Trade partners are teams whose surplus fills your needs while yours fills theirs; teams with a spare player who would start for you, but who need nothing you can spare, come after them.${model.market.format ? "" : " Surplus and partners need trade values, so they're hidden while FantasyCalc's values are unavailable."}`,
    },
  );
  return items;
}

// ---------------------------------------------------------------------------------------------

export function buildLeagueView(input: LeagueViewInput): LeagueView {
  const { snapshot, model, inputs, timeZone } = input;
  const platformLabel = PLATFORM_LABEL[snapshot.platform];
  const teamById = new Map<string, Team>(snapshot.teams.map((t) => [t.id, t]));
  const teamName = (id: string) => teamById.get(id)?.name ?? `Team ${id}`;
  const myTeamId = model.myTeamId && teamById.has(model.myTeamId) ? model.myTeamId : null;
  // Team numbers count from `from` (the week after one in progress); countedWeeks are those weeks.
  const from = teamFrom(model);
  const countedWeeks = model.weeks.slice(from);
  const inProgressWeek = from > 0 ? model.inProgressWeek : null;
  // The "next" strength window: config.lineups.strengthWeeks, or fewer near the end of the season.
  const nextWeeks = Math.max(1, Math.min(config.lineups.strengthWeeks, countedWeeks.length));
  // Values shown are §9's perception values: redraft ones in a keeper league (the market's own format is its dynasty list there).
  const keeper = snapshot.settings.leagueType === "keeper";
  const values = valuesShown(snapshot.settings, model.market.format);
  const source = projectionSource(snapshot, model);
  // Lineup points weight playoff weeks (config.lineups.playoffWeight) when any is among the counted weeks.
  const playoffWeight: number = config.lineups.playoffWeight;
  const playoffWeighted = playoffWeight !== 1 && countedWeeks.some((w) => model.playoffWeeks.includes(w));
  const weighting = playoffWeighted ? `(playoffs count ${config.lineups.playoffWeight}×)` : null;
  const nowMs = Date.parse(input.now);
  const ctx: PlayerContext = {
    snapshot,
    model,
    inputs,
    now: Number.isFinite(nowMs) ? nowMs : 0,
    playoffWeeks: new Set(model.playoffWeeks),
    hasPlayoffs: model.playoffWeeks.length > 0,
  };
  const stamp = (iso: string) => formatShortDateTime(iso, timeZone, input.now);

  // Team table: ranked by projected points per week.
  const labels = slotLabels(model);
  const medians = slotMedians(model);
  const teamModels = model.teams.filter((t) => teamById.has(t.id));
  const rows: TeamRow[] = teamModels.map((t) => {
    const team = teamById.get(t.id) as Team;
    const perWeek = perWeekOf(t, model, from);
    const rosPoints = sum(lineupOf(t).lv.slice(from));
    return {
      id: t.id,
      rank: 0,
      name: team.name,
      isMine: t.id === myTeamId,
      record: recordText(team.record),
      pointsFor: fmtNum(team.pointsFor, 1),
      perWeek,
      perWeekText: perWeek === null ? "—" : fmtNum(perWeek, 1),
      rosPoints,
      rosText: fmtWhole(rosPoints),
      needs: needChips(t, labels, medians, nextWeeks),
      surplus: surplusChips(snapshot, t),
    };
  });
  rows.sort((a, b) => (b.perWeek ?? -Infinity) - (a.perWeek ?? -Infinity) || b.rosPoints - a.rosPoints || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  rows.forEach((r, i) => (r.rank = i + 1));
  const order = rows.map((r) => r.id);
  const teamModelById = new Map(teamModels.map((t) => [t.id, t]));
  const firstCounted = countedWeeks[0];
  const teamsNote =
    inProgressWeek !== null && firstCounted !== undefined
      ? `Ranked by projected points per week from week ${firstCounted} on (week ${inProgressWeek} is under way).`
      : "Ranked by projected points per week.";

  // Heatmap: same team order as the table.
  const windowLabel: Record<StrengthWindow, string> = { ros: "Rest of season", next: `Next ${plural(nextWeeks, "week")}` };
  const span = (weeks: readonly number[]) => (weeks.length ? ` (${weekSpan(weeks)})` : "");
  const heatmap: Heatmap = {
    columns: model.slots.map((s) => ({ key: s.key, label: s.label })),
    rows: order.map((id) => {
      const t = teamModelById.get(id) as TeamModel;
      const name = teamName(id);
      const cells = (window: StrengthWindow) =>
        model.slots.map((s) => heatCell(s.key, s.label, name, t.strength[s.key], window, (window === "ros" ? medians.ros : medians.next).get(s.key) ?? 0, windowLabel[window].toLowerCase()));
      return { teamId: id, name, isMine: id === myTeamId, cells: { ros: cells("ros"), next: cells("next") } };
    }),
    windowLabel,
    caption: {
      ros: `Points per week from each team's starter in each lineup slot, rest of season${span(countedWeeks)}. Colors compare each team with the league median.`,
      next: `Points per week from each team's starter in each lineup slot, next ${plural(nextWeeks, "week")}${span(countedWeeks.slice(0, nextWeeks))}. Colors compare each team with the league median.`,
    },
  };

  // Best trade partners (my team only).
  const partnerPlayer = (p: { playerId: string; ppw: number }): PartnerPlayer => {
    const info = snapshot.players[p.playerId];
    const name = info?.name ?? p.playerId;
    return { id: p.playerId, text: `${shortName(name, info?.pos)} (${fmtSigned(p.ppw, 1)}/wk)`, title: `${name}: ${fmtSigned(p.ppw, 1)} points per week to the other lineup` };
  };
  const cards: PartnerCard[] = myTeamId
    ? model.partners
        .filter((p) => teamById.has(p.teamId))
        .slice(0, config.needs.partnersShown)
        .map((p) => ({ teamId: p.teamId, name: teamName(p.teamId), mutual: p.mutual, fitText: p.mutual ? `Fit ${fmtNum(p.score, 1)}` : "Would start for you", theyCanGive: p.theyCanGive.map(partnerPlayer), youCanGive: p.youCanGive.map(partnerPlayer) }))
    : [];
  const partnersEmpty = !myTeamId
    ? "Pick your team to see which teams fit you best as trade partners."
    : cards.length
      ? null
      : model.market.format
        ? "No clear fits right now: no team has a spare player who would start for you."
        : "Trade values couldn't be loaded, so surplus players and trade partners can't be picked right now. Refresh to try again.";

  // Rosters: mine first, then the table's order.
  const rosterOrder = myTeamId ? [myTeamId, ...order.filter((id) => id !== myTeamId)] : order;
  const rosters: RosterCard[] = rosterOrder.map((id) => {
    const team = teamById.get(id) as Team;
    const t = teamModelById.get(id);
    const active = byPositionThenRos(snapshot, team.roster.map((pid) => playerRow(ctx, pid, "active", t)));
    const ir = byPositionThenRos(snapshot, team.ir.map((pid) => playerRow(ctx, pid, "ir", t)));
    const taxi = byPositionThenRos(snapshot, team.taxi.map((pid) => playerRow(ctx, pid, "taxi", t)));
    const row = rows.find((r) => r.id === id);
    const summary = row ? `${row.perWeekText} pts/wk · ${row.rosText} ROS pts` : "";
    return { teamId: id, name: team.name, isMine: id === myTeamId, summary, waiver: freeAgentMove(snapshot, t, weighting), players: [...active, ...ir, ...taxi] };
  });

  // Free agents: the best few by ROS points at each startable position.
  const startable = POSITIONS.filter((pos) => snapshot.settings.lineup.some((s) => s.count > 0 && s.eligible.includes(pos)));
  const faRows = snapshot.freeAgents.filter((id) => model.players[id] && snapshot.players[id]).map((id) => playerRow(ctx, id, "fa", undefined));
  const freeAgents: FreeAgentGroup[] = startable
    .map((pos) => ({
      pos: posLabel(pos, snapshot.platform),
      players: faRows
        .filter((r) => snapshot.players[r.id]?.pos === pos)
        .sort((a, b) => (b.ros ?? 0) - (a.ros ?? 0) || a.name.localeCompare(b.name))
        .slice(0, FREE_AGENTS_SHOWN),
    }))
    .filter((g) => g.players.length > 0);

  // Sources, warnings, notes.
  const sources = [
    { label: `League data from ${platformLabel}`, value: stamp(snapshot.fetchedAt) },
    ...inputs.sources.map((s) => ({ label: s.source, value: `${stamp(s.fetchedAt)}${s.stale ? " (a saved copy: the live fetch failed)" : ""}` })),
  ];
  const warnings = [...new Set([...inputs.warnings.map((w) => w.message), ...model.warnings])];

  const weeks = model.weeks;
  const weeksLeft = weeks.length
    ? `${plural(weeks.length, "week")} left: ${model.regularWeeks.length} regular season${model.playoffWeeks.length || snapshot.settings.playoffWeeks.length ? `, ${model.playoffWeeks.length} playoffs` : ""}`
    : "No weeks left";
  const inProgressLine =
    inProgressWeek === null
      ? null
      : firstCounted === undefined
        ? `Week ${inProgressWeek} is under way and it's the last week, so team numbers have no weeks left to count.`
        : `Week ${inProgressWeek} is under way, so team numbers start with week ${firstCounted}.`;

  const myName = myTeamId ? teamName(myTeamId) : null;
  const hint =
    input.myTeamSource === "none" || !myTeamId
      ? "Pick your team on the Import Report to see your needs and trade partners."
      : input.myTeamSource === "link"
        ? `We guessed ${myName} from your link. Confirm it on the Import Report.`
        : null;

  return {
    header: {
      name: snapshot.name,
      platformLabel,
      season: snapshot.season,
      weekLine: `Week ${snapshot.currentWeek} · as of ${stamp(snapshot.fetchedAt)}`,
      inProgress: inProgressLine,
      projections: source.label,
      valuesFormat: values.label,
      weeksLeft,
    },
    myTeam: { id: myTeamId, name: myName, source: myTeamId ? input.myTeamSource : "none", hint },
    teams: rows,
    teamsNote,
    heatmap,
    partners: { cards, empty: partnersEmpty },
    rosters,
    freeAgents,
    lineupCostTitle: `Rest-of-season lineup points his team would lose without him${playoffWeighted ? `, with playoff weeks counted ${config.lineups.playoffWeight}×` : ""}`,
    explain: buildExplain({ snapshot, model, values, keeper, source, from, playoffWeighted }),
    sources,
    warnings,
    notes: pageNotes(inputs.notes, values.said),
    over: weeks.length === 0,
    playoffsLeft: ctx.hasPlayoffs,
  };
}
