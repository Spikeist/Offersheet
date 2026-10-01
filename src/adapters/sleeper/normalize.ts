/**
 * Sleeper responses → LeagueSnapshot (CLAUDE.md §2.3, §4). PURE and browser-safe (no node:
 * imports), so it can run in the browser if Sleeper allows cross-origin reads (§2.3).
 *
 * Every settings code below was verified against real leagues in Phase 0
 * (reports/probe-output/sleeper-codes.md, sleeper.md) unless marked "inferred"; an inferred reading
 * adds a SETTING_INFERRED warning, and a missing key read as a default adds SETTING_DEFAULTED, so
 * the Import Report never shows a guess as a fact (§0.12):
 * - settings.type 0/1/2 → redraft/keeper/dynasty; 3 = guillotine → rejected (planner answer 9).
 * - best_ball 1 → Sleeper sets the optimal lineup (allowed, with a note).
 * - veto_auto_poll 1 → 'league_vote', anything else → 'none' (planner answer 10).
 * - position_limit_<pos> caps the ACTIVE roster (IR exempt).
 * - playoff_teams; byes = next power of two − playoff_teams; playoff_round_type 0 one-week rounds,
 *   1 two-week final, 2 two-week rounds (inferred: 2 leagues); missing → one-week rounds (defaulted).
 * - playoff_seed_type 1 = re-seed, 0 = fixed bracket; any other code → a fixed bracket, with a warning.
 *   Missing → the default seeding (§8: a fixed bracket), with a SETTING_DEFAULTED warning at
 *   settings.playoff_seed_type: playoffSeeding is left out, unless division winners take the top seeds
 *   (below; that rule doesn't depend on the seed type), when it is { reseed: false, divisionWinnersFirst:
 *   true } and the warning is what says the re-seeding is assumed.
 * - Division winners take the top playoff seeds, set only when the rosters actually name 2+ divisions
 *   (with one division the rule changes nothing). Documented for 4 divisions and for 2 divisions in a
 *   6-team playoff (✅ divisionSeedingDocumented: Sleeper's help center; a note says so); anywhere else
 *   Sleeper documents only that every division winner makes the playoffs, so seeding them first is
 *   inferred (⚠️ Phase 0 saw it hold in 2/2 informative leagues), with a warning.
 * - Seeding tiebreaker (§8): points for, Sleeper's documented default (✅ SEEDING_TIEBREAKER), always
 *   set. A commissioner can also seed the playoffs by hand, which the API doesn't show: a note says
 *   the odds follow the standings.
 * - trade_deadline D in 1–17 = trades complete through LEAGUE week (leg) D, not NFL week D: on the
 *   Tuesday after NFL week D, trades still go through until the league's waivers run. So
 *   snapshot.leagueWeek carries settings.leg, and trades are open while leagueWeek ≤ D. 99 = no
 *   deadline (inferred, 1/5); any other code → unknown (settings.unknownSettings).
 * - league_average_match 1 = an extra game vs the median each week; missing → none (defaulted).
 * - waiver_type 2 = FAAB (waiver_budget is then the budget).
 * - Matchups of weeks ≥ playoff_week_start are regular-season placeholders until the playoffs start,
 *   so the schedule holds regular-season weeks only; once the playoffs start, a warning says the
 *   playoff matchups aren't imported yet (the winners_bracket isn't read).
 * - Results (§4 Matchup.decided and result): a week is decided through settings.last_scored_leg, the
 *   last week Sleeper has scored (Phase 0 ✅: the last completed NFL week in 178/178 in-season leagues;
 *   in the test league, captured on a Tuesday with leg still 3, matchups have points exactly for weeks
 *   ≤ last_scored_leg = 3, and every team's W+L+T is 3). On the Tuesday and Wednesday before the
 *   league's waivers run, the league week (leg) still names the finished week, so "weeks before leg"
 *   would miss a week the records already count. Without last_scored_leg: the weeks before leg, else
 *   before the NFL week. Every matchup of a decided week is `decided`, byes included (the records
 *   count that week). A decided pair's scores are custom_points when it's a number, else points (to
 *   cents); the higher wins, equal = a tie. A decided pair without both scores stays decided but gets
 *   no result, with a warning.
 *
 * Players: Sleeper's players-DB record (via the resolver) for active players, with injury status
 * and NFL team from the projection rows (at most 6 hours old, the DB up to a day); else the player
 * object a projection row embeds (Sleeper projects him, so he's current); else the resolver's
 * DynastyProcess fallback, where active false (not an active NFL player) is known only when
 * Sleeper's list for his position loaded fully.
 */
import { LeagueImportError, type ImportResult } from "@/adapters/types";
import type { PlayerIdResolver, SleeperPlayerLite } from "@/data/types";
import { config } from "@/engine/config";
import { POSITIONS, type DraftPick, type ImportWarning, type InjuryStatus, type LeagueSettings, type LeagueSnapshot, type Matchup, type MatchupResult, type PlayerInfo, type Pos, type Scoring, type SeedingTiebreaker, type SlotDef, type Team, type Transaction, type UnknownSetting } from "@/engine/model";
import { expectedPoints } from "@/engine/scoring";
import { mapSleeperScoring, normalizeProjectionStats } from "./scoringMap";
import {
  DraftSchema,
  LeagueSchema,
  LeagueUserSchema,
  MatchupSchema,
  RosterSchema,
  StateSchema,
  StatRowSchema,
  TradedPickSchema,
  TransactionSchema,
  num,
  parseArrayLenient,
  parseArrayOrThrow,
  parseOrThrow,
  type SleeperDraft,
  type SleeperLeague,
  type SleeperLeagueUser,
  type SleeperMatchup,
  type SleeperRoster,
  type SleeperStatRow,
  type SleeperTradedPick,
  type SleeperTransaction,
} from "./schemas";

/** Free agents kept per position (CLAUDE.md §4 LeagueSnapshot.freeAgents: "top 50 per position"; config.import). */
export const FREE_AGENTS_PER_POSITION = config.import.freeAgentsPerPosition;
/** Last week of the NFL regular season; fantasy playoffs can't run past it. */
export const LAST_NFL_WEEK = 18;
/**
 * Tradable draft picks cover "the current season + up to 3 future years", and leagues can't change
 * that (Sleeper's help center, support.sleeper.com/en/articles/4047901; planner reply to Checkpoint 1,
 * answer 8) ✅.
 */
export const FUTURE_PICK_SEASONS = 3;
/**
 * How Sleeper breaks ties in the standings (§8) ✅: "If two or more teams finish with the same record,
 * the default standings tiebreakers are: Points For, Higher Points Against. The team with more Points
 * For will rank higher. If that is also tied, the team with the higher Points Against will advance." A
 * tie left after both is a coin flip unless the commissioner seeds by hand, and "If any playoff
 * matchups end with a tie score, the winner is automatically the higher seed" (Sleeper's help center,
 * "Can I set tiebreakers?", support.sleeper.com/en/articles/4238872; lead decision D4, Phase 3). The
 * API doesn't show hand seeding, so the Import Report notes it. The simulator's points-for order (win
 * %, points for, head-to-head, division record, then more points against first) differs from
 * Sleeper's only when points for tie to the cent, and it settles a tied playoff game for the higher
 * seed too.
 */
