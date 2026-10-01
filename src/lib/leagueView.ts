/**
 * League page view model (CLAUDE.md §14 item 3): the standings with each team's playoff, bye and title
 * odds and my remaining schedule (§8), the team table with need and trade-chip chips, the positional
 * strength heatmap, best trade partners (§7), roster tables with each team's best free-agent move and
 * each player's rest-of-season points and week-by-week breakdown (§6 step 7), the best free agents,
 * values (§9) and "how these numbers work". A PURE function from the snapshot, the computed
 * LeagueModel and its model inputs, so the page only lays things out and every word and number is
 * unit-tested. The time zone and "now" are passed in (no clock reads here).
 *
 * Standings and odds (§8; §17 Checkpoint 3: "next to the current standings"): their own table, in
 * today's standings order by the league's rules (TeamOdds.rank), apart from the team table, which is
 * ranked by projected points per week and carries the chips: one table with both orders and every
 * column wouldn't fit a phone. Odds print as whole percents; "0%" and "100%" only when certain, "<1%"
 * and ">99%" when they merely round there (oddsCell), "—" when unknown. The Playoffs column needs 2+
 * playoff teams and the Bye column byes with known odds (oddsShown); the caption and the explainer name
 * only the odds shown. A points-only league is ranked by points for, so they show on phones there (and
 * the record doesn't). When my team is certainly out in a redraft league, the page says "Your season's
 * over — no trade helps this year." (§8), and the Trade partners card offers no partners (it says why).
 *
 * My remaining schedule (§8 "show each remaining week's risk"): each remaining regular-season week the
 * simulation plays (SeasonOdds.weekly): the opponent, both teams' projected points (TeamModel.score, the
 * simulator's means: for a week in progress, the whole week as if none of its games had started), my win
 * chance (and the median game's), and my likely starters on bye. Likely starters = my best lineup (the
 * engine's exact solver) by each active-roster player's projected points per game left (his ROS points ÷
 * his NFL team's games left), so injured and fading players drop out and nobody is counted twice. A
 * week is flagged risky in words when my win chance is under RISKY_WIN_CHANCE (as printed) or RISKY_BYES
 * or more likely starters are off in a week that counts (both from config.leaguePage): a fantasy bye week
 * without a median game can't change the standings (its Win cell says "no game"). A multi-week matchup
 * whose first weeks are already played says its numbers cover only the weeks still to play (the
 * simulation doesn't read the points scored).
 *
 * Team points shown here are plain projected lineup points (Σ LV over the weeks team numbers count).
 * The engine's ROS(T) weights playoff weeks by config.lineups.playoffWeight for trade math; "Lineup
 * cost" (MV_lose, §7), the free-agent move's gain and trade chips' gaps keep that weighting, so the page
 * calls them "lineup pts", never "ROS pts", says where playoff weeks count extra, and the explainer
 * spells it out.
 *
 * Trade chips (§7; planner reply to Checkpoint 2, answer 2) replaced Phase 2's surplus chips: a chip
 * reads "B. Nix: worth +31 to Team 6" (his gap: what Team 6 would gain minus what his team would lose,
 * in lineup points), and its title gives both parts. Partner cards list each side's chips by what they'd
 * add per week, the first chipsShown and a count of the rest. A player whose ESPN return date conflicts
 * with his tag (§6 step 3, PlayerModel.availabilityNote) says which signal his numbers follow.
 *
 * Game days (LeagueModel.inProgressWeek; CLAUDE.md §7, Phase 2 review decisions): once a game of the
 * current week has kicked off, the team numbers (Proj/wk, team ROS points, strength, needs, lineup
 * costs, the free-agent move, trade chips, partners) skip that week, as the engine's do. The header, the
 * team table and the heatmap say which weeks they count, and a player's row for a game already under way
 * shows "—" and "Game already started" (not a 0% chance to play).
 */
import { config } from "@/engine/config";
import type { FantasyCalcFormat, ModelInputs } from "@/engine/inputs";
import type { AvailabilityNote, LeagueModel, LineupValues, PlayerModel, SeasonOdds, SlotStrength, TeamModel, TeamOdds, ValueSource, WeekOdds } from "@/engine/leagueModel";
import { prepareLeagueSlots, solveLineup, type LineupPlayer } from "@/engine/lineup";
import { fantasyCalcFormat, fantasyCalcFormatLabel } from "@/engine/market";
import { POSITIONS, type InjuryStatus, type LeagueSettings, type LeagueSnapshot, type PlayerInfo, type Pos, type Team } from "@/engine/model";
import { DIVISION_RULE_ASSUMED, weekList } from "@/engine/season";
import { fmtNum, fmtSigned, fmtWhole, formatShortDateTime, plural, recordText } from "./format";
import { INJURY_LABEL, PLATFORM_LABEL, posLabel } from "./labels";
import type { MyTeamSource } from "./myTeam";

/** Free agents listed per startable position (a display choice, not a model number). */
export const FREE_AGENTS_SHOWN = 5;

/** My remaining schedule flags a week as risky below this win chance, as printed (config.leaguePage.riskyWinChance). */
export const RISKY_WIN_CHANCE: number = config.leaguePage.riskyWinChance;
/** …or when this many of my likely starters are on bye that week (config.leaguePage.riskyByes). */
export const RISKY_BYES: number = config.leaguePage.riskyByes;

