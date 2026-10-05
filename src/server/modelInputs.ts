/**
 * Model inputs (CLAUDE.md §3, §6, §9, §2.10; Phase 2): everything the projection model and the market
 * layer need beyond the LeagueSnapshot (ModelInputs, src/engine/inputs.ts), built on the server and
 * already in THIS league's scoring, so the browser's Web Worker never needs raw stat lines or the
 * 15 MB player database. Server-side (its I/O goes through the injected HttpClient), but it doesn't
 * import "server-only": `npm run league:report` runs it under tsx.
 *
 * buildModelInputs loads, ONE request at a time through the shared, polite, cached HttpClient (§0.9):
 *   1. the NFL schedule (ESPN proTeamSchedules_wl: byes, kickoffs, each team's opponents and the NFL's
 *      last week; cached 7 days; ModelInputs.nfl keeps kickoffs and opponents from the current week on),
 *   2. Sleeper's weekly projections, from lookbackWeeks before the current week (an injured player's
 *      most recent healthy projection, §6 step 1) through the last fantasy week (each week its own cache
 *      entry: 6 hours through two weeks after the current one, 24 hours for later weeks, §2.10). Every
 *      week read before its first kickoff (the schedule of step 1) also goes to the pre-game projection
 *      archive (§2.3, src/server/projectionArchive.ts; local disk only, in the background; when the
 *      schedule failed, only weeks after the current one count as before kickoff),
 *   3. Sleeper's season projections (§6's last-resort base rate; 6 hours),
 *   4. Sleeper's stats for the completed weeks (6 hours), up to the latest week the schedule of step 1 shows begun
 *      (statsWeeksStarted, review BF-R2: a week not begun has an empty list, never cached),
 *   5. FantasyCalc values in the league's format (keeper leagues: the dynasty and the redraft list,
 *      §9, each loaded whatever happens to the other, ⚠️ though once FantasyCalc doesn't answer the first, the second is
 *      read from the server cache only, not asked: the outage memory below; dynasty leagues with weeks left to project: the
 *      redraft list in their format too, after their own list loaded, for the market blend, §6 step 8,
 *      MarketInputs.seasonValues). Each list is a format of its own, refreshed at most once every 3 hours and only
 *      when a build reads it (FantasyCalc's conditions of 2026-10-05, reports/fantasycalc-permission.md: TTL.fantasyCalc;
 *      a day before; an answer the checks turn down holds that format off for as long, review of Checkpoint 7b's server
 *      work: src/data/fantasyCalcValues.ts FantasyCalcGate.rejected), and /values/current is the only FantasyCalc endpoint
 *      asked: its /players list, which once widened knownIds, isn't (knownIds is the players the value lists name; only the
 *      reports read it).
 * Steps 2–4 go through one SleeperGate (src/data/sleeperProjections.ts; review DATA-1, PERF-1): once
 * Sleeper stops answering, nothing more is asked of it in this build, nor in the builds of the next few
 * minutes, so an outage costs the build that finds it 2 requests and the builds after it none (what the
 * server cache holds is still read), and what's left out is one SLEEPER_DOWN warning. Step 5's value lists go through
 * a FantasyCalcGate the same way (src/data/fantasyCalcValues.ts; Phase 4c's polish): once FantasyCalc stops answering,
 * nothing more is asked of it for 5, then 10, at most 15 minutes, and the lists come from the server cache meanwhile
 * (a format with no copy there gets none: FANTASYCALC_UNAVAILABLE says it wasn't asked).
 * Once the season is over (no fantasy week left: currentWeek > lastWeek; or the league's season comes before the one
 * being played, review BF-R2), or before it has started
 * (the league's season comes after the one being played: a league renewed in January or February for
 * next season, review DATA-3), only step 5 runs: nothing is left to project, or nothing is published
 * yet, so asking for schedules, projections and stats would only load the sources (§0.9), while dynasty
 * and keeper values still matter (a dynasty league's season list doesn't then: nothing is projected to
 * blend).
 * Every source that fails becomes a warning and an empty contribution; nothing here throws for a
 * source failure (the route fails only when the league import itself fails).
 * Every FantasyCalc list step 5 read also goes to the local FantasyCalc archive (planner reply to
 * Checkpoint 4, change 7: src/server/fantasyCalcArchive.ts; one copy per format per day, local disk
 * only, in the background), for Phase 6's backtest of the market blend.
 * FantasyCalc's fallbacks (Phase 4c; planner reply to Checkpoint 4b, change 12: FantasyCalc stays the only
 * market source): its lists stay in the server cache up to config.market.fantasyCalcCurveDays (90) days
 * (src/data/fantasyCalcValues.ts), and when it doesn't answer, the copy the cache still holds stands in by its
 * age at the build time (fantasyCalcListUse; fantasyCalcUsed): at most fantasyCalcStaleDays (7) old, as
 * FantasyCalc's own values, MarketInputs.fallback { kind "saved", listDate } and a note ("Trade values from Sep
 * 28: FantasyCalc didn't answer."); older, only to calibrate the model's own value curve (src/engine/market.ts
 * curveMarketValues: every player valued from his projected points), fallback { kind "curve", listDate } and a
 * FANTASYCALC_VALUES_ESTIMATED warning, the banner's words (market.fantasyCalcFallbackText); none: no values,
 * FANTASYCALC_UNAVAILABLE as before. A keeper league whose dynasty list is too old but whose redraft list stands
 * in uses the redraft list as before (FANTASYCALC_DYNASTY_UNAVAILABLE), and a too-old redraft list next to a
 * usable dynasty one is left out (FANTASYCALC_REDRAFT_UNAVAILABLE; in the curve fallback too, when the old dynasty
 * list has no redraft list beside it: perception is then fitted to the dynasty list); a dynasty league's season list
 * (the blend's) is asked for only after its own list stood in or loaded, and read only when fresh or saved. It is no
 * trade value, so a saved copy of it makes no fallback (review of track MK): its own note says the blend reads it
 * ("The trade-market blend uses FantasyCalc's redraft values from Sep 30: FantasyCalc didn't answer."; once, when the
 * trade values' note names the same day).
 *
 * assembleModelInputs is the pure part (no I/O, time passed in): league scoring (expectedPoints for
 * projections, actualPoints for stat lines, §5), the FantasyCalc join (marketInputsFrom: Sleeper ids on
 * sleeperId, `espn:` ids on espnId with a name and position check), source stamps, warnings and notes.
 * It logs nothing per player.
 *
 * Choices of this module (reported at Checkpoint 2):
 * - Points are rounded to 0.01: far below any difference §6 acts on, and it halves the response.
 * - NFL opponents (Phase 4: "Streaming picks this week" shows each pick's opponent) come for every week
 *   from the current one through the NFL's last, like kickoffs: about 15 KB of JSON from week 4 (18 KB
 *   from week 1; kickoffs take 13 KB), shrinking every week.
 * - Once the season is over, the inputs carry no projections, stats or NFL schedule (see above); every
 *   player still gets an entry, and the market loads as usual. The same goes for a season that hasn't
 *   started, with a SEASON_NOT_STARTED warning saying why. "Hasn't started" is the pure calendar test
 *   season > defaultSeason(now) (src/lib/season.ts: the calendar year, or last year in January and
 *   February), so from March on the sources are asked as usual, and their own warnings say what isn't
 *   published yet.
 * - Several failed weeks of one Sleeper source become one warning listing the weeks (a down source
 *   would otherwise add one line per week to the League page), and everything Sleeper didn't serve
 *   because it stopped answering becomes one warning.
 * - A keeper league whose dynasty list fails still gets its redraft list, the one the League page shows
 *   (§9 perception; review DATA-2): the market is then in the redraft format, whose isDynasty false tells
 *   a reader of the future term that it's missing, with a FANTASYCALC_DYNASTY_UNAVAILABLE warning. How a later
 *   list is loaded depends on how the first one failed (loadFantasyCalc). FantasyCalc didn't answer it (no response, 429,
 *   5xx or a web page, whether a saved copy then stood in or not): the outage memory holds FantasyCalc off, so the later
 *   lists are read from the server cache only (a copy within the 3-hour TTL as FantasyCalc's answer, an older one as a
 *   saved copy standing in) and one with no copy there isn't asked: a keeper league's FANTASYCALC_*_UNAVAILABLE warning
 *   says so ("not asked while FantasyCalc isn't answering"); a dynasty league's season list gets no warning here (the
 *   League model says the blend is off). ⚠️ Phase 4c's polish (review POL-2) changed this: before the outage memory, such a list was asked
 *   once, without a retry (review DATA-2). FantasyCalc answered with a body the checks turned down and a saved copy stood
 *   in: a later list is still asked once, without a retry (review of track A). Any other failure (a 404, or a body turned
 *   down with no saved copy) leaves a later list its retry.
 */
