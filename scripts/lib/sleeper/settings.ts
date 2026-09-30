/**
 * What each Sleeper league `settings` key means. Sleeper doesn't document these keys, so every
 * meaning starts as "inferred" (from the key name / community use). A key is upgraded to
 * "verified" when this league's own data confirms it (e.g. records prove the median-game flag), or
 * to "verified (crawl)" when the crawl of public leagues (npm run probe:sleeper-codes, output in
 * reports/probe-output/sleeper-codes.json) verified the meaning across many leagues. The meanings
 * below are the crawl's readings; the crawl output decides whether they count as verified.
 */

export type Confidence = "verified" | "verified (crawl)" | "corroborated" | "inferred" | "unknown";

export interface KeyMeaning {
  meaning: string;
  /** Whether Phase 1 needs this key for the normalized LeagueSettings. */
  needed?: boolean;
}

export const SETTINGS_MEANINGS: Record<string, KeyMeaning> = {
  num_teams: { meaning: "number of teams", needed: true },
  type: { meaning: "league type: 0 redraft, 1 keeper, 2 dynasty, 3 guillotine ('chopped': the lowest scorer is eliminated each week)", needed: true },
  start_week: { meaning: "first fantasy week (NFL week)", needed: true },
  playoff_week_start: { meaning: "first fantasy playoff week (NFL week); regular season = start_week..playoff_week_start−1; 0 in guillotine leagues (no bracket)", needed: true },
  playoff_teams: { meaning: "number of teams in the winners bracket", needed: true },
  playoff_round_type: { meaning: "playoff round length: 0 one week per round, 1 two-week championship, 2 two weeks per round", needed: true },
  playoff_type: { meaning: "losers bracket: 0 losers advance (toilet bowl), 1 winners advance (consolation games for places)", needed: true },
  playoff_seed_type: { meaning: "0 fixed bracket, 1 re-seed after each round", needed: true },
  league_average_match: { meaning: "1 = extra game each week vs the league median", needed: true },
  trade_deadline: { meaning: "last week (transaction leg) in which trades complete; 99 = no deadline", needed: true },
  trade_review_days: { meaning: "length of the veto vote in days; used only when veto_auto_poll = 1 (trades otherwise process at once)", needed: true },
  veto_votes_needed: { meaning: "league votes needed to veto a trade (only with veto_auto_poll = 1)", needed: true },
  veto_auto_poll: { meaning: "1 = every trade opens a veto poll (tradeReview 'league_vote'); 0 or absent = no review ('none')", needed: true },
  veto_show_votes: { meaning: "1 = show who voted to veto" },
  disable_trades: { meaning: "1 = trading turned off", needed: true },
  pick_trading: { meaning: "1 = draft picks can be traded", needed: true },
  reserve_slots: { meaning: "IR slots per team", needed: true },
  reserve_allow_out: { meaning: "1 = OUT players may go on IR" },
  reserve_allow_doubtful: { meaning: "1 = DOUBTFUL players may go on IR" },
  reserve_allow_sus: { meaning: "1 = SUSPENDED players may go on IR" },
  reserve_allow_na: { meaning: "1 = players with status NA may go on IR" },
  reserve_allow_cov: { meaning: "1 = COVID-list players may go on IR" },
  reserve_allow_dnr: { meaning: "1 = DNR (did not report) players may go on IR" },
  taxi_slots: { meaning: "taxi squad slots per team", needed: true },
  taxi_years: { meaning: "max NFL seasons of experience for taxi eligibility" },
  taxi_allow_vets: { meaning: "1 = veterans allowed on taxi" },
  taxi_deadline: { meaning: "week after which taxi moves lock (0 = none)" },
  waiver_budget: { meaning: "FAAB budget per team for the season", needed: true },
  waiver_type: { meaning: "waiver system: 0 rolling, 1 reverse standings, 2 FAAB" },
  waiver_clear_days: { meaning: "days a dropped player stays on waivers" },
  waiver_day_of_week: { meaning: "day the weekly waivers run (0–6); settings.leg advances then; which weekday each value is isn't verified" },
  waiver_bid_min: { meaning: "minimum FAAB bid" },
  daily_waivers: { meaning: "1 = waivers run daily" },
  daily_waivers_hour: { meaning: "hour daily waivers run" },
  daily_waivers_days: { meaning: "bitmask of days daily waivers run (not established)" },
  daily_waivers_last_ran: { meaning: "internal: last day daily waivers ran" },
  daily_waivers_base: { meaning: "internal daily-waiver setting (not established)" },
  faab_suggestions: { meaning: "1 = show FAAB bid suggestions" },
  draft_rounds: { meaning: "rounds in the league's draft (the rookie draft in dynasty)", needed: true },
  max_keepers: { meaning: "keepers allowed per team", needed: true },
  best_ball: { meaning: "1 = best ball (Sleeper sets the optimal lineup); absent = 0", needed: true },
  bench_lock: { meaning: "1 = bench players lock at kickoff" },
  disable_adds: { meaning: "1 = free-agent adds disabled" },
  offseason_adds: { meaning: "1 = adds allowed in the offseason" },
  capacity_override: { meaning: "internal roster-capacity override (not established)" },
  commissioner_direct_invite: { meaning: "1 = commissioner can invite directly" },
  squads: { meaning: "not established" },
  sub_start_time_eligibility: { meaning: "in-game substitution rule (not established)" },
  sub_lock_if_starter_active: { meaning: "in-game substitution rule (not established)" },
  max_subs: { meaning: "in-game substitutions allowed (not established)" },
  pick_timer: { meaning: "draft pick timer (not established)" },
  last_report: { meaning: "internal: last week a league report was generated" },
  last_scored_leg: { meaning: "last week with final scores", needed: true },
  leg: { meaning: "league's current week; advances when the league's weekly waivers run, so it lags the NFL week" },
  divisions: { meaning: "number of divisions (0 or absent = none); a team's division is rosters[].settings.division, names in league.metadata division_N", needed: true },
  last_chopped_leg: { meaning: "guillotine leagues: last week a team was eliminated", needed: true },
  disable_elimination: { meaning: "guillotine leagues: elimination switch (not established)" },
};