/** CLAUDE.md §8, word for word: my team is certainly out of the title race in a redraft league. */
export const SEASON_OVER_TEXT = "Your season's over — no trade helps this year.";
/** The Trade partners card then: no trade helps, so it offers no partners either. */
export const SEASON_OVER_PARTNERS_TEXT = "Your season's over, so no trade partner can help this year.";

/**
 * A week in progress in my remaining schedule: its points and chances are the simulator's, which plays the
 * whole week from projections as if none of its games had started (season.ts weekUnderWayNote says it in
 * full, with the rosters and injury news being today's).
 */
export const UNDER_WAY_TEXT = "Under way: projected as if no game had started (live scores aren't read)";

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
  kind: "need-ros" | "need-next" | "chip";
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
  /** The team's best trade chips (§7), at most chipsShown, biggest gap first. */
  chips: Chip[];
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

/** One side of a partner card: the trade chips shown (the first chipsShown, most helpful first), and the rest as a count. */
export interface PartnerSide {
  players: PartnerPlayer[];
  /** "and 2 more": `title` lists the hidden players (hover), `srText` says them for screen readers; null when all are shown. */
  more: { text: string; title: string; srText: string } | null;
}

export interface PartnerCard {
  teamId: string;
  name: string;
  /** false: their trade chips would start for me, but none of mine would start for them (a trade would likely cost me a starter). */
  mutual: boolean;
  /** "Fit 2.4" for a mutual fit; "Would start for you" for a one-sided one (what was measured, whether or not I have needs). */
  fitText: string;
  theyCanGive: PartnerSide;
  youCanGive: PartnerSide;
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
  /**
   * Conflicting ESPN signals (§6 step 3; PlayerModel.availabilityNote): a short line for his row ("ESPN
   * says back wk 8; using Sleeper", "Out until ~wk 8 (ESPN)") and the full sentence for his breakdown
   * and hover. null for everyone whose tag and return date agree.
   */
  availabilityNote: { short: string; long: string } | null;
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

/** A probability as printed (oddsCell): `srText` says a symbolic one in words ("less than 1%"); null when `text` reads fine as it is. */
export interface OddsCell {
  text: string;
  srText: string | null;
}

/** One team in the standings table (§8 odds next to the current standings). */
export interface StandingsRow {
  teamId: string;
  /** Today's standings position by the league's own rules (TeamOdds.rank). */
  rank: number;
  name: string;
  isMine: boolean;
  /** Today's record: "7–4". */
  record: string;
  pointsFor: string;
  /** null when the Playoffs column is hidden (StandingsView.showPlayoffs false). */
  playoffs: OddsCell | null;
  /** null when the Bye column is hidden (StandingsView.showBye false). */
  bye: OddsCell | null;
  title: OddsCell;
  /** The expected final regular-season record, one decimal ("8.6–5.4", "8.5–4.5–1.0" with ties); null in a points-only league. */
  finalRecord: string | null;
  /** Certainly out of the title race (TeamOdds.eliminated). */
  eliminated: boolean;
}

export interface StandingsView {
  /** Today's standings order (rank 1 first); empty when there are no odds (`empty` says so). */
  rows: StandingsRow[];
  /** 2+ teams make the playoffs (oddsShown): with none or one, the title goes to the top of the final standings, and the Title column says it all. */
  showPlayoffs: boolean;
  /** The league has first-round byes and their odds are known. */
  showBye: boolean;
  /**
   * Points-only league: points for decide the standings, so the table shows them on phones too (the record,
   * which counts for nothing there, only on wider screens), and there's no projected final record.
   */
  pointsOnly: boolean;
  caption: string;
  /** SeasonOdds.notes the page doesn't already show as a warning. */
  notes: string[];
  empty: string | null;
}

/** One remaining regular-season game of mine (§8 "show each remaining week's risk"). */
export interface ScheduleRow {
  /** The week it's listed under (a multi-week game: its first week the simulation plays). */
  week: number;
  /** "13", or "13–14" for a multi-week matchup. */
  weekText: string;
  /** The same for screen readers: "Week 13", "Weeks 13–14". */
  weekLabel: string;
  opponentId: string | null;
  /** The opponent's name, or "Bye week" when there's none. */
  opponent: string;
  /** Projected points over the game's remaining weeks (TeamModel.score means): mine, and theirs (null on a bye). */
  mine: string;
  theirs: string | null;
  /** My chance to win the game; on a bye week "—", said as "no game" (not "unknown"). */
  win: OddsCell;
  /** Median-game leagues: my chance to beat the league median that week; null otherwise. */
  median: OddsCell | null;
  /** My likely starters on bye (short names, lineup order), and the same with full names for hover; null when none are. */
  byes: { text: string; title: string; count: number } | null;
  /** In words, never color alone: the badge's label, the short reasons shown beside it, and the full sentence (hover, screen readers). */
  risk: { label: string; reasons: string; text: string } | null;
  /**
   * A game already under way, in words: a multi-week matchup whose first weeks are played (the simulation
   * doesn't read the points they scored, so the row's points, win chance and byes cover only its weeks
   * still to play), and the week in progress (projected as if none of its games had started: live scores
   * aren't read). Null otherwise.
   */
  underWay: string | null;
}

export interface ScheduleView {
  rows: ScheduleRow[];
  showMedian: boolean;
  caption: string;
  /** Under the table: who counts as a likely starter, and when a week is flagged. */
  note: string;
  /** Why there are no rows: no team picked, a points-only league, no games left. */
  empty: string | null;
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
  /** SEASON_OVER_TEXT when my team is certainly out of the title race in a redraft league (§8); else null. */
  eliminated: string | null;
  /** Standings with playoff, bye and title odds (§8); null once no week is left (the page says the season is over). */
  standings: StandingsView | null;
  /** My remaining regular-season games and each week's risk (§8); null without odds or once the regular season is over. */
  schedule: ScheduleView | null;
  teams: TeamRow[];
  /** Under the team table: what the ranking counts ("Ranked by projected points per week from week 13 on (week 12 is under way)."). */
  teamsNote: string;
  /** The chip key's words for a trade chip ("trade chip: worth at least 10 more lineup pts to another team than to his own"). */
  chipLegend: string;
  heatmap: Heatmap;
  /** My best trade partners; `empty` says why there are none (no team picked, my redraft season over, no fit). */
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

const capitalize = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** "a", "a and b", "a, b and c" (or "a, b or c" with `conjunction` "or"). */
function listText(items: readonly string[], conjunction: "and" | "or" = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
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

const STATUS_WORD: Record<AvailabilityNote["status"], string> = {
  PROBABLE: "probable",
  QUESTIONABLE: "questionable",
  DOUBTFUL: "doubtful",
};

/**
 * Conflicting ESPN signals (§6 step 3): what a player's numbers follow, in a short line and a sentence.
 * A return week after the NFL's last week (inputs.nfl.lastWeek) is ESPN's "out for the season". In his
 * bye week (`byeNow`) Sleeper projects nobody, so the tiebreaker can't be read and the date is followed:
 * the sentence says so. So does it when Sleeper's projections for this week didn't load at all
 * (AvailabilityNote.sleeperUnavailable: the tiebreaker is missing, which isn't Sleeper not projecting him).
 */
export function availabilityNoteText(note: AvailabilityNote, lastNflWeek: number | undefined, byeNow = false): { short: string; long: string } {
  const status = STATUS_WORD[note.status];
  const outForSeason = lastNflWeek !== undefined && Number.isFinite(lastNflWeek) && note.returnWeek > lastNflWeek;
  const date = outForSeason ? "out for the season" : `return week ${note.returnWeek}`;
  if (note.used === "sleeper") {
    return {
      short: outForSeason ? "ESPN says out for the season; using Sleeper" : `ESPN says back wk ${note.returnWeek}; using Sleeper`,
      long: `ESPN: ${status}, ${date} — using Sleeper's projection (${status} this week, then healthy)`,
    };
  }
  const share = pct(config.projections.staleReturnShare);
  const why =
    note.sleeperNow === null
      ? byeNow
        ? "it's his bye week, so Sleeper doesn't project him"
        : note.sleeperUnavailable
          ? "Sleeper's projections for this week didn't load, so there's nothing to break the tie"
          : "Sleeper doesn't project him this week"
      : note.healthyRate === null
        ? "there's no healthy projection to compare Sleeper's with"
        : `Sleeper projects him for only ${fmtNum(note.sleeperNow, 1)} points this week, under ${share} of his healthy ${fmtNum(note.healthyRate, 1)}`;
  return {
    short: outForSeason ? "Out for the season (ESPN)" : `Out until ~wk ${note.returnWeek} (ESPN)`,
    long: `ESPN: ${status}, ${date} — following the return date (${why})`,
  };
}

/**
 * Why a week looks the way it does: his bye, a game already under way, his current injury status, or
 * ESPN's return date he follows (a week he's sure to miss).
 */
function weekNote(info: PlayerInfo | undefined, index: number, w: { a: number; bye: boolean }, started: boolean, followsDate: string | null): string | null {
  if (w.bye) return "Bye";
  if (started) return "Game already started";
  if (followsDate && w.a === 0) return followsDate;
  const label = INJURY_LABEL[info?.injury ?? "ACTIVE"];
  if (label && (index === 0 || w.a === 0)) return label.long;
  if (info && !info.nflTeam) return "No NFL team";
  if (w.a === 0) return "Out";
  return null;
}

function weekRows(ctx: PlayerContext, info: PlayerInfo | undefined, pm: PlayerModel | undefined, followsDate: string | null): WeekRow[] {
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
      note: weekNote(info, i, w, started, followsDate),
      playoff: ctx.playoffWeeks.has(week),
      started,
    };
  });
}