import type { EspnProjections } from "@/adapters/espn/projections";
import { LAST_NFL_WEEK } from "@/adapters/sleeper/normalize";
import type { HttpClient } from "@/adapters/types";
import { fantasyCalcGate, fantasyCalcListUse, loadFantasyCalcValues, marketInputsFrom, type FantasyCalcAgeConfig, type FantasyCalcGate, type FantasyCalcListUse, type FantasyCalcValuesLoad, type MarketFormats } from "@/data/fantasyCalcValues";
import { loadNflSchedule, toNflScheduleInputs, type NflSchedule } from "@/data/nflSchedule";
import {
  loadSleeperSeasonProjections,
  loadSleeperStats,
  loadSleeperWeeklyProjections,
  SLEEPER_DOWN,
  sleeperGate,
  type SleeperLoadMeta,
  type SleeperProjectionWeek,
  type SleeperSeasonProjectionsLoad,
  type SleeperStatsLoad,
  type SleeperWeeklyProjectionsLoad,
} from "@/data/sleeperProjections";
import type { PlayerIdResolver } from "@/data/types";
import { config } from "@/engine/config";
import type { FantasyCalcFormat, InputSourceStamp, MarketInputs, ModelInputs, PlayerInputs } from "@/engine/inputs";
import { fantasyCalcFallbackText, fantasyCalcFormat, fantasyCalcFormatLabel, noteDay } from "@/engine/market";
import { POSITIONS, type ImportWarning, type LeagueSettings, type LeagueSnapshot, type Pos, type Scoring, type StatLine } from "@/engine/model";
import { actualPoints, expectedPoints, playedGame } from "@/engine/scoring";
import { redactSecrets } from "@/lib/errors";
import { defaultSeason } from "@/lib/season";
import { archiveFantasyCalcLists, defaultFantasyCalcArchiver, type FantasyCalcArchiver } from "./fantasyCalcArchive";
import { errorNameOf, logEvent } from "./log";
import { defaultProjectionArchiver, firstKickoffOf, type ProjectionArchiver } from "./projectionArchive";

/** Source names on the League page (InputSourceStamp.source). */
export const MODEL_SOURCES = {
  sleeperProjections: "Sleeper projections",
  sleeperStats: "Sleeper stats",
  fantasyCalc: "FantasyCalc values",
  nflSchedule: "NFL schedule (ESPN)",
} as const;

// ---------------------------------------------------------------------------------------------
// Which weeks and players

export interface ModelWeekPlan {
  /** The last fantasy week: the last playoff week, else the last regular-season week (ModelInputs.lastWeek). */
  lastWeek: number;
  /** The settings list no season weeks, so lastWeek is the NFL's last regular-season week (a warning says so). */
  lastWeekUnknown: boolean;
  /**
   * No fantasy week is left (currentWeek > lastWeek), or the league's season comes before the season being played,
   * defaultSeason(now) (review BF-R2: a past season is over whatever a snapshot's week says, and a snapshot made from what a
   * browser sent can say any week): nothing to project, so only FantasyCalc is loaded.
   */
  seasonOver: boolean;
  /**
   * The league's season hasn't started: it comes after the season being played, defaultSeason(now) (a
   * league renewed in January or February for next season; review DATA-3). No NFL schedule, projection
   * or stat is published for it yet, so only FantasyCalc is loaded.
   */
  notStarted: boolean;
  /**
   * NFL weeks of Sleeper weekly projections: max(1, currentWeek − lookbackWeeks) through
   * min(lastWeek, 18). None once the season is over or before it has started.
   */
  projectionWeeks: number[];
  /** Completed NFL weeks whose stats count: 1 through currentWeek − 1 (at most 18). None once the season is over or before it has started. */
  statsWeeks: number[];
}

function weekRange(from: number, to: number): number[] {
  const out: number[] = [];
  for (let w = Math.max(1, Math.ceil(from)); w <= to; w++) out.push(w);
  return out;
}

