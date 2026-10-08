/**
 * "Waiver upgrades" on the League page (planner reply to Checkpoint 7a, §6.2): every word and number the section shows, from
 * the League model's lists (LeagueModel.waiverUpgrades; src/engine/waivers.ts has the rules) and the import (names,
 * positions, NFL teams, injury tags, and ESPN's waiver status: LeagueSnapshot.freeAgentStatus). WaiverUpgrades.tsx only lays
 * it out. Pure and client-safe: the moment and the viewer's time zone are passed in.
 *
 * The lists behind a toggle: "Rest of season" (the default) and "This week"; while the current week is under way, "This
 * week" counts only its games still to play (the week "Streaming picks this week" lists) and "Next week" is the week after
 * it (its lineups are locking; when none of its games is left, "Next week" is the only one-week list). Each row: the player
 * (position, NFL team, bye, injury tag, waiver status when the platform reports it), his rest-of-season points and the
 * week's projection, "Better than" (my players at his position he out-projects, in the list's terms; when none of mine
 * there plays, who and why: "No TE of yours plays in week 5 (B. Bowers: bye)"), and the lineup gain with the player he'd
 * replace ("Drop R. Doubs") or an open roster spot; "Depth only" when he wouldn't start in a normal week (said in words under
 * the list whenever a row carries it: DEPTH_ONLY_WORDS). The gain prints to config.waivers.gainDecimals, the precision the
 * engine orders rows by (waivers.gainSteps). The page shows the first config.waivers.rowsShown rows, then "Show all".
 * Without lists, one line instead: no team picked (with a link to pick it), my redraft season over, or no week left
 * (buildWaiversView; review of Phase 7b: the section showed nothing then, and the header's "Waivers" link led nowhere).
 * "Season over" is the League page's own (leagueView.ts seasonOver: since Checkpoint 7c only when no prize the league pays
 * can still move, so under "Several prizes" a team out of the title race still sees the pickups that can help it win a
 * weekly high score or the points title; planner reply to Checkpoint 7b, §6, the lead's reading), but for a pickup a
 * regular-season week under way with games still to play counts (its "This week" list: a pickup can still change it, a
 * trade can't; review of the prizes UI, prizes-ui-5).
 */
import { config } from "@/engine/config";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueModel, WaiverIdle, WaiverList, WaiverRow } from "@/engine/leagueModel";
import type { FreeAgentStatus, InjuryStatus, LeagueSnapshot, Pos } from "@/engine/model";
import { gainSteps } from "@/engine/waivers";
import { fmtNum, fmtWhole, weeksText } from "./format";
import { INJURY_LABEL, posLabel } from "./labels";
import { seasonOver, shortName, type InjuryTone } from "./leagueView";

/** The section's id: the site header's "Waivers" link goes to /league#waivers (WAIVERS_HREF; ./waiversLink.ts). */
export { WAIVERS_HREF, WAIVERS_SECTION_ID } from "./waiversLink";
export const WAIVERS_TITLE = "Waiver upgrades";
export const DEPTH_ONLY_TAG = "Depth only";
/**
 * What "Depth only" means, in words that read right on a row with a gain and on a "No gain" row alike (review of Phase 7b:
 * the old hover text, "what he adds comes from covering injuries and byes", only showed on hover, which phones and screen
 * readers miss, and read oddly next to "No gain"): visible in the list's note whenever a row of it carries the tag
 * (WaiverListView.note), and the tag's hover text (WaiverListView.depthOnlyTitle). The rest of the season's EV lineups
 * count byes; one week's, only injuries can open his spot.
 */
export const DEPTH_ONLY_WORDS: Readonly<Record<"ros" | "week", string>> = {
  ros: "he wouldn't start for you in a normal week, so he'd only play when injuries or byes open a spot",
  week: "he wouldn't start for you that week, so he'd only play if an injury opens a spot",
};
export const NO_GAIN_TEXT = "No gain";
export const CANT_FIT_TEXT = "No room";
export const WAIVERS_INTRO = "Free agents who project for more points than one of your players at the same position, and what each would add to your starting lineup.";
export const WAIVERS_SEASON_OVER = "Your season's over, so no pickup can help this year.";
/**
 * Instead of the lists when no team is picked, with a link to the Import Report's team picker (review of Phase 7b: the
 * header's "Waivers" link led nowhere then, the section rendering nothing).
 */
