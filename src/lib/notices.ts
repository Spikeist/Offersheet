/**
 * Plain-language data notices (Phase 7b; planner reply to Checkpoint 7a, §5.1). Every warning the app can produce gets one
 * of these dispositions: the adapters' ImportWarning codes (the import), the model inputs' (projections, stats, trade
 * values, the NFL schedule: src/server/modelInputs.ts) and the League model's own warnings (plain strings:
 * src/engine/league.ts).
 *
 * - Notice: plain words, only when it can change what the user sees or decides. The Import Report's "Things to know" card
 *   and the League page's yellow banner (the only thing that banner shows) list them:
 *   - a player on the user's roster, or a likely starter on any roster, is missing projections or was matched uncertainly
 *     (we couldn't find him in Sleeper's data, matched him by name only, or the ID sources disagree about him). "Likely
 *     starter" is the League page's rule (leagueView.likelyStarters: in his team's best lineup after its free-agent
 *     pickups in at least half the weeks he plays; a free agent a team would pick up and start counts for that team). That
 *     rule reads our own points, so it never picks a player without projections: such a player on another team is judged
 *     without them (startsWithoutProjections: his team has a lineup spot only his position takes and no other projected
 *     player for it, or FantasyCalc values him this season at least as high as one of its likely starters at his
 *     position). A player the ESPN adapter left out of the user's roster (a position ESPN gives that we don't know:
 *     ESPN_POSITION_UNKNOWN's teams) is one too;
 *   - a scoring rule isn't counted, and it's a common one (ESPN_COMMON_UNCOUNTED, COMMON_STAT_KEY) or it has scored points
 *     in this league this season (Scoring.unmapped scoredThisSeason); rules are judged by their plain name, so a name is
 *     said once, as a notice when any of its rules matters;
 *   - a setting that affects results couldn't be read (settings.unknownSettings, a Sleeper setting left out, in a code we
 *     don't know, or read from an undocumented code that changes the deadline or the playoffs), or projections, stats,
 *     trade values, free agents, injury details or the NFL schedule didn't load (a whole ESPN response that couldn't be
 *     read counts as not loaded, as does one whose every row we couldn't read).
 * - Quiet scoring: a rare uncounted rule, said in one quiet line in the Import Report's scoring section ("Two rare rules
 *   aren't counted: 1-point safeties and blocked-kick return touchdowns. They almost never happen.").
 * - Team: the import couldn't tell which team is the user's (a Sleeper username we couldn't find or look up, ESPN cookies
 *   whose account owns no team here): the Import Report's "Your team" card says why while no team is picked
 *   (myTeamWarningText), where the user picks it.
 * - Technical: everything else (free agents matched by name, ID conflicts on deep backups, trade-history caveats, the
 *   codes, paths and stat IDs). Only the Import Report's collapsed "Technical details (for bug reports)" shows it, never
 *   the League page; it lists every warning raw (code, message, path), the ones behind notices included.
 *
 * WARNING_RULES classifies every code (notices.test.ts checks it against every code in src/), NOTICE_TEXT words the notices
 * (none quotes a code, a path, a stat ID or an HTTP status). A code this module doesn't know (an import from a newer
 * version) is technical. A League model warning is a notice in its own words unless modelWarningRule says otherwise.
 *
 * Before and after the League model: the Import Report builds no League model, so it can't tell who the likely starters
 * on other teams are. There it judges players by the user's roster alone, and lists other teams' players under the
 * technical details (DataNotices.unjudged; the report says the League page points out any who are likely starters). The
 * League page judges them by the full rule. The model inputs the notices read must be fresh for the snapshot (built for
 * this very league data, as the League page reuses them: modelStore.modelForSnapshot), so an outage that's over or a
 * check made on older rosters never shows as current. The schedule's gaps and finished playoff games without a result are
 * notices on the Import Report only: on the League page the standings' own notes say them, next to the odds they change.
 *
 * Pure and browser-safe: no engine module (the League model's texts are restated here; notices.test.ts checks them).
 */
import type { MarketInputs, ModelInputs, PlayerInputs } from "@/engine/inputs";
import type { ImportWarning, LeagueSnapshot, Platform, PlayerInfo, Pos, Scoring, UnknownSetting } from "@/engine/model";
import { fmtSigned, plural, weekRuns } from "./format";
import { posLabel, statLabel } from "./labels";

/** The notices' heading: the Import Report's "Things to know" card and the League page's yellow banner. */
export const NOTICES_TITLE = "Things to know";

/** How one warning code is shown (WARNING_RULES). */
export type WarningRule =
  /** Always a notice, in NOTICE_TEXT's words. */
  | "notice"
  /** A notice when NOTICE_TEXT words it (its condition is on the warning itself, or on the import it came with); else technical. */
  | "conditional"
  /** The technical details only. */
  | "technical"
  /** Its players decide: a notice for a player on the user's roster or a likely starter, else technical. */
  | "player"
  /** Its scoring rule decides: a notice when the rule is common or scored this season, else the quiet line. */
  | "scoring"
  /** settings.unknownSettings words it: one notice per setting the adapter marked unknown. */
  | "setting"
  /** Which team is the user's: the Import Report's "Your team" card says it while no team is picked (myTeamWarningText). */
  | "team";

/**
 * Every ImportWarning code the app can produce, and how it's shown. The warning itself always goes to the technical details
 * too (with its code and path); "player", "scoring" and "setting" codes are worded through the data they describe, so a
 * player, a rule or a setting is said once however many warnings name it.
 */