/** The weeks the model inputs cover at `now`, the build time (pure; §6 step 1 lookback from config.projections). */
export function modelWeekPlan(snapshot: Pick<LeagueSnapshot, "season" | "currentWeek" | "settings">, now: Date, lookbackWeeks: number = config.projections.lookbackWeeks): ModelWeekPlan {
  const seasonWeeks = [...snapshot.settings.regularSeasonWeeks, ...snapshot.settings.playoffWeeks].filter((w) => Number.isInteger(w) && w >= 1);
  const lastWeekUnknown = seasonWeeks.length === 0;
  const lastWeek = lastWeekUnknown ? LAST_NFL_WEEK : Math.max(...seasonWeeks);
  const current = snapshot.currentWeek;
  const seasonOver = current > lastWeek || snapshot.season < defaultSeason(now);
  const notStarted = !seasonOver && snapshot.season > defaultSeason(now);
  const idle = seasonOver || notStarted;
  return {
    lastWeek,
    lastWeekUnknown,
    seasonOver,
    notStarted,
    projectionWeeks: idle ? [] : weekRange(current - Math.max(0, lookbackWeeks), Math.min(lastWeek, LAST_NFL_WEEK)),
    statsWeeks: idle ? [] : weekRange(1, Math.min(current - 1, LAST_NFL_WEEK)),
  };
}

/**
 * The stats weeks worth asking Sleeper for at `now` (review BF-R2): those up to the latest NFL week whose first game has
 * kicked off by the season's schedule. A week not begun has no stats, and Sleeper's empty list for it is never cached, so
 * every build would ask again; a snapshot made from what a browser sent can name any current week. Without a schedule
 * (or one without kickoff times) the weeks as planned.
 */
export function statsWeeksStarted(weeks: readonly number[], schedule: Pick<NflSchedule, "kickoffs"> | null, now: Date): number[] {
  if (!schedule || !Object.keys(schedule.kickoffs).length) return [...weeks];
  let latest = 0;
  for (const key of Object.keys(schedule.kickoffs)) {
    const week = Number(key);
    const first = firstKickoffOf(schedule, week);
    if (Number.isInteger(week) && first !== null && first <= now.getTime() && week > latest) latest = week;
  }
  return weeks.filter((w) => w <= latest);
}

/** Every rostered player (roster, IR, taxi, team by team) and every snapshot free agent, once each, in that order. */
export function relevantPlayerIds(snapshot: Pick<LeagueSnapshot, "teams" | "freeAgents">): string[] {
  const out = new Set<string>();
  for (const team of snapshot.teams) for (const id of [...team.roster, ...team.ir, ...team.taxi]) out.add(id);
  for (const id of snapshot.freeAgents) out.add(id);
  return [...out];
}

/** Positions a lineup slot can start, in canonical order (Sleeper requests drop P themselves). */
export function startablePositions(settings: Pick<LeagueSettings, "lineup">): Pos[] {
  return POSITIONS.filter((p) => settings.lineup.some((s) => s.count > 0 && s.eligible.includes(p)));
}

/** A canonical id is a Sleeper id unless it is `${platform}:${id}` (§4). */
export function isSleeperId(id: string): boolean {
  return !id.includes(":");
}

/**
 * The FantasyCalc formats a league requests (§9, §2.9): its own list (redraft → redraft, dynasty →
 * dynasty), and for keeper leagues the dynasty list for `values` plus the redraft list for perception.
 * Dynasty leagues also name the redraft list in their own format, `season`, for the market blend (§6
 * step 8; MarketInputs.seasonValues), which buildModelInputs asks for only while weeks are left to
 * project. Each carries its own substitution notes (fantasyCalcFormat).
 */
export function marketFormats(settings: LeagueSettings): MarketFormats {
  if (settings.leagueType === "keeper") return { values: fantasyCalcFormat(settings, "dynasty"), redraft: fantasyCalcFormat(settings, "redraft") };
  if (settings.leagueType === "dynasty") return { values: fantasyCalcFormat(settings), season: fantasyCalcFormat(settings, "redraft") };
  return { values: fantasyCalcFormat(settings) };
}

// ---------------------------------------------------------------------------------------------
// The pure assembly

/**
 * FantasyCalc as loaded: the league's own list, and for keeper leagues the redraft list. A list may be a saved copy
 * (`stale`, with the time FantasyCalc served it): fantasyCalcUsed reads each by its age (Phase 4c).
 */
export interface FantasyCalcLoads {
  /**
   * The league's own list (§9). A keeper league whose dynasty list couldn't be loaded gets its redraft
   * list here instead (its format says isDynasty false) and no `redraft`. In the curve fallback, a saved copy older
   * than config.market.fantasyCalcStaleDays (and a keeper league's redraft copy as old, as `redraft`).
   */
  values: FantasyCalcValuesLoad;
  /** Keeper leagues: the redraft list (perception, §9); missing when it couldn't be loaded. */
  redraft?: FantasyCalcValuesLoad;
  /**
   * Dynasty leagues with weeks left: the redraft list in the league's format, for the market blend (§6 step 8;
   * MarketInputs.seasonValues); missing when it couldn't be loaded (the League model then says the blend is off).
   */
  season?: FantasyCalcValuesLoad;
}

/** What buildModelInputs loaded (hand-built in tests). A source that couldn't be loaded at all is null. */
export interface ModelSources {
  schedule: NflSchedule | null;
  weekly: SleeperWeeklyProjectionsLoad | null;
  season: SleeperSeasonProjectionsLoad | null;
  stats: SleeperStatsLoad | null;
  /** Null when no FantasyCalc list could be loaded (market null). */
  fantasyCalc: FantasyCalcLoads | null;
  /** ESPN leagues: ESPN's league-scored projections (importEspnLeagueForModel). */
  espn?: EspnProjections;
  /** Every warning from loading, in load order, the loaders' own included (assembly reads only these). */
  warnings: readonly ImportWarning[];
}

/** A hundredth of a point (ModelInputs points are rounded to it; see the header). */
const POINTS_SCALE = 100;

export function roundPoints(x: number): number {
  return Math.round(x * POINTS_SCALE) / POINTS_SCALE;
}

/** A projection in league points; null for a line worth nothing (a stub-like line, §6 "not projected healthy"). */
function projectionValue(x: number): number | null {
  const v = roundPoints(x);
  return Number.isFinite(v) && v !== 0 ? v : null;
}

