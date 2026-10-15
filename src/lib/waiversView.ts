/**
 * "Waiver upgrades" on the League page (planner reply to Checkpoint 7a, §6.2): every word and number the section shows, from
 * the League model's lists (LeagueModel.waiverUpgrades; src/engine/waivers.ts has the rules) and the import (names,
 * positions, NFL teams, injury tags, and ESPN's waiver status: LeagueSnapshot.freeAgentStatus). WaiverUpgrades.tsx only lays
 * it out. Pure and client-safe: the moment and the viewer's time zone are passed in.
 *
 * The lists behind a toggle: "Rest of season" (the default) and "This week"; while the current week is under way, "This
 * week" counts only its games still to play (the week "Streaming picks this week" lists) and "Next week" is the week after
 * it (its lineups are locking; when none of its games is left, "Next week" is the only one-week list).
 *
 * Each row is one move (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.1: "The row reads as one move: 'Add A, drop
 * B.'"): the player to add (position, NFL team, bye, injury tag, waiver status when the platform reports it), the player to
 * drop (WaiverRowView.drop; an open roster spot: none; the page puts the lock icon next to him, item 3.3), and two numbers
 * (WaiverRowView.main, .outscores):
 * - "Rest of season", rated (WaiverList.rating; item 3.4): Helps you for that exact swap, on the trade cards' scale ("No
 *   gain" at 0 or below), and how many more rest-of-season points he scores than the drop ("Outscores R. Doubs by 18", the
 *   other way round when the drop scores more; an open spot: his own points). The lineup gain moves to the row's details
 *   (WaiverRowView.lineupGain: "+2.5 points over weeks 6–17"). Unrated (no odds): the lineup gain is the main number, as
 *   before.
 * - The one-week lists stay in points (the planner: "These stay in points, since they're for streaming"): the lineup gain
 *   that week is the main number, and "Outscores R. Doubs by 2.3 this week" from that week's projections.
 * Then his rest-of-season points and the week's projection, "Better than" (my players at his position he out-projects, in
 * the list's terms; when none of mine there plays, who and why: "No TE of yours plays in week 5 (B. Bowers: bye)"), and
 * "Depth only" when he wouldn't start in a normal week (said in words under the list whenever a row carries it:
 * DEPTH_ONLY_WORDS). A move that can't be made says why (WaiverRowView.blocked; item 3.3): "Every RB you could drop is
 * untouchable: C. McCaffrey, B. Hall." (with "Drop from the same position" off, or any position: "All the players you could
 * drop are untouchable: …"; the trade's own words, review of wave C, UI-C-4), naming the untouchables (unlocked from the
 * untouchables line above the lists, not on every row: UI-C-7), and, when the switch is on and a player at another position
 * could make room, the suggestion to turn it off (the planner: "In the waiver view, also suggest turning off 'Drop from the
 * same position'"); its number reads "Can't add" ("No room" when no untouchable is why), under the list's own label, with
 * the sentence as its hover. A rated "No gain" row whose odds part is a gain says that the value it gives up outweighs it
 * (WaiverRowView.why; UI-C-2). Gains print to config.waivers.gainDecimals, the precision the engine orders rows by
 * (waivers.gainSteps).
 *
 * The rows that don't help fold (Checkpoint 7f; planner reply to Checkpoint 7e, item 3: "Show the rows that rate above 0,
 * followed by a collapsed “N more pickups that don't help you (show).”"): a row helps when its main number as printed is
 * above 0 (WaiverRowView.helps): Helps you on the rated season list, the lineup gain on the one-week lists and, ⚠️ ours, on a
 * season list waiting for its rating or whose rating failed (the number each row shows then). The rows that help come first
 * and show (the first config.waivers.rowsShown of them, then "Show all"); the rest fold behind one button ("42 more pickups
 * that don't help you (show)": WaiverListView.rest), on every list (⚠️ the lead's call: the one-week lists print "No gain" on
 * most of their rows too), the moves that can't be made last among them (⚠️ ours); when none helps, a line says so
 * (WaiverListView.noneHelps). The engine's order puts them so already (waivers.ts compareRatedRows, compareWaiverRows); the
 * view partitions the rows stably anyway, so the rule holds whatever the order.
 *
 * Above the lists (Checkpoint 7e): "Drop from the same position" (item 3.2; WaiversView.samePosition, the setting the lists
 * were built with: the page shows the switch as the browser holds it now) and my untouchables, never suggested as drops
 * (WaiversView.untouchables, item 3.3: the page offers to unlock each one).
 *
 * The season list's rating comes on its own request (Checkpoint 7e: about a second on Parker's league, more than the lead's
 * rule allows the League model build; src/workers/engine.worker.ts `waivers`): until it answers, the list shows its rows in
 * points, as an unrated list, and WaiversView.pendingRating tells the section to ask for it ("Rating these against your
 * odds…": RATING_PENDING_TEXT) and to build this view again from the answer (WaiverUpgrades.tsx).
 *
 * Without lists, one line instead: no team picked (with a link to pick it), my redraft season over, or no week left
 * (buildWaiversView; review of Phase 7b: the section showed nothing then, and the header's "Waivers" link led nowhere).
 * "Season over" is the League page's own (leagueView.ts seasonOver: since Checkpoint 7c only when no prize the league pays
 * can still move, so under "Several prizes" a team out of the title race still sees the pickups that can help it win a
 * weekly high score, the points title or (final review of Checkpoint 7c, ui-UI-7C-1) the 3rd-place game after a lost
 * semifinal; planner reply to Checkpoint 7b, §6, the lead's reading), but for a pickup a regular-season week under way with
 * games still to play counts (its "This week" list: a pickup can still change it, a trade can't; review of the prizes UI,
 * prizes-ui-5).
 *
 * No trade value shows (FantasyCalc's condition, CLAUDE.md §2.9): Helps you, points and projections are ours; when Helps you
 * counts trade value too (a redraft league's "Protect my trade value"), the note says so in words.
 */