export const WARNING_RULES: Readonly<Record<string, WarningRule>> = {
  // The ESPN adapter (src/adapters/espn: normalize, slots, scoringMap, waivers, leagueData, fetch).
  ESPN_EMPTY_ROSTERS: "notice",
  ESPN_FREE_AGENTS_UNAVAILABLE: "notice",
  ESPN_FREE_AGENTS_UNREADABLE: "conditional",
  ESPN_HC_UNMAPPED: "conditional",
  ESPN_HOME_TEAM_BONUS: "notice",
  ESPN_IDP_UNVERIFIED: "notice",
  ESPN_ID_COLLISION: "player",
  ESPN_ID_CONFLICT: "player",
  ESPN_INJURY_UNKNOWN: "technical",
  ESPN_KEEPER_COUNTS_DIFFER: "technical",
  ESPN_MATCHUP_RESULT_UNREADABLE: "technical",
  ESPN_MULTIWEEK_MATCHUPS: "technical",
  ESPN_MY_TEAM_NOT_FOUND: "team",
  ESPN_MY_TEAM_UNKNOWN: "team",
  ESPN_NO_PLAYOFF_WEEKS: "notice",
  ESPN_NO_WAIVERS: "technical",
  ESPN_PLAYER_CARDS_PARTIAL: "technical",
  ESPN_PLAYER_CARDS_UNAVAILABLE: "notice",
  ESPN_PLAYER_CARDS_UNREADABLE: "conditional",
  ESPN_PLAYER_MATCHED_BY_NAME: "player",
  ESPN_PLAYOFF_BRACKET_UNCLEAR: "notice",
  ESPN_PLAYOFF_ROUND_LENGTH: "technical",
  ESPN_POSITION_UNKNOWN: "conditional",
  ESPN_SCHEDULE_UNAVAILABLE: "notice",
  ESPN_SCHEDULE_UNREADABLE: "notice",
  ESPN_SCORING_OVERRIDE_CONFLICT: "technical",
  ESPN_SCORING_OVERRIDE_UNKNOWN: "technical",
  ESPN_SCORING_REVERSE_ITEM: "technical",
  ESPN_SCORING_SHARED_KEY: "technical",
  ESPN_SCORING_TYPE: "notice",
  ESPN_SCORING_UNKNOWN_STAT: "scoring",
  ESPN_SCORING_UNMAPPED: "scoring",
  ESPN_SEEDING_DIVISIONS_UNKNOWN: "technical",
  ESPN_SEEDING_TIEBREAKER_UNKNOWN: "setting",
  ESPN_SEEDING_UNKNOWN: "setting",
  ESPN_SLOT_UNKNOWN: "notice",
  ESPN_TQB_AS_QB: "technical",
  ESPN_TRADES_UNVERIFIED: "technical",
  ESPN_TRADE_PARTNER_UNKNOWN: "technical",
  ESPN_TRADE_WITHOUT_PLAYERS: "technical",
  ESPN_TRANSACTIONS_UNAVAILABLE: "technical",
  ESPN_TRANSACTIONS_UNREADABLE: "technical",
  ESPN_WAIVER_ORDER_EDITED: "technical",
  ESPN_WAIVER_RESET_BEFORE_GAMES: "technical",
  ESPN_WAIVER_RESET_UNKNOWN: "technical",
  // The Sleeper adapter (src/adapters/sleeper: normalize, scoringMap, waivers, leagueData, fetch).
  DIVISION_MISSING: "notice",
  DRAFTS_MISSING: "technical",
  DRAFT_ROUNDS_CAPPED: "technical",
  DRAFT_ROUNDS_MISSING: "technical",
  INJURY_STATUS_UNKNOWN: "technical",
  LEAGUE_TYPE_UNKNOWN: "notice",
  MATCHUPS_MISSING: "technical",
  MATCHUPS_UNREADABLE: "technical",
  MATCHUP_ODD: "technical",
  MATCHUP_RESULT_MISSING: "technical",
  NOT_DRAFTED: "notice",
  PLAYER_INACTIVE: "technical",
  PLAYER_UNKNOWN: "player",
  PLAYOFFS_NOT_IMPORTED: "notice",
  PLAYOFF_ROUND_TYPE_UNKNOWN: "notice",
  PLAYOFF_SEED_TYPE_UNKNOWN: "notice",
  PLAYOFF_START_MISSING: "notice",
  PLAYOFF_TEAMS_MISSING: "notice",
  PLAYOFF_WEEKS_CAPPED: "notice",
  POSITION_LIMIT_UNKNOWN: "technical",
  PROJECTIONS_EMPTY: "notice",
  PROJECTIONS_MISSING: "notice",
  PROJECTIONS_OFFSEASON: "notice",
  PROJECTIONS_UNREADABLE: "technical",
  PROJECTION_ROWS_UNREADABLE: "technical",
  SCORING_VALUE_NOT_NUMBER: "scoring",
  SEASON_MISMATCH: "notice",
  SEASON_OVER: "technical",
  SETTING_DEFAULTED: "notice",
  SETTING_INFERRED: "conditional",
  TRADED_PICKS_MISSING: "technical",
  TRADED_PICKS_UNREADABLE: "technical",
  TRADED_PICK_DUPLICATE: "technical",
  TRADED_PICK_OUT_OF_RANGE: "technical",
  TRADES_DISABLED: "notice",
  TRADE_DEADLINE_UNKNOWN: "setting",
  TRADE_REVIEW_UNVERIFIED: "notice",
  TRANSACTIONS_MISSING: "technical",
  TRANSACTIONS_UNREADABLE: "technical",
  UNKNOWN_SLOT: "notice",
  USER_LOOKUP_FAILED: "team",
  USER_NOT_FOUND: "team",
  USER_NOT_IN_LEAGUE: "team",
  WAIVER_RESET_BEFORE_GAMES: "technical",
  WAIVER_TYPE_UNKNOWN: "technical",
  // The player-ID crosswalk (src/data/crosswalk.ts), on every import: its gaps show as the players they leave without data.
  ID_SOURCE_PARTIAL: "technical",
  ID_SOURCE_UNAVAILABLE: "technical",
  // The model inputs (src/server/modelInputs.ts, src/data/sleeperProjections.ts).
  ESPN_PROJECTIONS_UNAVAILABLE: "notice",
  FANTASYCALC_DYNASTY_UNAVAILABLE: "notice",
  FANTASYCALC_PLAYERS_UNAVAILABLE: "technical",
  FANTASYCALC_REDRAFT_UNAVAILABLE: "notice",
  FANTASYCALC_UNAVAILABLE: "notice",
  FANTASYCALC_VALUES_ESTIMATED: "notice",
  NFL_SCHEDULE_UNAVAILABLE: "notice",
  NO_SLEEPER_ID: "player",
  PROJECTIONS_WEEK_UNAVAILABLE: "notice",
  SEASON_NOT_STARTED: "notice",
  SEASON_PROJECTIONS_UNAVAILABLE: "technical",
  SEASON_WEEKS_UNKNOWN: "notice",
  SLEEPER_DOWN: "notice",
  SLEEPER_PROJECTIONS_UNAVAILABLE: "notice",
  SLEEPER_STATS_UNAVAILABLE: "notice",
  STATS_ROWS_UNREADABLE: "technical",
  STATS_WEEK_UNAVAILABLE: "notice",
  // Fleaflicker's and MFL's scoring (src/adapters/{fleaflicker,mfl}/scoringMap.ts; their imports come in Phase 5).
  SCORING_DEFINITION_ADJUSTED: "technical",
  SCORING_EMPTY: "notice",
  SCORING_POSITIONS_MERGED: "technical",
  SCORING_POSITION_UNSUPPORTED: "technical",
  SCORING_RULE_APPROXIMATE: "technical",
  SCORING_RULE_PARTIAL: "scoring",
  SCORING_RULE_UNMAPPED: "scoring",
};

/** A code's rule (a code this module doesn't know is technical). */
export function warningRule(code: string): WarningRule {
  return Object.hasOwn(WARNING_RULES, code) ? (WARNING_RULES[code] as WarningRule) : "technical";
}

/**
 * What a notice's words may read besides the warning itself (buildDataNotices passes it; without it a conditional code
 * whose condition is on the import stays technical, and the others take their general words).
 */
export interface NoticeContext {
  /** The import the warning came with (or the one the model inputs were built for). */
  snapshot?: Pick<LeagueSnapshot, "currentWeek" | "teams" | "players"> & Partial<Pick<LeagueSnapshot, "freeAgents">>;
  /** The user's team (null: not picked yet). */
  myTeamId?: string | null;
}

const REFRESH_LATER = "Refresh later to try again.";