function espnWeeks(weeks: Readonly<Record<number, number | null>> | undefined): Record<number, number | null> {
  const out: Record<number, number | null> = {};
  for (const [key, v] of Object.entries(weeks ?? {})) {
    const week = Number(key);
    if (!Number.isInteger(week) || week < 1) continue;
    out[week] = typeof v === "number" ? projectionValue(v) : null;
  }
  return out;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "1–3, 5, 9–11". */
export function weeksText(weeks: readonly number[]): string {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && (sorted[j + 1] as number) === (sorted[j] as number) + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(", ");
}

/** Per-week warnings of the Sleeper loaders (src/data/sleeperProjections.ts), with their platformPath prefix. */
const WEEK_WARNINGS: ReadonlyArray<{ code: string; prefix: string; message: (which: string, reasons: string) => string }> = [
  { code: "PROJECTIONS_WEEK_UNAVAILABLE", prefix: "projections/", message: (which, reasons) => `Sleeper's projections for ${which} couldn't be read${reasons}, so those weeks are left out.` },
  { code: "STATS_WEEK_UNAVAILABLE", prefix: "stats/", message: (which, reasons) => `Sleeper's stats for ${which} couldn't be read${reasons}, so those weeks' points are left out.` },
];

/** The loaders' reason in a warning message: its first "(…)". */
function reasonIn(message: string): string | undefined {
  return /\(([^()]+)\)/.exec(message)?.[1]?.trim() || undefined;
}

/** The warnings with every one of `code` replaced by `merged`, at the first one's place. */
function replaceWith(warnings: readonly ImportWarning[], code: string, merged: ImportWarning): ImportWarning[] {
  const first = warnings.findIndex((w) => w.code === code);
  const rest = warnings.filter((w) => w.code !== code);
  rest.splice(first, 0, merged);
  return rest;
}

/** "week 5" or "weeks 1–3, 5". */
function weekWords(weeks: readonly number[]): string {
  return `${new Set(weeks).size === 1 ? "week" : "weeks"} ${weeksText(weeks)}`;
}

/** "a", "a and b", "a, b and c". */
function listWords(parts: readonly string[]): string {
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
}

/**
 * One warning for everything the Sleeper loaders left out because Sleeper stopped answering: their
 * SLEEPER_DOWN items (platformPath projections/<week>, projections/season or stats/<week>) and reasons.
 */
function sleeperDownWarning(items: readonly ImportWarning[]): ImportWarning {
  const projections: number[] = [];
  const stats: number[] = [];
  let season = false;
  const reasons: string[] = [];
  for (const w of items) {
    const path = w.platformPath ?? "";
    const weekly = /^(projections|stats)\/(\d+)$/.exec(path);
    if (path === "projections/season") season = true;
    else if (weekly?.[1] === "projections") projections.push(Number(weekly[2]));
    else if (weekly?.[1] === "stats") stats.push(Number(weekly[2]));
    const reason = reasonIn(w.message);
    if (reason && !reasons.includes(reason)) reasons.push(reason);
  }
  const parts = [
    ...(projections.length ? [`its projections for ${weekWords(projections)}`] : []),
    ...(season ? ["its season projections"] : []),
    ...(stats.length ? [`its stats for ${weekWords(stats)}`] : []),
  ];
  const what = parts.length ? `${listWords(parts)} are` : "some of its data is";
  return { code: SLEEPER_DOWN, message: `Sleeper stopped answering${reasons.length ? ` (${reasons.join("; ")})` : ""}, so ${what} left out. Try again in a few minutes.` };
}

/**
 * Two or more per-week warnings of one Sleeper source become one, at the first one's place, listing
 * the weeks and the distinct reasons (the loaders' "(…)"); every SLEEPER_DOWN item (Sleeper stopped
 * answering) becomes one warning, at the first one's place, for all sources. Everything else is kept
 * as it is.
 */
export function collapseWeekWarnings(warnings: readonly ImportWarning[]): ImportWarning[] {
  let out: ImportWarning[] = [...warnings];
  for (const kind of WEEK_WARNINGS) {
    const matching = out.filter((w) => w.code === kind.code);
    if (matching.length < 2) continue;
    const weeks: number[] = [];
    const reasons: string[] = [];
    for (const w of matching) {
      const week = w.platformPath?.startsWith(kind.prefix) ? Number(w.platformPath.slice(kind.prefix.length)) : Number.NaN;
      if (Number.isInteger(week)) weeks.push(week);
      const reason = reasonIn(w.message);
      if (reason && !reasons.includes(reason)) reasons.push(reason);
    }
    const which = weeks.length === matching.length ? `weeks ${weeksText(weeks)}` : plural(matching.length, "week");
    out = replaceWith(out, kind.code, { code: kind.code, message: kind.message(which, reasons.length ? ` (${reasons.join("; ")})` : ""), platformPath: kind.prefix.slice(0, -1) });
  }
  const down = out.filter((w) => w.code === SLEEPER_DOWN);
  if (down.length) out = replaceWith(out, SLEEPER_DOWN, sleeperDownWarning(down));
  return out;
}

/**
 * "Trade values: FantasyCalc …" and one note per substitution (each once), for the formats that loaded. A
 * dynasty league's season list (the market blend's, §6 step 8) gets no note of its own: the blend reads a
 * list in every league type, and the League page's "Projected points" says which in each (in a dynasty
 * league, this season's redraft values rather than the dynasty values shown), so a note for dynasty leagues
 * alone would say less than the page and only in one league type (review of track A). Its size, PPR and TE
 * substitutions are the league's own list's anyway.
 */
export function fantasyCalcNotes(values: FantasyCalcFormat, redraft?: FantasyCalcFormat): string[] {
  const head = redraft
    ? `Trade values: FantasyCalc ${fantasyCalcFormatLabel(values)} for long-term worth, and ${fantasyCalcFormatLabel(redraft)} for how managers see a trade this season.`
    : `Trade values: FantasyCalc ${fantasyCalcFormatLabel(values)}.`;
  const subs = [...new Set([...values.substitutions, ...(redraft?.substitutions ?? [])])];
  return [head, ...subs.map((s) => `Trade values: ${s}.`)];
}

/** The lists of a FantasyCalc load the market reads (fantasyCalcUsed), and the fallback they make. */
export interface FantasyCalcUsed {
  values: FantasyCalcValuesLoad;
  redraft?: FantasyCalcValuesLoad;
  season?: FantasyCalcValuesLoad;
  /** MarketInputs.fallback, the trade values' (`values`, `redraft`); null when FantasyCalc answered for both. */
  fallback: NonNullable<MarketInputs["fallback"]> | null;
  /**
   * A dynasty league's season list read as a saved copy: when FantasyCalc served it (ISO). It is no trade value (the market
   * blend's table alone), so it makes no fallback, only its own note (seasonListNote; review of track MK).
   */
  seasonListDate?: string;
}

/** The note for a dynasty league's season list read as a saved copy (FantasyCalcUsed.seasonListDate): "The trade-market blend uses FantasyCalc's redraft values from Sep 30: FantasyCalc didn't answer." */
export function seasonListNote(listDate: string): string {
  return `The trade-market blend uses FantasyCalc's redraft values from ${noteDay(listDate) ?? "an earlier day"}: FantasyCalc didn't answer.`;
}

/** The oldest fetch time of `loads`, ISO (`now` when none is known), as marketInputsFrom dates the market. */
function oldestTime(loads: ReadonlyArray<{ fetchedAt?: number }>, now: Date): string {
  const times = loads.map((l) => l.fetchedAt).filter((t): t is number => t !== undefined && Number.isFinite(t));
  return new Date(times.length ? Math.min(...times) : now.getTime()).toISOString();
}

/**
 * Which loaded FantasyCalc lists the market reads at `now`, the build time, and its fallback (pure; Phase 4c, planner reply
 * to Checkpoint 4b, change 12; the header), by each list's age (fantasyCalcListUse):
 * - the league's own list (`values`) "fresh" or "saved": the market as before Phase 4c, a keeper league's redraft list and
 *   a dynasty league's season list read only when "fresh" or "saved" too (an older one is left out: the loader warns for
 *   the redraft list, and the League model says the blend is off without the season list); fallback "saved" when a trade
 *   value list read (`values`, a keeper league's `redraft`) is a saved copy (listDate: the oldest such copy's time), else
 *   null. A saved season list is no trade value (the blend reads it alone: review of track MK, a fresh dynasty list next
 *   to it was announced as "Trade values from …"), so it only sets seasonListDate;
 * - `values` "curve": the curve fallback: it and a keeper league's redraft list (unless "expired") only calibrate the
 *   model's own curve, no season list (no blend then); listDate: the oldest list read;
 * - `values` "expired": nothing (null).
 */
export function fantasyCalcUsed(loads: Pick<FantasyCalcLoads, "values" | "redraft" | "season">, now: Date, cfg: FantasyCalcAgeConfig = config.market): FantasyCalcUsed | null {
  const ageOf = (l: FantasyCalcValuesLoad): FantasyCalcListUse => fantasyCalcListUse(l, now, cfg);
  const own = ageOf(loads.values);
  if (own === "expired") return null;
  if (own === "curve") {
    const redraft = loads.redraft && ageOf(loads.redraft) !== "expired" ? loads.redraft : undefined;
    return { values: loads.values, ...(redraft ? { redraft } : {}), fallback: { kind: "curve", listDate: oldestTime([loads.values, ...(redraft ? [redraft] : [])], now) } };
  }
  const readable = (l: FantasyCalcValuesLoad | undefined): FantasyCalcValuesLoad | undefined => (l && (ageOf(l) === "fresh" || ageOf(l) === "saved") ? l : undefined);
  const redraft = readable(loads.redraft);
  const season = readable(loads.season);
  const saved = [loads.values, redraft].filter((l): l is FantasyCalcValuesLoad => l !== undefined && ageOf(l) === "saved");
  return {
    values: loads.values,
    ...(redraft ? { redraft } : {}),
    ...(season ? { season } : {}),
    fallback: saved.length ? { kind: "saved", listDate: oldestTime(saved, now) } : null,
    ...(season && ageOf(season) === "saved" ? { seasonListDate: oldestTime([season], now) } : {}),
  };
}

/** A stamp from the loads that delivered data: the oldest fetch time (`now` when none is known), stale when any was. */
function stamp(source: string, loads: ReadonlyArray<{ fetchedAt?: number; stale: boolean }>, now: Date): InputSourceStamp | null {
  if (!loads.length) return null;
  const times = loads.map((l) => l.fetchedAt).filter((t): t is number => t !== undefined && Number.isFinite(t));
  const stale = loads.some((l) => l.stale);
  return { source, fetchedAt: new Date(times.length ? Math.min(...times) : now.getTime()).toISOString(), ...(stale ? { stale: true } : {}) };
}

const NAMES_LISTED = 5;

function namesList(names: readonly string[]): string {
  const shown = names.slice(0, NAMES_LISTED).join(", ");
  return names.length > NAMES_LISTED ? `${shown} and ${names.length - NAMES_LISTED} more` : shown;
}

/**
 * ModelInputs for a snapshot from what was loaded (pure, deterministic; `now` is the build time).
 * Per relevant player with a Sleeper id and a PlayerInfo (his league position scores the lines):
 * - sleeper[w] = expectedPoints(line) for every loaded projection week (null: no real line, or worth 0);
 * - sleeperSeasonPerGame = expectedPoints(season line per game), when Sleeper projects his season;
 * - actual[w] = actualPoints(stat line) for loaded completed weeks he played (gp > 0).
 * Players without a Sleeper id get empty sleeper and actual (and a warning naming them). With ESPN
 * projections (ESPN leagues), every player gets espn: ESPN's weeks for him, possibly none.
 */
export function assembleModelInputs(snapshot: LeagueSnapshot, loaded: ModelSources, now: Date): ModelInputs {
  const scoring: Scoring = snapshot.settings.scoring;
  const plan = modelWeekPlan(snapshot, now);
  const ids = relevantPlayerIds(snapshot);

  const weekly = loaded.weekly;
  const stats = loaded.stats;
  const projectionWeeks = weekly ? plan.projectionWeeks.filter((w) => weekly.weeks.has(w)) : [];
  const statsWeeks = stats ? plan.statsWeeks.filter((w) => stats.weeks.has(w)) : [];
  const projectionLines = projectionWeeks.map((w) => [w, weekly?.weeks.get(w)] as const);
  const statLines = statsWeeks.map((w) => [w, stats?.weeks.get(w)] as const);
  const seasonLines = loaded.season?.perGame;
  // ESPN's projections count as loaded when the extraction found any player (an empty one is a warning).
  const espn = loaded.espn && Object.keys(loaded.espn).length > 0 ? loaded.espn : undefined;
  const hasEspn = espn !== undefined;

  const players: Record<string, PlayerInputs> = {};
  const noSleeperId: string[] = [];
  for (const id of ids) {
    const inputs: PlayerInputs = { sleeper: {}, actual: {} };
    const info = snapshot.players[id];
    if (!isSleeperId(id)) noSleeperId.push(info?.name ?? id);
    else if (info) {
      const pos = info.pos;
      for (const [week, lines] of projectionLines) {
        const line = lines?.get(id);
        inputs.sleeper[week] = line ? projectionValue(expectedPoints(line.stats, pos, scoring)) : null;
      }
      const seasonLine = seasonLines?.get(id);
      if (seasonLine) {
        const perGame = projectionValue(expectedPoints(seasonLine, pos, scoring));
        if (perGame !== null) inputs.sleeperSeasonPerGame = perGame;
      }
      for (const [week, lines] of statLines) {
        const line: StatLine | undefined = lines?.get(id);
        if (!line || !playedGame(line)) continue;
        const points = roundPoints(actualPoints(line, pos, scoring));
        if (Number.isFinite(points)) inputs.actual[week] = points;
      }
    }
    if (espn) inputs.espn = espnWeeks(espn[id]);
    players[id] = inputs;
  }

  // FantasyCalc (§9): values joined to canonical ids, keeper leagues' redraft list, dynasty leagues' season list (the market
  // blend's), knownIds; the lists read by their age, and the fallback they make (Phase 4c: fantasyCalcUsed).
  const fc = loaded.fantasyCalc;
  const used = fc ? fantasyCalcUsed(fc, now) : null;
  const market: MarketInputs | null =
    fc && used
      ? {
          ...marketInputsFrom({
            values: used.values,
            ...(used.redraft ? { redraft: used.redraft } : {}),
            ...(used.season ? { season: used.season } : {}),
            players: snapshot.players,
            relevantIds: ids,
            now,
          }),
          ...(used.fallback ? { fallback: used.fallback } : {}),
        }
      : null;

  const warnings: ImportWarning[] = [];
  if (plan.notStarted) {
    warnings.push({
      code: "SEASON_NOT_STARTED",
      message: `The ${snapshot.season} season hasn't started yet, so nothing is projected: Sleeper's projections and stats and the NFL schedule are loaded from March ${snapshot.season} on.`,
      platformPath: "season",
    });
  }
  warnings.push(...collapseWeekWarnings(loaded.warnings));
  // FantasyCalc's curve fallback: the banner's words, next to the loaders' own warnings (Phase 4c).
  if (used?.fallback?.kind === "curve") warnings.push({ code: "FANTASYCALC_VALUES_ESTIMATED", message: fantasyCalcFallbackText(used.fallback), platformPath: "values/current" });
  if (fc && !used) {
    // A list too old even for the curve (the loader never passes one; hand-built loads can).
    warnings.push({ code: "FANTASYCALC_UNAVAILABLE", message: `FantasyCalc's values couldn't be loaded (its newest saved list is more than ${config.market.fantasyCalcCurveDays} days old), so players have no market values yet.`, platformPath: "values/current" });
  }
  if (plan.lastWeekUnknown) {
    warnings.push({ code: "SEASON_WEEKS_UNKNOWN", message: `The league's settings don't list its season weeks, so projections run through NFL week ${plan.lastWeek}.`, platformPath: "settings.regularSeasonWeeks" });
  }
  if (snapshot.platform === "espn" && !hasEspn && plan.projectionWeeks.length) {
    warnings.push({ code: "ESPN_PROJECTIONS_UNAVAILABLE", message: "ESPN's own projections couldn't be read from the league data, so only Sleeper's projections are used.", platformPath: "player.stats[statSourceId=1]" });
  }
  if (noSleeperId.length) {
    const n = noSleeperId.length;
    const covered = hasEspn ? ` (ESPN's own projections still cover ${n === 1 ? "him" : "them"})` : "";
    warnings.push({
      code: "NO_SLEEPER_ID",
      message: `${plural(n, "player")} ${n === 1 ? "has" : "have"} no Sleeper id, so Sleeper's projections and stats don't cover ${n === 1 ? "him" : "them"}${covered}: ${namesList(noSleeperId)}.`,
    });
  }

  const sources: InputSourceStamp[] = [];
  const projectionLoads = [...(weekly && weekly.weeks.size ? [weekly] : []), ...(loaded.season && loaded.season.perGame.size ? [loaded.season] : [])];
  const stamps = [
    stamp(MODEL_SOURCES.sleeperProjections, projectionLoads, now),
    stamp(MODEL_SOURCES.sleeperStats, stats && stats.weeks.size ? [stats] : [], now),
    market && used ? { source: MODEL_SOURCES.fantasyCalc, fetchedAt: market.fetchedAt, ...(used.values.stale || used.redraft?.stale || used.season?.stale ? { stale: true } : {}) } : null,
    stamp(MODEL_SOURCES.nflSchedule, loaded.schedule ? [loaded.schedule] : [], now),
  ];
  for (const s of stamps) if (s) sources.push(s);

  // The format notes, then a saved list's date (Phase 4c: "Trade values from Sep 28: FantasyCalc didn't answer."), then a
  // dynasty league's saved season list's own (the blend's; once, when the trade values' note names the same day).
  const savedNote = used?.fallback?.kind === "saved" ? fantasyCalcFallbackText(used.fallback) : null;
  const seasonDate = used?.seasonListDate;
  const seasonNote = seasonDate !== undefined && !(used?.fallback?.kind === "saved" && noteDay(used.fallback.listDate) === noteDay(seasonDate)) ? seasonListNote(seasonDate) : null;
  const notes = used ? [...fantasyCalcNotes(used.values.format, used.redraft?.format), ...(savedNote ? [savedNote] : []), ...(seasonNote ? [seasonNote] : [])] : [];

  return {
    version: 1,
    season: snapshot.season,
    currentWeek: snapshot.currentWeek,
    lastWeek: plan.lastWeek,
    builtAt: now.toISOString(),
    nfl: loaded.schedule ? toNflScheduleInputs(loaded.schedule, snapshot.currentWeek) : { byeWeek: {}, kickoffs: {} },
    players,
    espnProjections: hasEspn,
    market,
    sources,
    warnings,
    notes,
  };
}

// ---------------------------------------------------------------------------------------------
// Loading

export interface BuildModelInputsArgs {
  snapshot: LeagueSnapshot;
  /** The shared, polite, cached client (src/app/api/_lib/deps.ts). */
  http: HttpClient;
  /** Translates ESPN's team abbreviations in the NFL schedule to PlayerInfo.nflTeam codes. */
  resolver: Pick<PlayerIdResolver, "defenseId">;
  now: Date;
  /** ESPN leagues: ESPN's league-scored projections (importEspnLeagueForModel). */
  espn?: EspnProjections;
  /**
   * Where weeks fetched before their first kickoff are archived (§2.3 "Pre-game snapshots"). Absent: the
   * process's own archive when it has a local disk (defaultProjectionArchiver: off in production, on
   * Vercel and under Vitest); null: none. Tests pass their own.
   */
  projectionArchive?: ProjectionArchiver | null;
  /**
   * Where every FantasyCalc list read is archived, one copy per format per day (planner reply to Checkpoint 4,
   * change 7: Phase 6's backtest of the market blend). Absent: the process's own archive when it has a local disk
   * (defaultFantasyCalcArchiver: off in production, on Vercel and under Vitest); null: none. Tests pass their own.
   */
  fantasyCalcArchive?: FantasyCalcArchiver | null;
}

/**
 * A loader's error in words: our loaders' messages name the source, never a URL (redacted anyway);
 * anything else isn't echoed.
 */
function reasonOf(err: unknown): string {
  if (err && typeof err === "object" && (err as { name?: unknown }).name === "LeagueImportError") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return redactSecrets(message.trim());
  }
  return "couldn't be reached";
}

