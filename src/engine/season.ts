/**
 * The season simulation wired to the League model (CLAUDE.md §8; §14 "League": playoff odds next to the
 * standings; §17 Phase 3). buildSimSetup turns a LeagueSnapshot and its LeagueModel into sim.ts's
 * SimSetup; seasonOdds runs it and maps the result to a SeasonOdds: LeagueModel.odds on pickupSeasonModel(model)
 * (every team after its free-agent pickups), LeagueModel.oddsAsRostersStand on the model itself ("Drawn weeks"
 * below). Pure and deterministic: no I/O, no clock; the only randomness is sim.ts's common-random-numbers matrix, drawn
 * from config.simulation.seed (or the caller's), so two builds from the same snapshot give identical odds.
 *
 * The setup (buildSimSetup)
 * - Teams in snapshot order (= LeagueModel.teams): the platform's W-L-T, points for and against, and a
 *   division number (the team's index in settings.divisions) when the league has 2+ divisions.
 * - Regular-season matchups: a decided one is in the records already (§4 Matchup.decided): with a result
 *   and an opponent it is a played game (head-to-head and division records; winnerId null = a tie); a
 *   decided one without a result (the adapter warned) counts only in the records. A matchup not decided
 *   is still to play when any of its weeks is a model week (LeagueModel.weeks: the current week on):
 *   a remaining game (a bye when it has no opponent). One whose weeks are all before the first model week
 *   is finished but not scored yet (lead decision D5): left out of the odds, with one warning naming all
 *   its weeks, since the records don't count it yet either. A multi-week matchup already under way is
 *   decided by its weeks still to play (sim.ts; the points its first weeks scored aren't in the setup),
 *   with a note.
 * - Records cross-check: every team's W + L + T should be its decided regular-season games (plus one
 *   median game per decided matchup in median leagues). When a team's isn't, one warning; the records
 *   are used as the platform reports them.
 * - The rest of the regular season without a schedule: in a league that isn't points-only, when no
 *   remaining regular-season week has a game still to play (a matchup with an opponent, not decided) and
 *   some of them have no matchup at all (the schedule didn't load), there are no odds (null;
 *   oddsSkippedWarning says why, for LeagueModel.warnings): the records alone would print today's
 *   standings as final, 0% and 100% for everyone. That holds when the weeks that did load are all
 *   decided, too (the current week scored, the later weeks missing).
 * - Other gaps, one warning each, none of them simulated: some remaining regular-season weeks without
 *   any matchup (the records stand as they are for those weeks), matchups we can't read (a team that
 *   isn't in the league, a team scheduled against itself, no week), and remaining games past the
 *   season's last week.
 * - Drawn weeks: every model week of a remaining game (a bye needs none), every median week, every
 *   remaining regular week still to score in a points-only league (points for accrue weekly; a week
 *   whose matchups are all decided is in the platform's points for already) and every model week of a
 *   playoff round still to play. Each team's score in a drawn week is the SeasonModel's at that model
 *   week: for LeagueModel.odds, the headline (Phase 4c, "one baseline everywhere"), TeamModel.scoreWithPickups,
 *   every team after its free-agent pickups (pickupSeasonModel; league.ts step 8a), the trade search's baseline,
 *   whose trades swap in their two teams' rows (evaluate.ts); for LeagueModel.oddsAsRostersStand, TeamModel.score,
 *   every team as it stands. Either is the scenario mean and the law-of-total-variance SD (teamValue.ts), and for a week
 *   in progress the whole week as if none of its games had started (lead decision D6: live scores aren't read, so its
 *   games are played from projections; league.ts preKickoffTable; the score with pickups keeps the team's own week: ⚠️ the
 *   model plays a week under way with today's rosters). ⚠️ That rebuild uses today's rosters and injury tags: no record of either from before
 *   kickoff is kept, so a player tagged after the game he already played counts as missing it, and a roster move since
 *   kickoff moves his week. The note says so (weekUnderWayNote). ⚠️ The odds with pickups aren't the same just before
 *   and just after the week's first kickoff (the odds as rosters stand are): before it a team's pickups can still play
 *   the week, after it they can't, and its free-agent optimizer stops counting that week (league.ts "Game days").
 * - The regular season is over once every remaining regular-season week has matchups and every
 *   regular-season matchup is decided: the records are final (the current week can still be the last
 *   regular week, in the days between its last game and the platform's rollover).
 * - Median weeks (medianGame; not points-only): the first remaining week of each remaining matchup. A
 *   matchup spanning several weeks gets ONE median game, ranked by that week's score (⚠️ our reading:
 *   records count one median game per matchup; neither platform documents multi-week median games).
 * - Playoffs: settings.playoffTeams teams (0 without playoff weeks), rounds = settings.playoffWeeks grouped
 *   by settings.playoffRoundWeeks (one week each when absent). Finished winners'-bracket games with a
 *   winner are replayed (playoffResults); a decided playoff game without a readable winner makes bye and
 *   title odds unknown. Winners'-bracket games the league has scheduled but not played (ESPN lists a
 *   round's pairings once it's set; Sleeper's playoff matchups aren't imported) are checked against the
 *   bracket we build once the standings are final (sim.ts bracketGames, the round by the game's first
 *   week): one that gives a team of ours in that round another opponent than ours, or puts one of our
 *   round-1 byes in a round-1 game, means our seeding isn't the league's, so bye and title odds are
 *   unknown, with a warning, rather than simulated from games that aren't on the schedule (§8 "use the
 *   real remaining schedule"). A listed game between two teams outside our games of that round (a
 *   third-place game) says nothing either way. Byes: sim.ts always uses the bracket's own (next power of
 *   two − teams); the league's playoffByes only adds a note when it differs.
 * - 3rd place (Checkpoint 7c; planner reply to Checkpoint 7b, §6: "simulate the 3rd-place game when the league has
 *   one … If the data doesn't say, assume there's one"): settings.thirdPlace (the adapters read it: ESPN's schedule or
 *   setting, Sleeper's winners bracket). game true → sim.ts "game" (the two semifinal losers play in the final round's
 *   weeks); game false → "bySeed" (the better regular-season seed of the two, ⚠️ ours); absent → "game", assumed
 *   (SeasonOdds.thirdPlace.assumed; the Import Report says so, not a note here). The adapters import no consolation
 *   game (⚠️ the lead's call for 7c), so a 3rd-place game's result is never replayed: once the final round is over, 3rd
 *   reads as unknown (only after the season).
 * - Weekly high-score periods (only when asked: buildSimSetup's highScores, which the League model sets when the weekly
 *   prize pays, since each period costs about 2.5% of a run): every remaining regular-season matchup period with a game
 *   still to play, once (its NFL weeks: a matchup period of several weeks is one period, decided by its weeks still to
 *   play, ⚠️ the points its first weeks already scored aren't read, as with its games); in a points-only league every
 *   regular week still to score (the weeks it draws). High scores already won are left out: the same for every trade,
 *   they never move a number we compute.
 * - Seeding: settings.playoffSeeding (re-seeding, division winners first); absent → a fixed bracket
 *   without division winners first, said to be assumed. The division rule alone is also said to be
 *   assumed when the adapter warns that it only infers it (DIVISION_RULE_ASSUMED: Sleeper's help center
 *   covers only some division and playoff layouts; ESPN's documents its rule, division winners first,
 *   though an older ESPN adapter warned it assumed the opposite). The re-seeding alone is said to be
 *   assumed when the league doesn't give it but playoffSeeding carries the division rule anyway
 *   (reseedRuleAssumed: unknownSettings, or the adapter's RESEED_RULE_ASSUMED warning). Tiebreaker:
 *   settings.seedingTiebreaker, else points for (assumed, said so).
 * - Nothing left to simulate (no model weeks, or no drawn week: the regular season and the playoffs are
 *   over) → null.
 *
 * The odds (seasonOdds): sim.ts's averages with NaN mapped to null (the page can't print NaN, and it
 * doesn't survive the worker boundary as a number); TeamOdds.rank from today's standings (sim.ts
 * standingsOrder); pBye null without byes or when the playoffs are unknown; pTitle null when they're
 * unknown or the league lists fewer playoff rounds than its bracket needs, and pSecond with it; pThird also
 * null when the 3rd-place game can't be known (sim.ts thirdKnown); expHighScores (0 without high-score periods) and
 * pPointsLeader always known (Checkpoint 7c: benefit.ts weighs them by the league's prizes). WeekOdds: each remaining
 * regular week with games to simulate, one entry per team with a matchup starting that week (a bye: no
 * opponent, no win chance) or a median game.
 *
 * TeamOdds.eliminated is never read off simulation counts (0 in 5,000 seasons isn't proof), nor off our
 * reconstruction of the league's tiebreakers: head-to-head and division records leave out decided games
 * whose result couldn't be read (the adapters warn), and the readings of ESPN's head-to-head and
 * division rules are espn-api's, not seen live. It needs either a playoff game lost or a place outside
 * the playoff spots that nothing unverified can change: at least as many teams as there are spots
 * certainly ahead, and, with 2+ divisions, a division rival among them, so seeding division winners
 * first (ESPN's rule, and Sleeper's in the layouts it documents) can't lift the team either; the guard
 * holds whatever the league's rule, since not every platform reports it. Once the regular season is
 * over (above), "certainly ahead" goes only by what the platform reports: a better win percentage; with
 * the league's own points-for tiebreaker, the same win percentage and more points for; in a points-only
 * league, more points for. A tie at the cut on those numbers leaves the team's place to rules we can't
 * be sure of (or to a coin flip), so it isn't certainly out. Before then (§8's "Your season's over"
 * matters most before the trade deadline, which comes before the regular season ends), the records alone
 * decide: a team is certainly ahead when its win percentage if it loses every result still to come beats
 * the other's if it wins every one (SimSetupResult.resultsLeft, known only when the rest of the regular
 * season is all in the schedule and the records add up; win percentage comes first in every standings
 * order). Points-only leagues wait for the regular season to end: points for can't be bounded. With no
 * playoffs the title goes to the top of the standings, so every team certainly behind another is out.
 * TeamOdds.bestFinish (Checkpoint 7c; the review of the reward engine) is that bound as a place: 1 + the teams certainly
 * ahead, or 1 while a division title could lift the team; eliminated is a bestFinish past the playoff spots, or a lost
 * playoff game. reward.ts prizeStillMovable reads it for the places the final standings decide (3rd in a bracket of 2
 * playoff teams or fewer, 2nd too with 1 or none), with SeasonOdds.regularLeft: the high-score periods and the
 * regular-season weeks a trade can still change, the week under way left out (every trade holds it as rosters stand); and
 * SeasonOdds.playoffLeft, the playoff weeks a trade can still change, the same way, for the 3rd-place game a team that lost
 * its semifinal still plays (final review of Checkpoint 7c, ui-UI-7C-1).
 */