import { lineupEquivalent } from "@/engine/benefit";
import { config } from "@/engine/config";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueModel, WaiverBlocked, WaiverIdle, WaiverList, WaiverListRating, WaiverRow } from "@/engine/leagueModel";
import type { FreeAgentStatus, InjuryStatus, LeagueSnapshot, Platform, Pos } from "@/engine/model";
import { gainSteps, waiverRatingPending } from "@/engine/waivers";
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
/** A move only untouchables could make room for (review of wave C, UI-C-4): the row's number, its sentence saying why. */
export const CANT_ADD_TEXT = "Can't add";
/** Why nobody can make room, when no rule names it (the row's sentence, and its number's hover). */
export const CANT_FIT_WHY = "None of your players can make room for him under your league's roster rules.";
export const WAIVERS_INTRO = "Free agents who project for more points than one of your players at the same position. Each one is a single move: add him and drop the player named.";
export const WAIVERS_SEASON_OVER = "Your season's over, so no pickup can help this year.";
/**
 * Instead of the lists when no team is picked, with a link to the Import Report's team picker (review of Phase 7b: the
 * header's "Waivers" link led nowhere then, the section rendering nothing).
 */
export const WAIVERS_NO_TEAM = "Pick your team on the Import Report to see waiver upgrades for it.";
export const WAIVERS_PICK_TEAM: Readonly<{ href: string; text: string }> = { href: "/import#your-team", text: "Pick your team" };
/** Instead of the lists when no week is left for a pickup to help (the season over, or its last week under way). */
export const WAIVERS_NO_WEEKS = "Waiver upgrades cover the weeks still to come, and none is left this season.";
/** "Drop from the same position" (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.2): the switch's label and its help. */
export const SAME_POSITION_LABEL = "Drop from the same position";
export const SAME_POSITION_HELP = "On: the player you drop plays the same position as the one you add. Off: any position.";
/**
 * My untouchables above the lists (item 3.3): never suggested as drops, each with its lock to unlock him; kept out of trade
 * ideas too, which the line says since the final review of Checkpoint 7e (UI-F-3: it said "never suggested as drops" alone).
 */