/**
 * A loader that threw instead of reporting a warning is a bug: logged by its warning code and error name only (never
 * bodies, URLs or messages; src/server/log.ts).
 */
function logUnexpected(code: string, err: unknown): void {
  logEvent({ event: "model_load_failed", code, platform: "sleeper", errorName: errorNameOf(err) });
}

/** A Sleeper loader (they report failures as warnings); one that throws anyway degrades to a warning too. */
async function loadSleeper<T extends SleeperLoadMeta>(source: { what: string; code: string; path: string }, load: () => Promise<T>, warnings: ImportWarning[]): Promise<T | null> {
  try {
    const got = await load();
    warnings.push(...got.warnings);
    return got;
  } catch (err) {
    logUnexpected(source.code, err);
    warnings.push({ code: source.code, message: `Sleeper's ${source.what} couldn't be loaded, so they're left out.`, platformPath: source.path });
    return null;
  }
}

type ValuesAttempt = { load: FantasyCalcValuesLoad } | { error: unknown };

async function tryFantasyCalcValues(http: HttpClient, format: FantasyCalcFormat, opts: { maxRetries?: number; gate?: FantasyCalcGate } = {}): Promise<ValuesAttempt> {
  try {
    return { load: await loadFantasyCalcValues(http, format, opts) };
  } catch (error) {
    return { error };
  }
}