export const SEEDING_TIEBREAKER: SeedingTiebreaker = "pointsFor";
/**
 * Whether Sleeper documents that division winners take the top playoff seeds (✅), for a league with
 * `divisions` divisions (2+) and `playoffTeams` playoff teams. Sleeper's help center, "How do playoff
 * teams get determined?" (support.sleeper.com/en/articles/2203518), under "Leagues with divisions":
 * "In leagues with divisions, the winners of each division automatically make the playoffs." Then,
 * under "6-Team Playoff Leagues": "The bye week goes to the 2 division winners with the best record,
 * based on Overall Record > Points For > Points Against. Any remaining playoff slots are filled by teams
 * that did not win the division, and seeding is sorted by Overall Record > Points For > Points
 * Against." And under "4 Division League": "The top 4 seeds will always be given to division winners,
 * while the remaining bottom seeds will be filled with non-division winners." So it's documented with 4
 * divisions (the rule names no playoff size) and with 2 divisions in a 6-team playoff (both winners get
 * the byes, seeds 1 and 2). Anywhere else the article says only that every division winner makes the
 * playoffs, and seeding them first is inferred (⚠️): a 2-division league with a 4- or 8-team playoff,
 * or 3 divisions, where a 6-team playoff's byes go to the 2 best winners but the third's seed isn't
 * given. Lead decision D4, Phase 3, read against the article's text: its 2-division rule is the
 * 6-team one.
 */
export function divisionSeedingDocumented(divisions: number, playoffTeams: number): boolean {
  return divisions === 4 || (divisions === 2 && playoffTeams === 6);
}

/** The raw responses the fetch half collected (JSON as received; validated here). */
export interface SleeperRawLeague {
  /** /state/nfl */
  state: unknown;
  /** /league/{id} */
  league: unknown;
  /** /league/{id}/users */
  users: unknown;
  /** /league/{id}/rosters */
  rosters: unknown;
  /** week → /league/{id}/matchups/{week}; weeks ≥ playoff_week_start are ignored. */
  matchups: Record<number, unknown>;
  /** leg → /league/{id}/transactions/{leg} */
  transactions: Record<number, unknown>;
  /** /league/{id}/traded_picks */
  tradedPicks?: unknown;
  /** /league/{id}/drafts */
  drafts?: unknown;
  /**
   * NFL week → /projections rows (any positions) for this week and the next ones; weeks that
   * couldn't be read are left out. Rank free agents and give fresh injury status and NFL team.
   */
  projections?: Record<number, unknown>;
  /** This NFL week (the first projection week); undefined outside the regular season. */
  projectionWeek?: number;
}

export interface SleeperNormalizeContext {
  now: Date;
  resolver: PlayerIdResolver;
  /** The user's Sleeper user_id, when they came in with a username (my-team detection, §2.3). */
  userId?: string;
  /** The season the user asked for; a league from another season gets a warning. */
  requestedSeason?: number;
  /** Problems the fetch half already met (e.g. a week that couldn't be read). */
  fetchWarnings?: ImportWarning[];
}

// ---------------------------------------------------------------------------------------------
// Platform knowledge (checked against real lineups in Phase 0: B.slotEligibility)

export const SLOT_ELIGIBLE: Readonly<Record<string, readonly Pos[]>> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  DL: ["DL"],
  LB: ["LB"],
  DB: ["DB"],
  FLEX: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  IDP_FLEX: ["DL", "LB", "DB"],
};
const BENCH_SLOT = "BN";

const LEAGUE_TYPES: Readonly<Record<number, LeagueSettings["leagueType"]>> = { 0: "redraft", 1: "keeper", 2: "dynasty" };
const GUILLOTINE_TYPE = 3;

/** Sleeper injury_status → normalized (Phase 0 decision; DNR and COV count as OUT, planner reply). */
const INJURY_MAP: Readonly<Record<string, InjuryStatus>> = {
  questionable: "QUESTIONABLE",
  doubtful: "DOUBTFUL",
  out: "OUT",
  ir: "IR",
  pup: "PUP",
  sus: "SUSPENDED",
  na: "NA",
  dnr: "OUT",
  cov: "OUT",
};

/** Sleeper positions outside our Pos list, for players whose fantasy_positions don't say. */
const POSITION_FALLBACK: Readonly<Record<string, Pos>> = { DE: "DL", DT: "DL", NT: "DL", CB: "DB", S: "DB", SS: "DB", FS: "DB", ILB: "LB", OLB: "LB", MLB: "LB", FB: "RB" };

const isPos = (x: string | null | undefined): x is Pos => !!x && (POSITIONS as readonly string[]).includes(x);

/** Our position for a Sleeper player: Sleeper's own position when it's one of ours, else its fantasy position. */
export function sleeperPos(position: string | null | undefined, fantasyPositions: readonly string[] = []): Pos | null {
  if (isPos(position)) return position;
  const fp = fantasyPositions.find(isPos);
  if (fp) return fp;
  return (position && POSITION_FALLBACK[position]) || null;
}

export function mapInjury(status: string | null | undefined): { injury: InjuryStatus; known: boolean } {
  const s = status?.trim().toLowerCase();
  if (!s) return { injury: "ACTIVE", known: true };
  const m = INJURY_MAP[s];
  return m ? { injury: m, known: true } : { injury: "ACTIVE", known: false };
}