/** The weeks a message names ("week 5", "weeks 1–3, 5", "weeks 5 and 7"): their words and numbers, else null. */
function weeksNamed(message: string): { text: string; one: boolean; weeks: number[] } | null {
  const m = /\b(weeks?) (\d+(?:[–-]\d+)?(?:(?:, | and )\d+(?:[–-]\d+)?)*)/.exec(message);
  if (!m) return null;
  const list = m[2] as string;
  const weeks = list.split(/, | and /).flatMap((part) => {
    const [from, to] = part.split(/[–-]/).map(Number);
    if (from === undefined || !Number.isInteger(from)) return [];
    if (to === undefined || !Number.isInteger(to) || to < from) return [from];
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  });
  const one = weeks.length === 1;
  return { text: `${one ? "week" : "weeks"} ${list}`, one, weeks };
}

/**
 * Sleeper's projections for some weeks didn't load (PROJECTIONS_WEEK_UNAVAILABLE). Those weeks are still projected, from
 * each player's other weeks: what they miss is the matchup adjustment (§6 week shape). Past weeks only (the lookback) feed
 * just an injured player's latest healthy projection.
 */
function projectionWeeksText(w: ImportWarning, ctx?: NoticeContext): string {
  const named = weeksNamed(w.message);
  const which = named?.text ?? "some weeks";
  const current = ctx?.snapshot?.currentWeek;
  if (named && named.weeks.length > 0 && current !== undefined && named.weeks.every((week) => week < current))
    return `Sleeper's projections for ${which} didn't load, so some injured players' projections may be a little off. ${REFRESH_LATER}`;
  return `Sleeper's projections for ${which} didn't load, so ${named?.one ? "that week skips" : "those weeks skip"} the matchup adjustment. ${REFRESH_LATER}`;
}

/** Sleeper's stats for some weeks didn't load (STATS_WEEK_UNAVAILABLE): those games miss players' season-to-date averages (§6 step 1), not the standings. */
function statsWeeksText(w: ImportWarning): string {
  const named = weeksNamed(w.message);
  return `Sleeper's stats for ${named?.text ?? "some weeks"} didn't load, so ${named?.one ? "that week's games don't" : "those weeks' games don't"} count toward players' season averages. ${REFRESH_LATER}`;
}

/** A whole ESPN response that couldn't be read (normalize.ts rowsOf: its path names the response, "…[2]"), not just some of its rows ("…[]"). */
const wholeResponse = (w: ImportWarning) => /\[\d+\]$/.test(w.platformPath ?? "");

/** No free agent came in at all: every position's list failed, or none could be read. */
const noFreeAgents = (ctx?: NoticeContext) => ctx?.snapshot?.freeAgents !== undefined && ctx.snapshot.freeAgents.length === 0;

/** ESPN's free agents that didn't load or couldn't be read: none at all, or some positions'. */
function freeAgentsText(ctx?: NoticeContext): string {
  return noFreeAgents(ctx)
    ? `ESPN's free agents didn't load, so free-agent pickups and streaming picks are missing. ${REFRESH_LATER}`
    : `Some of ESPN's free-agent lists didn't load, so free-agent pickups may miss players at some positions. ${REFRESH_LATER}`;
}

/** No injured rostered player has a return week: none of ESPN's player cards could be read. */
function noReturnWeeks(ctx?: NoticeContext): boolean {
  const s = ctx?.snapshot;
  if (!s) return false;
  const injured = s.teams
    .flatMap((t) => [...t.roster, ...t.ir])
    .map((id) => s.players[id])
    .filter((p): p is PlayerInfo => p !== undefined && p.injury !== "ACTIVE");
  return injured.length > 0 && injured.every((p) => p.injuryReturnWeek === undefined);
}

const SLOT_UNKNOWN = "Your league has a lineup spot Offer Sheet doesn't recognize, so lineups leave it empty.";
const RETURN_WEEKS_DEFAULT = `injured players' return weeks use our usual recovery times. ${REFRESH_LATER}`;
const INJURY_DETAILS = `ESPN's injury details didn't load, so ${RETURN_WEEKS_DEFAULT}`;

/**
 * Sleeper's settings read from an undocumented code or a layout its help center doesn't cover (SETTING_INFERRED), by the
 * setting's path: the ones the playoff odds or the deadline read. The waiver reset's reading with divisions only changes
 * who claims a free agent first, so it stays technical, as does a path this module doesn't know.
 */
const INFERRED: Readonly<Record<string, string>> = {
  "settings.trade_deadline": "We read your league as having no trade deadline, since Sleeper doesn't say clearly. Check your league's settings.",
  "settings.playoff_round_type": "We read your playoff rounds as two weeks each, since Sleeper doesn't say clearly. Check your league's playoff settings.",
  "settings.divisions": "We assume your division winners get the top playoff seeds, since Sleeper doesn't say for leagues like yours. Check your league's playoff settings.",
};

/** Sleeper's settings left out and read as their usual default (SETTING_DEFAULTED), by the setting's path. */
const DEFAULTED: Readonly<Record<string, string>> = {
  "settings.playoff_round_type": "Your league doesn't say how long its playoff rounds last, so Offer Sheet assumes one week each.",
  "settings.playoff_seed_type": "Your league doesn't say how its playoff bracket is seeded, so Offer Sheet assumes standard seeding with no re-seeding.",
  "settings.league_average_match": "Your league doesn't say whether teams also play the league median each week, so Offer Sheet assumes they don't.",
};

/**
 * The words of every "notice" and "conditional" code (a conditional one's null: technical after all). Nothing here quotes a
 * code, a path, a stat ID or a reason such as an HTTP status: those stay in the technical details.
 */