/**
 * FantasyCalc didn't answer (no response, 429 or 5xx: a SOURCE_DOWN LeagueImportError with such a status,
 * or none), as opposed to answering with something unusable. Checked by name, like reasonOf.
 */
function fantasyCalcDidntAnswer(err: unknown): boolean {
  const e = err as { name?: unknown; code?: unknown; detail?: { status?: unknown } } | null;
  if (!e || typeof e !== "object" || e.name !== "LeagueImportError" || e.code !== "SOURCE_DOWN") return false;
  const status = e.detail?.status;
  return typeof status !== "number" || status === 0 || status === 429 || status >= 500;
}

/** A list attempt with its use at the build time (fantasyCalcListUse): readable ("fresh" or "saved"), "curve" or "expired" (Phase 4c). */
type ListOutcome = { load: FantasyCalcValuesLoad; use: FantasyCalcListUse } | { error: unknown };

function outcomeOf(attempt: ValuesAttempt, now: Date): ListOutcome {
  return "load" in attempt ? { load: attempt.load, use: fantasyCalcListUse(attempt.load, now) } : attempt;
}

/** The list when FantasyCalc served it, or when a saved copy may stand in for it as its own ("fresh" or "saved"). */
const readableLoad = (o: ListOutcome | undefined): FantasyCalcValuesLoad | undefined => (o && "load" in o && (o.use === "fresh" || o.use === "saved") ? o.load : undefined);