export const UNTOUCHABLES_LABEL = "Untouchable (never in trade ideas, never suggested as drops):";
/** The suggestion under a move only another position could make room for (item 3.3: "suggest turning off 'Drop from the same position'"). */
export const SAME_POSITION_HINT = `Turn off “${SAME_POSITION_LABEL}” to drop a player at another position.`;

/**
 * Which weeks a list's fold and its "none helps" line name (Checkpoint 7f, item 3): the rest of the season, this week (a
 * week under way's games still to play included), or next week.
 */
export type WaiverListWhen = "ros" | "thisWeek" | "nextWeek";

/** Instead of the rows that help when none does (Checkpoint 7f, item 3), before the fold that holds every row. */
export const WAIVERS_NONE_HELPS: Readonly<Record<WaiverListWhen, string>> = {
  ros: "No pickup helps you over the rest of the season.",
  thisWeek: "No pickup helps you this week.",
  nextWeek: "No pickup helps you next week.",
};

/**
 * The fold's button (Checkpoint 7f; planner reply to Checkpoint 7e, item 3: "a collapsed “N more pickups that don't help you
 * (show).”"): "42 more pickups that don't help you (show)", "(hide)" once open, "1 more pickup that doesn't help you", the
 * week on a one-week list ("… help you this week (show)", "… next week"), and no "more" when no row helps ("21 pickups that
 * don't help you (show)").
 */
export function waiversRestText(n: number, when: WaiverListWhen, opts: { more: boolean; open: boolean }): string {
  const what = n === 1 ? "pickup that doesn't" : "pickups that don't";
  const week = when === "thisWeek" ? " this week" : when === "nextWeek" ? " next week" : "";
  return `${n} ${opts.more ? "more " : ""}${what} help you${week} (${opts.open ? "hide" : "show"})`;
}

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
  /**
   * Checkpoint 7e (item 3.2): "Drop from the same position" as the lists were built with (WaiverUpgrades.samePosition; on for
   * a model built before); null without lists. The page's switch shows the setting as the browser holds it now.
   */
  samePosition?: boolean | null;
  /** Checkpoint 7e (item 3.3): my untouchables the lists never drop, each with his short and full name (the lock's label). */
  untouchables?: { id: string; name: string; fullName: string }[];
  /**
   * Checkpoint 7e (item 3.4): the season list can be rated by Helps you but isn't yet (the League page's model is built without
   * the rating: src/workers/engine.worker.ts): this view's input, so the section asks for the rating (src/lib/engineClient.ts
   * waiverRatingFor on its model) and builds its view again from the answer; null when rated already or when it can't be
   * (no season simulated, no row that can be made).
   */
  pendingRating?: WaiversInput | null;
}

/** Whether the season list is rated, being rated, or couldn't be (WaiverUpgrades.tsx; the file header). */
export type WaiverRatingStatus = "pending" | "failed" | null;

/** The section's line while its season list is rated on its own request (Checkpoint 7e, item 3.4), and when that fails. */
export const RATING_PENDING_TEXT = "Rating these against your odds…";
export const RATING_FAILED_TEXT = "These couldn't be rated against your odds, so they're listed by lineup gain.";
/**
 * A one-week list's line meanwhile (the final review of Checkpoint 7e, UI-F-7): its drops are the season list's (the rated
 * ones once it's rated), so one can change when the rating comes.
 */