export const NOTICE_TEXT: Readonly<Record<string, (w: ImportWarning, ctx?: NoticeContext) => string | null>> = {
  ESPN_EMPTY_ROSTERS: () => "Every roster is empty, so your league may not have drafted yet.",
  ESPN_FREE_AGENTS_UNAVAILABLE: (_, ctx) => freeAgentsText(ctx),
  // Its twin's words when a whole list couldn't be read, or no free agent came in at all; a few unreadable rows are technical.
  ESPN_FREE_AGENTS_UNREADABLE: (w, ctx) => (wholeResponse(w) || noFreeAgents(ctx) ? freeAgentsText(ctx) : null),
  // Only when the league starts a head coach (the lineup slot's warning): rostered head coaches change nothing otherwise.
  ESPN_HC_UNMAPPED: (w) => (w.platformPath?.startsWith("settings.rosterSettings.lineupSlotCounts") ? "Your league starts a head coach, which Offer Sheet doesn't support yet, so lineups leave that spot empty." : null),
  ESPN_HOME_TEAM_BONUS: () => "Your league gives the home team bonus points, which the playoff odds don't add, so close games may be a little off.",
  ESPN_IDP_UNVERIFIED: () => "Your league starts individual defensive players. Offer Sheet hasn't been checked on an ESPN league like that yet, so their projections may be off.",
  ESPN_NO_PLAYOFF_WEEKS: () => "ESPN doesn't list any playoff weeks for your league, so the odds give the title to the regular season's leader. Check your league's playoff settings.",
  ESPN_PLAYER_CARDS_UNAVAILABLE: () => INJURY_DETAILS,
  // Its twin's words when a whole batch couldn't be read, or no injured player got a return week; a few unreadable rows are technical.
  ESPN_PLAYER_CARDS_UNREADABLE: (w, ctx) => (wholeResponse(w) || noReturnWeeks(ctx) ? INJURY_DETAILS : null),
  ESPN_PLAYOFF_BRACKET_UNCLEAR: () => "Your league's playoff teams and rounds don't make a standard bracket, so playoff byes and title odds may be off.",
  // Only when one of them was on the user's roster (the warning's teams): the adapter leaves such a player out.
  ESPN_POSITION_UNKNOWN: (w, ctx) => (ctx?.myTeamId && w.teams?.includes(ctx.myTeamId) ? "A player on your roster has a position Offer Sheet doesn't recognize, so he's left out." : null),
  ESPN_SCHEDULE_UNAVAILABLE: () => `ESPN's NFL schedule didn't load, so ${RETURN_WEEKS_DEFAULT}`,
  ESPN_SCHEDULE_UNREADABLE: () => `ESPN's NFL schedule didn't load, so ${RETURN_WEEKS_DEFAULT}`,
  ESPN_SCORING_TYPE: () => "Your league isn't a head-to-head points league, which is what Offer Sheet is built for, so its numbers may be off.",
  ESPN_SLOT_UNKNOWN: () => SLOT_UNKNOWN,
  DIVISION_MISSING: () => "Some teams in your league don't say which division they're in, so the playoff odds may seed division winners wrongly.",
  LEAGUE_TYPE_UNKNOWN: () => "Sleeper doesn't say whether your league is redraft, keeper or dynasty, so Offer Sheet treats it as redraft.",
  NOT_DRAFTED: () => "Your league hasn't finished its draft, so rosters may be empty.",
  PLAYOFFS_NOT_IMPORTED: () => "Offer Sheet doesn't read Sleeper's playoff games yet, so once a playoff round has been played, title odds show as unknown.",
  PLAYOFF_ROUND_TYPE_UNKNOWN: () => "Sleeper reports your playoff rounds in a way Offer Sheet doesn't recognize, so it assumes each round lasts one week.",
  PLAYOFF_SEED_TYPE_UNKNOWN: () => "Sleeper reports your playoff seeding in a way Offer Sheet doesn't recognize, so it assumes a fixed bracket with no re-seeding.",
  PLAYOFF_START_MISSING: () => "Your league doesn't say when its playoffs start, so Offer Sheet assumes week 15.",
  PLAYOFF_TEAMS_MISSING: () => "Your league doesn't say how many teams make the playoffs, so the odds give the title to the regular season's leader.",
  PLAYOFF_WEEKS_CAPPED: () => "Your playoffs would run past the NFL season's last week, so the weeks after it are left out.",
  PROJECTIONS_EMPTY: () => "Sleeper hasn't published projections for the coming weeks yet, so free agents aren't listed.",
  PROJECTIONS_MISSING: () => `Sleeper's projections didn't load, so free agents aren't listed. ${REFRESH_LATER}`,
  PROJECTIONS_OFFSEASON: () => "It's the offseason, so there are no weekly projections and free agents aren't listed.",
  // The adapter's own words: which season was asked for and which one the league is (plain already).
  SEASON_MISMATCH: (w) => w.message,
  // A setting the league leaves out: what Offer Sheet assumes instead (the adapter's own words for one we don't know).
  SETTING_DEFAULTED: (w) => DEFAULTED[w.platformPath ?? ""] ?? w.message,
  // A setting read from an undocumented code: only the deadline's and the playoffs' (the waiver reset's is technical).
  SETTING_INFERRED: (w) => INFERRED[w.platformPath ?? ""] ?? null,
  TRADES_DISABLED: () => "Trading is turned off in your league, so no trade can go through.",
  TRADE_REVIEW_UNVERIFIED: () => "Your league doesn't say whether trades are reviewed, so Offer Sheet assumes they aren't.",
  UNKNOWN_SLOT: () => SLOT_UNKNOWN,
  ESPN_PROJECTIONS_UNAVAILABLE: () => "ESPN's own projections didn't load, so projections use Sleeper's alone.",
  FANTASYCALC_DYNASTY_UNAVAILABLE: () => `FantasyCalc's dynasty values didn't load, so this season's values stand in for long-term value. ${REFRESH_LATER}`,
  FANTASYCALC_REDRAFT_UNAVAILABLE: () => `FantasyCalc's values for this season didn't load, so long-term values stand in for how managers see a trade. ${REFRESH_LATER}`,
  FANTASYCALC_UNAVAILABLE: () => `FantasyCalc's trade values didn't load, so trade ideas can't weigh trade value. ${REFRESH_LATER}`,
  // The League page says it in its own banner (leagueView.ts valuesBanner); the Import Report lists it here.
  FANTASYCALC_VALUES_ESTIMATED: () => "FantasyCalc didn't answer, so trade values are our own estimates for now. Read trade ideas as rough.",
  NFL_SCHEDULE_UNAVAILABLE: () => `The NFL schedule didn't load, so bye weeks are unknown and every remaining week counts as a game. ${REFRESH_LATER}`,
  PROJECTIONS_WEEK_UNAVAILABLE: projectionWeeksText,
  SEASON_NOT_STARTED: () => "The season hasn't started yet, so nothing is projected.",
  // The server's own words ("… so projections run through NFL week 18."): plain already.
  SEASON_WEEKS_UNKNOWN: (w) => w.message,
  SLEEPER_DOWN: () => "Sleeper stopped answering, so some of its projections or stats are missing and projections are less precise than usual. Refresh in a few minutes.",
  SLEEPER_PROJECTIONS_UNAVAILABLE: () => `Sleeper's weekly projections didn't load, so projections are less precise than usual. ${REFRESH_LATER}`,
  SLEEPER_STATS_UNAVAILABLE: () => `Sleeper's stats didn't load, so players' games so far this season don't count toward their projections. ${REFRESH_LATER}`,
  STATS_WEEK_UNAVAILABLE: statsWeeksText,
  SCORING_EMPTY: () => "Your league's scoring rules couldn't be read, so every player would score 0.",
};

/** One notice per setting the platform doesn't expose or we couldn't read (LeagueSettings.unknownSettings). */
export const UNKNOWN_SETTING_NOTICE: Readonly<Record<UnknownSetting, string>> = {
  tradeDeadline: "Your league's trade deadline couldn't be read, so Offer Sheet treats trades as open all season. Check the deadline in your league's settings.",
  tradeReview: "How your league reviews trades couldn't be read, so Offer Sheet assumes trades aren't reviewed.",
  playoffs: "Your league's playoff settings couldn't be read, so playoff and title odds may be off. Check them in your league's settings.",
  playoffSeeding: "Whether your playoffs re-seed after each round couldn't be read, so Offer Sheet assumes a fixed bracket.",
  seedingTiebreaker: "Offer Sheet couldn't use your league's rule for breaking ties in the standings, so it breaks them by points for.",
};

/** "Pick your team …": the end of every "Your team" explanation below. */
const PICK_YOUR_TEAM = "Pick your team here so trade ideas are for your team.";

/**
 * Why the import couldn't tell which team is the user's ("team" codes), in plain words, for the Import Report's "Your team"
 * card while no team is picked: a Sleeper username we couldn't find or look up, one without a team in this league, ESPN
 * cookies whose account owns no team here, a team id that isn't in the league. Null when no such warning came (the
 * platform doesn't say for this kind of import). The username, when the warning quotes it, is the one the user typed.
 */