/** The list when it is a saved copy only the curve fallback may read ("curve"). */
const curveLoad = (o: ListOutcome | undefined): FantasyCalcValuesLoad | undefined => (o && "load" in o && o.use === "curve" ? o.load : undefined);

/** Why a list can't be read as values, in words: the loader's error, or how old the saved copy is (Phase 4c). */
function outcomeReason(o: ListOutcome): string {
  if ("error" in o) return reasonOf(o.error);
  const day = o.load.fetchedAt !== undefined && Number.isFinite(o.load.fetchedAt) ? noteDay(new Date(o.load.fetchedAt).toISOString()) : null;
  const days = o.use === "expired" ? config.market.fantasyCalcCurveDays : config.market.fantasyCalcStaleDays;
  return `FantasyCalc didn't answer, and its newest saved list${day ? `, from ${day},` : ""} is more than ${days} days old`;
}

/**
 * FantasyCalc's lists for the league (§9). A keeper league loads both lists whatever happens to the
 * first (review DATA-2): the redraft one is what the League page shows (⚠️ during an outage the second is read from
 * the server cache only, not asked: below). A dynasty league asks for its
 * season list (`formats.season`, the market blend's, §6 step 8) only once its own list loaded: without
 * that there's no market to blend with. The season list failing isn't a warning here: the League model
 * says the blend is off (src/engine/league.ts BLEND_OFF_WARNING). After the first list, a later one depends on how
 * the first failed (the header's last choice): when FantasyCalc didn't answer it (no response, 429, 5xx or a web page,
 * a saved copy standing in or not), the outage memory holds FantasyCalc off and a later list is read from the server
 * cache only (Phase 4c's polish, below; review POL-2: it replaced review DATA-2's one attempt without a retry); when a
 * saved copy stood in for a live answer the checks turned down, a later list is asked once, without a retry (a fresh
 * or saved copy still serves; review of track A); otherwise it keeps its retry.
 * Phase 4c (the header): a list counts as loaded when it's readable at `now` ("fresh", or a saved copy at most
 * fantasyCalcStaleDays old); when no list is, but a saved copy at most fantasyCalcCurveDays old is, the curve fallback
 * takes it (and a keeper league's other old list; when that one is missing, FANTASYCALC_REDRAFT_UNAVAILABLE says the
 * dynasty list calibrates perception, as in the readable case: review of track MK); a dynasty league's season list is
 * asked only after a readable own list (the curve fallback blends nothing). FantasyCalc's /players isn't asked at all
 * (its conditions of 2026-10-05 allow only /values/current; until then it widened knownIds, which only the reports read,
 * when FantasyCalc served some list fresh in the build): knownIds counts the players a value list names.
 * Phase 4c's polish: every list goes through the build's FantasyCalcGate (fantasyCalcGate: the outage memory, the
 * header). While it holds FantasyCalc off, a list is read from the server cache only (loadFantasyCalcValues: a copy within
 * the TTL as FantasyCalc's answer, an older one as a saved copy standing in, none as a "not asked" failure), so the
 * build that finds an outage costs its own list's 2 attempts and nothing more.
 */