import { config } from "./config";
import type { LeagueModel, SeasonOdds, TeamModel, TeamOdds, WeekOdds } from "./leagueModel";
import type { LeagueSettings, LeagueSnapshot, Matchup, SeedingTiebreaker } from "./model";
import { bracketGames, simulateSeason, standingsOrder, type SimGame, type SimNormals, type SimPlayedGame, type SimPlayoffResult, type SimSetup, type SimTeam } from "./sim";

/** The config keys this module reads (config.simulation), widened from config's `as const` literals. */
export interface SeasonConfig {
  readonly simulation: { readonly finalSims: number; readonly seed: number };
}

/** What the setup reads from the League model: its weeks and each team's weekly score (a full LeagueModel fits). */
export type SeasonModel = Pick<LeagueModel, "weeks" | "regularWeeks" | "playoffWeeks" | "inProgressWeek"> & {
  readonly teams: readonly Pick<TeamModel, "id" | "score">[];
};

/**
 * The season LeagueModel.odds simulates (Phase 4c, "one baseline everywhere"; the file header, "Drawn weeks"): the same
 * weeks with every team's TeamModel.scoreWithPickups as its score (every team after its free-agent pickups: league.ts
 * step 8a), the trade search's baseline (evaluate.ts builds it with this too). A team without one (a model built before
 * Phase 4c) keeps its score as it stands.
 */
export function pickupSeasonModel(model: Pick<LeagueModel, "weeks" | "regularWeeks" | "playoffWeeks" | "inProgressWeek"> & { readonly teams: readonly Pick<TeamModel, "id" | "score" | "scoreWithPickups">[] }): SeasonModel {
  return {
    weeks: model.weeks,
    regularWeeks: model.regularWeeks,
    playoffWeeks: model.playoffWeeks,
    inProgressWeek: model.inProgressWeek,
    teams: model.teams.map((t) => ({ id: t.id, score: t.scoreWithPickups ?? t.score })),
  };
}