export const RATING_PENDING_WEEK_TEXT = "Rating the rest-of-season moves against your odds… A drop named here can change when that's done.";

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
  /** The rows that help first (`helping` of them), then those that don't, then the moves that can't be made (the file header). */
  rows: WaiverRowView[];
  /** Checkpoint 7f (item 3): how many rows help, the first ones of `rows` (WaiverRowView.helps). */
  helping: number;
  /** Rows that help shown before "Show all" (config.waivers.rowsShown); the rows that don't help are folded (`rest`). */
  shown: number;
  /**
   * Checkpoint 7f (item 3): the rows that don't help, folded behind one button: how many, the button's words collapsed and
   * open (waiversRestText), and the folded list's caption for screen readers. Null when every row helps.
   */
  rest: { count: number; show: string; hide: string; caption: string } | null;
  /** Checkpoint 7f (item 3): when the list has rows and none helps, the line instead of them (WAIVERS_NONE_HELPS); else null. */
  noneHelps: string | null;
  /** Shown when there's no row. */
  empty: string;
  /** For screen readers: what the list is. */
  caption: string;
  /** Checkpoint 7e (item 3.4): the list's rows are rated by Helps you (the season list with odds). */
  rated?: boolean;
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
  /** The lineup gain (the main number on the one-week lists and an unrated season list; the details on a rated one). */
  gain: { text: string; positive: boolean; title: string };
  /**
   * Checkpoint 7e (item 3.1: "Add A, drop B"): the player to drop, his short and full names (the lock's label) and position
   * (the page reads "Add Alvin Kamara" then "Drop R. Dowdle (RB)", with the lock icon next to him: item 3.3), or null: an
   * open roster spot or a move that can't be made.
   */
  drop: { id: string; name: string; fullName: string; pos: string } | null;
  /** "Drop R. Doubs", "Open roster spot", or null when he can't be added. */
  dropText: string | null;
  /** The row's main number: Helps you on a rated list, else the lineup gain (with its label: "Helps you", "Lineup gain"). */
  main: { label: string; text: string; positive: boolean; title: string };
  /** Checkpoint 7f (item 3): the row helps, its main number as printed above 0 (`main.positive`): it shows; else it's folded. */
  helps: boolean;
  /** The second number: "Outscores R. Doubs by 18", "R. Doubs outscores him by 3", "No drop needed: 77 points"; null when he can't be added. */
  outscores: string | null;
  /** On a rated list: the lineup gain in the details, "+2.5 points over weeks 6–17" or "None over weeks 6–17"; null otherwise. */
  lineupGain: string | null;
  /**
   * Why he can't be added (item 3.3): the sentence (naming the untouchables when they're why: their locks are on the
   * untouchables line above the lists, review of wave C, UI-C-7), the suggestion to turn the switch off, and those players.
   */
  blocked: { text: string; hint: string | null; unlock: { id: string; name: string; fullName: string }[] } | null;
  /**
   * On a rated list, why a "No gain" row gains nothing when his odds part is a gain (review of wave C, UI-C-2): "It raises
   * your chances, but the trade value you'd give up outweighs that (your “Protect my trade value” setting)."; else null.
   */
  why: string | null;
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

/** A position's plural in a sentence: "RBs", "TEs", "kickers", "D/STs". */
export function positionPlural(pos: Pos, platform?: Platform): string {
  if (pos === "K") return "kickers";
  if (pos === "P") return "punters";
  return `${posLabel(pos, platform)}s`;
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
  const untouchables = (w.untouchables ?? []).map((id) => playerNames(snapshot, id));
  // The season list waits for its rating (the League page's model is built without it): there's a season to rate it on and
  // a move to rate (waivers.waiverRatingPending: the engine worker keeps the build for it by the same rule).
  const ratable = waiverRatingPending(model);
  return {
    ros,
    underWay,
    week,
    first: ros ? "ros" : underWay ? "underWay" : "week",
    intro: WAIVERS_INTRO,
    empty: null,
    emptyLink: null,
    samePosition: w.samePosition ?? true,
    untouchables,
    pendingRating: ratable ? input : null,
  };
}

/** A player's short name (the rows') and full name (the lock's label); his id when the import doesn't know him. */
function playerNames(snapshot: LeagueSnapshot, id: string): { id: string; name: string; fullName: string } {
  const p = snapshot.players[id];
  return { id, name: p ? shortName(p.name, p.pos) : id, fullName: p?.name ?? id };
}