export function myTeamWarningText(warnings: readonly ImportWarning[] | undefined): string | null {
  for (const w of warnings ?? []) {
    const name = /"([^"]+)"/.exec(w.message)?.[1];
    switch (w.code) {
      case "USER_NOT_FOUND":
        return `We couldn't find a Sleeper user named ${name ? `"${name}"` : "like that"}, so we couldn't tell which team is yours. Check the username, or ${lowerFirst(PICK_YOUR_TEAM)}`;
      case "USER_LOOKUP_FAILED":
        return `Sleeper didn't answer when we looked up ${name ? `"${name}"` : "your username"}, so we couldn't tell which team is yours. Refresh league data to try again, or pick your team here.`;
      case "USER_NOT_IN_LEAGUE":
        return `That Sleeper username doesn't manage a team in this league, so we couldn't tell which team is yours. ${PICK_YOUR_TEAM}`;
      case "ESPN_MY_TEAM_NOT_FOUND":
        return `The ESPN account your cookies belong to doesn't own a team in this league, so we couldn't tell which team is yours. ${PICK_YOUR_TEAM}`;
      case "ESPN_MY_TEAM_UNKNOWN":
        return `The team you picked (or the one in your link) isn't in this league, so we couldn't tell which team is yours. ${PICK_YOUR_TEAM}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The League model's warnings (plain strings: src/engine/league.ts modelWarnings, season.ts oddsSkippedWarning, …)

/** league.ts BLEND_OFF_WARNING, restated so this module loads no engine code (notices.test.ts checks they match). */
export const BLEND_OFF_WARNING = "The trade-market blend is off: FantasyCalc's redraft values didn't load.";
/** league.ts BLEND_OFF_CURVE_WARNING, restated likewise. */
export const BLEND_OFF_CURVE_WARNING =
  "The trade-market blend is off: FantasyCalc didn't answer and its newest values are too old, so projections aren't pulled toward the trade market.";

/**
 * How a League model warning is shown: "players" for its rostered players without projections (judged one by one, like
 * any player: playerIssues reads the same League model), technical for free agents without projections and for which
 * projections were used (the Import Report's data card says that in its own words), else a notice in the plain words below,
 * or the model's own (written for the page: the odds left out, projections prepared for another week, Sleeper's
 * projections missing …).
 */
export function modelWarningRule(message: string): { rule: "notice"; text: string } | { rule: "technical" | "player" } {
  if (/^No projections for \d+ rostered players?\b/.test(message)) return { rule: "player" };
  if (/^No projections for \d+ free agents?\b/.test(message)) return { rule: "technical" };
  if (/^ESPN's projections differ from Sleeper's\b/.test(message) || /^ESPN's and Sleeper's projections couldn't be compared\b/.test(message)) return { rule: "technical" };
  if (message === BLEND_OFF_WARNING) return { rule: "notice", text: `FantasyCalc's values for this season didn't load, so projections aren't adjusted toward the trade market. ${REFRESH_LATER}` };
  if (message === BLEND_OFF_CURVE_WARNING) return { rule: "notice", text: "FantasyCalc didn't answer and its newest values are too old, so projections aren't adjusted toward the trade market." };
  return { rule: "notice", text: message };
}

// ---------------------------------------------------------------------------------------------
// Scoring rules we can't count

/**
 * The ESPN scoring rules the adapter can't count, in plain words, by ESPN statId (src/adapters/espn/scoringMap.ts
 * ESPN_READINGS of kind "none"; notices.test.ts checks every one has a name). Ranges of ids share one name.
 */
const ESPN_UNCOUNTED_NAMES: Readonly<Record<number, string>> = {
  21: "completion percentage",
  39: "rushing yards per carry",
  59: "receiving yards after the catch",
  60: "receiving yards per catch",
  65: "passing fumbles",
  66: "rushing fumbles",
  67: "receiving fumbles",
  69: "passing fumbles lost",
  70: "rushing fumbles lost",
  71: "receiving fumbles lost",
  93: "blocked-kick return touchdowns",
  100: "half sacks",
  105: "return touchdowns",
  112: "run stuffs",
  126: "points allowed per game",
  137: "yards allowed per game",
  138: "net punts",
  139: "punt yards",
  140: "punts inside the 10",
  141: "punts inside the 20",
  142: "blocked punts",
  143: "punts returned",
  144: "punt return yards allowed",
  145: "punt touchbacks",
  146: "fair catches",
  147: "punting average",
  197: "D/ST points allowed per game",
  204: "offensive 2-point returns",
  207: "offensive 1-point safeties",
  208: "defensive 1-point safeties",
  209: "1-point safeties",
  215: "missed field-goal yards",
  216: "attempted field-goal yards",
};

const ESPN_UNCOUNTED_RANGES: ReadonlyArray<{ from: number; to: number; name: string }> = [
  { from: 148, to: 154, name: "punting-average bonuses" },
  { from: 155, to: 174, name: "head-coach team results" },
  { from: 175, to: 186, name: "touchdown-length bonuses" },
  { from: 223, to: 228, name: "missed field-goal yards" },
  { from: 229, to: 234, name: "attempted field-goal yards" },
];

/** An uncounted ESPN rule's plain name, by statId (undefined: a stat ESPN's table doesn't name, which we don't know). */
export function espnUncountedName(statId: number): string | undefined {
  return ESPN_UNCOUNTED_NAMES[statId] ?? ESPN_UNCOUNTED_RANGES.find((r) => statId >= r.from && statId <= r.to)?.name;
}

/**
 * The common ones among them (§5.1: "a common rule": the standard categories, passing, rushing and receiving yards and
 * TDs, receptions, interceptions, fumbles lost, 2-point conversions, kicking makes and misses, D/ST sacks, takeaways, TDs
 * and points allowed): fumbles and fumbles lost by play type, and all return touchdowns. Every other uncounted ESPN rule
 * is rare, unless it has scored this season.
 */
export const ESPN_COMMON_UNCOUNTED: ReadonlySet<number> = new Set([65, 66, 67, 69, 70, 71, 105]);

/** The standard categories among Sleeper's stat keys (a Sleeper rule with a value we couldn't read; the same list as above). */
const COMMON_STAT_KEY = /^(pass_yd|pass_td|pass_int|pass_2pt|rush_yd|rush_td|rush_2pt|rec|rec_yd|rec_td|rec_2pt|fum|fum_lost|fgm|fgmiss|fga|xpm|xpmiss|sack|int|fum_rec|ff|safe|blk_kick|def_td|def_st_td|st_td|bonus_rec_(?:te|rb|wr))$|^(?:fgm|fgmiss)_|^pts_allow/;

/** The name of a rule we can't tell apart from others (an ESPN stat we don't know, a Sleeper rule without a key). */
const UNRECOGNIZED_RULE = "an unrecognized rule";
const UNNAMED_RULE = "a scoring rule";
/** Such names counted, when there are several ("two unrecognized rules"): each is a rule of its own, not one name. */
const GENERIC_PLURAL: Readonly<Record<string, string>> = { [UNRECOGNIZED_RULE]: "unrecognized rules", [UNNAMED_RULE]: "other scoring rules" };