export interface SimSetupResult {
  setup: SimSetup;
  /** SimSetup team index → team id (snapshot.teams order, which is LeagueModel.teams order). */
  teamIds: string[];
  /** SimSetup week index → index into LeagueModel.weeks. */
  simWeekToModelWeek: number[];
  /** Plain English, about the league's rules as simulated (tiebreaker, bracket, byes, median games, a week in progress). */
  notes: string[];
  /** Plain English, about gaps in the data (finished games not scored yet, records that don't add up, missing matchups). */
  warnings: string[];
  /** The league doesn't report its seeding tiebreaker: points for is assumed. */
  tiebreakerAssumed: boolean;
  /**
   * The league doesn't report whether its playoffs re-seed (reseedRuleAssumed: no playoff seeding at all, or
   * the adapter's warning that the re-seeding part is a default): a fixed bracket is assumed.
   */
  reseedAssumed: boolean;
  /**
   * The league has 2+ divisions and doesn't report whether their winners are seeded first: the setup's
   * divisionWinnersFirst is assumed (no playoff seeding at all, or the adapter's warning: DIVISION_RULE_ASSUMED).
   */
  divisionRuleAssumed: boolean;
  /**
   * Checkpoint 7c (the file header's "3rd place"): how the two semifinal losers' place is decided (the setup's
   * thirdPlace), and whether that was assumed (settings.thirdPlace absent: the league doesn't say).
   */
  thirdPlace: { rule: "game" | "bySeed"; assumed: boolean };
  /**
   * False when a decided playoff game has no readable winner, or when the league's own playoff schedule
   * pairs teams differently from the bracket built from the final standings: bye and title odds are then
   * unknown.
   */
  playoffsKnown: boolean;
  /**
   * Every remaining regular-season week has matchups and every regular-season matchup is decided: the
   * records are final (true too when no regular-season week is left).
   */
  regularSeasonOver: boolean;
  /**
   * Checkpoint 7c (SeasonOdds.regularLeft; reward.ts prizeStillMovable): what a trade can still change in the regular
   * season, the week under way (model.inProgressWeek) left out, since every trade holds it at its score as rosters stand
   * (evaluate.ts): the remaining high-score periods (the file header's, listed in the setup only when asked, counted here
   * either way) with a drawn week other than it, and the regular-season weeks drawn other than it.
   */
  regularLeft: { periods: number; weeks: number };
  /**
   * Checkpoint 7c (SeasonOdds.playoffLeft; reward.ts prizeStillMovable; final review of Checkpoint 7c, ui-UI-7C-1): the
   * playoff weeks drawn other than the week under way, the ones a trade can still change (after a lost semifinal, the
   * 3rd-place game's).
   */
  playoffLeft: { weeks: number };
  /**
   * Per team (setup order), how many regular-season results its record still has to take in: its
   * remaining games with an opponent, its median games (median leagues), and the games of finished weeks
   * that aren't scored yet (D5, with their median games). Null when that isn't known for sure: in a
   * points-only league (no W/L), or when the rest of the regular season isn't fully in the schedule (a
   * remaining week without matchups, a regular-season matchup we can't read, a game past the season's last
   * week) or a team's record doesn't match its finished games. TeamOdds.eliminated reads it before the
   * regular season is over.
   */
  resultsLeft: number[] | null;
}

const TIEBREAKER_LABEL: Readonly<Record<SeedingTiebreaker, string>> = {
  pointsFor: "points for",
  headToHead: "head-to-head record",
  divisionRecord: "division record",
};

const ASSUMED = " (assumed: the league doesn't say)";

/**
 * The adapters' warnings that the snapshot's playoffSeeding.divisionWinnersFirst is an assumption, not a
 * rule the platform documents: Sleeper's help center gives it only for some division and playoff layouts
 * (src/adapters/sleeper/normalize.ts, an inferred reading elsewhere). ESPN's help center documents its
 * rule (division winners always take the top seeds: src/adapters/espn/normalize.ts DIVISION_SEEDING_SOURCE,
 * review ADAPT-3), so today's ESPN adapter warns nothing here; ESPN_SEEDING_DIVISIONS_UNKNOWN is the warning
 * an older one gave with its opposite assumption, kept so such a snapshot still reads as assumed. Matched by
 * code and field path; season.test.ts runs both adapters to keep these in step with them.
 */
export const DIVISION_RULE_ASSUMED: readonly { code: string; platformPath?: string }[] = [
  { code: "ESPN_SEEDING_DIVISIONS_UNKNOWN" },
  { code: "SETTING_INFERRED", platformPath: "settings.divisions" },
];

/**
 * The adapters' warnings that the snapshot's playoffSeeding.reseed is an assumption (a fixed bracket standing
 * in for a setting the platform didn't give), although playoffSeeding is set: it carries the division rule
 * (division winners first), which doesn't depend on re-seeding. Sleeper: playoff_seed_type missing
 * (SETTING_DEFAULTED) or a code we don't know; ESPN: no playoffReseed (ESPN_SEEDING_UNKNOWN, which also puts
 * "playoffSeeding" in unknownSettings). Matched by code and field path; season.test.ts runs both adapters to
 * keep these in step with them.
 */
export const RESEED_RULE_ASSUMED: readonly { code: string; platformPath?: string }[] = [
  { code: "SETTING_DEFAULTED", platformPath: "settings.playoff_seed_type" },
  { code: "PLAYOFF_SEED_TYPE_UNKNOWN", platformPath: "settings.playoff_seed_type" },
  { code: "ESPN_SEEDING_UNKNOWN", platformPath: "settings.scheduleSettings.playoffReseed" },
];

const warned = (snapshot: Pick<LeagueSnapshot, "warnings">, list: readonly { code: string; platformPath?: string }[]): boolean =>
  snapshot.warnings.some((w) => list.some((d) => d.code === w.code && (d.platformPath === undefined || d.platformPath === w.platformPath)));

const divisionRuleWarned = (snapshot: LeagueSnapshot): boolean => warned(snapshot, DIVISION_RULE_ASSUMED);