/** The first-week list's label: "Next week" while the current week is under way (the list is for the week after), else "This week". */
function weekLabel(input: WaiversInput, list: WaiverList): string {
  const week = list.weeks[0] ?? input.snapshot.currentWeek;
  return input.model.inProgressWeek !== null && week !== input.snapshot.currentWeek ? "Next week" : "This week";
}

/**
 * What a rated season list's Helps you weighs, in words (Checkpoint 7e, item 3.4): the season played out, and the trade
 * value or long-term value it counts too (WaiverListRating.weighs; no number: CLAUDE.md §2.9), and how many seasons are
 * behind its rows (`rated` and `finished`: its rows with a rating, and those played out on the whole shown block; the final
 * review of Checkpoint 7e, UI-F-5: it said "the others" when every move was finished, and how many times each move is played
 * out when no move could be made).
 */
function ratingNote(r: WaiverListRating, span: string, counts: { rated: number; finished: number }): string {
  const weighs =
    r.weighs === "tradeValue"
      ? " It counts the trade value you'd give up too, as your “Protect my trade value” setting asks."
      : r.weighs === "longTerm"
        ? " It counts the change in your roster's long-term value too, as your Win now ↔ Future setting asks."
        : "";
  const others = counts.rated - counts.finished;
  const each = counts.rated === 1 ? "The move is" : "Each move is";
  const sims =
    counts.rated === 0
      ? ""
      : counts.finished > 0 && others > 0
        ? ` The ${counts.finished === 1 ? "best move is" : `${counts.finished} best moves are`} played out ${fmtWhole(r.shownSims)} times, the others ${fmtWhole(r.screenSims)} times.`
        : ` ${each} played out ${fmtWhole(counts.finished > 0 ? r.shownSims : r.screenSims)} times.`;
  return `Helps you: how much each move raises your chances at what your league rewards over ${span}, from simulated seasons, on the same scale as trade ideas.${weighs}${sims} Outscores: his rest-of-season points against the player you'd drop.`;
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
  const rating = mode === "ros" ? (list.rating ?? null) : null;
  const when = mode === "ros" ? null : nextWeek ? "next week" : "this week";
  const rated = rating ? list.rows.filter((r) => r.rating) : [];
  const counts = rating ? { rated: rated.length, finished: rated.filter((r) => (r.rating?.sims ?? 0) >= rating.shownSims).length } : null;
  // A one-week list's drop is the season list's for the same free agent, when he's on it (waivers.ts; the final review of
  // Checkpoint 7e, UI-F-7: a streamed kicker's or D/ST's row has none there, its drop the drop order's).
  const note =
    mode === "ros"
      ? rating && counts
        ? `${ratingNote(rating, span, counts)} Lineup gain: what the move adds to your starting lineup over ${span}, each week counted once, ${how}.${streamedNote}`
        : `Lineup gain: what adding him adds to your starting lineup over ${span}, each week counted once, ${how}, after dropping the player named. Outscores: his rest-of-season points against the player you'd drop.${streamedNote}`
      : mode === "underWay"
        ? `Lineup gain: what adding him adds to your starting lineup in ${span}, ${how}, after dropping the player named (the same one as for the rest of the season when he's on that list, among players whose games haven't started). Outscores: his projection for the games still to play against the player you'd drop. Players whose games have started are locked: yours stay in the best lineup you could have set before kickoff.`
        : `Lineup gain: what adding him adds to your starting lineup in ${span}, ${how}, after dropping the player named (the same one as for the rest of the season when he's on that list). Outscores: his projection ${when} against the player you'd drop.`;
  const weekIndex = model.weeks.indexOf(pickupWeek);
  // The rows that help first, then those that don't, then the moves that can't be made (Checkpoint 7f, item 3; the file
  // header), each group in the engine's order (which puts them so already: the sort is stable).
  const rows = list.rows
    .map((r) => {
      const view = rowView(input, list, r, mode, span, weekIndex, pickupWeek, rating, when);
      return { view, place: view.helps ? 0 : r.gain !== null ? 1 : 2 };
    })
    .sort((a, b) => a.place - b.place)
    .map((x) => x.view);
  const helping = rows.filter((r) => r.helps).length;
  const folded = rows.length - helping;
  const which: WaiverListWhen = mode === "ros" ? "ros" : nextWeek ? "nextWeek" : "thisWeek";
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
    helping,
    shown: Math.max(1, Math.floor(config.waivers.rowsShown)),
    rest:
      folded > 0
        ? {
            count: folded,
            show: waiversRestText(folded, which, { more: helping > 0, open: false }),
            hide: waiversRestText(folded, which, { more: helping > 0, open: true }),
            caption: mode === "ros" ? "Pickups that don't help you over the rest of the season" : mode === "underWay" ? `Pickups that don't help you in week ${pickupWeek}'s games still to play` : `Pickups that don't help you in week ${pickupWeek}`,
          }
        : null,
    noneHelps: rows.length > 0 && helping === 0 ? WAIVERS_NONE_HELPS[which] : null,
    empty:
      mode === "ros"
        ? "No free agent projects for more rest-of-season points than one of your players at his position."
        : mode === "underWay"
          ? `No free agent still to play in week ${pickupWeek} projects for more points than one of your players at his position.`
          : `No free agent projects for more points in week ${pickupWeek} than one of your players at his position.`,
    caption: mode === "ros" ? "Waiver upgrades for the rest of the season" : mode === "underWay" ? `Waiver upgrades for week ${pickupWeek}'s games still to play` : `Waiver upgrades for week ${pickupWeek}`,
    rated: rating !== null,
  };
}