async function loadFantasyCalc(http: HttpClient, formats: MarketFormats, warnings: ImportWarning[], now: Date): Promise<FantasyCalcLoads | null> {
  // The build's outage memory (fantasyCalcGate): every list goes through it, and none is asked while it holds FantasyCalc off.
  const gate = fantasyCalcGate(http, now);
  const ownAttempt = await tryFantasyCalcValues(http, formats.values, { gate });
  const own = outcomeOf(ownAttempt, now);
  // A later list after a first that failed (the doc above): FantasyCalc not answering has the gate hold it off (read from
  // the cache only, whatever the retries); a saved copy standing in for an answer the checks turned down leaves it one
  // attempt without a retry.
  const failedToAnswer = "error" in ownAttempt ? fantasyCalcDidntAnswer(ownAttempt.error) : ownAttempt.load.stale;
  const later = failedToAnswer ? { maxRetries: 0, gate } : { gate };
  const second = formats.redraft ? outcomeOf(await tryFantasyCalcValues(http, formats.redraft, later), now) : undefined;
  let values: FantasyCalcValuesLoad;
  let redraft: FantasyCalcValuesLoad | undefined;
  const ownLoad = readableLoad(own);
  const secondLoad = readableLoad(second);
  const ownOld = curveLoad(own);
  const secondOld = curveLoad(second);
  if (ownLoad) {
    values = ownLoad;
    if (secondLoad) redraft = secondLoad;
    else if (second) {
      warnings.push({
        code: "FANTASYCALC_REDRAFT_UNAVAILABLE",
        message: `FantasyCalc's redraft values couldn't be loaded (${outcomeReason(second)}), so dynasty values stand in for how managers see a trade.`,
        platformPath: "values/current",
      });
    }
  } else if (secondLoad) {
    values = secondLoad;
    warnings.push({
      code: "FANTASYCALC_DYNASTY_UNAVAILABLE",
      message: `FantasyCalc's dynasty values couldn't be loaded (${outcomeReason(own)}), so this season's redraft values stand in for long-term worth.`,
      platformPath: "values/current",
    });
  } else if (ownOld || secondOld) {
    // The curve fallback (Phase 4c): no list young enough to read as FantasyCalc's own; the newest saved one only
    // calibrates the model's own value curve (assembleModelInputs words it). A keeper league's two old lists both go
    // (dynasty as `values`, redraft for perception); with only its redraft list old, it stands in as `values` (its format
    // says isDynasty false, as when the dynasty list fails outright).
    if (ownOld) {
      values = ownOld;
      if (secondOld) redraft = secondOld;
      else if (second) {
        // A keeper league's redraft list failed (or is too old even for the curve): perception reads the dynasty list
        // (market.valuesForTerm), so the curve for how managers see a trade is fitted to it. Said as in the readable case.
        warnings.push({
          code: "FANTASYCALC_REDRAFT_UNAVAILABLE",
          message: `FantasyCalc's redraft values couldn't be loaded (${outcomeReason(second)}), so our estimates of how managers see a trade are fitted to its dynasty values.`,
          platformPath: "values/current",
        });
      }
    } else values = secondOld as FantasyCalcValuesLoad;
  } else {
    const reasons = [...new Set([own, ...(second ? [second] : [])].map(outcomeReason))];
    warnings.push({ code: "FANTASYCALC_UNAVAILABLE", message: `FantasyCalc's values couldn't be loaded (${reasons.join("; ")}), so players have no market values yet.`, platformPath: "values/current" });
    return null;
  }
  const seasonOutcome = formats.season && ownLoad ? outcomeOf(await tryFantasyCalcValues(http, formats.season, later), now) : undefined;
  const season = readableLoad(seasonOutcome);
  return { values, ...(redraft ? { redraft } : {}), ...(season ? { season } : {}) };
}

/**
 * Loads every source the model needs for the snapshot, one request at a time (see the header), and
 * assembles ModelInputs. Never throws for a source failure: each becomes a warning in the result.
 */
export async function buildModelInputs(args: BuildModelInputsArgs): Promise<ModelInputs> {
  const { snapshot, http, resolver, now } = args;
  const season = snapshot.season;
  const plan = modelWeekPlan(snapshot, now);
  const positions = startablePositions(snapshot.settings);
  const warnings: ImportWarning[] = [];

  // Nothing is left to project once the season is over, and nothing is published before it starts: only FantasyCalc (see the header).
  let schedule: NflSchedule | null = null;
  let weekly: SleeperWeeklyProjectionsLoad | null = null;
  let seasonLoad: SleeperSeasonProjectionsLoad | null = null;
  let stats: SleeperStatsLoad | null = null;
  if (!plan.seasonOver && !plan.notStarted) {
    try {
      schedule = await loadNflSchedule(http, season, resolver);
    } catch (err) {
      warnings.push({
        code: "NFL_SCHEDULE_UNAVAILABLE",
        message: `The NFL schedule couldn't be loaded (${reasonOf(err)}), so bye weeks are unknown and every remaining week counts as a game.`,
        platformPath: "proTeamSchedules_wl",
      });
    }
    // One gate for all of this build's Sleeper requests: once Sleeper stops answering, the rest isn't asked.
    const sleeper = sleeperGate(http, now);
    if (plan.projectionWeeks.length) {
      const archive = args.projectionArchive === undefined ? defaultProjectionArchiver() : args.projectionArchive;
      const currentWeek = snapshot.currentWeek;
      // The archive works in the background: the build doesn't wait for it (its promise never rejects; caught anyway).
      const onWeek = archive
        ? (w: SleeperProjectionWeek) => void Promise.resolve(archive.archive({ ...w, currentWeek, firstKickoff: firstKickoffOf(schedule, w.week) })).catch(() => {})
        : undefined;
      weekly = await loadSleeper(
        { what: "weekly projections", code: "SLEEPER_PROJECTIONS_UNAVAILABLE", path: "projections" },
        () => loadSleeperWeeklyProjections(sleeper, season, plan.projectionWeeks, positions, { currentWeek, ...(onWeek ? { onWeek } : {}) }),
        warnings,
      );
    }
    seasonLoad = await loadSleeper({ what: "season projections", code: "SEASON_PROJECTIONS_UNAVAILABLE", path: "projections/season" }, () => loadSleeperSeasonProjections(sleeper, season, positions), warnings);
    // Only weeks the NFL has begun (statsWeeksStarted): a real league's completed weeks always are.
    const statsWeeks = statsWeeksStarted(plan.statsWeeks, schedule, now);
    if (statsWeeks.length) {
      stats = await loadSleeper({ what: "stats", code: "SLEEPER_STATS_UNAVAILABLE", path: "stats" }, () => loadSleeperStats(sleeper, season, statsWeeks, positions), warnings);
    }
  }

  // A dynasty league's season list is the market blend's (§6 step 8): asked for only while weeks are left to project.
  const formats = marketFormats(snapshot.settings);
  const fantasyCalc = await loadFantasyCalc(http, plan.seasonOver || plan.notStarted ? { values: formats.values, ...(formats.redraft ? { redraft: formats.redraft } : {}) } : formats, warnings, now);
  // Every list read goes to the local FantasyCalc archive too, in the background: the build doesn't wait (never throws).
  archiveFantasyCalcLists(args.fantasyCalcArchive === undefined ? defaultFantasyCalcArchiver() : args.fantasyCalcArchive, fantasyCalc);

  return assembleModelInputs(snapshot, { schedule, weekly, season: seasonLoad, stats, fantasyCalc, ...(args.espn ? { espn: args.espn } : {}), warnings }, now);
}