/**
 * Whether the league's re-seeding rule is an assumption (the file header, "Seeding"): it reports no playoff
 * seeding, or marks it unknown (settings.unknownSettings), or its adapter warned that the re-seeding part is
 * a default standing in for a setting it didn't give (RESEED_RULE_ASSUMED).
 */
export function reseedRuleAssumed(snapshot: Pick<LeagueSnapshot, "settings" | "warnings">): boolean {
  const { settings } = snapshot;
  return settings.playoffSeeding === undefined || (settings.unknownSettings ?? []).includes("playoffSeeding") || warned(snapshot, RESEED_RULE_ASSUMED);
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
/** The verb after a count: `n === 1 ? one : many`. */
const verb = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** 5000 → "5,000". */
function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "week 3", "weeks 2 and 3", "weeks 4–14", "weeks 3, 5–7 and 9": runs of three or more consecutive weeks as ranges. */
export function weekList(weeks: readonly number[]): string {
  const ws = [...new Set(weeks)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < ws.length; ) {
    let j = i;
    while (j + 1 < ws.length && (ws[j + 1] as number) === (ws[j] as number) + 1) j++;
    if (j - i >= 2) runs.push(`${ws[i]}–${ws[j]}`);
    else for (let k = i; k <= j; k++) runs.push(`${ws[k]}`);
    i = j + 1;
  }
  const one = ws.length === 1;
  const text = runs.length <= 1 ? (runs[0] ?? "") : `${runs.slice(0, -1).join(", ")} and ${runs.at(-1)}`;
  return `${one ? "week" : "weeks"} ${text}`;
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Playoff rounds (the file header): settings.playoffWeeks in order, grouped by playoffRoundWeeks (weeks per
 * round, read as whole numbers ≥ 1); weeks past the listed rounds are one round each, and a last round the
 * weeks run out on keeps the weeks there are.
 */
export function playoffRounds(settings: Pick<LeagueSettings, "playoffWeeks" | "playoffRoundWeeks">): { weeks: number[] }[] {
  const weeks = settings.playoffWeeks.filter((w) => Number.isInteger(w));
  const out: { weeks: number[] }[] = [];
  let i = 0;
  for (const n of settings.playoffRoundWeeks ?? []) {
    if (i >= weeks.length) break;
    const len = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
    out.push({ weeks: weeks.slice(i, i + len) });
    i += len;
  }
  for (; i < weeks.length; i++) out.push({ weeks: [weeks[i] as number] });
  return out;
}

/** A matchup's NFL weeks: `weeks` when it spans several, else [week]; whole weeks only, ascending. */
function matchupWeeks(m: { week: number; weeks?: number[] }): number[] {
  return [...new Set(m.weeks && m.weeks.length > 0 ? m.weeks : [m.week])].filter((w) => Number.isInteger(w)).sort((a, b) => a - b);
}

/** Why a matchup can't be read: a team that isn't in the league, a team scheduled against itself, no week. */
type Unreadable = "team" | "self" | "week";

/** A matchup as team indexes (b null = a bye) and its NFL weeks, or why it can't be read. */
function readMatchup(m: Matchup, indexOf: ReadonlyMap<string, number>): { a: number; b: number | null; weeks: number[] } | Unreadable {
  const a = indexOf.get(m.teamA);
  const b = m.teamB === null ? null : indexOf.get(m.teamB);
  if (a === undefined || b === undefined) return "team";
  if (a === b) return "self";
  const weeks = matchupWeeks(m);
  return weeks.length === 0 ? "week" : { a, b, weeks };
}

/**
 * Why the season can't be simulated although regular-season weeks remain, as a warning for
 * LeagueModel.warnings; null when it can (or when there's nothing left to simulate anyway). Today: a
 * league that isn't points-only whose schedule has no game still to play (a readable matchup with an
 * opponent, not decided) in any remaining regular-season week, while some of those weeks have no
 * matchup at all: the rest of the schedule didn't load. Without its games, the odds would be today's
 * records printed as the final standings (the file header), and that holds just the same when the
 * weeks that did load are all decided (the current week scored before the platform rolls over to the
 * next). With no game left to play and every remaining week's matchups decided, the regular season is
 * simply over. buildSimSetup and seasonOdds return null when this gives a warning.
 */
export function oddsSkippedWarning(snapshot: LeagueSnapshot, model: Pick<LeagueModel, "regularWeeks">): string | null {
  if (snapshot.settings.pointsOnly || model.regularWeeks.length === 0) return null;
  const indexOf = new Map(snapshot.teams.map((t, i) => [t.id, i]));
  const remaining = new Set(model.regularWeeks);
  const covered = new Set<number>();
  let toPlay = false;
  for (const m of snapshot.schedule) {
    if (m.isPlayoff) continue;
    const r = readMatchup(m, indexOf);
    if (typeof r === "string") continue;
    for (const w of r.weeks) {
      if (!remaining.has(w)) continue;
      covered.add(w);
      if (!m.decided && r.b !== null) toPlay = true;
    }
  }
  const missing = model.regularWeeks.filter((w) => !covered.has(w));
  if (toPlay || missing.length === 0) return null;
  return `The schedule has no matchups for the rest of the regular season (${weekList(missing)}), so the playoff odds are left out; refresh to try again.`;
}

/**
 * The season simulation's setup from a snapshot and its League model (the file header); null when nothing
 * is left to simulate, or when the rest of the regular season has no schedule (oddsSkippedWarning).
 * `highScores` lists the weekly high-score periods (the file header; default off): it changes no other number.
 */
export function buildSimSetup(snapshot: LeagueSnapshot, model: SeasonModel, opts: { highScores?: boolean } = {}): SimSetupResult | null {
  if (model.weeks.length === 0 || oddsSkippedWarning(snapshot, model) !== null) return null;
  const { settings } = snapshot;
  const pointsOnly = settings.pointsOnly;
  const median = settings.medianGame && !pointsOnly;
  const firstWeek = model.weeks[0] as number;
  const modelWeek = new Map(model.weeks.map((w, i) => [w, i]));
  const notes: string[] = [];
  const warnings: string[] = [];

  // Teams, in snapshot order, with their weekly scores.
  const teamIds = snapshot.teams.map((t) => t.id);
  const indexOf = new Map(teamIds.map((id, i) => [id, i]));
  const scoreOf = new Map(model.teams.map((t) => [t.id, t.score]));
  const divisionList = settings.divisions && settings.divisions.length >= 2 ? settings.divisions : [];
  const divisionOf = new Map<string, number>();
  divisionList.forEach((d, k) => {
    for (const id of d.teamIds) if (!divisionOf.has(id)) divisionOf.set(id, k);
  });
  const teams: SimTeam[] = snapshot.teams.map((t) => ({
    id: t.id,
    w: t.record.w,
    l: t.record.l,
    t: t.record.t,
    pointsFor: t.pointsFor,
    pointsAgainst: t.pointsAgainst,
    division: divisionOf.get(t.id) ?? null,
  }));

  // The schedule.
  const games: SimGame[] = [];
  const played: SimPlayedGame[] = [];
  const playoffResults: SimPlayoffResult[] = [];
  /** Winners'-bracket games the league has scheduled but not decided (compared with our bracket below). */
  const scheduledPlayoffs: { a: number; b: number; week: number }[] = [];
  const decidedGames = new Array<number>(teams.length).fill(0);
  const decidedMatchups = new Array<number>(teams.length).fill(0);
  /** Per team: games of finished weeks not scored yet (D5) with an opponent, and all such matchups (byes too). */
  const unscoredGames = new Array<number>(teams.length).fill(0);
  const unscoredMatchups = new Array<number>(teams.length).fill(0);
  /** Weeks with a regular-season matchup, and weeks with one not decided yet. */
  const covered = new Set<number>();
  const undecidedWeeks = new Set<number>();
  const unscoredWeeks: number[] = [];
  const medianWeeks = new Set<number>();
  const underWay: number[][] = [];
  const unreadable: Record<Unreadable, number> = { team: 0, self: 0, week: 0 };
  let unreadableRegular = 0;
  let outside = 0;
  let undecidedRegular = 0;
  let unreadablePlayoffs = 0;
  let multiWeekRemaining = false;
  for (const m of snapshot.schedule) {
    const read = readMatchup(m, indexOf);
    if (typeof read === "string") {
      unreadable[read]++;
      if (!m.isPlayoff) unreadableRegular++;
      continue;
    }
    const { a, b, weeks } = read;
    if (m.isPlayoff) {
      // Finished winners'-bracket games are replayed; one without a readable winner makes the playoffs unknown.
      if (b === null) continue;
      if (!m.decided) {
        scheduledPlayoffs.push({ a, b, week: weeks[0] as number });
        continue;
      }
      const winner = m.result?.winnerId;
      if (winner === m.teamA || winner === m.teamB) playoffResults.push({ a, b, winner: winner === m.teamA ? a : b });
      else unreadablePlayoffs++;
      continue;
    }
    for (const w of weeks) covered.add(w);
    if (m.decided) {
      decidedMatchups[a]!++;
      if (b !== null) {
        decidedMatchups[b]!++;
        decidedGames[a]!++;
        decidedGames[b]!++;
        const winner = m.result?.winnerId;
        // A decided game without a readable result counts in the records only.
        if (m.result && (winner === null || winner === m.teamA || winner === m.teamB)) played.push({ a, b, winner: winner === null ? null : winner === m.teamA ? a : b });
      }
      continue;
    }
    undecidedRegular++;
    for (const w of weeks) undecidedWeeks.add(w);
    const remaining = weeks.filter((w) => w >= firstWeek);
    if (remaining.length === 0) {
      unscoredWeeks.push(...weeks); // D5: finished, not scored yet
      unscoredMatchups[a]!++;
      if (b !== null) {
        unscoredMatchups[b]!++;
        unscoredGames[a]!++;
        unscoredGames[b]!++;
      }
      continue;
    }
    if (remaining.some((w) => !modelWeek.has(w))) {
      outside++;
      continue;
    }
    games.push({ weeks, a, b });
    if (median) medianWeeks.add(remaining[0] as number);
    if (weeks.length > 1) multiWeekRemaining = true;
    if (remaining.length < weeks.length && b !== null) underWay.push(weeks);
  }

  // Records cross-check (points-only leagues have no W/L to check).
  let recordsOff = 0;
  if (!pointsOnly) {
    recordsOff = teams.filter((t, i) => t.w + t.l + t.t !== (decidedGames[i] as number) + (median ? (decidedMatchups[i] as number) : 0)).length;
    if (recordsOff > 0)
      warnings.push(
        `${recordsOff === 1 ? "1 team's record doesn't match its finished games" : `${recordsOff} teams' records don't match their finished games`} in the schedule; the odds use the records as the platform reports them.`,
      );
  }
  if (unscoredWeeks.length > 0) {
    const one = new Set(unscoredWeeks).size === 1;
    warnings.push(`${capitalize(weekList(unscoredWeeks))}'s final scores aren't in yet, so ${one ? "its" : "their"} games are left out of the odds until they are; refresh later.`);
  }
  const missing = model.regularWeeks.filter((w) => !covered.has(w));
  if (!pointsOnly && missing.length > 0) warnings.push(`The schedule has no matchups in ${weekList(missing)}, so ${missing.length === 1 ? "it is" : "they are"} left out of the odds.`);
  const leftOut = (n: number) => `so ${verb(n, "it is", "they are")} left out of the odds.`;
  if (unreadable.team > 0) warnings.push(`${plural(unreadable.team, "matchup")} ${verb(unreadable.team, "names", "name")} a team that isn't in the league, ${leftOut(unreadable.team)}`);
  if (unreadable.self > 0) warnings.push(`${plural(unreadable.self, "matchup")} ${verb(unreadable.self, "pits", "pit")} a team against itself, ${leftOut(unreadable.self)}`);
  if (unreadable.week > 0) warnings.push(`${plural(unreadable.week, "matchup")} ${verb(unreadable.week, "has", "have")} no NFL week we can read, ${leftOut(unreadable.week)}`);
  if (outside > 0) warnings.push(`${plural(outside, "remaining game")} ${verb(outside, "falls", "fall")} after the season's last week (${model.weeks.at(-1)}), ${leftOut(outside)}`);
  if (unreadablePlayoffs > 0) warnings.push(`${plural(unreadablePlayoffs, "finished playoff game")} ${verb(unreadablePlayoffs, "has", "have")} no winner we can read, so bye and title odds are unknown.`);

  // The playoffs: teams, rounds, byes, seeding.
  const T = teams.length;
  const listed = settings.playoffWeeks.length > 0 && Number.isFinite(settings.playoffTeams) ? Math.max(0, Math.floor(settings.playoffTeams)) : 0;
  const N = Math.min(T, listed);
  const rounds = N >= 2 ? playoffRounds(settings) : [];
  const B = nextPowerOfTwo(Math.max(1, N));
  const bracketByes = N >= 2 ? B - N : 0;
  const R = Math.round(Math.log2(B));
  const seeding = settings.playoffSeeding;
  const reseed = seeding?.reseed ?? false;
  const divisionWinnersFirst = seeding?.divisionWinnersFirst ?? false;
  const reseedAssumed = reseedRuleAssumed(snapshot);
  // Not reseedAssumed: a league can document its division rule and still not say whether it re-seeds (ESPN).
  const divisionRuleAssumed = divisionList.length >= 2 && (seeding === undefined || divisionRuleWarned(snapshot));
  const tiebreaker = settings.seedingTiebreaker ?? "pointsFor";
  const tiebreakerAssumed = settings.seedingTiebreaker === undefined;
  // 3rd place (the file header): the league's answer, else a game, assumed.
  const thirdGame = settings.thirdPlace?.game;
  const thirdPlace: SimSetupResult["thirdPlace"] = { rule: thirdGame === false ? "bySeed" : "game", assumed: typeof thirdGame !== "boolean" };

  // Drawn weeks: remaining games (their model weeks), median weeks, points-only regular weeks still to
  // score (not a week whose matchups are all decided: its points are in points for), playoff rounds still to play.
  const drawn = new Set<number>();
  for (const g of games) if (g.b !== null) for (const w of g.weeks) if (modelWeek.has(w)) drawn.add(w);
  for (const w of medianWeeks) drawn.add(w);
  if (pointsOnly) for (const w of model.regularWeeks) if (undecidedWeeks.has(w) || !covered.has(w)) drawn.add(w);
  for (const r of rounds) for (const w of r.weeks) if (modelWeek.has(w)) drawn.add(w);
  const weeks = [...drawn].sort((x, y) => x - y);
  if (weeks.length === 0) return null;
  const simWeekToModelWeek = weeks.map((w) => modelWeek.get(w) as number);

  const mean: Float64Array[] = [];
  const sd: Float64Array[] = [];
  for (const id of teamIds) {
    const score = scoreOf.get(id);
    if (!score) throw new RangeError(`buildSimSetup: team ${id} has no weekly score in the League model`);
    mean.push(Float64Array.from(simWeekToModelWeek, (k) => score.mean[k] as number));
    sd.push(Float64Array.from(simWeekToModelWeek, (k) => score.sd[k] as number));
  }

  // Notes on the rules as simulated.
  if (pointsOnly) notes.push("Standings go by points for (a points-only league).");
  else notes.push(`Ties in the standings go to ${TIEBREAKER_LABEL[tiebreaker]}${tiebreakerAssumed ? ASSUMED : ", the league's rule"}.`);
  if (divisionList.length >= 2) notes.push(`${divisionWinnersFirst ? "Division winners get the top seeds" : "Division winners aren't seeded first"}${divisionRuleAssumed ? ASSUMED : ""}.`);
  if (N >= 3) notes.push(`${reseed ? "The playoffs re-seed after each round: the best seed left plays the worst" : "The playoff bracket is fixed: no re-seeding after each round"}${reseedAssumed ? ASSUMED : ""}.`);
  if (bracketByes > 0) notes.push(`The top ${bracketByes === 1 ? "seed gets" : `${bracketByes} seeds get`} a first-round bye.`);
  const listedByes = settings.playoffByes;
  if (N >= 2 && listedByes !== undefined && listedByes !== bracketByes) notes.push(`The league lists ${plural(listedByes, "bye")}, but a bracket of ${N} teams has ${bracketByes}; the odds use ${bracketByes}.`);
  if (N >= 2 && rounds.length < R) notes.push(`The playoff schedule has fewer rounds than a bracket of ${N} teams needs, so title odds are unknown.`);
  if (N <= 1) notes.push(N === 1 ? "One team makes the playoffs: the title goes to the top of the final standings." : "No playoffs: the title goes to the top of the final standings.");
  if (medianWeeks.size > 0) notes.push(`Every week each team also plays the league median: the top half of the week's scores win.${multiWeekRemaining ? " A matchup spanning several weeks gets one median game, decided by its first week still to play." : ""}`);
  const regularSeasonOver = undecidedRegular === 0 && missing.length === 0;
  if (regularSeasonOver) notes.push("The regular season is over: the standings are final, and only the playoffs are simulated.");
  const live = model.inProgressWeek;
  if (live !== null && drawn.has(live)) notes.push(weekUnderWayNote(live));
  for (const ws of underWay.filter((x, i) => underWay.findIndex((y) => y.join() === x.join()) === i))
    notes.push(`The matchups of weeks ${ws[0]}–${ws.at(-1)} are under way: only their weeks still to play are simulated (the points already scored aren't read).`);
  for (const r of rounds) {
    const left = r.weeks.filter((w) => modelWeek.has(w));
    if (left.length > 0 && left.length < r.weeks.length) notes.push(`The playoff round of weeks ${r.weeks[0]}–${r.weeks.at(-1)} is under way: only its weeks still to play are simulated.`);
  }

  // Weekly high-score periods (the file header): each remaining matchup period with a game to play once (its weeks are
  // drawn already, as that game's), or in a points-only league each regular week still to score; the setup lists them only
  // when asked. What a trade can still change in the regular season (SimSetupResult.regularLeft) leaves the week under way out.
  const periodsByKey = new Map<string, number[]>();
  if (pointsOnly) {
    for (const w of model.regularWeeks) if (drawn.has(w)) periodsByKey.set(String(w), [w]);
  } else {
    for (const g of games) if (g.b !== null && !periodsByKey.has(g.weeks.join())) periodsByKey.set(g.weeks.join(), [...g.weeks]);
  }
  const periods = [...periodsByKey.values()].sort((x, y) => (x[0] as number) - (y[0] as number));
  const highScorePeriods = opts.highScores === true ? periods : undefined;
  const tradeable = (w: number): boolean => drawn.has(w) && w !== live;
  const regularLeft = { periods: periods.filter((p) => p.some(tradeable)).length, weeks: model.regularWeeks.filter(tradeable).length };
  const playoffLeft = { weeks: model.playoffWeeks.filter(tradeable).length };

  const setup: SimSetup = {
    teams,
    weeks,
    mean,
    sd,
    games,
    medianWeeks: [...medianWeeks].sort((x, y) => x - y),
    played,
    pointsOnly,
    playoffTeams: N,
    byes: listedByes ?? bracketByes,
    rounds,
    reseed,
    divisionWinnersFirst,
    tiebreaker,
    playoffResults,
    thirdPlace: thirdPlace.rule,
    ...(highScorePeriods ? { highScorePeriods } : {}),
  };

  // The league's own playoff schedule (the file header): once the standings are final, a winners'-bracket game it
  // has scheduled in a round our bracket has paired (sim.ts bracketGames; the round by the game's first week) must
  // give each of our teams in that round the opponent we give it, and none of our round-1 byes a round-1 game.
  // A game between two teams outside our games of that round says nothing about them (a third-place game, say).
  let bracketMatches = true;
  if (regularSeasonOver && scheduledPlayoffs.length > 0) {
    const order = standingsOrder(setup);
    const ours = bracketGames(setup, order);
    const firstByes = new Set(order.slice(0, bracketByes));
    const roundOf = new Map<number, number>();
    rounds.forEach((r, k) => {
      for (const w of r.weeks) if (!roundOf.has(w)) roundOf.set(w, k);
    });
    bracketMatches = scheduledPlayoffs.every(({ a, b, week }) => {
      const k = roundOf.get(week);
      const games = k === undefined ? undefined : ours[k];
      if (games === undefined) return true;
      const opponent = new Map<number, number>();
      for (const [x, y] of games) {
        opponent.set(x, y);
        opponent.set(y, x);
      }
      const fits = (t: number, other: number): boolean => {
        const o = opponent.get(t);
        return o === undefined ? !(k === 0 && firstByes.has(t)) : o === other;
      };
      return fits(a, b) && fits(b, a);
    });
    if (!bracketMatches) warnings.push("The league's playoff schedule pairs teams differently from the bracket built from its final standings (its seeding may differ from ours), so bye and title odds are unknown.");
  }

  // What each record still has to take in (SimSetupResult.resultsLeft): only when the rest of the regular
  // season is all in the schedule and the records add up.
  let resultsLeft: number[] | null = null;
  if (!pointsOnly && missing.length === 0 && unreadableRegular === 0 && outside === 0 && recordsOff === 0) {
    const left = teams.map((_, i) => (unscoredGames[i] as number) + (median ? (unscoredMatchups[i] as number) + medianWeeks.size : 0));
    for (const g of games) {
      if (g.b === null) continue;
      left[g.a]!++;
      left[g.b]!++;
    }
    resultsLeft = left;
  }

  return {
    setup,
    teamIds,
    simWeekToModelWeek,
    notes,
    warnings,
    tiebreakerAssumed,
    reseedAssumed,
    divisionRuleAssumed,
    thirdPlace,
    playoffsKnown: unreadablePlayoffs === 0 && bracketMatches,
    regularSeasonOver,
    regularLeft,
    playoffLeft,
    resultsLeft,
  };
}

/**
 * The note for a week under way (lead decision D6; the file header): live scores aren't read, so all its
 * games are played from the week as it stood before its first kickoff, but with today's rosters and
 * injury tags (league.ts preKickoffTable keeps no record of either from before kickoff).
 */
export function weekUnderWayNote(week: number): string {
  return `Week ${week} is under way: live scores aren't read yet, so all its games are simulated from projections as if none had started, with today's rosters and injury news.`;
}

/** A probability or expectation from sim.ts, NaN (unknown) → null. */
const known = (x: number): number | null => (Number.isFinite(x) ? x : null);

/**
 * TeamOdds.bestFinish (the file header, "TeamOdds.eliminated"): the best place each team can still finish in the final
 * regular-season standings, 1 + the teams certainly ahead of it at the end of the regular season, or 1 when a division
 * title could still lift it: with 2+ divisions, unless a division rival is among those teams (seeding division winners
 * first then keeps it below every team ahead of it, and without that rule those teams are ahead anyway). Once the regular
 * season is over, "certainly ahead" reads the final records. Before that, only the records can decide it: u is certainly
 * ahead of t when u's win percentage if it loses every result still to come beats t's if it wins every one
 * (SimSetupResult.resultsLeft: remaining games, median games and finished games not scored yet), which no tiebreaker can
 * undo. Points-only leagues, and seasons whose remaining results aren't known for sure (resultsLeft null), wait for the
 * regular season to end (1 for every team until then). A lower bound, never a place the team is sure of.
 */
function bestFinishes(built: SimSetupResult): number[] {
  const { setup } = built;
  const T = setup.teams.length;
  const best = new Array<number>(T).fill(1);
  const left = built.resultsLeft;
  if (!built.regularSeasonOver && (setup.pointsOnly || left === null)) return best;
  const divisions = new Set(setup.teams.flatMap((t) => (t.division === null ? [] : [t.division]))).size;
  /** Win percentage with `wins` more wins and `losses` more losses than the record. */
  const winPct = (tm: SimTeam, wins: number, losses: number): number => {
    const games = tm.w + tm.l + tm.t + wins + losses;
    return games > 0 ? (tm.w + wins + tm.t / 2) / games : 0;
  };
  let ahead: (u: number, t: number) => boolean;
  if (built.regularSeasonOver) {
    // "Certainly ahead" reads only what the platform reports (the file header): win percentage, then points
    // for when that is the league's own tiebreaker; points for alone in a points-only league. Never
    // head-to-head or division records, never an assumed tiebreaker.
    const byPoints = setup.pointsOnly || (setup.tiebreaker === "pointsFor" && !built.tiebreakerAssumed);
    ahead = (u, t) => {
      const um = setup.teams[u] as SimTeam;
      const tm = setup.teams[t] as SimTeam;
      if (!setup.pointsOnly) {
        const pu = winPct(um, 0, 0);
        const pt = winPct(tm, 0, 0);
        if (pu !== pt) return pu > pt;
      }
      return byPoints && um.pointsFor > tm.pointsFor;
    };
  } else {
    // u loses everything left, t wins everything left: u still has the better win percentage.
    const results = left as number[];
    ahead = (u, t) => winPct(setup.teams[u] as SimTeam, 0, results[u] as number) > winPct(setup.teams[t] as SimTeam, results[t] as number, 0);
  }
  for (let t = 0; t < T; t++) {
    const division = (setup.teams[t] as SimTeam).division;
    let count = 0;
    let rivalAhead = false;
    for (let u = 0; u < T; u++) {
      if (u === t || !ahead(u, t)) continue;
      count++;
      if (division !== null && (setup.teams[u] as SimTeam).division === division) rivalAhead = true;
    }
    const canWinDivision = divisions >= 2 && division !== null && !rivalAhead;
    best[t] = canWinDivision ? 1 : 1 + count;
  }
  return best;
}

/**
 * TeamOdds.eliminated (the file header): certainly out of the title race. A team is out when it can't finish within the
 * playoff spots (`best`, bestFinishes: at least as many teams as there are spots certainly ahead of it, and no division
 * title to lift it), or, once the regular season is over, when it lost a playoff game.
 */
function eliminatedTeams(built: SimSetupResult, best: readonly number[]): boolean[] {
  const { setup } = built;
  const spots = Math.max(1, Math.min(setup.teams.length, Math.max(0, setup.playoffTeams))); // no playoffs: the title goes to the top of the standings
  const out = best.map((b) => b > spots);
  if (built.regularSeasonOver) for (const r of setup.playoffResults) out[r.winner === r.a ? r.b : r.a] = true;
  return out;
}

/**
 * A season's odds (§8; the file header): LeagueModel.oddsAsRostersStand on the League model itself, LeagueModel.odds
 * on pickupSeasonModel(model) (league.ts step 8b), the trade context's baseline on the same (evaluate.ts). The setup
 * from buildSimSetup, `sims` seasons (default config.simulation.finalSims) on the common-random-numbers matrix of
 * `seed` (default config.simulation.seed), or on `normals` when given (both League model odds share it, and so do a
 * trade's "before" and "after"). `highScores` adds the weekly high-score periods (buildSimSetup; off by default: they
 * cost about 2.5% of a run each and change no other number). Null when nothing is left to simulate, when the rest of the
 * regular season has no schedule (oddsSkippedWarning gives the warning), or when `sims` is below 1.
 */
export function seasonOdds(snapshot: LeagueSnapshot, model: SeasonModel, opts: { sims?: number; seed?: number; normals?: SimNormals; highScores?: boolean } = {}, cfg: SeasonConfig = config): SeasonOdds | null {
  const sims = Math.floor(opts.sims ?? cfg.simulation.finalSims);
  if (!(sims >= 1)) return null;
  const seed = opts.seed ?? cfg.simulation.seed;
  const built = buildSimSetup(snapshot, model, { highScores: opts.highScores === true });
  if (!built) return null;
  const { setup, teamIds } = built;
  const res = simulateSeason(setup, { sims, seed, ...(opts.normals ? { normals: opts.normals } : {}) });
  const order = standingsOrder(setup);
  const rank = new Array<number>(teamIds.length).fill(0);
  order.forEach((t, k) => {
    rank[t] = k + 1;
  });
  const playoffsKnown = res.playoffsKnown && built.playoffsKnown;
  const N = Math.min(teamIds.length, setup.playoffTeams);
  const byes = N >= 2 ? nextPowerOfTwo(N) - N : 0;
  const best = bestFinishes(built);
  const eliminated = eliminatedTeams(built, best);
  const teams: TeamOdds[] = res.teams.map((o, t) => ({
    teamId: teamIds[t] as string,
    rank: rank[t] as number,
    pPlayoffs: o.pPlayoffs,
    pBye: byes === 0 || !playoffsKnown ? null : known(o.pBye),
    pTitle: playoffsKnown ? known(o.pTitle) : null,
    expWins: o.expWins,
    expLosses: o.expLosses,
    expTies: o.expTies,
    seedDist: [...o.seedDist],
    eliminated: eliminated[t] as boolean,
    bestFinish: best[t] as number,
    pSecond: playoffsKnown ? known(o.pSecond) : null,
    pThird: playoffsKnown && res.thirdKnown ? known(o.pThird) : null,
    expHighScores: o.expHighScores,
    pPointsLeader: o.pPointsLeader,
  }));

  // Each remaining week's matchups: a game's opponent in its first drawn week; a bye in its first drawn week.
  const drawn = new Set(setup.weeks);
  const opponents = new Map<number, Map<number, number | null>>();
  const meet = (week: number, t: number, opponent: number | null) => {
    const at = opponents.get(week) ?? new Map<number, number | null>();
    if (!at.has(t)) at.set(t, opponent);
    opponents.set(week, at);
  };
  for (const g of setup.games) {
    const first = g.weeks.find((w) => drawn.has(w));
    if (first === undefined) continue;
    meet(first, g.a, g.b);
    if (g.b !== null) meet(first, g.b, g.a);
  }
  const weekly: WeekOdds[] = res.weekly.map((wk) => {
    const at = opponents.get(wk.week);
    const games: WeekOdds["games"] = [];
    teamIds.forEach((teamId, t) => {
      const has = at?.has(t) ?? false;
      if (!has && wk.pMedianWin === null) return;
      const opponent = has ? (at?.get(t) ?? null) : null;
      games.push({
        teamId,
        opponentId: opponent === null ? null : (teamIds[opponent] as string),
        pWin: opponent === null ? null : known(wk.pWin[t] as number),
        pMedianWin: wk.pMedianWin ? known(wk.pMedianWin[t] as number) : null,
      });
    });
    return { week: wk.week, games };
  });

  const notes = [`Odds from ${thousands(sims)} simulated seasons.`, ...built.notes];
  if (!res.playoffsKnown && built.playoffsKnown) notes.push("Some playoff games already played have no result we can match to the bracket, so bye and title odds are unknown.");
  notes.push(...built.warnings);
  return {
    sims,
    seed,
    playoffTeams: N,
    byes,
    tiebreaker: { rule: setup.tiebreaker, assumed: built.tiebreakerAssumed },
    reseed: { value: setup.reseed, assumed: built.reseedAssumed },
    thirdPlace: { ...built.thirdPlace },
    highScorePeriods: setup.highScorePeriods?.length ?? 0,
    regularLeft: { ...built.regularLeft },
    playoffLeft: { ...built.playoffLeft },
    playoffsKnown,
    teams,
    weekly,
    notes,
  };
}