/** A position in a sentence, one player: "RB", "D/ST", "kicker", "punter". */
function positionSingular(pos: Pos, platform?: Platform): string {
  if (pos === "K") return "kicker";
  if (pos === "P") return "punter";
  return posLabel(pos, platform);
}

/**
 * Why a move can't be made, in words (Checkpoint 7e, items 3.2 and 3.3; WaiverRow.blocked): "Every RB you could drop is
 * untouchable: C. McCaffrey, B. Hall." (the drop had to play his position; the trade's own words, evaluate.ts
 * untouchableDropNote: review of wave C, UI-C-4, since in the week under way a player whose game has started can't be
 * dropped either, so "All your RBs" wasn't always true) or "All the players you could drop are untouchable: …", naming the
 * untouchables (`unlock`; their locks are on the untouchables line above the lists, not on every row: review of wave C,
 * UI-C-7); "No RB of yours can make room for him." or today's words; and the switch's suggestion when another position could
 * make room.
 */
function blockedView(snapshot: LeagueSnapshot, b: WaiverBlocked, pos: Pos | undefined): NonNullable<WaiverRowView["blocked"]> {
  const unlock = b.why === "untouchable" ? b.untouchable.map((id) => playerNames(snapshot, id)) : [];
  const named = unlock.length ? `: ${unlock.map((u) => u.name).join(", ")}.` : ".";
  const text =
    b.why === "untouchable"
      ? b.atPosition && pos
        ? `Every ${positionSingular(pos, snapshot.platform)} you could drop is untouchable${named}`
        : `All the players you could drop are untouchable${named}`
      : b.atPosition && pos
        ? `No ${posLabel(pos, snapshot.platform)} of yours can make room for him.`
        : CANT_FIT_WHY;
  return { text, hint: b.otherPosition ? SAME_POSITION_HINT : null, unlock };
}

/** "N points", with "point" when the number prints as 1 (review of wave C, UI-C-6). */
function pointsText(shown: string): string {
  return `${shown} ${shown === "1" ? "point" : "points"}`;
}

/** A lineup equivalent a week: "0.9 points a week", "1 point a week", "less than 0.1 points a week" (review of wave C, UI-C-6: "0 points"). */
function weeklyPointsText(x: number): string {
  const shown = fmtNum(x, 1);
  return shown === "0" || shown === "-0" ? "less than 0.1 points a week" : `${pointsText(shown)} a week`;
}