/** Keys Phase 1 reads for the normalized LeagueSettings. */
export const SETTINGS_NEEDED: ReadonlySet<string> = new Set(Object.entries(SETTINGS_MEANINGS).filter(([, m]) => m.needed).map(([k]) => k));

/** Keys whose name pattern gives the meaning (e.g. position_limit_qb). */
export function patternMeaning(key: string): KeyMeaning | undefined {
  const pl = /^position_limit_(\w+)$/.exec(key);
  if (pl) return { meaning: `max ${pl[1]?.toUpperCase()} on the active roster (players minus IR and taxi)`, needed: true };
  return undefined;
}

/**
 * probe:sleeper-codes checks behind each key's meaning. `partial` marks a key whose meaning the
 * crawl verified only in part (it stays "inferred", with the crawl as its basis); `byValue` names
 * the checks for particular values instead (e.g. type 3 is CODES.type3).
 */
export interface CrawlBasis {
  checks: string[];
  partial?: string;
  byValue?: Record<string, string[]>;
}

export const CRAWL_BASIS: Record<string, CrawlBasis> = {
  num_teams: { checks: ["CODES.numTeams"] },
  type: { checks: ["CODES.type"], byValue: { "3": ["CODES.type3"] } },
  start_week: { checks: ["CODES.startWeek"] },
  playoff_week_start: { checks: ["CODES.playoffWeekStart"] },
  playoff_teams: { checks: ["CODES.playoffTeams"] },
  playoff_round_type: { checks: ["CODES.playoffRoundType"] },
  playoff_type: { checks: ["CODES.playoffType"] },
  playoff_seed_type: { checks: ["CODES.playoffSeedType"] },
  league_average_match: { checks: ["CODES.medianGame"] },
  trade_deadline: { checks: ["CODES.tradeDeadline"], byValue: { "99": ["CODES.tradeDeadlineNone"] } },
  veto_auto_poll: { checks: ["CODES.tradeReview"] },
  trade_review_days: { checks: ["CODES.tradeReview"], partial: "matters only with veto_auto_poll = 1; that it is the vote length is inferred from the name" },
  disable_trades: { checks: ["CODES.disableTrades"] },
  pick_trading: { checks: ["CODES.pickTrading"] },
  reserve_slots: { checks: ["CODES.reserveSlots"] },
  taxi_slots: { checks: ["CODES.taxiSlots"] },
  waiver_budget: { checks: ["CODES.waiverBudget"] },
  waiver_type: { checks: ["CODES.waiverType"] },
  max_keepers: { checks: ["CODES.maxKeepers"] },
  best_ball: { checks: ["CODES.bestBall"] },
  last_scored_leg: { checks: ["CODES.lastScoredLeg"] },
  leg: { checks: ["CODES.leg"] },
  waiver_day_of_week: { checks: ["CODES.leg"], partial: "each value maps to one weekly rollover day; which weekday each value is isn't verified" },
  divisions: { checks: ["CODES.divisions"] },
  last_chopped_leg: { checks: ["CODES.type3"] },
};