function weeksText(rows: readonly WeekRow[], note: string | null): string {
  const weeks = rows.map((r) => {
    const detail = r.note === "Bye" ? "bye" : r.started ? "game already started" : `${r.pointsText} pts, ${r.availabilityText}${r.note ? ` · ${r.note}` : ""}`;
    return `Wk ${r.week}${r.playoff ? " (playoffs)" : ""}: ${detail}`;
  });
  return (note ? [note, ...weeks] : weeks).join("\n");
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
  // His bye this week: the model's first week is the current NFL week.
  const byeNow = ctx.model.weeks[0] === ctx.snapshot.currentWeek && pm?.weekly[0]?.bye === true;
  const note = pm?.availabilityNote ? availabilityNoteText(pm.availabilityNote, ctx.inputs.nfl.lastWeek, byeNow) : null;
  const weeks = weekRows(ctx, info, pm, note && pm?.availabilityNote?.used === "returnDate" ? note.short : null);
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
    availabilityNote: note,
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
    weeksText: weeksText(weeks, note?.long ?? null),
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

/**
 * A team's trade chips (§7; TeamModel.chips, biggest gap first): the first chipsShown, each "B. Nix:
 * worth +31 to Team 6" (the gap, whole lineup points; "to you" for my team), the title giving both parts
 * to a tenth: what that team would gain with him and what his team would lose without him, in lineup
 * points (`weighting`: the playoff weighting while playoff weeks count).
 */
function tradeChipTags(snapshot: LeagueSnapshot, team: TeamModel, teamName: (id: string) => string, myTeamId: string | null, weighting: string | null): Chip[] {
  return team.chips.slice(0, Math.max(0, config.needs.chipsShown)).map((c) => {
    const info = snapshot.players[c.playerId];
    const name = info?.name ?? c.playerId;
    const mine = c.bestTeamId === myTeamId;
    const to = mine ? "you" : teamName(c.bestTeamId);
    const toLong = mine ? `${teamName(c.bestTeamId)} (your team)` : teamName(c.bestTeamId);
    const pos = info ? ` (${posLabel(info.pos, snapshot.platform)})` : "";
    return {
      key: c.playerId,
      text: `${shortName(name, info?.pos)}: worth ${fmtSigned(c.gap, 0)} to ${to}`,
      title: `${name}${pos}: worth ${fmtNum(c.gap, 1)} more lineup pts${weighting ? ` ${weighting}` : ""} to ${toLong} than to his own team. ${toLong} would gain ${fmtNum(c.maxOther, 1)} with him (after its best free-agent move); his team would lose ${fmtNum(c.cost, 1)} without him.`,
      kind: "chip" as const,
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
// Standings, playoff odds and my remaining schedule (§8)

/**
 * A probability as the page prints it (§8 odds): a whole percent, with "0%" and "100%" only when it's
 * certain (exactly 0 or 1) and "<1%" and ">99%" when it merely rounds there: 0.3% of 5,000 seasons is
 * 15 of them, not none. Unknown (null; NaN too, which the engine never sends) prints "—". Screen
 * readers get the symbolic forms in words.
 */
export function oddsCell(p: number | null): OddsCell {
  if (p === null || !Number.isFinite(p)) return { text: "—", srText: "unknown" };
  if (p <= 0) return { text: "0%", srText: null };
  if (p >= 1) return { text: "100%", srText: null };
  if (p < 0.005) return { text: "<1%", srText: "less than 1%" };
  if (p >= 0.995) return { text: ">99%", srText: "more than 99%" };
  return { text: `${Math.round(p * 100)}%`, srText: null };
}

/** A fantasy bye week's Win cell: there's no game to win, which isn't an unknown chance. */
const NO_GAME: OddsCell = { text: "—", srText: "no game" };

/**
 * Which odds the standings show, and the explainer names: playoff odds only when 2+ teams make the
 * playoffs (with none or one, the title goes to the top of the final standings: a Playoffs column would
 * read 0% for everyone or repeat the Title column); bye odds only when the league has byes and their
 * odds are known.
 */
function oddsShown(odds: SeasonOdds): { playoffs: boolean; bye: boolean } {
  return { playoffs: odds.playoffTeams >= 2, bye: odds.byes > 0 && odds.teams.some((t) => t.pBye !== null) };
}

/** The expected final record with one decimal, so it never passes for a real one ("8.6–5.4"); ties only when they print above 0. */
function finalRecordText(o: TeamOdds): string {
  const one = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "—");
  const ties = Number.isFinite(o.expTies) && Number(o.expTies.toFixed(1)) > 0;
  return `${one(o.expWins)}–${one(o.expLosses)}${ties ? `–${one(o.expTies)}` : ""}`;
}

interface OddsContext {
  snapshot: LeagueSnapshot;
  model: LeagueModel;
  odds: SeasonOdds | null;
  teamById: ReadonlyMap<string, Team>;
  teamName: (id: string) => string;
  myTeamId: string | null;
  /** Everything the warnings box already says: notes repeating it aren't listed twice. */
  warnings: readonly string[];
}

/**
 * The standings table (§8; §17 Checkpoint 3): every team in today's standings order by the league's
 * rules (TeamOdds.rank), with its record and points for, and its playoff, bye and title odds and
 * projected final record. The Playoffs column shows only when 2+ teams make the playoffs and the Bye
 * column only when the league has byes and their odds are known (oddsShown; unknown playoffs make bye
 * and title odds null: the title column then prints "—" and a note says why). Null once no week is
 * left (the page says the season is over); no odds otherwise → `empty`.
 */
function standingsView(c: OddsContext): StandingsView | null {
  if (!c.model.weeks.length) return null;
  const pointsOnly = c.snapshot.settings.pointsOnly;
  const odds = c.odds;
  if (!odds) return { rows: [], showPlayoffs: false, showBye: false, pointsOnly, caption: "", notes: [], empty: "Playoff odds aren't available for this league right now." };
  const { playoffs: showPlayoffs, bye: showBye } = oddsShown(odds);
  const rows: StandingsRow[] = odds.teams
    .filter((o) => c.teamById.has(o.teamId))
    .sort((a, b) => a.rank - b.rank)
    .map((o) => {
      const team = c.teamById.get(o.teamId) as Team;
      return {
        teamId: o.teamId,
        rank: o.rank,
        name: team.name,
        isMine: o.teamId === c.myTeamId,
        record: recordText(team.record),
        pointsFor: fmtNum(team.pointsFor, 1),
        playoffs: showPlayoffs ? oddsCell(o.pPlayoffs) : null,
        bye: showBye ? oddsCell(o.pBye) : null,
        title: oddsCell(o.pTitle),
        finalRecord: pointsOnly ? null : finalRecordText(o),
        eliminated: o.eliminated,
      };
    });
  const chances = listText([...(showPlayoffs ? ["make the playoffs"] : []), ...(showBye ? ["get a first-round bye"] : []), "win the title"]);
  const said = new Set(c.warnings);
  return {
    rows,
    showPlayoffs,
    showBye,
    pointsOnly,
    caption: `Standings today by your league's rules, with each team's chance to ${chances}${pointsOnly ? "" : ", and its projected final record"}, from ${fmtWhole(odds.sims)} simulated seasons`,
    notes: [...new Set(odds.notes.filter((n) => !said.has(n)))],
    empty: null,
  };
}

/**
 * My likely starters (the rule the schedule's bye list uses; see the header): my best lineup, by the
 * engine's exact solver over the league's slots, from each active-roster player's projected points per
 * game left (his ROS points ÷ his NFL team's games left, so availability counts: an injured or suspended
 * player's missed games pull him down). Nobody at 0 counts. In lineup order (slot by slot, best first).
 */
export function likelyStarters(snapshot: LeagueSnapshot, model: LeagueModel, teamId: string): string[] {
  const team = snapshot.teams.find((t) => t.id === teamId);
  if (!team) return [];
  const players: LineupPlayer[] = [];
  for (const id of team.roster) {
    const info = snapshot.players[id];
    const pm = model.players[id];
    if (!info || !pm) continue;
    const games = pm.ros.gamesLeft;
    players.push({ id, pos: info.pos, eligible: info.eligible, points: games > 0 && Number.isFinite(pm.ros.total) ? pm.ros.total / games : 0 });
  }
  return solveLineup(players, prepareLeagueSlots(snapshot.settings))
    .starters.filter((s) => s.points > 0)
    .map((s) => s.id);
}

/**
 * When a remaining week is flagged risky, completing "A week is flagged risky when …": a win chance under
 * RISKY_WIN_CHANCE (head-to-head leagues only) or RISKY_BYES or more likely starters on bye.
 */
function riskRule(h2h: boolean, chance: string, starters: string): string {
  const byes = `${RISKY_BYES} or more of ${starters} are on bye`;
  return h2h ? `${chance} is under ${pct(RISKY_WIN_CHANCE)}, or when ${byes}` : byes;
}

/**
 * The NFL weeks of my regular-season game that the simulation lists under `week` (Matchup.weeks for an
 * ESPN multi-week matchup, else just that week), from the snapshot's schedule; [week] when not found.
 */
function matchupWeeks(snapshot: LeagueSnapshot, me: string, opponentId: string | null, week: number): number[] {
  for (const m of snapshot.schedule) {
    if (m.isPlayoff) continue;
    const pair = (m.teamA === me && m.teamB === opponentId) || (opponentId !== null && m.teamA === opponentId && m.teamB === me);
    if (!pair) continue;
    const weeks = m.weeks?.length ? [...m.weeks].sort((a, b) => a - b) : [m.week];
    if (weeks.includes(week)) return weeks;
  }
  return [week];
}

/**
 * My remaining schedule (§8 "show each remaining week's risk"; see the header): one row per game of
 * mine in SeasonOdds.weekly, with both teams' projected points summed over the game's remaining weeks
 * (TeamModel.score means, the numbers the simulation draws around), my win chance (and median-game
 * chance), my likely starters on bye, and a risk flag in words. Null without odds or once no
 * regular-season week is left to play; no team picked, or none of my games left → `empty`.
 */
function scheduleView(c: OddsContext): ScheduleView | null {
  const odds = c.odds;
  if (!odds || !odds.weekly.length) return null;
  const none = (empty: string): ScheduleView => ({ rows: [], showMedian: false, caption: "", note: "", empty });
  const me = c.myTeamId;
  if (!me) return none("Pick your team to see your remaining games and each week's risk.");
  const settings = c.snapshot.settings;
  const weekIndex = new Map(c.model.weeks.map((w, i) => [w, i]));
  const teamModels = new Map(c.model.teams.map((t) => [t.id, t]));
  // Σ score means over the weeks the model has; null when it has none of them (or no scores).
  const projected = (teamId: string, weeks: readonly number[]): number | null => {
    const mean = teamModels.get(teamId)?.score?.mean;
    let total = 0;
    let any = false;
    for (const w of weeks) {
      const i = weekIndex.get(w);
      const x = i === undefined ? undefined : mean?.[i];
      if (x === undefined || !Number.isFinite(x)) continue;
      total += x;
      any = true;
    }
    return any ? total : null;
  };
  const starters = likelyStarters(c.snapshot, c.model, me);
  const limit = pct(RISKY_WIN_CHANCE);
  // A points-only league's games don't count in the standings (only points do), so a low win chance isn't a risk there.
  const h2h = !settings.pointsOnly;
  const mine = (wk: WeekOdds) => wk.games.find((g) => g.teamId === me);
  const showMedian = settings.medianGame && !settings.pointsOnly && odds.weekly.some((wk) => (mine(wk)?.pMedianWin ?? null) !== null);
  const rows: ScheduleRow[] = [];
  // A fantasy bye week without a game is listed, never flagged: the note then says why.
  let noGameWeek = false;
  for (const wk of odds.weekly) {
    const game = mine(wk);
    if (!game) continue;
    const weeks = matchupWeeks(c.snapshot, me, game.opponentId, wk.week);
    const remaining = weeks.filter((w) => weekIndex.has(w));
    const counted = remaining.length ? remaining : [wk.week];
    const off = starters.filter((id) => {
      const bye = c.model.players[id]?.ros.bye;
      return bye?.status === "upcoming" && bye.week !== undefined && counted.includes(bye.week);
    });
    const names = off.map((id) => {
      const info = c.snapshot.players[id];
      return { short: info ? shortName(info.name, info.pos) : id, full: info?.name ?? id };
    });
    // Risky as printed: a win chance shown as "40%" isn't "under 40%".
    const winPct = game.pWin === null || !Number.isFinite(game.pWin) ? null : Math.round(game.pWin * 100);
    const low = h2h && winPct !== null && winPct < Math.round(RISKY_WIN_CHANCE * 100);
    // A bye crunch is a risk only in a week that counts for me: a game, a median game, or any week of a
    // points-only league (its points add up). A fantasy bye week without a median game can't move the
    // standings (the simulator plays nothing for a bye), so its byes are listed, not flagged.
    const counts = game.opponentId !== null || game.pMedianWin !== null || settings.pointsOnly;
    if (!counts) noGameWeek = true;
    const many = counts && off.length >= RISKY_BYES;
    const reasons = [...(many ? [`${off.length} starters on bye`] : []), ...(low ? [`under ${limit} to win`] : [])];
    const sentence = many && low ? `${off.length} of your likely starters are on bye, and your chance to win is under ${limit}` : many ? `${off.length} of your likely starters are on bye` : `your chance to win is under ${limit}`;
    const first = weeks[0] ?? wk.week;
    const last = weeks[weeks.length - 1] ?? wk.week;
    const mineProj = projected(me, counted);
    const theirProj = game.opponentId === null ? null : projected(game.opponentId, counted);
    // A multi-week matchup already under way: the simulation plays only its weeks still to play (the
    // points already scored aren't read, season.ts), so the row's numbers cover those weeks alone.
    const played = weeks.filter((w) => !weekIndex.has(w) && w < (c.model.weeks[0] ?? Number.POSITIVE_INFINITY));
    const underWay = [
      ...(played.length ? [`${capitalize(weekList(played))} already played: ${played.length === 1 ? "its" : "their"} points aren't counted, so these numbers cover ${weekList(counted)} only`] : []),
      ...(c.model.inProgressWeek !== null && counted.includes(c.model.inProgressWeek) ? [UNDER_WAY_TEXT] : []),
    ];
    rows.push({
      week: wk.week,
      weekText: first === last ? `${first}` : `${first}–${last}`,
      weekLabel: first === last ? `Week ${first}` : `Weeks ${first}–${last}`,
      opponentId: game.opponentId,
      opponent: game.opponentId === null ? "Bye week" : c.teamName(game.opponentId),
      mine: mineProj === null ? "—" : fmtNum(mineProj, 1),
      theirs: game.opponentId === null ? null : theirProj === null ? "—" : fmtNum(theirProj, 1),
      win: game.opponentId === null ? NO_GAME : oddsCell(game.pWin),
      median: showMedian ? oddsCell(game.pMedianWin) : null,
      byes: names.length ? { text: names.map((n) => n.short).join(", "), title: names.map((n) => n.full).join(", "), count: names.length } : null,
      risk: reasons.length ? { label: "Risky week", reasons: reasons.join(" · "), text: `Risky week: ${sentence}.` } : null,
      underWay: underWay.length ? underWay.join(". ") : null,
    });
  }
  if (!rows.length) return none(h2h ? "Your team has no regular-season games left to play." : "Your league ranks teams by total points, so there's no weekly schedule to show.");
  return {
    rows,
    showMedian,
    caption: `Your remaining regular-season games: the opponent, projected points for you and them, and your chance to win${showMedian ? " and to beat the league median" : ""} each week`,
    note: `${h2h ? "" : "Your league ranks teams by total points, so these games don't change the standings: only your points count. "}"On bye" names your likely starters who are off that week: your best lineup by each player's projected points per game left. A week is flagged risky when ${riskRule(h2h, "your chance to win it", "those starters")}.${noGameWeek ? " A bye week without a game can't change the standings, so it isn't flagged." : ""}${showMedian ? " Median: your chance of a top-half score that week, which counts as a second game." : ""}`,
    empty: null,
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
  /** The season simulation, when it ran (§8). */
  odds: SeasonOdds | null;
  /** My remaining schedule is shown (a team is picked and games are left), so its risk rule is explained too. */
  schedule: boolean;
}

const TIEBREAKER_WORDS: Record<SeasonOdds["tiebreaker"]["rule"], string> = {
  pointsFor: "points for",
  headToHead: "head-to-head record",
  divisionRecord: "division record",
};

/**
 * Whether the league's division rule (division winners seeded first, or not) is an assumption, as the
 * simulation reads it (season.ts buildSimSetup's divisionRuleAssumed, which SeasonOdds doesn't carry): the
 * league has 2+ divisions and either reports no playoff seeding at all or its adapter warned that the
 * platform doesn't say (DIVISION_RULE_ASSUMED: Sleeper's help center covers only some division and playoff
 * layouts, so the rest are inferred readings; ESPN's documents its rule, so only a snapshot an older ESPN
 * adapter normalized carries such a warning).
 */
function divisionRuleAssumed(snapshot: LeagueSnapshot): boolean {
  const s = snapshot.settings;
  if ((s.divisions?.length ?? 0) < 2) return false;
  if (s.playoffSeeding === undefined) return true;
  return snapshot.warnings.some((w) => DIVISION_RULE_ASSUMED.some((d) => d.code === w.code && (d.platformPath === undefined || d.platformPath === w.platformPath)));
}

/**
 * "Playoff odds" in "How these numbers work" (§8): seasons simulated, weekly scores drawn around the
 * projected lineups with their spread, today's records, the league's seeding rule (and what's assumed),
 * the playoff spots, byes and bracket (or where the title goes without a bracket: 0 or 1 playoff team,
 * worded like the engine's note), the odds the standings show (oddsShown), common random numbers, and
 * the schedule's risk rule.
 */
function oddsExplainText(c: ExplainContext, odds: SeasonOdds): string {
  const s = c.snapshot.settings;
  const scen = c.model.scenarios;
  const draws = `Each week, every team's score is drawn around its projected starting lineup${scen ? ` (its average over the ${scen} simulated runs of injuries and byes)` : ""}, with a spread that covers its starters' week-to-week swings${scen ? " and how much injuries and byes could change the lineup" : ""}.`;
  const assumedRule = odds.tiebreaker.assumed ? " (assumed: the platform doesn't say which tiebreaker your league uses)" : "";
  // Worded like the tiebreaker and the bracket: an inferred rule reads as one (the standings notes say so too).
  const divisionsFirst =
    s.playoffSeeding?.divisionWinnersFirst && (s.divisions?.length ?? 0) >= 2 ? `, with division winners seeded first${divisionRuleAssumed(c.snapshot) ? " (assumed: the platform doesn't say)" : ""}` : "";
  const ranking = s.pointsOnly
    ? "Each simulated season ranks teams by total points."
    : `Each simulated game adds to today's records${s.medianGame ? ", as does a weekly game against the league median (a win for a top-half score)" : ""}. Each simulated season is then ranked by your league's rules: win percentage, then ${TIEBREAKER_WORDS[odds.tiebreaker.rule]}${assumedRule}${divisionsFirst}.`;
  const n = odds.playoffTeams;
  const byes = odds.byes > 0 ? `, and the top ${odds.byes === 1 ? "seed gets" : `${odds.byes} seeds get`} a first-round bye` : "";
  const assumedBracket = odds.reseed.assumed ? " (assumed: the platform doesn't say)" : "";
  const bracket = odds.reseed.value ? ` After each round the teams left are re-seeded, best seed against worst${assumedBracket}.` : ` The bracket is fixed: no re-seeding after each round${assumedBracket}.`;
  const playoffs =
    n > 2
      ? `The top ${n} make the playoffs${byes}.${bracket}`
      : n === 2
        ? "The top 2 make the playoffs and meet for the title."
        : n === 1
          ? "One team makes the playoffs, so the title goes to the top of the final standings."
          : "There are no playoffs, so the title goes to the top of the final standings.";
  const shown = oddsShown(odds);
  const chances = listText([...(shown.playoffs ? ["a playoff spot"] : []), ...(shown.bye ? ["a bye"] : []), "the title"], "or");
  const risk = c.schedule ? ` Your remaining schedule flags a week as risky when ${riskRule(!s.pointsOnly, "your chance to win it", "your likely starters (your best lineup by projected points per game left)")}.` : "";
  return `We play out the rest of the season ${fmtWhole(odds.sims)} times. ${draws} ${ranking} ${playoffs} A team's chance of ${chances} is the share of those seasons where it happened. Each time the odds are worked out, every team and week gets the same random draws (common random numbers), so when trade ideas compare the odds before and after a trade, the difference comes from the trade, not from the luck of the draw.${risk}`;
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
      text: `Once a week's first game kicks off, the team numbers (points per week, team ROS points, positional strength, needs, lineup cost, free-agent moves and trade partners) ${next === undefined ? "have no full week left to count" : `count from the next week, week ${next}`}: lineups are locking and week ${inProgress}'s points are being scored, so it no longer says how good a team is. A player's own ROS points still count his week ${inProgress} game if it hasn't kicked off; one that has shows "Game already started".${c.odds ? ` The playoff odds still play all of week ${inProgress}'s games from projections, as if none had started: live scores aren't read yet, and the rosters and injury news are today's.` : ""}`,
    });
  }
  if (c.odds) items.push({ title: "Playoff odds", text: oddsExplainText(c, c.odds) });
  items.push(
    {
      title: "Trade values",
      text: values.label
        ? `Values come from FantasyCalc in your league's format (${values.label}).${c.keeper ? (model.market.format?.isDynasty === false ? " In a keeper league these are its redraft values, how managers see a trade this season; its dynasty values, for long-term worth, didn't load this time." : " In a keeper league these are its redraft values, how managers see a trade this season; its dynasty values, for long-term worth, come into play with trade suggestions.") : ""}${values.substitutions.length ? ` Where your league doesn't match one of FantasyCalc's formats exactly: ${values.substitutions.join("; ")}.` : ""}${unvaluedText(snapshot, model)}`
        : "FantasyCalc's values couldn't be loaded, so trade values are missing for now. Refresh to try again.",
    },
    {
      title: "Needs, trade chips and partners",
      text: `A need is a lineup slot where a team's starter is at least ${Math.abs(config.lineups.needZThreshold)} standard deviations below the league median, for the rest of the season or just the next ${config.lineups.strengthWeeks} weeks. A trade chip is a player worth at least ${config.needs.chipMinGap} more lineup points to another team than to his own: what he'd add to that team's lineup, measured after its best free-agent move (so a pickup it could make anyway doesn't count), minus what his own team would lose without him when it can make only one free-agent move (a replacement for him, or the pickup it would make anyway).${excludedText(snapshot)} Trade partners are teams whose trade chips would start for you while yours would start for them; teams with a trade chip who would start for you, when none of yours would start for them, come after them.`,
    },
  );
  return items;
}

const EXCLUDED_WORDS: Partial<Record<Pos, string>> = { K: "kickers", P: "punters", DEF: "team defenses", DL: "defensive players", LB: "defensive players", DB: "defensive players" };

/** " Kickers and team defenses aren't trade chips …" for the positions trade search leaves out (§9) that this league starts; "" when none. */
function excludedText(snapshot: LeagueSnapshot): string {
  const started = new Set(snapshot.settings.lineup.filter((s) => s.count > 0).flatMap((s) => s.eligible));
  const words = [...new Set(config.market.tradeSearchExcluded.filter((p) => started.has(p)).map((p) => EXCLUDED_WORDS[p] ?? posLabel(p, snapshot.platform)))];
  if (!words.length) return "";
  const text = listText(words);
  return ` ${text.charAt(0).toUpperCase()}${text.slice(1)} aren't trade chips: trade suggestions leave them out.`;
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
      chips: tradeChipTags(snapshot, t, teamName, myTeamId, weighting),
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

  // My team certainly out in a redraft league (§8). `?? null`: a model built before Phase 3 has no odds.
  const odds = model.odds ?? null;
  const myOdds = myTeamId && odds ? odds.teams.find((t) => t.teamId === myTeamId) : undefined;
  const eliminated = myOdds?.eliminated === true && snapshot.settings.leagueType === "redraft" ? SEASON_OVER_TEXT : null;

  // Best trade partners (my team only): each side's trade chips, most helpful first (the engine's order).
  // None once my redraft season is over: the page says no trade helps this year (§8), so it offers none.
  const partnerPlayer = (p: { playerId: string; ppw: number }): PartnerPlayer => {
    const info = snapshot.players[p.playerId];
    const name = info?.name ?? p.playerId;
    return { id: p.playerId, text: `${shortName(name, info?.pos)} (${fmtSigned(p.ppw, 1)}/wk)`, title: `${name}: ${fmtSigned(p.ppw, 1)} points per week to the other lineup` };
  };
  const partnerSide = (players: readonly { playerId: string; ppw: number }[]): PartnerSide => {
    const shown = Math.max(1, config.needs.chipsShown);
    const all = players.map(partnerPlayer);
    const hidden = all.slice(shown);
    const text = `and ${hidden.length} more`;
    return { players: all.slice(0, shown), more: hidden.length ? { text, title: hidden.map((p) => p.title).join("\n"), srText: `${text}: ${hidden.map((p) => p.text).join(", ")}` } : null };
  };
  const cards: PartnerCard[] =
    myTeamId && !eliminated
      ? model.partners
          .filter((p) => teamById.has(p.teamId))
          .slice(0, config.needs.partnersShown)
          .map((p) => ({ teamId: p.teamId, name: teamName(p.teamId), mutual: p.mutual, fitText: p.mutual ? `Fit ${fmtNum(p.score, 1)}` : "Would start for you", theyCanGive: partnerSide(p.theyCanGive), youCanGive: partnerSide(p.youCanGive) }))
      : [];
  const partnersEmpty = !myTeamId
    ? "Pick your team to see which teams fit you best as trade partners."
    : eliminated
      ? SEASON_OVER_PARTNERS_TEXT
      : cards.length
        ? null
        : "No clear fits right now: no team has a trade chip who would start for you.";

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

  // Standings, odds and my remaining schedule (§8).
  const oddsContext: OddsContext = { snapshot, model, odds, teamById, teamName, myTeamId, warnings };
  const standings = standingsView(oddsContext);
  const schedule = scheduleView(oddsContext);

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
    eliminated,
    standings,
    schedule,
    teams: rows,
    teamsNote,
    chipLegend: `trade chip: worth at least ${config.needs.chipMinGap} more lineup pts to another team than to his own`,
    heatmap,
    partners: { cards, empty: partnersEmpty },
    rosters,
    freeAgents,
    lineupCostTitle: `Rest-of-season lineup points his team would lose without him${playoffWeighted ? `, with playoff weeks counted ${config.lineups.playoffWeight}×` : ""}`,
    explain: buildExplain({ snapshot, model, values, keeper, source, from, playoffWeighted, odds, schedule: (schedule?.rows.length ?? 0) > 0 }),
    sources,
    warnings,
    notes: pageNotes(inputs.notes, values.said),
    over: weeks.length === 0,
    playoffsLeft: ctx.hasPlayoffs,
  };
}