/** One scoring rule we can't count, as the notices say it. */
export interface UncountedRule {
  /** Plain words ("1-point safeties"). */
  name: string;
  /** Its points (per unit), when known. */
  points?: number;
  /** A standard category; null: we can't tell what the rule is. */
  common: boolean | null;
  /** It scored this season in this league (Scoring.unmapped scoredThisSeason); null: unknown. */
  scored: boolean | null;
}

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** A rule another platform's adapter couldn't count (Phase 5): its label up to the reason, never its key. */
function otherPlatformName(label: string): string {
  const name = label.replace(/^\(partly mapped\) /, "").split(/: | \[/)[0]?.trim() ?? "";
  return name ? lowerFirst(name) : UNNAMED_RULE;
}

/** Every scoring rule the import couldn't count (Scoring.unmapped; Sleeper's rules with a value that isn't a number). */
export function uncountedRules(snapshot: { platform: Platform; settings: { scoring: Pick<Scoring, "unmapped"> }; warnings?: readonly ImportWarning[] }): UncountedRule[] {
  const out: UncountedRule[] = [];
  for (const u of snapshot.settings.scoring.unmapped ?? []) {
    const scored = typeof u.scoredThisSeason === "boolean" ? u.scoredThisSeason : null;
    const points = Number.isFinite(u.points) ? { points: u.points } : {};
    if (snapshot.platform === "espn") {
      // ESPN's key is its statId (an older import may prefix it).
      const statId = Number(/(\d+)$/.exec(u.platformKey)?.[1]);
      const name = Number.isInteger(statId) ? espnUncountedName(statId) : undefined;
      out.push(name ? { name, ...points, common: ESPN_COMMON_UNCOUNTED.has(statId), scored } : { name: UNRECOGNIZED_RULE, ...points, common: null, scored });
    } else out.push({ name: otherPlatformName(u.label), ...points, common: null, scored });
  }
  for (const w of snapshot.warnings ?? []) {
    if (w.code !== "SCORING_VALUE_NOT_NUMBER") continue;
    const key = /^scoring_settings\.(.+)$/.exec(w.platformPath ?? "")?.[1];
    out.push(key ? { name: lowerFirst(statLabel(key)), common: COMMON_STAT_KEY.test(key), scored: null } : { name: UNNAMED_RULE, common: null, scored: null });
  }
  return out;
}

/**
 * Whether an uncounted rule is a notice (§5.1): it scored this season, or it's common; one we can't tell is a notice unless
 * we know it hasn't scored. Everything else is the quiet line. A name matters when any of its rules does (byName).
 */
export function uncountedMatters(r: Pick<UncountedRule, "common" | "scored">): boolean {
  return r.scored === true || r.common === true || (r.common === null && r.scored !== false);
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const countWord = (n: number) => NUMBER_WORDS[n] ?? String(n);
const upperFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "a", "a and b", "a, b and c" (or "or"); past `max`, "… and 2 more". */
function listText(items: readonly string[], conjunction: "and" | "or" = "and", max = 4): string {
  const shown = items.length > max ? [...items.slice(0, max), `${items.length - max} more`] : [...items];
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} ${conjunction} ${shown.at(-1)}` : (shown[0] ?? "");
}

/** One plain name among the uncounted rules: how many rules it counts as, its points when they're all the same, whether it matters. */
interface NamedRules {
  name: string;
  points?: number;
  /** Rules it stands for in the count: 1 per name (a range of ids is one rule), each rule of a generic name. */
  count: number;
  /** Any of its rules matters (uncountedMatters): then the name is a notice, and never also in the quiet line. */
  matters: boolean;
}

/**
 * The rules grouped by plain name first (a range of ids shares one; finding of the review: grouped after the notice-or-quiet
 * split, one name could be in both lines), then judged: a name matters when any of its rules does.
 */
function byName(rules: readonly UncountedRule[]): NamedRules[] {
  const groups = new Map<string, { points: Set<number | undefined>; rules: number; matters: boolean }>();
  for (const r of rules) {
    const g = groups.get(r.name) ?? { points: new Set<number | undefined>(), rules: 0, matters: false };
    g.points.add(r.points);
    g.rules++;
    g.matters ||= uncountedMatters(r);
    groups.set(r.name, g);
  }
  return [...groups].map(([name, g]) => {
    const points = g.points.size === 1 ? [...g.points][0] : undefined;
    const generic = Object.hasOwn(GENERIC_PLURAL, name);
    const shown = generic && g.rules > 1 ? `${countWord(g.rules)} ${GENERIC_PLURAL[name]}` : name;
    return { name: shown, ...(points !== undefined ? { points } : {}), count: generic ? g.rules : 1, matters: g.matters };
  });
}

const ruleCount = (named: readonly NamedRules[]) => named.reduce((n, r) => n + r.count, 0);

/** The scoring notice ("Offer Sheet doesn't count one of your league's scoring rules yet, …"), or null. */
export function uncountedNoticeText(rules: readonly UncountedRule[]): string | null {
  const named = byName(rules).filter((r) => r.matters);
  if (!named.length) return null;
  const n = ruleCount(named);
  const one = n === 1;
  const list = listText(named.map((r) => (r.points !== undefined ? `${r.name} (${fmtSigned(r.points)})` : r.name)));
  return `Offer Sheet doesn't count ${one ? "one" : countWord(n)} of your league's scoring rules yet, so projections leave ${one ? "its" : "their"} points out: ${list}.`;
}

/** The quiet line for rare uncounted rules (the planner's words: "Two rare rules aren't counted: … They almost never happen."), or null. */
export function quietScoringLine(rules: readonly UncountedRule[]): string | null {
  const named = byName(rules).filter((r) => !r.matters);
  if (!named.length) return null;
  const n = ruleCount(named);
  const one = n === 1;
  return `${upperFirst(countWord(n))} rare ${one ? "rule isn't" : "rules aren't"} counted: ${listText(named.map((r) => r.name), "and", 8)}. ${one ? "It almost never happens." : "They almost never happen."}`;
}

// ---------------------------------------------------------------------------------------------
// Players

/** What's wrong with a player's data, most serious first (each player is said once, under his most serious). */
export const PLAYER_ISSUES = ["missing", "noProjections", "noSleeper", "conflict", "byName"] as const;
export type PlayerIssue = (typeof PLAYER_ISSUES)[number];

/** The players a player-level warning names: its own ids (ImportWarning.players), else every player the message names ("Name ("). */
function namedPlayers(w: ImportWarning, players: Readonly<Record<string, PlayerInfo>>): string[] {
  if (Array.isArray(w.players)) return w.players.filter((id) => players[id] !== undefined);
  return Object.values(players)
    .filter((p) => p.name && w.message.includes(`${p.name} (`))
    .map((p) => p.id);
}

/** Whether a player's model inputs hold anything a base rate can come from (a projection, a season line, a game played). */
function hasAnyProjection(p: PlayerInputs): boolean {
  const some = (weeks: Readonly<Record<number, number | null>> | undefined) => Object.values(weeks ?? {}).some((v) => typeof v === "number" && Number.isFinite(v));
  return some(p.sleeper) || some(p.espn) || typeof p.sleeperSeasonPerGame === "number" || Object.keys(p.actual ?? {}).length > 0;
}

/** A canonical id is a Sleeper id unless it is `${platform}:${id}` (§4; src/server/modelInputs.ts isSleeperId). */
const isSleeperId = (id: string) => !id.includes(":");

/** The League model, as the notices read it (the League page only; the Import Report has none). */
export interface NoticeModel {
  /** LeagueModel.warnings. */
  warnings: readonly string[];
  /** LeagueModel.players: a rostered player without one, or whose base rate has no source, has no projections; ros.total is his rest-of-season points. */
  players: Readonly<Record<string, { base: { source: string }; ros?: { total: number } } | undefined>>;
  /** Player id → the team he likely starts for (leagueView.likelyStarters after its pickups, a free agent it picks up included); read only when needed. */
  likelyStarters: () => ReadonlyMap<string, string>;
  /** The positions a team streams (LeagueModel.streaming.byTeam): a streamed lineup spot needs no rostered player. */
  streams?: (teamId: string) => readonly Pos[];
}

export interface NoticeInput {
  snapshot: Pick<LeagueSnapshot, "platform" | "currentWeek" | "settings" | "teams" | "players" | "schedule" | "warnings"> & Partial<Pick<LeagueSnapshot, "freeAgents">>;
  /** The user's team (null: not picked yet: then no player is on "your roster"). */
  myTeamId: string | null;
  /**
   * The model inputs, once loaded and only while fresh for this snapshot (built for this very league data: the caller's
   * job, modelStore.modelForSnapshot): their warnings, which players have anything to project from (every rostered player
   * has an entry then, so one without has nothing), and FantasyCalc's values (a player without projections judged by value).
   */
  inputs?: (Pick<ModelInputs, "warnings" | "players"> & Partial<Pick<ModelInputs, "market">>) | null;
  /** The League model (the League page). */
  model?: NoticeModel | null;
}

export interface Notice {
  /** Unique in the list: the warning's code, "setting:…", "scoring", "players:…", "model:…" or the schedule's. */
  key: string;
  text: string;
}

export interface DataNotices {
  /** In order: the import's, the unknown settings, scoring, players, the model inputs', the League model's; each text once. */
  notices: Notice[];
  /** The scoring section's lines: the notice about rules that matter (also in `notices`), and the quiet line for rare ones. */
  scoring: { notice: string | null; quiet: string | null };
  /** Players on other teams' rosters with a data problem nobody could judge (no League model: likely starters unknown); in the technical details only. */
  unjudged: number;
  /**
   * Rostered players (every team's) without projections, by the League model or the fresh model inputs, for the technical
   * details; empty when nobody is projected (the season hasn't started, or the projections didn't load: their own notice
   * says so) or when neither has loaded.
   */
  noProjections: string[];
}

/** Each player with a data problem, under his most serious one, and the rostered players without projections. */
function playerIssues(input: NoticeInput): { issues: Map<string, PlayerIssue>; noProjections: string[] } {
  const { snapshot, inputs, model } = input;
  const issues = new Map<string, PlayerIssue>();
  const note = (id: string, issue: PlayerIssue) => {
    const had = issues.get(id);
    if (had === undefined || PLAYER_ISSUES.indexOf(issue) < PLAYER_ISSUES.indexOf(had)) issues.set(id, issue);
  };
  const players = snapshot.players ?? {};
  // No projections: the League model's word (no model, or a base rate without a source), else the fresh inputs' (no
  // entry, or one with nothing to project from); unknown before either has loaded.
  const unprojected = (id: string): boolean | null => {
    if (model) {
      const pm = model.players[id];
      return !pm || pm.base.source === "none";
    }
    if (inputs) {
      const pin = inputs.players?.[id];
      return !pin || !hasAnyProjection(pin);
    }
    return null;
  };
  const unprojectedIds: string[] = [];
  let someProjected = false;
  for (const t of snapshot.teams)
    for (const id of [...t.roster, ...t.ir, ...t.taxi]) {
      // No player details at all (Sleeper's PLAYER_UNKNOWN; ESPN's rosters never keep one): he's left out.
      if (!players[id]) {
        note(id, "missing");
        continue;
      }
      const none = unprojected(id);
      if (none === true) unprojectedIds.push(id);
      else if (none === false) someProjected = true;
    }
  // When nobody is projected (the season hasn't started, the projections didn't load), that source's own notice says so.
  const noProjections = someProjected ? unprojectedIds : [];
  for (const id of noProjections) note(id, "noProjections");
  // Not in Sleeper's data (an `${platform}:` id: NO_SLEEPER_ID, ESPN_ID_COLLISION): rostered players and free agents alike,
  // but ESPN's team units (a negative ESPN id: a team QB, which Sleeper never lists, by design: ESPN_TQB_AS_QB).
  for (const id of Object.keys(players)) if (!isSleeperId(id) && !id.startsWith("espn:-")) note(id, "noSleeper");
  for (const w of snapshot.warnings ?? []) {
    if (w.code === "ESPN_ID_CONFLICT") for (const id of namedPlayers(w, players)) note(id, "conflict");
    if (w.code === "ESPN_PLAYER_MATCHED_BY_NAME") for (const id of namedPlayers(w, players)) note(id, "byName");
  }
  return { issues, noProjections };
}

/** FantasyCalc's values for this season (§9): a keeper league's redraft list, a dynasty league's season list, else the league's own. */
function seasonValues(market: MarketInputs | null | undefined): Readonly<Record<string, number>> | undefined {
  return market ? (market.redraftValues ?? market.seasonValues ?? market.values) : undefined;
}

/**
 * Whether another team's player without projections would likely start for it (§5.1: "a likely starter on any roster"),
 * judged without his points, since the League page's likelyStarters reads the points he doesn't have (a review of
 * Phase 7b: a team's RB1 without projections was never said anywhere). Either his team starts his position in a lineup spot
 * only that position takes, and has fewer other projected players there on its active roster than such spots (a position
 * it streams needs none: the streaming row fills it); or FantasyCalc values him this season at least as high as one of its
 * likely starters at his position (a likely starter it doesn't value counts as 0). A taxi player never starts.
 */
function startsWithoutProjections(id: string, teamId: string, input: NoticeInput, likely: ReadonlyMap<string, string>): boolean {
  const { snapshot, inputs, model } = input;
  const info = snapshot.players[id];
  const team = snapshot.teams.find((t) => t.id === teamId);
  if (!model || !info || !team || team.taxi.includes(id)) return false;
  if (team.roster.includes(id)) {
    const streamed = model.streams?.(teamId) ?? [];
    const others = team.roster.filter((pid) => pid !== id && (model.players[pid]?.ros?.total ?? 0) > 0).map((pid) => snapshot.players[pid]?.pos);
    for (const pos of new Set([info.pos, ...info.eligible])) {
      if (streamed.includes(pos)) continue;
      const spots = snapshot.settings.lineup.reduce((n, s) => n + (s.eligible.length === 1 && s.eligible[0] === pos ? s.count : 0), 0);
      if (spots > 0 && others.filter((p) => p === pos).length < spots) return true;
    }
  }
  const values = seasonValues(inputs?.market);
  const his = values?.[id];
  if (his === undefined) return false;
  for (const [pid, t] of likely) if (t === teamId && pid !== id && snapshot.players[pid]?.pos === info.pos && his >= (values?.[pid] ?? 0)) return true;
  return false;
}

function issueText(issue: PlayerIssue, labels: readonly string[], platform: Platform): string {
  const one = labels.length === 1;
  switch (issue) {
    case "missing":
      return `${one ? "A player" : `${labels.length} players`} on your roster came without any player details, so ${one ? "he's" : "they're"} left out.`;
    case "noProjections":
      return `We have no projections for ${listText(labels, "or")}, so ${one ? "he counts" : "they count"} as 0 points.`;
    case "noSleeper":
      return `We couldn't find ${listText(labels, "or")} in Sleeper's data, so ${one ? "his" : "their"} projections ${platform === "espn" ? "come from ESPN alone" : "may be incomplete"}.`;
    case "conflict":
      return `Our data sources disagree about who ${listText(labels)} ${one ? "is" : "are"}, so check ${one ? "his" : "their"} projections.`;
    case "byName":
      return `We could only identify ${listText(labels)} by name, position and team, so check ${one ? "his" : "their"} projections.`;
  }
}

/** The player notices: one per kind of problem, naming the players on the user's roster and the likely starters it affects. */
function playerNotices(input: NoticeInput, issues: ReadonlyMap<string, PlayerIssue>): { notices: Notice[]; unjudged: number } {
  const { snapshot, myTeamId, model } = input;
  if (!issues.size) return { notices: [], unjudged: 0 };
  const teamOf = new Map<string, string>();
  for (const t of snapshot.teams) for (const id of [...t.roster, ...t.ir, ...t.taxi]) if (!teamOf.has(id)) teamOf.set(id, t.id);
  const teamName = (id: string) => (id === myTeamId ? "your team" : (snapshot.teams.find((t) => t.id === id)?.name ?? `Team ${id}`));
  let starters: ReadonlyMap<string, string> | null = null;
  const likely = () => (starters ??= model ? model.likelyStarters() : new Map<string, string>());
  const byIssue = new Map<PlayerIssue, string[]>();
  let unjudged = 0;
  for (const [id, issue] of issues) {
    const team = teamOf.get(id);
    let where: string | null = null;
    if (team !== undefined && team === myTeamId) where = "your team";
    else if (model) {
      const starts = likely().get(id);
      if (starts !== undefined) where = starts === team ? teamName(starts) : `a pickup for ${teamName(starts)}`;
      // Our points never make a player without projections a likely starter: he's judged without them.
      else if (issue === "noProjections" && team !== undefined && startsWithoutProjections(id, team, input, likely())) where = teamName(team);
    }
    // Without the League model, another team's player could be a likely starter (one without player details can't be judged at all).
    else if (team !== undefined && issue !== "missing") unjudged++;
    if (where === null) continue;
    const p = snapshot.players[id];
    const label = p ? `${p.name} (${posLabel(p.pos, snapshot.platform)}, ${where})` : where;
    byIssue.set(issue, [...(byIssue.get(issue) ?? []), label]);
  }
  const notices: Notice[] = [];
  for (const issue of PLAYER_ISSUES) {
    const labels = byIssue.get(issue);
    if (labels?.length) notices.push({ key: `players:${issue}`, text: issueText(issue, labels, snapshot.platform) });
  }
  return { notices, unjudged };
}

// ---------------------------------------------------------------------------------------------
// The schedule (the Import Report only: the League page's standings notes say it)

/** "week 9", "weeks 9 and 11", "weeks 9–11". */
function weekWords(weeks: readonly number[]): string {
  const runs = weekRuns(weeks).map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`));
  return `${weeks.length === 1 ? "week" : "weeks"} ${listText(runs, "and", 8)}`;
}