/** The crawl checks behind a key (and value), including patterns (position_limit_*). */
export function crawlBasisFor(key: string, value?: unknown): { checks: string[]; partial?: string } | undefined {
  if (/^position_limit_\w+$/.test(key)) return { checks: ["CODES.positionLimits"] };
  const b = CRAWL_BASIS[key];
  if (!b) return undefined;
  const byValue = value === undefined ? undefined : b.byValue?.[String(value)];
  return { checks: byValue ?? b.checks, partial: b.partial };
}

/** The crawl's own "Reading: …" sentence from a check summary, when it states one. */
export function crawlReading(summary: string): string | null {
  const i = summary.indexOf("Reading:");
  if (i < 0) return null;
  const rest = summary.slice(i + "Reading:".length).trim();
  const end = rest.search(/\.\s|\s—\s|;\s/);
  return (end < 0 ? rest : rest.slice(0, end)).trim() || null;
}

/** A crawl check as read from reports/probe-output/sleeper-codes.json. */
export interface CrawlCheck {
  status: string;
  summary: string;
}

export interface SettingsRow {
  key: string;
  value: unknown;
  meaning: string;
  confidence: Confidence;
  basis?: string;
}

const RANK: Record<Confidence, number> = { unknown: 0, inferred: 1, corroborated: 2, "verified (crawl)": 3, verified: 4 };

/** What the crawl says about a key: "verified (crawl)", partly verified ("inferred" + basis), or nothing. */
export function crawlConfidence(key: string, crawl: ReadonlyMap<string, CrawlCheck> | null, value?: unknown): { confidence: Confidence; basis: string } | null {
  const basis = crawlBasisFor(key, value);
  if (!crawl || !basis) return null;
  const found = basis.checks.map((c) => [c, crawl.get(c)] as const).filter((x): x is readonly [string, CrawlCheck] => Boolean(x[1]));
  if (!found.length) return null;
  const names = found.map(([c]) => c).join(" + ");
  const readings = found.map(([, c]) => crawlReading(c.summary)).filter((r): r is string => Boolean(r));
  const reading = readings.length ? ` (reading: ${readings.join("; ")})` : "";
  const allOk = found.length === basis.checks.length && found.every(([, c]) => c.status === "ok");
  if (allOk && !basis.partial) return { confidence: "verified (crawl)", basis: `probe:sleeper-codes ${names}${reading}` };
  const statuses = found.map(([c, x]) => `${c} ${x.status}`).join(", ");
  const missing = basis.checks.filter((c) => !crawl.has(c));
  const why = [basis.partial, missing.length ? `${missing.join(", ")} missing` : ""].filter(Boolean).join("; ");
  return { confidence: "inferred", basis: `partly verified by probe:sleeper-codes (${statuses})${why ? `: ${why}` : ""}${reading}` };
}

/**
 * Every settings key with its value, meaning and confidence: the strongest of this league's own
 * evidence (`evidence`) and the crawl (`crawl`), with both bases kept.
 */
export function describeSettings(settings: Record<string, unknown>, evidence: Record<string, { confidence: Confidence; basis: string }>, crawl: ReadonlyMap<string, CrawlCheck> | null = null): SettingsRow[] {
  return Object.keys(settings)
    .sort()
    .map((key) => {
      const m = SETTINGS_MEANINGS[key] ?? patternMeaning(key);
      const unknownMeaning = !m || /not established/.test(m.meaning);
      const base: Confidence = unknownMeaning ? "unknown" : "inferred";
      const local = evidence[key];
      const fromCrawl = unknownMeaning ? null : crawlConfidence(key, crawl, settings[key]);
      const candidates = [local, fromCrawl].filter((x): x is { confidence: Confidence; basis: string } => Boolean(x));
      const best = candidates.reduce<Confidence>((acc, c) => (RANK[c.confidence] > RANK[acc] ? c.confidence : acc), base);
      const basis = candidates.map((c) => c.basis).join("; ");
      return { key, value: settings[key], meaning: m?.meaning ?? "unknown", confidence: best, ...(basis ? { basis } : {}) };
    });
}