export const WAIVERS_NO_TEAM = "Pick your team on the Import Report to see waiver upgrades for it.";
export const WAIVERS_PICK_TEAM: Readonly<{ href: string; text: string }> = { href: "/import#your-team", text: "Pick your team" };
/** Instead of the lists when no week is left for a pickup to help (the season over, or its last week under way). */
export const WAIVERS_NO_WEEKS = "Waiver upgrades cover the weeks still to come, and none is left this season.";

/** Which list (WaiverUpgrades): the rest of the season, the week under way, or the first week team numbers count. */
export type WaiverListMode = "ros" | "underWay" | "week";

export interface WaiversInput {
  snapshot: LeagueSnapshot;
  model: LeagueModel;
  /** The model inputs' NFL schedule: each week's opponents (the one-week lists show them). */
  inputs?: Pick<ModelInputs, "nfl"> | undefined;
  /** IANA time zone for the waiver dates (the viewer's own). */
  timeZone: string;
  /** The moment the model was computed for (ISO): a waiver date before it has passed. */
  now: string;
}

export interface WaiversView {
  ros: WaiverListView | null;
  /** "This week" while the current week is under way: its games still to play. Null otherwise. */
  underWay: WaiverListView | null;
  /** "This week", or "Next week" while the current week is under way. */
  week: WaiverListView | null;
  /** The list shown first: "ros" unless there's none. */
  first: WaiverListMode;
  intro: string;
  /**
   * Instead of the lists: no team picked (WAIVERS_NO_TEAM), my redraft season over (WAIVERS_SEASON_OVER), or no week left
   * for a pickup (WAIVERS_NO_WEEKS); null otherwise. The section shows either way, so the header's "Waivers" link always
   * leads somewhere on a League page that's ready.
   */
  empty: string | null;
  /** With `empty` when no team is picked: the link to the Import Report's team picker (WAIVERS_PICK_TEAM); null otherwise. */
  emptyLink: { href: string; text: string } | null;
}

export interface WaiverListView {
  mode: WaiverListMode;
  /** The toggle's label: "Rest of season", "This week", or "Next week" while the current week is under way. */
  label: string;
  /** What the list's numbers count, in words; when a row of it is "Depth only", what that means too (DEPTH_ONLY_WORDS). */
  note: string;
  /** The "Depth only" tag's hover text for this list (DEPTH_ONLY_WORDS, as a sentence). */
  depthOnlyTitle: string;
  /**
   * While a week is under way, on the one-week lists: "Week 4 is under way: this list counts only its games still to
   * play." or "Week 4 is under way, so this list is for week 5."; else null.
   */
  underWay: string | null;
  /** The column heading of the week's projection: "Wk 5". */
  weekLabel: string;
  rows: WaiverRowView[];
  /** Rows shown before "Show all" (config.waivers.rowsShown). */
  shown: number;
  /** Shown when there's no row. */
  empty: string;
  /** For screen readers: what the list is. */
  caption: string;
}

export interface WaiverRowView {
  id: string;
  name: string;
  pos: string;
  /** NFL team code, "FA" without one. */
  nflTeam: string;
  /** "bye wk 9", "bye done", "bye unknown". */
  bye: string;
  injury: { short: string; long: string; tone: InjuryTone } | null;
  /** ESPN's waiver status ("On waivers until Wed", "Free agent now"), with the details for hover; null when the platform doesn't report one. */
  status: { text: string; title: string } | null;
  /** The week's opponent on the one-week lists ("vs ARI", "@ DAL", and in words); null otherwise or when unknown. */
  opponent: { short: string; long: string } | null;
  /** Rest-of-season points (whole) and the week's projection (one decimal; "bye" on his bye week). */
  rosText: string;
  weekText: string;
  /** "C. Sutton, R. Doubs" (my players he out-projects), "No K on your roster", or "No TE of yours plays in week 5 (B. Bowers: bye)". */
  betterThan: string;
  gain: { text: string; positive: boolean; title: string };
  /** "Drop R. Doubs", "Open roster spot", or null when he can't be added. */
  drop: string | null;
  depthOnly: boolean;
}

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