/** Starting slots (in roster_positions order), bench size and slot names we don't know. */
export function lineupFromRosterPositions(rosterPositions: readonly string[]): { lineup: SlotDef[]; bench: number; unknown: string[] } {
  const counts = new Map<string, number>();
  let bench = 0;
  const unknown = new Set<string>();
  for (const slot of rosterPositions) {
    if (slot === BENCH_SLOT) bench++;
    else if (SLOT_ELIGIBLE[slot]) counts.set(slot, (counts.get(slot) ?? 0) + 1);
    else unknown.add(slot);
  }
  const lineup = [...counts].map(([slot, count]) => ({ slot, count, eligible: [...(SLOT_ELIGIBLE[slot] as readonly Pos[])] }));
  return { lineup, bench, unknown: [...unknown] };
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Playoff weeks from playoff_week_start, playoff_teams and playoff_round_type (0 one week per
 * round, 1 two-week final, 2 two weeks per round), capped at NFL week 18.
 */
export function playoffLayout(start: number, playoffTeams: number, roundType: number | undefined): { weeks: number[]; roundWeeks: number[]; capped: boolean } {
  const rounds = playoffTeams > 1 ? Math.ceil(Math.log2(playoffTeams)) : playoffTeams === 1 ? 1 : 0;
  const roundWeeks = Array.from({ length: rounds }, (_, i) => (roundType === 2 || (roundType === 1 && i === rounds - 1) ? 2 : 1));
  const total = roundWeeks.reduce((a, b) => a + b, 0);
  const weeks: number[] = [];
  for (let w = start; w < start + total && w <= LAST_NFL_WEEK; w++) weeks.push(w);
  return { weeks, roundWeeks, capped: weeks.length < total };
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let w = from; w <= to; w++) out.push(w);
  return out;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Settings

interface SettingsResult {
  settings: LeagueSettings;
  notes: string[];
  startable: Set<Pos>;
  playoffStart: number;
}

/** A setting read from a small sample or by inference (§0.12: ⚠️, never shown as a fact). */
const inferred = (message: string, platformPath: string): ImportWarning => ({ code: "SETTING_INFERRED", message, platformPath });
/** A setting the league leaves out, read as its usual default. */
const defaulted = (message: string, platformPath: string): ImportWarning => ({ code: "SETTING_DEFAULTED", message, platformPath });

/** Divisions from the rosters' division numbers; one warning for every team without one (SLP-8). */
function buildDivisions(divisionsCount: number, rosters: SleeperRoster[], warn: (w: ImportWarning) => void): LeagueSettings["divisions"] {
  if (divisionsCount <= 0) return undefined;
  const byDivision = new Map<string, string[]>();
  const missing: number[] = [];
  for (const r of rosters) {
    const d = r.settings?.division;
    if (typeof d !== "number" || d <= 0) missing.push(r.roster_id);
    else byDivision.set(String(d), [...(byDivision.get(String(d)) ?? []), String(r.roster_id)]);
  }
  if (missing.length) {
    const teams = missing.sort((a, b) => a - b);
    const list = `${teams.slice(0, 6).join(", ")}${teams.length > 6 ? ", …" : ""}`;
    warn({
      code: "DIVISION_MISSING",
      message: byDivision.size
        ? `${teams.length} of ${rosters.length} teams have no division although the league has ${divisionsCount} (${teams.length > 1 ? "teams" : "team"} ${list}); they're left out of the divisions.`
        : `The league has ${divisionsCount} divisions, but no team says which one it's in, so divisions are left out.`,
      platformPath: "rosters[].settings.division",
    });
  }
  if (!byDivision.size) return undefined;
  return [...byDivision].sort((a, b) => Number(a[0]) - Number(b[0])).map(([id, teamIds]) => ({ id, teamIds }));
}

/**
 * Whether division winners take the top playoff seeds, from the number of divisions the rosters name:
 * only with 2 or more (with one, its winner is the top team anyway). Where Sleeper documents it
 * (divisionSeedingDocumented) a note says so. Elsewhere Sleeper documents only that every division
 * winner makes the playoffs; seeding them first is the closest reading (it puts them in whenever the
 * playoffs have a spot for each), so it's inferred, with a warning (§0.12: never shown as a fact).
 */
function divisionWinnersFirst(divisionCount: number, playoffTeams: number, notes: string[], warn: (w: ImportWarning) => void): boolean {
  if (divisionCount < 2) return false;
  if (divisionSeedingDocumented(divisionCount, playoffTeams))
    notes.push(`Playoff seeding: the ${divisionCount} division winners take the top seeds, then the other teams by the standings (Sleeper's help center says so for ${divisionCount === 4 ? "leagues with 4 divisions" : "6-team playoffs with 2 divisions"}).`);
  else
    warn(
      inferred(
        `Division winners are assumed to take the top playoff seeds. Sleeper's help center says every division winner makes the playoffs, but it gives them the top seeds only in leagues with 4 divisions and in 6-team playoffs with 2 divisions (this league: ${divisionCount} divisions, ${playoffTeams} playoff ${playoffTeams === 1 ? "team" : "teams"}), so check your league's playoff settings.`,
        "settings.divisions",
      ),
    );
  return true;
}

/**
 * The note on Sleeper's standings tiebreaker (SEEDING_TIEBREAKER: more points for ranks higher, then
 * more points against) and, when the league has playoffs, on hand seeding, which the API doesn't show.
 */
function tiebreakerNote(hasPlayoffs: boolean): string {
  const ties = "Ties in the standings: more points for, then more points against (Sleeper's default tiebreakers, from its help center).";
  return hasPlayoffs ? `${ties} A commissioner can also set the playoff seeds by hand, which Sleeper's API doesn't show; Offer Sheet seeds by the standings.` : ties;
}

function buildSettings(league: SleeperLeague, rosters: SleeperRoster[], scoring: Scoring, warn: (w: ImportWarning) => void): SettingsResult {
  const s = league.settings;
  const notes: string[] = [];
  const unknownSettings: UnknownSetting[] = [];

  const type = num(s, "type");
  let leagueType: LeagueSettings["leagueType"] = "redraft";
  if (type !== undefined && LEAGUE_TYPES[type]) leagueType = LEAGUE_TYPES[type] as LeagueSettings["leagueType"];
  else warn({ code: "LEAGUE_TYPE_UNKNOWN", message: `Unknown league type code ${type ?? "(missing)"}; treated as redraft.`, platformPath: "settings.type" });

  const { lineup, bench, unknown } = lineupFromRosterPositions(league.roster_positions);
  for (const slot of unknown) warn({ code: "UNKNOWN_SLOT", message: `Lineup slot "${slot}" isn't one we know; it is left out of the lineup.`, platformPath: "roster_positions" });
  const startable = new Set<Pos>(lineup.flatMap((l) => l.eligible));

  const positionLimits: Partial<Record<Pos, number>> = {};
  for (const [key, value] of Object.entries(s)) {
    const m = /^position_limit_(\w+)$/.exec(key);
    if (!m) continue;
    const pos = (m[1] as string).toUpperCase();
    if (typeof value !== "number" || value <= 0) continue; // 0 / missing = no limit
    if (isPos(pos)) positionLimits[pos] = value;
    else warn({ code: "POSITION_LIMIT_UNKNOWN", message: `Position limit for "${pos}" isn't a position we know; ignored.`, platformPath: `settings.${key}` });
  }

  const numTeams = num(s, "num_teams") ?? league.total_rosters ?? rosters.length;
  const startWeek = num(s, "start_week") || 1;
  let playoffStart = num(s, "playoff_week_start") ?? 0;
  if (!playoffStart) {
    playoffStart = 15;
    warn({ code: "PLAYOFF_START_MISSING", message: "The league doesn't say when its playoffs start; assumed NFL week 15 (the most common start).", platformPath: "settings.playoff_week_start" });
  }
  const playoffTeams = num(s, "playoff_teams") ?? 0;
  if (!playoffTeams) warn({ code: "PLAYOFF_TEAMS_MISSING", message: "The league doesn't say how many teams make the playoffs.", platformPath: "settings.playoff_teams" });
  let roundType = num(s, "playoff_round_type");
  if (roundType === undefined) warn(defaulted("The league doesn't say how long its playoff rounds last; assumed one week per round.", "settings.playoff_round_type"));
  else if (![0, 1, 2].includes(roundType)) {
    warn({ code: "PLAYOFF_ROUND_TYPE_UNKNOWN", message: `Unknown playoff round type ${roundType}; assumed one week per round.`, platformPath: "settings.playoff_round_type" });
    roundType = 0;
  } else if (roundType === 2) warn(inferred("Every playoff round is read as lasting two weeks (Sleeper's code 2). We could check that code in only 2 leagues, so check your league's playoff settings.", "settings.playoff_round_type"));
  const layout = playoffLayout(playoffStart, playoffTeams, roundType);
  if (layout.capped) warn({ code: "PLAYOFF_WEEKS_CAPPED", message: `The playoff rounds would run past NFL week ${LAST_NFL_WEEK}; weeks after it are left out.`, platformPath: "settings.playoff_week_start" });

  const divisions = buildDivisions(num(s, "divisions") ?? 0, rosters, warn);

  // Division winners first depends on the divisions and the playoff size, not on the seed type (review
  // ADAPT-1): Sleeper's help center gives it whatever playoff_seed_type says, so a league that doesn't
  // report its seed type keeps it, and only re-seeding falls back to the default (the warning says so).
  const seedingNotes: string[] = [];
  const divisionsFirst = divisionWinnersFirst(divisions?.length ?? 0, playoffTeams, seedingNotes, warn);
  const seedType = num(s, "playoff_seed_type");
  let playoffSeeding: LeagueSettings["playoffSeeding"];
  if (seedType === undefined) {
    const standard = "standard seeding is assumed: by record, with ties going to points for (Sleeper's default), and no re-seeding.";
    warn(defaulted(`The league doesn't say how its playoff bracket is seeded; ${divisionsFirst ? `after the division winners, ${standard}` : standard}`, "settings.playoff_seed_type"));
    if (divisionsFirst) playoffSeeding = { reseed: false, divisionWinnersFirst: true };
  } else {
    if (seedType !== 0 && seedType !== 1) warn({ code: "PLAYOFF_SEED_TYPE_UNKNOWN", message: `Unknown playoff seeding code ${seedType}; assumed a fixed bracket (no re-seeding).`, platformPath: "settings.playoff_seed_type" });
    playoffSeeding = { reseed: seedType === 1, divisionWinnersFirst: divisionsFirst };
  }

  const deadline = num(s, "trade_deadline");
  let tradeDeadline: LeagueSettings["tradeDeadline"] = null;
  if (deadline !== undefined && deadline >= 1 && deadline <= 17) tradeDeadline = { week: deadline };
  else if (deadline === 99) warn(inferred('Trade deadline code 99 is read as "no trade deadline". Sleeper doesn\'t document it, and we could confirm it in only 1 of 5 leagues, so check your league settings.', "settings.trade_deadline"));
  else {
    unknownSettings.push("tradeDeadline");
    warn({
      code: "TRADE_DEADLINE_UNKNOWN",
      message: deadline === undefined ? "The league doesn't say when its trade deadline is, so it's shown as unknown. Check it in your league settings." : `Trade deadline code ${deadline} isn't one we know, so the deadline is shown as unknown. Check it in your league settings.`,
      platformPath: "settings.trade_deadline",
    });
  }
  if (num(s, "disable_trades") === 1) warn({ code: "TRADES_DISABLED", message: "Trading is turned off in this league, so no trade can go through.", platformPath: "settings.disable_trades" });

  const median = num(s, "league_average_match");
  if (median === undefined) warn(defaulted("The league doesn't say whether teams also play against the league median each week; assumed they don't.", "settings.league_average_match"));

  const vetoPoll = num(s, "veto_auto_poll");
  const tradeReview: LeagueSettings["tradeReview"] = vetoPoll === 1 ? "league_vote" : "none";
  if (vetoPoll === undefined) warn({ code: "TRADE_REVIEW_UNVERIFIED", message: "The league has no veto setting; assumed trades aren't reviewed.", platformPath: "settings.veto_auto_poll" });

  const bestBall = num(s, "best_ball") === 1;
  if (bestBall) notes.push("Best-ball league: lineups are set automatically (Sleeper starts each team's best lineup every week). Offer Sheet values every team by its best possible lineup, which is how best ball scores.");

  // Division seeding, then how ties in the standings are broken (§8: Sleeper's documented default).
  notes.push(...seedingNotes, tiebreakerNote(playoffTeams > 0));

  const settings: LeagueSettings = {
    numTeams,
    leagueType,
    lineup,
    benchSlots: bench,
    irSlots: num(s, "reserve_slots") ?? 0,
    taxiSlots: num(s, "taxi_slots") ?? 0,
    maxRosterSize: lineup.reduce((a, l) => a + l.count, 0) + bench,
    ...(Object.keys(positionLimits).length ? { positionLimits } : {}),
    ...(bestBall ? { bestBall } : {}),
    scoring,
    regularSeasonWeeks: range(startWeek, playoffStart - 1),
    playoffWeeks: layout.weeks,
    playoffTeams,
    playoffByes: playoffTeams > 1 ? nextPowerOfTwo(playoffTeams) - playoffTeams : 0,
    ...(layout.roundWeeks.some((w) => w > 1) ? { playoffRoundWeeks: layout.roundWeeks } : {}),
    medianGame: median === 1,
    pointsOnly: false,
    ...(divisions ? { divisions } : {}),
    ...(playoffSeeding ? { playoffSeeding } : {}),
    seedingTiebreaker: SEEDING_TIEBREAKER,
    tradeDeadline,
    tradeReview,
    ...(num(s, "waiver_type") === 2 && num(s, "waiver_budget") !== undefined ? { faabBudget: num(s, "waiver_budget") } : {}),
    ...(unknownSettings.length ? { unknownSettings } : {}),
  };
  return { settings, notes, startable, playoffStart };
}

// ---------------------------------------------------------------------------------------------
// Teams

function displayName(u: SleeperLeagueUser | undefined): string | undefined {
  const n = u?.display_name?.trim();
  return n || undefined;
}

function teamNameOf(u: SleeperLeagueUser | undefined): string | undefined {
  const t = u?.metadata?.team_name;
  return typeof t === "string" && t.trim() ? t.trim() : displayName(u);
}

function buildTeams(rosters: SleeperRoster[], users: SleeperLeagueUser[], settings: LeagueSettings): Team[] {
  const byId = new Map(users.map((u) => [u.user_id, u]));
  const inDivision = new Map<string, string>();
  for (const d of settings.divisions ?? []) for (const t of d.teamIds) inDivision.set(t, d.id);
  return [...rosters]
    .sort((a, b) => a.roster_id - b.roster_id)
    .map((r) => {
      const owner = r.owner_id ? byId.get(r.owner_id) : undefined;
      const owners = [owner, ...(r.co_owners ?? []).map((id) => byId.get(id))].map(displayName).filter((x): x is string => !!x);
      const all = (r.players ?? []).filter((p) => p && p !== "0");
      const ir = (r.reserve ?? []).filter((p) => p && p !== "0");
      const taxi = (r.taxi ?? []).filter((p) => p && p !== "0");
      const benched = new Set([...ir, ...taxi]);
      const st = r.settings ?? {};
      const id = String(r.roster_id);
      const division = inDivision.get(id);
      return {
        id,
        name: teamNameOf(owner) ?? `Team ${r.roster_id}`,
        ownerName: owners.length ? owners.join(" & ") : "No manager",
        roster: all.filter((p) => !benched.has(p)),
        ir,
        taxi,
        record: { w: st.wins ?? 0, l: st.losses ?? 0, t: st.ties ?? 0 },
        pointsFor: round2((st.fpts ?? 0) + (st.fpts_decimal ?? 0) / 100),
        pointsAgainst: round2((st.fpts_against ?? 0) + (st.fpts_against_decimal ?? 0) / 100),
        ...(division ? { divisionId: division } : {}),
      };
    });
}

/** §2.3: the roster whose owner_id is the user, else one whose co_owners lists them. */
export function findMyRosterId(rosters: SleeperRoster[], userId: string): { rosterId: number; via: "owner_id" | "co_owners" } | null {
  const own = rosters.find((r) => r.owner_id === userId);
  if (own) return { rosterId: own.roster_id, via: "owner_id" };
  const co = rosters.find((r) => (r.co_owners ?? []).includes(userId));
  return co ? { rosterId: co.roster_id, via: "co_owners" } : null;
}

// ---------------------------------------------------------------------------------------------
// Schedule, transactions, picks

/**
 * The last week whose matchups are decided (see the header, "Results"): settings.last_scored_leg,
 * else the week before the league week (leg), else the week before the NFL week.
 */
export function lastDecidedWeek(leagueSettings: Record<string, unknown>, currentWeek: number): number {
  const scored = num(leagueSettings, "last_scored_leg");
  if (scored !== undefined) return scored;
  return (num(leagueSettings, "leg") ?? currentWeek) - 1;
}

/**
 * The regular-season schedule. An already-scored matchup without both teams' points stays decided
 * without a result (MATCHUP_RESULT_MISSING, worded by what that changes: the records still count it,
 * the head-to-head tiebreaker and, with 2+ divisions, the division-record one leave it out).
 */
function buildSchedule(weeks: number[], raw: Record<number, unknown>, decidedThrough: number, hasDivisions: boolean, warn: (w: ImportWarning) => void): Matchup[] {
  const out: Matchup[] = [];
  const unscored: number[] = [];
  for (const week of weeks) {
    const data = raw[week];
    if (data === undefined) continue; // the fetch half already warned
    const { rows, bad, firstBadPath } = parseArrayLenient(MatchupSchema, data);
    if (bad) warn({ code: "MATCHUPS_UNREADABLE", message: `Week ${week}: ${bad} matchup row(s) didn't have the expected shape and were skipped.`, platformPath: `matchups/${week}${firstBadPath ?? ""}` });
    const matchups = weekMatchups(week, rows, week <= decidedThrough, warn);
    out.push(...matchups.list);
    for (let i = 0; i < matchups.unscored; i++) unscored.push(week);
  }
  if (unscored.length) {
    const [they, them] = unscored.length === 1 ? ["it has", "it"] : ["they have", "them"];
    const tiebreakers = hasDivisions ? "head-to-head and division-record tiebreakers" : "head-to-head tiebreakers";
    warn({
      code: "MATCHUP_RESULT_MISSING",
      message: `${unscored.length} already-scored matchup(s) (${weeksText([...new Set(unscored)])}) came without both teams' points, so ${they} no result: Sleeper's standings still count ${them} as played, but ${tiebreakers} leave ${them} out.`,
      platformPath: `matchups/${unscored[0]}[].points`,
    });
  }
  return out;
}

/** A team's score in one week's row: custom_points when it's a number (an override), else points, to cents. */
function scoreOf(row: SleeperMatchup): number | undefined {
  const pts = typeof row.custom_points === "number" ? row.custom_points : row.points;
  return typeof pts === "number" && Number.isFinite(pts) ? round2(pts) : undefined;
}

/** A decided pair's result (teamA = the lower roster id): the higher score wins; equal scores are a tie. */
function pairResult(a: SleeperMatchup, b: SleeperMatchup): MatchupResult | undefined {
  const pa = scoreOf(a);
  const pb = scoreOf(b);
  if (pa === undefined || pb === undefined) return undefined;
  return { pointsA: pa, pointsB: pb, winnerId: pa > pb ? String(a.roster_id) : pb > pa ? String(b.roster_id) : null };
}

/**
 * One week's matchups (pairs by matchup_id), every one marked decided when the week is; `unscored`
 * counts decided pairs without both scores.
 */
function weekMatchups(week: number, rows: SleeperMatchup[], decided: boolean, warn: (w: ImportWarning) => void): { list: Matchup[]; unscored: number } {
  const byId = new Map<number, SleeperMatchup[]>();
  const loose: number[] = [];
  for (const r of rows) {
    if (typeof r.matchup_id === "number") byId.set(r.matchup_id, [...(byId.get(r.matchup_id) ?? []), r]);
    else loose.push(r.roster_id);
  }
  const done = decided ? { decided: true } : {};
  const list: Matchup[] = [];
  let unscored = 0;
  for (const [mid, group] of [...byId].sort((a, b) => a[0] - b[0])) {
    const sorted = [...group].sort((a, b) => a.roster_id - b.roster_id);
    const [a, b] = sorted;
    if (sorted.length === 2 && a && b) {
      const result = decided ? pairResult(a, b) : undefined;
      if (decided && !result) unscored++;
      list.push({ week, teamA: String(a.roster_id), teamB: String(b.roster_id), isPlayoff: false, ...done, ...(result ? { result } : {}) });
    } else {
      warn({ code: "MATCHUP_ODD", message: `Week ${week}: matchup ${mid} has ${sorted.length} team(s) instead of 2.`, platformPath: `matchups/${week}[].matchup_id` });
      for (const t of sorted) list.push({ week, teamA: String(t.roster_id), teamB: null, isPlayoff: false, ...done });
    }
  }
  for (const t of loose.sort((a, b) => a - b)) list.push({ week, teamA: String(t), teamB: null, isPlayoff: false, ...done });
  return { list, unscored };
}

function toPick(p: SleeperTradedPick): DraftPick {
  return { season: Number(p.season), round: p.round, originalTeamId: String(p.roster_id), ownerTeamId: String(p.owner_id) };
}

function transactionType(t: SleeperTransaction): Transaction["type"] {
  if (t.type === "trade") return "trade";
  if (t.type === "waiver") return "waiver";
  return Object.keys(t.adds ?? {}).length ? "add" : "drop";
}

function buildTransactions(raw: Record<number, unknown>, warn: (w: ImportWarning) => void): Transaction[] {
  const seen = new Set<string>();
  const out: Array<{ tx: Transaction; created: number }> = [];
  for (const leg of Object.keys(raw).map(Number).sort((a, b) => a - b)) {
    const { rows, bad, firstBadPath } = parseArrayLenient(TransactionSchema, raw[leg]);
    if (bad) warn({ code: "TRANSACTIONS_UNREADABLE", message: `Week ${leg}: ${bad} transaction(s) didn't have the expected shape and were skipped.`, platformPath: `transactions/${leg}${firstBadPath ?? ""}` });
    for (const t of rows) {
      if (t.status !== "complete" || seen.has(t.transaction_id)) continue;
      seen.add(t.transaction_id);
      const adds = t.adds ?? {};
      const drops = t.drops ?? {};
      const moves = [...new Set([...Object.keys(adds), ...Object.keys(drops)])].map((playerId) => ({
        playerId,
        from: drops[playerId] !== undefined ? String(drops[playerId]) : null,
        to: adds[playerId] !== undefined ? String(adds[playerId]) : null,
      }));
      const picks = (t.draft_picks ?? []).map(toPick);
      out.push({
        created: t.created,
        tx: {
          id: t.transaction_id,
          type: transactionType(t),
          week: t.leg,
          timestamp: new Date(t.created).toISOString(),
          teams: [...new Set((t.roster_ids ?? []).map(String))],
          moves,
          ...(picks.length ? { picks } : {}),
        },
      });
    }
  }
  return out.sort((a, b) => a.created - b.created || a.tx.id.localeCompare(b.tx.id)).map((x) => x.tx);
}

/**
 * Future pick ownership for keeper/dynasty leagues: each team starts with its own pick in every
 * round of every open season, then traded_picks moves them (roster_id = original team, owner_id =
 * current owner). Open seasons: this season if its draft hasn't finished, else from next season,
 * through season + FUTURE_PICK_SEASONS (Sleeper's documented window), or the last season
 * traded_picks mentions if that is ever later.
 */
function buildDraftPicks(league: SleeperLeague, rosterIds: number[], tradedRaw: unknown, draftsRaw: unknown, leagueType: LeagueSettings["leagueType"], warn: (w: ImportWarning) => void, notes: string[]): DraftPick[] | undefined {
  if (leagueType === "redraft" || num(league.settings, "pick_trading") === 0) return undefined;
  const season = Number(league.season);
  const traded = parseArrayLenient(TradedPickSchema, tradedRaw);
  if (traded.bad) warn({ code: "TRADED_PICKS_UNREADABLE", message: `${traded.bad} traded-pick row(s) didn't have the expected shape and were skipped.`, platformPath: `traded_picks${traded.firstBadPath ?? ""}` });
  const drafts = parseArrayLenient(DraftSchema, draftsRaw).rows as SleeperDraft[];
  // In season (or later) this season's draft has happened even if the drafts list couldn't be read.
  const thisDraftDone = drafts.some((d) => Number(d.season) === season && d.status === "complete") || ["in_season", "post_season", "complete"].includes(league.status ?? "");
  const firstOpen = thisDraftDone ? season + 1 : season;
  const lastTraded = traded.rows.reduce((mx, p) => Math.max(mx, Number(p.season)), 0);
  const lastOpen = Math.max(season + FUTURE_PICK_SEASONS, lastTraded);
  let rounds = num(league.settings, "draft_rounds");
  if (!rounds) {
    rounds = traded.rows.reduce((mx, p) => Math.max(mx, p.round), 0);
    warn({ code: "DRAFT_ROUNDS_MISSING", message: rounds ? `The league doesn't say how many draft rounds it has; assumed ${rounds} from traded picks.` : "The league doesn't say how many draft rounds it has, so pick ownership is unknown.", platformPath: "settings.draft_rounds" });
    if (!rounds) return undefined;
  }
  const owner = new Map<string, number>();
  const key = (s: number, r: number, orig: number) => `${s}|${r}|${orig}`;
  for (let s = firstOpen; s <= lastOpen; s++) for (let r = 1; r <= rounds; r++) for (const id of rosterIds) owner.set(key(s, r, id), id);
  const applied = new Map<string, number>();
  for (const p of traded.rows) {
    const k = key(Number(p.season), p.round, p.roster_id);
    if (!owner.has(k)) continue; // a closed season (e.g. this year's finished draft) or an unknown team
    const before = applied.get(k);
    if (before !== undefined && before !== p.owner_id) warn({ code: "TRADED_PICK_DUPLICATE", message: `Pick ${p.season} round ${p.round} of team ${p.roster_id} is listed twice with different owners; the last row is used.`, platformPath: "traded_picks" });
    applied.set(k, p.owner_id);
    owner.set(k, p.owner_id);
  }
  notes.push(`Draft picks: ${firstOpen}–${lastOpen} seasons, ${rounds} round(s) each (Sleeper lets leagues trade the current season's picks and up to ${FUTURE_PICK_SEASONS} future years).`);
  return [...owner]
    .map(([k, cur]) => {
      const [s, r, orig] = k.split("|").map(Number) as [number, number, number];
      return { season: s, round: r, originalTeamId: String(orig), ownerTeamId: String(cur) };
    })
    .sort((a, b) => a.season - b.season || a.round - b.round || Number(a.originalTeamId) - Number(b.originalTeamId));
}

// ---------------------------------------------------------------------------------------------
// Players and free agents

const PROJECTION_META_KEY = /^(adp_|pos_adp_|gp$|gs$|gms_active$)/;

/** A /projections row with a real projection (not an ADP-only stub, Phase 0 J.endpoint). */
export function hasProjection(stats: Record<string, unknown> | null | undefined): boolean {
  return !!stats && Object.entries(stats).some(([k, v]) => typeof v === "number" && v !== 0 && !PROJECTION_META_KEY.test(k));
}

/** One week of /projections rows. */
interface ProjectionWeek {
  week: number;
  rows: SleeperStatRow[];
}

/** The projection weeks that were read, in week order (rows that don't fit the schema are skipped, with a warning). */
function projectionWeeks(raw: SleeperRawLeague["projections"], warn: (w: ImportWarning) => void): ProjectionWeek[] {
  const out: ProjectionWeek[] = [];
  for (const week of Object.keys(raw ?? {}).map(Number).sort((a, b) => a - b)) {
    const { rows, bad, firstBadPath } = parseArrayLenient(StatRowSchema, raw?.[week]);
    if (bad) warn({ code: "PROJECTION_ROWS_UNREADABLE", message: `Week ${week}: ${bad} projection row(s) didn't have the expected shape and were skipped.`, platformPath: `projections/${week}${firstBadPath ?? ""}` });
    out.push({ week, rows: rows as SleeperStatRow[] });
  }
  return out;
}

/**
 * The player object a projection row embeds. active: true when the row shows a current player (an
 * NFL team or a real projection), else null (a stub row doesn't say).
 */
function liteFromRow(row: SleeperStatRow): SleeperPlayerLite | undefined {
  const p = row.player;
  if (!p?.position) return undefined;
  const name = [p.first_name, p.last_name].filter((x) => x && x.trim()).join(" ").trim();
  return {
    id: row.player_id,
    name: name || row.player_id,
    position: p.position,
    fantasyPositions: p.fantasy_positions ?? [],
    team: p.team ?? null,
    injuryStatus: p.injury_status ?? null,
    status: null,
    age: null,
    active: p.team || hasProjection(row.stats) ? true : null,
    yearsExp: p.years_exp ?? null,
  };
}

/**
 * DATA-4: a player's injury status and NFL team from his projection row's player object (at most
 * 6 hours old, TTL.projections) over the players DB's (up to a day old); only fields the row carries.
 */
function withRowFacts(lite: SleeperPlayerLite, row: SleeperStatRow | undefined): SleeperPlayerLite {
  const p = row?.player;
  if (!p) return lite;
  return { ...lite, ...(p.team !== undefined ? { team: p.team } : {}), ...(p.injury_status !== undefined ? { injuryStatus: p.injury_status } : {}) };
}

/**
 * Public facts for one Sleeper player id (SLP-1, DATA-1, DATA-4), in this order:
 * 1. the players-DB record of an ACTIVE player, with injury status and team from his projection row;
 * 2. the player object his projection row embeds: Sleeper projects him, so he's current, whatever a
 *    partial, empty or stale players DB says. Only a row that shows a current player (a team or a
 *    real projection) overrides a KNOWN inactive verdict;
 * 3. the resolver's DynastyProcess fallback: active false only when Sleeper's list for his position
 *    loaded fully (retired or unsigned), else null (unknown).
 */
export function lookupPlayer(resolver: PlayerIdResolver, id: string, row: SleeperStatRow | undefined): SleeperPlayerLite | undefined {
  const known = resolver.sleeperPlayer(id);
  if (known?.active === true) return withRowFacts(known, row);
  const fromRow = row ? liteFromRow(row) : undefined;
  if (fromRow && (known?.active !== false || fromRow.active === true)) return typeof known?.age === "number" ? { ...fromRow, age: known.age } : fromRow;
  return known ?? fromRow;
}

const TEAM_DEFENSE_ID = /^[A-Z]{2,3}$/;

function toPlayerInfo(id: string, lite: SleeperPlayerLite | undefined, unknownInjury: Set<string>): PlayerInfo | undefined {
  if (!lite) {
    if (!TEAM_DEFENSE_ID.test(id)) return undefined;
    return { id, name: `${id} D/ST`, pos: "DEF", eligible: ["DEF"], nflTeam: id, injury: "ACTIVE", ids: { sleeper: id } };
  }
  const pos = sleeperPos(lite.position, lite.fantasyPositions);
  if (!pos) return undefined;
  const eligible = [...new Set<Pos>([pos, ...lite.fantasyPositions.map((p) => sleeperPos(p)).filter((p): p is Pos => !!p)])];
  const { injury, known } = mapInjury(lite.injuryStatus);
  if (!known && lite.injuryStatus) unknownInjury.add(lite.injuryStatus);
  return {
    id,
    name: lite.name,
    pos,
    eligible,
    nflTeam: lite.team ?? (pos === "DEF" ? id : null),
    // KNOWN not to be an active NFL player (retired or unsigned; details from DynastyProcess): NA,
    // availability config.projections.injury.notActive. Unknown (null) keeps his injury status.
    injury: lite.active === false ? "NA" : injury,
    ...(typeof lite.age === "number" ? { age: lite.age } : {}),
    ids: { sleeper: id },
  };
}

// ---------------------------------------------------------------------------------------------

/**
 * Normalize everything the fetch half collected into a LeagueSnapshot. Throws LeagueImportError:
 * BAD_RESPONSE (a required field is missing; `detail.path` names it) and UNSUPPORTED_LEAGUE
 * (a guillotine league or a non-NFL league).
 */
export function normalizeSleeperLeague(raw: SleeperRawLeague, ctx: SleeperNormalizeContext): ImportResult {
  const warnings: ImportWarning[] = [...(ctx.fetchWarnings ?? [])];
  const warn = (w: ImportWarning) => warnings.push(w);

  const state = parseOrThrow(StateSchema, raw.state, "state");
  const league = parseOrThrow(LeagueSchema, raw.league, "league");
  assertSupported(league);
  const users = parseArrayOrThrow(LeagueUserSchema, raw.users ?? [], "users");
  const rosters = parseArrayOrThrow(RosterSchema, raw.rosters, "rosters");

  const scoringMap = mapSleeperScoring(league.scoring_settings);
  scoringMap.warnings.forEach(warn);
  const { settings, notes, startable, playoffStart } = buildSettings(league, rosters, scoringMap.scoring, warn);

  const season = Number(league.season);
  if (ctx.requestedSeason !== undefined && ctx.requestedSeason !== season) warn({ code: "SEASON_MISMATCH", message: `You asked for ${ctx.requestedSeason}, but this Sleeper league is the ${season} season (Sleeper gives every season its own league ID).`, platformPath: "season" });
  if (league.status === "pre_draft" || league.status === "drafting") warn({ code: "NOT_DRAFTED", message: "This league hasn't finished its draft, so rosters may be empty.", platformPath: "status" });

  const { week: currentWeek, over: seasonOver } = currentWeekFor(season, state, settings, warn);
  if (!seasonOver && currentWeek >= playoffStart)
    warn({ code: "PLAYOFFS_NOT_IMPORTED", message: `The fantasy playoffs started in week ${playoffStart}, but Offer Sheet doesn't read playoff matchups yet, so the schedule shows the regular season only.`, platformPath: "winners_bracket" });
  // Sleeper's league week (settings.leg) can lag the NFL week by a day: trades complete through leg D.
  const leagueWeek = num(league.settings, "leg");
  const teams = buildTeams(rosters, users, settings);

  let myTeamId: string | null = null;
  if (ctx.userId) {
    const mine = findMyRosterId(rosters, ctx.userId);
    if (mine) myTeamId = String(mine.rosterId);
    else warn({ code: "USER_NOT_IN_LEAGUE", message: "That Sleeper user doesn't manage a team in this league; pick your team.", platformPath: "rosters[].owner_id" });
  }

  const schedule = buildSchedule(
    settings.regularSeasonWeeks.filter((w) => w < playoffStart),
    raw.matchups,
    lastDecidedWeek(league.settings, currentWeek),
    (settings.divisions?.length ?? 0) >= 2,
    warn,
  );
  const transactions = buildTransactions(raw.transactions, warn);
  const draftPicks = buildDraftPicks(
    league,
    rosters.map((r) => r.roster_id),
    raw.tradedPicks,
    raw.drafts,
    settings.leagueType,
    warn,
    notes,
  );

  // Players: everyone rostered, everyone in this season's transactions, and the free agents.
  const projWeeks = projectionWeeks(raw.projections, warn);
  // A player's projection row with a player object: this week's, else the nearest later week's.
  const rowById = new Map<string, SleeperStatRow>();
  for (const { rows } of projWeeks) for (const r of rows) if (r.player && !rowById.has(r.player_id)) rowById.set(r.player_id, r);
  const lookup = (id: string): SleeperPlayerLite | undefined => lookupPlayer(ctx.resolver, id, rowById.get(id));
  const unknownInjury = new Set<string>();
  const players: Record<string, PlayerInfo> = {};
  const rostered = new Set<string>();
  const missing: string[] = [];
  const inactive: string[] = [];
  for (const t of teams) {
    for (const id of [...t.roster, ...t.ir, ...t.taxi]) {
      rostered.add(id);
      const lite = lookup(id);
      const info = toPlayerInfo(id, lite, unknownInjury);
      if (info) {
        players[id] = info;
        if (lite?.active === false) inactive.push(info.name);
      } else missing.push(id);
    }
  }
  if (inactive.length)
    warn({
      code: "PLAYER_INACTIVE",
      message: `${inactive.length} rostered player(s) aren't on Sleeper's list of active NFL players (retired or unsigned), so they're marked NA: not an active NFL player. ${inactive.slice(0, 10).join(", ")}${inactive.length > 10 ? ", …" : ""}.`,
      platformPath: "rosters[].players",
    });
  if (missing.length) warn({ code: "PLAYER_UNKNOWN", message: `${missing.length} rostered player(s) aren't in the player database and are left out: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", …" : ""}.`, platformPath: "rosters[].players" });
  for (const tx of transactions) {
    for (const m of tx.moves) {
      if (players[m.playerId]) continue;
      const info = toPlayerInfo(m.playerId, lookup(m.playerId), unknownInjury);
      if (info) players[m.playerId] = info;
    }
  }

  const freeAgents = rankFreeAgents(projWeeks, rostered, startable, settings.scoring, lookup, unknownInjury, players);
  const readWeeks = projWeeks.map((w) => w.week);
  const realWeeks = projWeeks.filter((w) => w.rows.some((r) => hasProjection(r.stats))).map((w) => w.week);
  if (raw.projections === undefined && raw.projectionWeek === undefined) warn({ code: "PROJECTIONS_OFFSEASON", message: "Outside the NFL regular season there are no weekly projections, so free agents aren't listed.", platformPath: "projections" });
  else if (!readWeeks.length) warn({ code: "PROJECTIONS_MISSING", message: "Sleeper's projections couldn't be read, so free agents aren't listed.", platformPath: "projections" });
  else if (!realWeeks.length) warn({ code: "PROJECTIONS_EMPTY", message: `Sleeper has no projections for ${weeksText(readWeeks)} yet, so free agents aren't listed.`, platformPath: "projections" });
  else notes.push(`Free agents: the top ${FREE_AGENTS_PER_POSITION} per position by Sleeper's projections for ${weeksText(realWeeks)} under this league's scoring, averaged over the weeks each player is projected to play (so a bye or a missed week doesn't hide him).`);
  if (unknownInjury.size) warn({ code: "INJURY_STATUS_UNKNOWN", message: `Sleeper sent injury status(es) we don't recognize (${[...unknownInjury].join(", ")}); those players are treated as healthy.`, platformPath: "players[].injury_status" });

  const snapshot: LeagueSnapshot = {
    platform: "sleeper",
    leagueId: league.league_id,
    season,
    name: league.name?.trim() || "Sleeper league",
    fetchedAt: ctx.now.toISOString(),
    currentWeek,
    ...(leagueWeek !== undefined ? { leagueWeek } : {}),
    settings,
    teams,
    myTeamId,
    players,
    schedule,
    transactions,
    freeAgents,
    ...(draftPicks ? { draftPicks } : {}),
    warnings,
  };
  return { snapshot, notes };
}

/** "week 4", "weeks 4–6" or "weeks 4 and 6". */
function weeksText(weeks: readonly number[]): string {
  if (weeks.length === 1) return `week ${weeks[0]}`;
  const contiguous = weeks.every((w, i) => i === 0 || w === (weeks[i - 1] as number) + 1);
  return contiguous ? `weeks ${weeks[0]}–${weeks.at(-1)}` : `weeks ${weeks.slice(0, -1).join(", ")} and ${weeks.at(-1)}`;
}

/** Guillotine (type 3) and non-NFL leagues aren't supported (planner answer 9). */
export function assertSupported(league: Pick<SleeperLeague, "settings" | "sport">): void {
  if (league.sport && league.sport !== "nfl") throw new LeagueImportError("UNSUPPORTED_LEAGUE", "That Sleeper league isn't an NFL league.", { platform: "sleeper", path: "sport" });
  if (num(league.settings, "type") === GUILLOTINE_TYPE)
    throw new LeagueImportError("UNSUPPORTED_LEAGUE", "This is a guillotine league: the lowest-scoring team is eliminated every week. Offer Sheet doesn't support guillotine leagues yet.", { platform: "sleeper", path: "settings.type" });
}

function currentWeekFor(season: number, state: { week: number; season: string; season_type?: string | null }, settings: LeagueSettings, warn: (w: ImportWarning) => void): { week: number; over: boolean } {
  const stateSeason = Number(state.season);
  const over = (settings.playoffWeeks.at(-1) ?? settings.regularSeasonWeeks.at(-1) ?? LAST_NFL_WEEK) + 1;
  if (season < stateSeason || (season === stateSeason && (state.season_type === "off" || state.season_type === "post"))) {
    warn({ code: "SEASON_OVER", message: `The ${season} fantasy season is over.`, platformPath: "state.season" });
    return { week: over, over: true };
  }
  if (season > stateSeason || state.season_type === "pre") return { week: 1, over: false };
  return { week: Math.max(1, state.week), over: false };
}

/**
 * The top FREE_AGENTS_PER_POSITION free agents per startable position (SLP-2): each player is ranked
 * by the MEAN of his league-scored projections over the weeks he has a real one (ADP-only stubs,
 * e.g. his bye week, are skipped), so a player on bye or out this week still ranks by the weeks he's
 * projected to play. Only players on an NFL team who aren't known to be inactive.
 */
function rankFreeAgents(
  weeks: readonly ProjectionWeek[],
  rostered: ReadonlySet<string>,
  startable: ReadonlySet<Pos>,
  scoring: Scoring,
  lookup: (id: string) => SleeperPlayerLite | undefined,
  unknownInjury: Set<string>,
  players: Record<string, PlayerInfo>,
): string[] {
  const candidates = new Map<string, { info: PlayerInfo; position: string | null; sum: number; n: number }>();
  const rejected = new Set<string>();
  for (const { rows } of weeks) {
    const seenThisWeek = new Set<string>();
    for (const row of rows) {
      const id = row.player_id;
      if (rostered.has(id) || rejected.has(id) || seenThisWeek.has(id) || !hasProjection(row.stats)) continue;
      seenThisWeek.add(id);
      let c = candidates.get(id);
      if (!c) {
        const lite = lookup(id);
        const info = lite && lite.active !== false && lite.team ? toPlayerInfo(id, lite, unknownInjury) : undefined;
        if (!lite || !info || !startable.has(info.pos)) {
          rejected.add(id);
          continue;
        }
        c = { info, position: lite.position, sum: 0, n: 0 };
        candidates.set(id, c);
      }
      c.sum += expectedPoints(normalizeProjectionStats(row.stats, c.position), c.info.pos, scoring);
      c.n++;
    }
  }
  const byPos = new Map<Pos, Array<{ id: string; points: number; info: PlayerInfo }>>();
  for (const [id, c] of candidates) byPos.set(c.info.pos, [...(byPos.get(c.info.pos) ?? []), { id, points: c.sum / c.n, info: c.info }]);
  const out: string[] = [];
  for (const pos of POSITIONS) {
    const list = (byPos.get(pos) ?? []).sort((a, b) => b.points - a.points || a.id.localeCompare(b.id)).slice(0, FREE_AGENTS_PER_POSITION);
    for (const fa of list) {
      players[fa.id] = fa.info;
      out.push(fa.id);
    }
  }
  return out;
}