/**
 * Why a rated row reads "No gain" when its odds part, B_win, is a gain (WaiverRowRating.bWin; review of wave C, UI-C-2:
 * "No gain" alone read as "it doesn't raise your chances", while it did): the value the swap gives up outweighs it, by the
 * setting that weighs it (WaiverListRating.weighs). `words` ends the number's hover, `why` is the row's own line in words
 * (a hover is missed on a phone and by screen readers). No number: Offer Sheet shows no trade value (CLAUDE.md §2.9).
 */
const TRADE_VALUE_COST = {
  words: "the trade value you'd give up outweighs that, as your “Protect my trade value” setting counts it",
  why: "It raises your chances, but the trade value you'd give up outweighs that (your “Protect my trade value” setting).",
} as const;
const LONG_TERM_COST = {
  words: "the long-term value you'd give up outweighs that, as your Win now ↔ Future setting counts it",
  why: "It raises your chances this season, but the long-term value you'd give up outweighs that (your Win now ↔ Future setting).",
} as const;

function rowView(
  input: WaiversInput,
  list: WaiverList,
  r: WaiverRow,
  mode: WaiverListMode,
  span: string,
  weekIndex: number,
  pickupWeek: number,
  rating: WaiverListRating | null,
  when: string | null,
): WaiverRowView {
  const { snapshot, model } = input;
  const info = snapshot.players[r.playerId];
  const pm = model.players[r.playerId];
  const pos: Pos | undefined = info?.pos;
  const posText = pos ? posLabel(pos, snapshot.platform) : "player";
  const injury = info ? INJURY_LABEL[info.injury] : null;
  const name = (id: string) => playerNames(snapshot, id).name;
  const fullName = info?.name ?? r.playerId;
  const bye = pm?.ros.bye;
  const weekP = weekIndex >= 0 ? (pm?.weekly[weekIndex]?.p ?? 0) : 0;
  const byeThatWeek = weekIndex >= 0 && pm?.weekly[weekIndex]?.bye === true;
  const opp = mode !== "ros" && info?.nflTeam ? input.inputs?.nfl?.opponents?.[pickupWeek]?.[info.nflTeam] : undefined;
  const dropInfo = r.drop ? snapshot.players[r.drop] : undefined;
  const drop = r.gain !== null && r.drop ? { ...playerNames(snapshot, r.drop), pos: dropInfo ? posLabel(dropInfo.pos, snapshot.platform) : "—" } : null;
  const dropName = drop?.name ?? null;
  const moveWords = drop ? `adding him and dropping ${dropName}` : "adding him into an open roster spot";
  const where = mode === "ros" ? `over ${span}` : `in ${span}`;
  // Nobody of mine to beat at his position: none on my roster, or none who plays in the list's weeks (who, and why).
  const idle = list.idle.filter((x) => x.pos === pos);
  const idleWhen = mode === "ros" ? "again this season" : `in ${span}`;
  const nobody = idle.length ? `No ${posText} of yours plays ${idleWhen} (${idle.map((x) => `${name(x.playerId)}: ${IDLE_WORD[x.why]}`).join("; ")})` : `No ${posText} on your roster`;
  // The lineup gain as the engine orders rows (waivers.gainSteps): a gain that rounds to 0 or below is no gain.
  const decimals = config.waivers.gainDecimals;
  // A move that can't be made: why, in words (item 3.3), which its number's hover says too (review of wave C, UI-C-4).
  const blocked = r.gain === null && r.blocked ? blockedView(snapshot, r.blocked, pos) : null;
  let gain: WaiverRowView["gain"];
  if (r.gain === null) {
    gain = { text: r.blocked?.why === "untouchable" ? CANT_ADD_TEXT : CANT_FIT_TEXT, positive: false, title: blocked ? [blocked.text, blocked.hint].filter((x) => x !== null).join(" ") : CANT_FIT_WHY };
  } else {
    const shown = fmtNum(r.gain, decimals);
    gain =
      gainSteps(r.gain, decimals) > 0
        ? { text: `+${shown} pts`, positive: true, title: `${capitalize(moveWords)} adds ${pointsText(shown)} to your starting lineup ${where}.` }
        : { text: NO_GAIN_TEXT, positive: false, title: `${capitalize(moveWords)} doesn't add points to your starting lineup ${where}.` };
  }
  // The main number: Helps you on a rated list (item 3.4), else the lineup gain; a move that can't be made says so under
  // the list's own label (review of wave C, UI-C-4: "Lineup gain" broke a rated list's column of Helps you).
  let main: WaiverRowView["main"] = { label: rating ? "Helps you" : "Lineup gain", ...gain };
  let why: string | null = null;
  if (rating && r.gain !== null && r.rating) {
    const helps = r.rating.helps;
    const sims = fmtWhole(r.rating.sims);
    const equivalent = rating.weighs !== "longTerm" ? lineupEquivalent(r.rating.b, rating.b3) : null;
    const per = equivalent !== null && helps !== null ? `: about as good as adding ${weeklyPointsText(equivalent)} to your lineup for the rest of the season` : "";
    // A move whose odds part is a gain the value it gives up outweighs (review of wave C, UI-C-2: "No gain" alone read as
    // "it doesn't raise your chances", while it did: in Parker's second league 15 of 21 such rows).
    const cost = rating.weighs === "tradeValue" ? TRADE_VALUE_COST : rating.weighs === "longTerm" ? LONG_TERM_COST : null;
    const bWin = r.rating.bWin;
    const b = r.rating.b;
    if (helps !== null && helps > 0) main = { label: "Helps you", text: String(helps), positive: true, title: `Helps you ${helps}${per}, on the same scale as trade ideas (from ${sims} simulated seasons).` };
    else {
      const title =
        typeof b === "number" && b > 0
          ? `${capitalize(moveWords)} raises your chances at what your league rewards too little to show (from ${sims} simulated seasons).`
          : cost && typeof bWin === "number" && bWin > 0
            ? `${capitalize(moveWords)} raises your chances at what your league rewards, but ${cost.words} (from ${sims} simulated seasons).`
            : `${capitalize(moveWords)} doesn't raise your chances at what your league rewards (from ${sims} simulated seasons).`;
      main = { label: "Helps you", text: NO_GAIN_TEXT, positive: false, title };
      if (!(typeof b === "number" && b > 0) && cost && typeof bWin === "number" && bWin > 0) why = cost.why;
    }
  }
  // The second number (item 3.1): how many more points he scores than the drop in the list's terms (an open spot: his own).
  let outscores: string | null = null;
  if (r.gain !== null) {
    const whole = mode === "ros";
    const fmt = (x: number) => (whole ? fmtWhole(x) : fmtNum(x, 1));
    const tail = when ? ` ${when}` : "";
    if (!drop) outscores = `No drop needed: ${whole ? `${fmt(r.points)} rest-of-season ${fmt(r.points) === "1" ? "point" : "points"}` : `${pointsText(fmt(r.points))}${tail}`}`;
    else if (typeof r.dropPoints === "number" && Number.isFinite(r.dropPoints)) {
      const diff = r.points - r.dropPoints;
      const shown = fmt(Math.abs(diff));
      outscores = shown === "0" ? `Even with ${dropName}${tail}` : diff > 0 ? `Outscores ${dropName} by ${shown}${tail}` : `${dropName} outscores him by ${shown}${tail}`;
    }
  }
  const lineupGain = rating && r.gain !== null ? (gainSteps(r.gain, decimals) > 0 ? `+${pointsText(fmtNum(r.gain, decimals))} ${where}` : `None ${where}`) : null;
  return {
    id: r.playerId,
    name: fullName,
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
    drop,
    dropText: r.gain === null ? null : dropName ? `Drop ${dropName}` : "Open roster spot",
    main,
    helps: main.positive,
    outscores,
    lineupGain,
    blocked,
    why,
    depthOnly: r.depthOnly,
  };
}

const capitalize = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