/** Why one of my players doesn't play in a list's weeks (WaiverIdle.why), in a word. */
const IDLE_WORD: Record<WaiverIdle["why"], string> = { bye: "bye", started: "game started", out: "out" };

/** A day this many days ahead or more is named by its date, not its weekday ("until Oct 8"). */
const WEEKDAY_SPAN_DAYS = 6;
const DAY_MS = 86_400_000;

/**
 * ESPN's waiver status in words (LeagueSnapshot.freeAgentStatus; the planner: "On waivers until Wed", "Free agent now"): the
 * weekday the claims run, in the viewer's time zone (its date when it's a week or more away); "Was on waivers until Wed"
 * once that moment has passed (the import is older than the claims: a Refresh shows where he is now). Null without a status.
 */
export function waiverStatusText(status: FreeAgentStatus | undefined, now: string, timeZone: string): { text: string; title: string } | null {
  if (!status) return null;
  if (status.kind === "freeAgent") return { text: "Free agent now", title: "When your league was last read, he was a free agent anyone could add right away." };
  const until = status.until ? new Date(status.until) : null;
  const nowMs = Date.parse(now);
  if (!until || Number.isNaN(until.getTime())) return { text: "On waivers", title: "When your league was last read, he was on waivers: claims run before anyone can add him." };
  const fmt = (opts: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone, ...opts }).format(until);
    } catch {
      return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(until);
    }
  };
  const ahead = Number.isFinite(nowMs) ? until.getTime() - nowMs : Number.POSITIVE_INFINITY;
  const day = ahead >= WEEKDAY_SPAN_DAYS * DAY_MS ? fmt({ month: "short", day: "numeric" }) : fmt({ weekday: "short" });
  const when = fmt({ weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  if (ahead <= 0) return { text: `Was on waivers until ${day}`, title: `When your league was last read, he was on waivers until ${when}. Refresh to see where he is now.` };
  return { text: `On waivers until ${day}`, title: `On waivers until ${when}: claims run then, in your league's waiver order.` };
}

/** The weeks in words, in a sentence: "weeks 5–17", "week 5". */
function weeksWords(weeks: readonly number[]): string {
  return weeksText(weeks).replace(/^Weeks?/, (w) => w.toLowerCase());
}

/** The section without lists: one line instead (WaiversView.empty), and the team picker's link when no team is picked. */
function emptyView(empty: string, emptyLink: WaiversView["emptyLink"] = null): WaiversView {
  return { ros: null, underWay: null, week: null, first: "ros", intro: WAIVERS_INTRO, empty, emptyLink };
}

/**
 * The "Waiver upgrades" section (the file header). With no team picked (the model's team not in the league, as the League
 * page reads it), a line and a link to pick it; with my redraft season over, or no week left for a pickup, a line instead
 * of the lists (review of Phase 7b: the section rendered nothing, so the header's "Waivers" link led nowhere). Null only
 * when the model has my team but no lists at all: built without them (BuildLeagueModelOptions.waiverUpgrades false, a
 * caller that never shows them).
 */
export function buildWaiversView(input: WaiversInput): WaiversView | null {
  const { snapshot, model } = input;
  const myTeamId = model.myTeamId && snapshot.teams.some((t) => t.id === model.myTeamId) ? model.myTeamId : null;
  if (!myTeamId) return emptyView(WAIVERS_NO_TEAM, WAIVERS_PICK_TEAM);
  const w = model.waiverUpgrades;
  if (!w) return null;
  // My redraft season over, the League page's own reading (seasonOver: out of the title race with no prize the league pays
  // still within reach), the week under way counted while it's a regular-season week with games still to play (its "This
  // week" list: a pickup can still change it).
  const weekUnderWay = w.underWay !== null && model.inProgressWeek !== null && model.regularWeeks.includes(model.inProgressWeek);
  if (seasonOver(model, w.teamId, snapshot.settings.leagueType, { weekUnderWay })) return emptyView(WAIVERS_SEASON_OVER);
  if (!w.ros && !w.underWay && !w.week) return emptyView(WAIVERS_NO_WEEKS);
  const labels = { underWay: w.underWay ? "This week" : null, week: w.week ? weekLabel(input, w.week) : null };
  const ros = w.ros ? listView(input, w.ros, "ros", w.teamId, labels) : null;
  const underWay = w.underWay ? listView(input, w.underWay, "underWay", w.teamId, labels) : null;
  const week = w.week ? listView(input, w.week, "week", w.teamId, labels) : null;
  return { ros, underWay, week, first: ros ? "ros" : underWay ? "underWay" : "week", intro: WAIVERS_INTRO, empty: null, emptyLink: null };
}

/** The first-week list's label: "Next week" while the current week is under way (the list is for the week after), else "This week". */
function weekLabel(input: WaiversInput, list: WaiverList): string {
  const week = list.weeks[0] ?? input.snapshot.currentWeek;
  return input.model.inProgressWeek !== null && week !== input.snapshot.currentWeek ? "Next week" : "This week";
}

function listView(input: WaiversInput, list: WaiverList, mode: WaiverListMode, teamId: string, labels: { underWay: string | null; week: string | null }): WaiverListView {
  const { snapshot, model } = input;
  // The one-week list's week; the rest of season's first week names the week the projection column shows.
  const pickupWeek = list.weeks[0] ?? snapshot.currentWeek;
  const underWayWeek = model.inProgressWeek;
  const label = mode === "ros" ? "Rest of season" : mode === "underWay" ? (labels.underWay ?? "This week") : (labels.week ?? "This week");
  const nextWeek = mode === "week" && label === "Next week";
  const span = mode === "underWay" ? `the rest of week ${pickupWeek}` : weeksWords(list.weeks);
  const how = model.scenarios > 0 ? "with injuries and byes simulated" : "on projected lineups";
  // The positions I stream: the rest-of-season list leaves them to the one-week lists, named as their toggles name them.
  const streamed = (model.streaming.byTeam[teamId]?.positions ?? []).map((p) => posLabel(p, snapshot.platform));
  const oneWeek = [labels.underWay, labels.week].filter((l): l is string => l !== null).map((l) => `“${l}”`);
  const streamedNote = streamed.length && oneWeek.length ? ` Positions you stream weekly (${streamed.join(", ")}) are under ${oneWeek.join(" and ")}.` : "";
  const note =
    mode === "ros"
      ? `Lineup gain: what adding him adds to your starting lineup over ${span}, each week counted once, ${how}, after dropping the player named.${streamedNote}`
      : mode === "underWay"
        ? `Lineup gain: what adding him adds to your starting lineup in ${span}, ${how}, after dropping the player named (the one your roster misses least over the rest of the season, among players whose games haven't started). Players whose games have started are locked: yours stay in the best lineup you could have set before kickoff.`
        : `Lineup gain: what adding him adds to your starting lineup in ${span}, ${how}, after dropping the player named (the one your roster misses least over the rest of the season).`;
  const weekIndex = model.weeks.indexOf(pickupWeek);
  const rows = list.rows.map((r) => rowView(input, list, r, mode, span, weekIndex, pickupWeek));
  const underWay =
    underWayWeek === null ? null : mode === "underWay" ? `Week ${underWayWeek} is under way: this list counts only its games still to play.` : nextWeek ? `Week ${underWayWeek} is under way, so this list is for week ${pickupWeek}.` : null;
  // "Depth only" in words, visible under the list when a row of it carries the tag (DEPTH_ONLY_WORDS; review of Phase 7b).
  const depthWords = DEPTH_ONLY_WORDS[mode === "ros" ? "ros" : "week"];
  const depthNote = rows.some((r) => r.depthOnly) ? ` ${DEPTH_ONLY_TAG}: ${depthWords}.` : "";
  return {
    mode,
    label,
    note: `${note}${depthNote}`,
    depthOnlyTitle: `${capitalize(depthWords)}.`,
    underWay,
    weekLabel: `Wk ${pickupWeek}`,
    rows,
    shown: Math.max(1, Math.floor(config.waivers.rowsShown)),
    empty:
      mode === "ros"
        ? "No free agent projects for more rest-of-season points than one of your players at his position."
        : mode === "underWay"
          ? `No free agent still to play in week ${pickupWeek} projects for more points than one of your players at his position.`
          : `No free agent projects for more points in week ${pickupWeek} than one of your players at his position.`,
    caption: mode === "ros" ? "Waiver upgrades for the rest of the season" : mode === "underWay" ? `Waiver upgrades for week ${pickupWeek}'s games still to play` : `Waiver upgrades for week ${pickupWeek}`,
  };
}

function rowView(input: WaiversInput, list: WaiverList, r: WaiverRow, mode: WaiverListMode, span: string, weekIndex: number, pickupWeek: number): WaiverRowView {
  const { snapshot, model } = input;
  const info = snapshot.players[r.playerId];
  const pm = model.players[r.playerId];
  const pos: Pos | undefined = info?.pos;
  const posText = pos ? posLabel(pos, snapshot.platform) : "player";
  const injury = info ? INJURY_LABEL[info.injury] : null;
  const name = (id: string) => {
    const p = snapshot.players[id];
    return p ? shortName(p.name, p.pos) : id;
  };
  const bye = pm?.ros.bye;
  const weekP = weekIndex >= 0 ? (pm?.weekly[weekIndex]?.p ?? 0) : 0;
  const byeThatWeek = weekIndex >= 0 && pm?.weekly[weekIndex]?.bye === true;
  const opp = mode !== "ros" && info?.nflTeam ? input.inputs?.nfl?.opponents?.[pickupWeek]?.[info.nflTeam] : undefined;
  const dropName = r.drop ? name(r.drop) : null;
  const move = r.drop ? `adding him and dropping ${dropName}` : "adding him into an open roster spot";
  const where = mode === "ros" ? `over ${span}` : `in ${span}`;
  // Nobody of mine to beat at his position: none on my roster, or none who plays in the list's weeks (who, and why).
  const idle = list.idle.filter((x) => x.pos === pos);
  const when = mode === "ros" ? "again this season" : `in ${span}`;
  const nobody = idle.length ? `No ${posText} of yours plays ${when} (${idle.map((x) => `${name(x.playerId)}: ${IDLE_WORD[x.why]}`).join("; ")})` : `No ${posText} on your roster`;
  let gain: WaiverRowView["gain"];
  if (r.gain === null) {
    gain = { text: CANT_FIT_TEXT, positive: false, title: "None of your players can make room for him under your league's roster rules." };
  } else {
    // The gain as the engine orders rows (waivers.gainSteps): a gain that rounds to 0 or below is no gain.
    const decimals = config.waivers.gainDecimals;
    const shown = fmtNum(r.gain, decimals);
    gain =
      gainSteps(r.gain, decimals) > 0
        ? { text: `+${shown} pts`, positive: true, title: `${capitalize(move)} adds ${shown} points to your starting lineup ${where}.` }
        : { text: NO_GAIN_TEXT, positive: false, title: `${capitalize(move)} doesn't add points to your starting lineup ${where}.` };
  }
  return {
    id: r.playerId,
    name: info?.name ?? r.playerId,
    pos: pos ? posLabel(pos, snapshot.platform) : "—",
    nflTeam: info?.nflTeam ?? "FA",
    bye: !bye || bye.status === "unknown" ? "bye unknown" : bye.status === "done" ? "bye done" : `bye wk ${bye.week}`,
    injury: injury && info ? { ...injury, tone: INJURY_TONE[info.injury] } : null,
    status: waiverStatusText(snapshot.freeAgentStatus?.[r.playerId], input.now, input.timeZone),
    opponent: opp ? { short: `${opp.home ? "vs" : "@"} ${opp.team}`, long: opp.home ? `at home against ${opp.team}` : `away at ${opp.team}` } : null,
    rosText: pm ? fmtWhole(pm.ros.total) : "—",
    weekText: byeThatWeek ? "bye" : fmtNum(weekP, 1),
    betterThan: r.betterThan.length ? r.betterThan.map(name).join(", ") : nobody,
    gain,
    drop: r.gain === null ? null : dropName ? `Drop ${dropName}` : "Open roster spot",
    depthOnly: r.depthOnly,
  };
}

const capitalize = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