/**
 * The remaining regular-season weeks without a matchup, said once (the Season card lists only the weeks that loaded). As
 * the season simulation reads them (season.ts oddsSkippedWarning): with no game left to play in any remaining week, there
 * are no playoff odds at all; otherwise only those weeks are left out of them.
 */
function scheduleNotices(snapshot: NoticeInput["snapshot"]): Notice[] {
  const out: Notice[] = [];
  const st = snapshot.settings;
  if (!st.pointsOnly) {
    const remaining = new Set(st.regularSeasonWeeks.filter((w) => w >= snapshot.currentWeek));
    const covered = new Set(snapshot.schedule.flatMap((m) => m.weeks ?? [m.week]));
    const gaps = [...remaining].filter((w) => !covered.has(w)).sort((a, b) => a - b);
    if (gaps.length) {
      const teams = new Set(snapshot.teams.map((t) => t.id));
      const toPlay = snapshot.schedule.some(
        (m) => !m.isPlayoff && m.decided !== true && m.teamB !== null && m.teamA !== m.teamB && teams.has(m.teamA) && teams.has(m.teamB) && (m.weeks ?? [m.week]).some((w) => remaining.has(w)),
      );
      out.push({
        key: "schedule-gaps",
        text: toPlay
          ? `Your league's schedule has no matchups in ${weekWords(gaps)}, so ${gaps.length === 1 ? "that week is" : "those weeks are"} left out of the playoff odds.`
          : `Your league's schedule is missing the rest of the regular season, so there are no playoff odds for now. ${REFRESH_LATER}`,
      });
    }
  }
  if (snapshot.schedule.some((m) => m.isPlayoff && m.decided === true && !m.result && m.teamB !== null))
    out.push({ key: "playoff-results", text: "Some finished playoff games came back without a result, so bye and title odds show as unknown." });
  return out;
}

// ---------------------------------------------------------------------------------------------

/** The notices, the scoring section's lines, the unjudged players' count and the players without projections (the file header). */
export function buildDataNotices(input: NoticeInput): DataNotices {
  const { snapshot, inputs, model } = input;
  const ctx: NoticeContext = { snapshot, myTeamId: input.myTeamId };
  const notices: Notice[] = [];
  const keys = new Map<string, number>();
  const add = (key: string, text: string | null | undefined) => {
    if (!text || notices.some((n) => n.text === text)) return;
    const seen = keys.get(key) ?? 0;
    keys.set(key, seen + 1);
    notices.push({ key: seen ? `${key}#${seen}` : key, text });
  };
  const fromWarnings = (warnings: readonly ImportWarning[] | undefined) => {
    for (const w of warnings ?? []) {
      const rule = warningRule(w.code);
      if (rule === "notice" || rule === "conditional") add(w.code, NOTICE_TEXT[w.code]?.(w, ctx));
    }
  };

  fromWarnings(snapshot.warnings);
  for (const s of snapshot.settings.unknownSettings ?? []) add(`setting:${s}`, UNKNOWN_SETTING_NOTICE[s]);
  const rules = uncountedRules(snapshot);
  const scoring = { notice: uncountedNoticeText(rules), quiet: quietScoringLine(rules) };
  add("scoring", scoring.notice);
  const { issues, noProjections } = playerIssues(input);
  const players = playerNotices(input, issues);
  for (const n of players.notices) add(n.key, n.text);
  if (!model) for (const n of scheduleNotices(snapshot)) add(n.key, n.text);
  fromWarnings(inputs?.warnings);
  model?.warnings.forEach((message, i) => {
    const r = modelWarningRule(message);
    if (r.rule === "notice") add(`model:${i}`, r.text);
  });
  return { notices, scoring, unjudged: players.unjudged, noProjections };
}

/** The Import Report's line under its technical details when other teams' players went there unjudged (DataNotices.unjudged). */
export function unjudgedText(n: number): string | null {
  if (n <= 0) return null;
  return `${plural(n, "player")} on other teams ${n === 1 ? "has" : "have"} incomplete data (listed below). The League page points out any of them who are likely starters.`;
}
