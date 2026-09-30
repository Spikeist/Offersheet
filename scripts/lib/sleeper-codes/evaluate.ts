/**
 * Turns the crawl into checklist results for item "CODES" (aggregate numbers only).
 * Pure: no I/O, no clock.
 *
 * One evidence rule for every ✅ (enough()): a code value counts as verified only when at least
 * 3 independent leagues support it and none contradicts it, or at least 10 with no more than 10%
 * contradicting. "Independent" means distinct 2026 leagues: the older seasons fetched for rare
 * playoff codes are the same leagues again, so they only appear (separately) in the check they
 * were fetched for. Everything else is ⚠️ with the distribution and the best inference.
 */
import type { Evidence, Status } from "../checklist";
import {
  advancement,
  classifyRoundPattern,
  compareKeys,
  crossTab,
  divisionWinnersFirst,
  frac,
  gamesCheck,
  groupsInPlayers,
  median,
  optimalLineupShare,
  pointsOrder,
  positionLimitChecks,
  recordOrder,
  roundWeeks,
  seedRuleEvidence,
  seedingFits,
  standardByes,
  summarizeBracket,
  tally,
  toWeekScores,
  topSeedRound2,
  waiverVsStandings,
  type Advancement,
  type BracketSummary,
  type GamesCheck,
  type LimitCheck,
  type MatchupLite,
  type RosterGroups,
  type RoundPattern,
  type RoundWeeks,
  type Tally,
  type TopSeedRound2,
} from "./analyze";
import { TIMING_BUCKETS, timingInWeek, type NflCalendar } from "./calendar";
import type { Current2026, League2026, Prev2025, TxLite } from "./crawl";

export interface CrawlStats {
  seedSources: string[];
  usersFetched: number;
  usersWithNewLeagues: number;
  usersQueued: number;
  leagueUserLists: number;
  draftsSeen: number;
  stoppedBy: string;
  picksRequested: number;
  currentRequested: number;
  prevRequested: number;
  calls: number;
  live: number;
  cached: number;
  statusCounts: Record<string, number>;
  byTemplate: Record<string, number>;
}

export interface Dataset {
  /** NFL state from /state/nfl, plus the weekday the probe ran (passed in: this module has no clock). */
  state: { week: number; season: string; displayWeek?: number; seasonType?: string; weekday?: string };
  leagues: League2026[];
  prev: Prev2025[];
  /** 2026 rosters so far for in-season leagues with rare codes (best ball, late start, position limits). */
  current: Current2026[];
  positionOf?: (playerId: string) => string | undefined;
  /** NFL week windows (nflverse games.csv) for dating trades; the timing evidence is skipped without it. */
  calendar?: NflCalendar;
  /** HTTP status of the games.csv request (evidence). */
  calendarStatus?: number;
  /** HTTP status of GET /league/0, requested once when some league sent previous_league_id "0". */
  zeroLinkStatus?: number;
  crawl: CrawlStats;
}

export interface CodeCheck {
  key: string;
  title: string;
  status: Status;
  summary: string;
  evidence: Evidence[];
}

export interface Evaluation {
  checks: CodeCheck[];
  meta: Record<string, unknown>;
  issues: string[];
  decisions: string[];
  questions: string[];
}

const API = "https://api.sleeper.app/v1";
export const URLS = {
  userLeagues: `${API}/user/{userId}/leagues/nfl/2026`,
  userDrafts: `${API}/user/{userId}/drafts/nfl/2026`,
  picks: `${API}/draft/{draftId}/picks`,
  state: `${API}/state/nfl`,
  curRosters: `${API}/league/{leagueId}/rosters`,
  zeroLeague: `${API}/league/0`,
  prevLeague: `${API}/league/{previousLeagueId}`,
  prevRosters: `${API}/league/{previousLeagueId}/rosters`,
  winners: `${API}/league/{previousLeagueId}/winners_bracket`,
  losers: `${API}/league/{previousLeagueId}/losers_bracket`,
  matchups: `${API}/league/{previousLeagueId}/matchups/{week}`,
  transactions: `${API}/league/{previousLeagueId}/transactions/{week}`,
  nflGames: "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv",
} as const;

/** Slot names CLAUDE.md §2.3 lists for roster_positions. */
export const KNOWN_SLOTS = ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "REC_FLEX", "WRRB_FLEX", "K", "DEF", "DL", "LB", "DB", "IDP_FLEX", "BN"];

/** Codes with their own sub-check; every other numeric setting is reported as a distribution. */
const COVERED = new Set([
  "type",
  "trade_deadline",
  "playoff_round_type",
  "playoff_week_start",
  "playoff_teams",
  "league_average_match",
  "start_week",
  "best_ball",
  "playoff_type",
  "playoff_seed_type",
  "waiver_type",
  "waiver_budget",
  "waiver_day_of_week",
  "divisions",
  "reserve_slots",
  "taxi_slots",
  "num_teams",
  "max_keepers",
  "trade_review_days",
  "veto_votes_needed",
  "veto_auto_poll",
  "veto_show_votes",
  "disable_trades",
  "pick_trading",
  "leg",
  "last_scored_leg",
  "last_chopped_leg",
  "disable_elimination",
]);

// ---------------------------------------------------------------------------------------------
// The evidence rule

export const EVIDENCE = { minClean: 3, minWithExceptions: 10, maxExceptionShare: 0.1 } as const;

/**
 * ✅ needs `leagues` ≥ 3 independent leagues with none contradicting, or ≥ 10 with at most 10%
 * contradicting. `leagues` counts every informative league, contradicting ones included.
 */
export function enough(leagues: number, contradicting = 0): boolean {
  if (contradicting <= 0) return leagues >= EVIDENCE.minClean;
  return leagues >= EVIDENCE.minWithExceptions && contradicting <= EVIDENCE.maxExceptionShare * leagues;
}

export const EVIDENCE_RULE = `a code value is ✅ only with ≥ ${EVIDENCE.minClean} independent leagues (distinct 2026 leagues; earlier seasons of the same league don't count) and none contradicting, or ≥ ${EVIDENCE.minWithExceptions} with ≤ ${Math.round(100 * EVIDENCE.maxExceptionShare)}% contradicting; below that it is ⚠️`;

const below = (leagues: number, contradicting = 0) =>
  enough(leagues, contradicting) ? "" : contradicting ? `; ${contradicting} of ${leagues} leagues contradict` : `; below the ${EVIDENCE.minClean}-league minimum`;

const MAX_TALLY_KEYS = 30;

/** Keep reports small: at most 30 values per tally (the rest summed as "other values"). */
function capTally(t: Tally): Tally {
  const entries = Object.entries(t);
  if (entries.length <= MAX_TALLY_KEYS) return t;
  const top = [...entries].sort((a, b) => b[1] - a[1]).slice(0, MAX_TALLY_KEYS - 1);
  const rest = entries.filter(([k]) => !top.some(([t2]) => t2 === k)).reduce((s, [, n]) => s + n, 0);
  return { ...Object.fromEntries(top), "other values": rest };
}

const setting = (s: Record<string, number>, k: string, dflt?: number): number | undefined => s[k] ?? dflt;
const share = (n: number, d: number) => (d ? n / d : 0);
const pct = (x: number) => `${Math.round(100 * x)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const hasLimits = (s: Record<string, number>) => Object.keys(s).some((k) => k.startsWith("position_limit_"));
const typeName = (t: number | undefined) => (t === 3 ? "guillotine" : t === 2 ? "dynasty" : t === 1 ? "keeper" : t === 0 ? "redraft" : `type ${t ?? "absent"}`);

// ---------------------------------------------------------------------------------------------
// Per previous-season league analysis (computed once)

interface PrevAnalysis {
  p: Prev2025;
  /** The 2026 league this season belongs to: the key for "independent leagues". */
  lineage: string;
  s: Record<string, number>;
  pws: number;
  startWeek: number;
  lam: number;
  regularWeeks?: number;
  winners?: BracketSummary;
  losers?: BracketSummary;
  roundWeeks: RoundWeeks[];
  pattern?: RoundPattern;
  firstPlayoffWeek?: number;
  games?: GamesCheck;
  optimal: ReturnType<typeof optimalLineupShare>;
  winnersAdv?: Advancement;
  losersAdv?: Advancement;
  fits: { record: boolean; points: boolean; divisionsFirst?: boolean };
  topSeed?: TopSeedRound2;
  waiverCorr?: number;
  trades: TxLite[];
  waivers: TxLite[];
  legs: number[];
  /**
   * Some team has a decided game or scored points. Seasons that never started have neither (and
   * empty rosters); guillotine seasons have no games but do have points.
   */
  played: boolean;
}

function analyzePrev(p: Prev2025): PrevAnalysis {
  const s = p.settings;
  const pws = s.playoff_week_start ?? 0;
  const startWeek = s.start_week ?? 1;
  const lam = s.league_average_match ?? 0;
  const regularWeeks = pws > startWeek ? pws - startWeek : undefined;
  const byWeek = new Map<number, MatchupLite[]>(Object.entries(p.matchups).map(([w, list]) => [Number(w), list]));
  const scores = toWeekScores(byWeek);
  const winners = p.winners?.length ? summarizeBracket(p.winners) : undefined;
  const losers = p.losers?.length ? summarizeBracket(p.losers) : undefined;
  const rw = p.winners?.length && byWeek.size ? roundWeeks(p.winners, scores) : [];
  const nPlayoff = s.playoff_teams ?? winners?.teams.length ?? 0;
  const byRecord = recordOrder(p.standings);
  const byPoints = pointsOrder(p.standings);
  // Only settings.divisions says whether divisions are on: rosters can keep stale division numbers.
  const divFirst = (s.divisions ?? 0) > 0 ? divisionWinnersFirst(p.standings) : undefined;
  const fits = winners?.complete
    ? { record: seedingFits(winners, byRecord, nPlayoff), points: seedingFits(winners, byPoints, nPlayoff), divisionsFirst: divFirst ? seedingFits(winners, divFirst, nPlayoff) : undefined }
    : { record: false, points: false };
  // Round-2 evidence needs the real seeds: use whichever seeding rule explains the bracket.
  const seeds = fits.record ? byRecord : fits.divisionsFirst && divFirst ? divFirst : fits.points ? byPoints : undefined;
  const tx = Object.values(p.transactions).flat();
  return {
    p,
    lineage: p.fromLeagueId,
    s,
    pws,
    startWeek,
    lam,
    regularWeeks,
    winners,
    losers,
    roundWeeks: rw,
    pattern: rw.length ? classifyRoundPattern(rw) : undefined,
    firstPlayoffWeek: rw[0]?.weeks[0],
    games: regularWeeks && p.standings.length ? gamesCheck(p.standings, regularWeeks) : undefined,
    optimal: optimalLineupShare(p.standings),
    winnersAdv: p.winners?.length && byWeek.size ? advancement(p.winners, scores) : undefined,
    losersAdv: p.losers?.length && byWeek.size ? advancement(p.losers, scores) : undefined,
    fits,
    topSeed: seeds && p.winners ? topSeedRound2(p.winners, seeds, nPlayoff) : undefined,
    waiverCorr: waiverVsStandings(p.standings),
    trades: tx.filter((t) => t.type === "trade" && t.status === "complete"),
    waivers: tx.filter((t) => t.type === "waiver" && t.status === "complete"),
    legs: Object.keys(p.transactions).map(Number),
    played: p.standings.some((st) => st.wins + st.losses + st.ties > 0 || st.fpts > 0),
  };
}

function modal(t: Tally): { value: string; n: number; total: number } {
  const entries = Object.entries(t);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const [value, n] = entries.reduce<[string, number]>((best, e) => (e[1] > best[1] ? e : best), ["", 0]);
  return { value, n, total };
}

/** Group analyses by a settings code; a missing key is its own group ("absent") unless a default is given. */
function byCode(prev: readonly PrevAnalysis[], key: string, dflt?: number): Map<string, PrevAnalysis[]> {
  const out = new Map<string, PrevAnalysis[]>();
  for (const a of prev) {
    const v = String(setting(a.s, key, dflt) ?? "absent");
    out.set(v, [...(out.get(v) ?? []), a]);
  }
  return new Map([...out].sort(([x], [y]) => compareKeys(x, y)));
}

const lineagesOf = (as: ReadonlyArray<{ lineage: string }>) => new Set(as.map((a) => a.lineage)).size;

const round1 = (x: number | undefined) => (x === undefined ? undefined : Math.round(10 * x) / 10);
const round2 = (x: number | undefined) => (x === undefined ? undefined : Math.round(100 * x) / 100);

/** A short list of numbers, or its range and median when long. */
function numbersText(xs: readonly number[]): string {
  const s = [...xs].sort((a, b) => a - b).map((x) => round2(x) ?? 0);
  if (!s.length) return "none";
  if (s.length <= 8) return `[${s.join(", ")}]`;
  return `${s[0]}…${s[s.length - 1]} (median ${round2(median(s))})`;
}

// ---------------------------------------------------------------------------------------------

export function evaluateAll(d: Dataset): Evaluation {
  const checks: CodeCheck[] = [];
  const issues: string[] = [];
  const decisions: string[] = [];
  const questions: string[] = [];
  const meta: Record<string, unknown> = {};
  const L = d.leagues;
  const found = d.prev.filter((p) => p.found);
  /** Seasons linked directly from a 2026 league: one per independent league. */
  const found1 = found.filter((p) => p.depth === 1);
  const analyzed = found.map(analyzePrev);
  /** Seasons that never started (0 games, empty rosters) say nothing about any code. */
  const unplayed = analyzed.filter((a) => !a.played);
  const prevAll = analyzed.filter((a) => a.played);
  /** Every check except playoffRoundType uses these only (older seasons repeat the same leagues). */
  const prev1 = prevAll.filter((a) => a.p.depth === 1);
  const prevOlder = prevAll.filter((a) => a.p.depth > 1);
  const dist = (k: string, dflt?: number) => tally(L.map((l) => setting(l.settings, k, dflt)));
  const add = (key: string, title: string, status: Status, summary: string, ...evidence: Evidence[]) => checks.push({ key, title, status, summary, evidence });
  const verification: Record<string, unknown> = {};
  const absentDefaults: string[] = [];
  const inSeason = L.filter((l) => l.status === "in_season");

  // ---- Sample
  {
    const hops = L.map((l) => l.hop);
    const drafts = L.filter((l) => l.draft).length;
    const picks = L.filter((l) => l.picks).length;
    const requested1 = d.prev.filter((p) => p.depth === 1);
    const deeper = found.filter((p) => p.depth > 1);
    const links = tally(L.map((l) => l.previousLink));
    const ok = L.length >= 150 && found1.length >= 20;
    add(
      "CODES.sample",
      "Crawl sample",
      ok ? "ok" : L.length >= 50 ? "warn" : "fail",
      `${L.length} public 2026 leagues from ${d.crawl.usersWithNewLeagues} users (≤ 5 leagues per user, ${hops.length ? Math.min(...hops) : 0}–${hops.length ? Math.max(...hops) : 0} hops from the seeds; stopped by ${d.crawl.stoppedBy}); previous_league_id: ${links.id ?? 0} real IDs, ${links.null ?? 0} null, ${links.zero ?? 0} "0"${links.absent ? `, ${links.absent} missing` : ""}${links.other ? `, ${links.other} other` : ""}; ${found1.length}/${requested1.length} previous seasons found${unplayed.length ? ` (${unplayed.length} never played: no games or points; left out)` : ""}${deeper.length ? ` plus ${deeper.length} older seasons of ${lineagesOf(deeper.map((p) => ({ lineage: p.fromLeagueId })))} of those leagues (rare playoff codes only)` : ""}; 2026 rosters for ${d.current.length} leagues; drafts matched for ${drafts}; ${picks} pick lists; ${d.crawl.calls} Sleeper calls (${d.crawl.live} live, ${d.crawl.cached} cached)`,
      { url: URLS.userLeagues, status: 200, path: "[].settings, [].previous_league_id", sample: { leagues: L.length, byStatus: tally(L.map((l) => l.status)), previousLeagueId: links } },
      { url: URLS.prevLeague, status: 200, path: "season", sample: tally(found.map((p) => p.season)), note: `HTTP status of previous-season requests (real IDs only): ${JSON.stringify(tally(requested1.map((p) => p.httpStatus)))}` },
    );
    meta.crawl = d.crawl;
    meta.sample = {
      leagues2026: L.length,
      hops: tally(hops),
      previousLeagueIdForm: links,
      previousSeasonsRequested: requested1.length,
      previousSeasonsFound: found1.length,
      olderSeasonsForRareCodes: tally(deeper.map((p) => p.season)),
      previousSeasonStatus: tally(found.map((p) => p.status)),
      current2026Rosters: tally(d.current.flatMap((c) => c.reasons)),
      draftsMatched: drafts,
      pickListsFetched: picks,
      nflState: d.state,
    };
    if (found1.some((p) => p.season !== String(Number(d.state.season) - 1)))
      issues.push(`Some previous_league_id links point to a season other than ${Number(d.state.season) - 1}: ${JSON.stringify(tally(found1.map((p) => p.season)))} — evidence: ${URLS.prevLeague} → season.`);
    if (links.zero)
      issues.push(
        `Sleeper sends previous_league_id as the string "0" (not null) in ${links.zero}/${L.length} sampled 2026 leagues, and that league doesn't exist (GET ${URLS.zeroLeague} → HTTP ${d.zeroLinkStatus ?? "not requested"}) — evidence: ${URLS.userLeagues} → [].previous_league_id — options: treat "0" (and any all-zero ID) exactly like null, i.e. no previous season, in the Phase 1 adapter (this probe does).`,
      );
  }

  // ---- Distributions of every numeric setting (2026)
  {
    const keys = [...new Set(L.flatMap((l) => Object.keys(l.settings)))].sort();
    meta.distributions2026 = Object.fromEntries(keys.map((k) => [k, capTally(dist(k))]));
    meta.keyPresence2026 = Object.fromEntries(keys.map((k) => [k, L.filter((l) => k in l.settings).length]));
    const changed = Object.fromEntries(
      keys
        .map((k) => {
          const pairs = found1.map((p) => [L.find((l) => l.leagueId === p.fromLeagueId)?.settings[k], p.settings[k]] as const).filter(([a, b]) => a !== undefined || b !== undefined);
          return [k, `${pairs.filter(([a, b]) => a !== b).length}/${pairs.length}`] as const;
        })
        .filter(([, v]) => !v.startsWith("0/")),
    );
    meta.settingsChanged2025to2026 = changed;
  }

  // ---- League type (settings.type)
  {
    const types = [...new Set(L.map((l) => l.settings.type))].filter((t): t is number => typeof t === "number").sort((a, b) => a - b);
    const stats = Object.fromEntries(
      types.map((t) => {
        const ls = L.filter((l) => l.settings.type === t);
        const renewed = ls.filter((l) => l.previousLeagueId);
        const newL = ls.filter((l) => !l.previousLeagueId);
        const picked = (xs: League2026[]) => xs.filter((l) => l.picks && l.picks.withYearsExp > 0);
        const rookieShare = (l: League2026) => (l.picks ? l.picks.rookies / Math.max(1, l.picks.withYearsExp) : 0);
        const pr = picked(renewed);
        const pn = picked(newL);
        return [
          String(t),
          {
            leagues: ls.length,
            renewed: renewed.length,
            taxiSlotsAbove0: ls.filter((l) => (l.settings.taxi_slots ?? 0) > 0).length,
            maxKeepers: tally(ls.map((l) => l.settings.max_keepers)),
            pickTrading: tally(ls.map((l) => l.settings.pick_trading)),
            nameKeywords: tally(ls.flatMap((l) => l.nameKeywords)),
            draftRoundsMedian: { renewed: median(renewed.flatMap((l) => (l.draft?.rounds ? [l.draft.rounds] : []))), new: median(newL.flatMap((l) => (l.draft?.rounds ? [l.draft.rounds] : []))) },
            draftPlayerType: tally(ls.filter((l) => l.draft).map((l) => l.draft?.playerType)),
            draftScoringType: capTally(tally(ls.filter((l) => l.draft).map((l) => l.draft?.scoringType))),
            draftLeagueTypeMeta: tally(ls.filter((l) => l.draft).map((l) => l.draft?.leagueTypeMeta)),
            picksRenewed: { drafts: pr.length, withKeeperPicks: pr.filter((l) => (l.picks?.keepers ?? 0) > 0).length, rookieOnly: pr.filter((l) => rookieShare(l) >= 0.9).length, rookieShareMedian: round2(median(pr.map(rookieShare))) },
            picksNew: { drafts: pn.length, withKeeperPicks: pn.filter((l) => (l.picks?.keepers ?? 0) > 0).length, rookieOnly: pn.filter((l) => rookieShare(l) >= 0.9).length, rookieShareMedian: round2(median(pn.map(rookieShare))) },
            lastChoppedLeg: ls.filter((l) => "last_chopped_leg" in l.settings).length,
            disableElimination: ls.filter((l) => "disable_elimination" in l.settings).length,
            bestBall: tally(ls.map((l) => l.settings.best_ball)),
            status: tally(ls.map((l) => l.status)),
          },
        ];
      }),
    );
    verification.type = stats;
    type TS = (typeof stats)[string];
    const g = (t: number): TS | undefined => stats[String(t)];
    const t0 = g(0);
    const t1 = g(1);
    const t2 = g(2);
    // Redraft: renewed drafts without keeper picks (a keeper pick contradicts). Keeper: keeper picks
    // (a keeper league where nobody kept a player doesn't contradict). Dynasty: rookie-only drafts.
    const redraftOk = !!t0 && enough(t0.picksRenewed.drafts, t0.picksRenewed.withKeeperPicks) && (t0.picksRenewed.rookieShareMedian ?? 1) < 0.3;
    const keeperOk = !!t1 && enough(t1.picksRenewed.withKeeperPicks, 0) && redraftOk;
    const dynastyOk = !!t2 && enough(t2.picksRenewed.drafts, t2.picksRenewed.drafts - t2.picksRenewed.rookieOnly) && redraftOk;
    const dynastyShare = !!t2 && t2.picksRenewed.drafts >= 3 && share(t2.picksRenewed.rookieOnly, t2.picksRenewed.drafts) >= 0.7 && redraftOk;
    const kw = (t: TS | undefined, k: string) => (t ? `${frac(t.nameKeywords[k] ?? 0, t.leagues)} of names say "${k}"` : "n/a");
    const parts = [
      t2 ? `type 2: rookie-only drafts in ${frac(t2.picksRenewed.rookieOnly, t2.picksRenewed.drafts)} renewed leagues (median ${t2.draftRoundsMedian.renewed ?? "?"} rounds), taxi slots in ${frac(t2.taxiSlotsAbove0, t2.leagues)}, ${kw(t2, "dynasty")}` : "type 2 not seen",
      t1 ? `type 1: keeper picks in ${frac(t1.picksRenewed.withKeeperPicks, t1.picksRenewed.drafts)} renewed drafts, ${kw(t1, "keeper")}` : "type 1 not seen",
      t0 ? `type 0: keeper picks in ${frac(t0.picksRenewed.withKeeperPicks, t0.picksRenewed.drafts)} renewed drafts, median rookie share ${pct(t0.picksRenewed.rookieShareMedian ?? 0)}, median ${t0.draftRoundsMedian.renewed ?? "?"} rounds, ${kw(t0, "dynasty")}` : "type 0 not seen",
    ];
    const allOk = redraftOk && keeperOk && (dynastyOk || dynastyShare);
    add(
      "CODES.type",
      "settings.type → league type",
      allOk ? "ok" : "warn",
      `${allOk ? "Verified" : "Inferred (not all verified)"}: 0 = redraft${redraftOk ? " ✓" : ""}, 1 = keeper${keeperOk ? " ✓" : ""}, 2 = dynasty${dynastyOk || dynastyShare ? " ✓" : ""}. ${parts.join("; ")}`,
      { url: URLS.userLeagues, status: 200, path: "[].settings.type", sample: dist("type") },
      { url: URLS.picks, status: 200, path: "[].is_keeper, [].metadata.years_exp", sample: Object.fromEntries(Object.entries(stats).map(([t, s]) => [t, s.picksRenewed])) },
      { url: URLS.userDrafts, status: 200, path: "[].settings.rounds, [].settings.player_type", sample: Object.fromEntries(Object.entries(stats).map(([t, s]) => [t, s.draftRoundsMedian])) },
    );

    // Other type values (e.g. 3)
    for (const t of types.filter((x) => x > 2)) {
      const st = g(t);
      if (!st) continue;
      const inSeasonT = inSeason.filter((l) => l.settings.type === t);
      const others = inSeason.filter((l) => l.settings.type !== t);
      const chopCount = inSeasonT.filter((l) => "last_chopped_leg" in l.settings).length;
      const chopOthers = others.filter((l) => "last_chopped_leg" in l.settings).length;
      const prevT = prev1.filter((a) => a.s.type === t);
      const emptied = prevT.map((a) => a.p.standings.filter((x) => x.players === 0).length);
      const chopped = (as: PrevAnalysis[]) => as.reduce((s, a) => s + Object.values(a.p.transactions).flat().filter((x) => x.type === "chopped").length, 0);
      const choppedHere = chopped(prevT);
      const choppedElsewhere = chopped(prev1.filter((a) => a.s.type !== t));
      const noPlayoffs = L.filter((l) => l.settings.type === t && l.settings.playoff_teams === undefined).length;
      const verified = enough(inSeasonT.length, inSeasonT.length - chopCount) && chopOthers === 0;
      add(
        `CODES.type${t}`,
        `settings.type = ${t}`,
        verified ? "ok" : "warn",
        `${verified ? "Verified" : "Inferred"}: ${t} = guillotine ("chopped") league — settings.last_chopped_leg present in ${frac(chopCount, inSeasonT.length)} in-season type-${t} leagues vs ${frac(chopOthers, others.length)} of other in-season leagues; transactions of type "chopped": ${choppedHere} in ${prevT.length} finished type-${t} seasons vs ${choppedElsewhere} elsewhere; teams left with an empty roster at season end: ${JSON.stringify(tally(emptied))}; playoff_teams missing in ${noPlayoffs}/${st.leagues}; ${frac(st.nameKeywords.guillotine ?? 0, st.leagues)} names mention guillotine/chopped`,
        { url: URLS.userLeagues, status: 200, path: "[].settings.last_chopped_leg, [].settings.disable_elimination", sample: { leagues: st.leagues, lastChoppedLeg: st.lastChoppedLeg, disableElimination: st.disableElimination, status: st.status } },
        { url: URLS.transactions, status: 200, path: "[type=chopped]", sample: { typeT: choppedHere, otherTypes: choppedElsewhere } },
      );
      issues.push(
        `Sleeper settings.type has a 4th value, ${t} = guillotine ("chopped": the lowest scorer is eliminated each week), in ${frac(st.leagues, L.length)} sampled 2026 leagues; CLAUDE.md §4 leagueType only has redraft, keeper and dynasty, and these leagues have no playoff_teams (${noPlayoffs}/${st.leagues}) — evidence: ${URLS.userLeagues} → [].settings.type, [].settings.last_chopped_leg; ${URLS.transactions} → [type=chopped] (${choppedHere} in ${prevT.length} finished seasons) — options: (a) reject guillotine leagues at import for the MVP with a clear message; (b) import as redraft with a warning that weekly elimination isn't modeled.`,
      );
      questions.push(`Guillotine leagues (settings.type = ${t}, ${frac(st.leagues, L.length)} of the sample) eliminate the lowest scorer each week: reject them at import for the MVP?`);
    }
    meta.crossTabs = {
      "type × taxi_slots": crossTab(L, (l) => l.settings.type, (l) => l.settings.taxi_slots),
      "type × max_keepers": crossTab(L, (l) => l.settings.type, (l) => l.settings.max_keepers),
      "type × best_ball": crossTab(L, (l) => l.settings.type, (l) => l.settings.best_ball),
      "type × previous_league_id form": crossTab(L, (l) => l.settings.type, (l) => l.previousLink),
      "type × draft.player_type": crossTab(
        L.filter((l) => l.draft),
        (l) => l.settings.type,
        (l) => l.draft?.playerType,
      ),
      "type × draft.metadata.league_type": crossTab(
        L.filter((l) => l.draft),
        (l) => l.settings.type,
        (l) => l.draft?.leagueTypeMeta,
      ),
      "type × status": crossTab(L, (l) => l.settings.type, (l) => l.status),
      "veto_auto_poll × trade_review_days": crossTab(L, (l) => l.settings.veto_auto_poll, (l) => l.settings.trade_review_days),
      "trade_review_days × veto_votes_needed present": crossTab(L, (l) => l.settings.trade_review_days, (l) => ("veto_votes_needed" in l.settings ? "present" : "absent")),
      "waiver_type × waiver_budget": crossTab(L, (l) => l.settings.waiver_type, (l) => l.settings.waiver_budget),
      "playoff_round_type × playoff_week_start": crossTab(L, (l) => l.settings.playoff_round_type, (l) => l.settings.playoff_week_start),
      "playoff_teams × playoff_week_start": crossTab(L, (l) => l.settings.playoff_teams, (l) => l.settings.playoff_week_start),
      "disable_trades × type": crossTab(L, (l) => l.settings.disable_trades, (l) => l.settings.type),
      "pick_trading × type": crossTab(L, (l) => l.settings.pick_trading, (l) => l.settings.type),
    };
  }

  // ---- Trade deadline: a week value, and the "no deadline" value
  {
    const isWeek = (v: number | undefined) => v !== undefined && v >= 1 && v <= 17;
    const withWeek = prev1.filter((a) => isWeek(a.s.trade_deadline));
    const tradingOn = withWeek.filter((a) => a.s.disable_trades !== 1);
    let atD = 0;
    let dMinus1 = 0;
    let earlier = 0;
    let after = 0;
    const leaguesAtD = new Set<string>();
    const leaguesDm1 = new Set<string>();
    const leaguesAfter = new Set<string>();
    for (const a of withWeek) {
      const D = a.s.trade_deadline ?? 0;
      for (const t of a.trades) {
        const r = (t.leg ?? 0) - D;
        if (r === 0) {
          atD++;
          leaguesAtD.add(a.lineage);
        } else if (r === -1) {
          dMinus1++;
          leaguesDm1.add(a.lineage);
        } else if (r < -1) earlier++;
        else {
          after++;
          leaguesAfter.add(a.lineage);
        }
      }
    }
    const legSets = tally(withWeek.map((a) => (a.legs.some((l) => l < (a.s.trade_deadline ?? 0) - 1) ? "D−1…D+1 plus weeks 4–8" : "D−1…D+1")));
    // When leg-D trades completed, in real time (needs the NFL calendar).
    const cal = d.calendar;
    const timing: Record<string, number> = {};
    const lag: number[] = [];
    let legDTimed = 0;
    if (cal) {
      for (const a of withWeek) {
        const D = a.s.trade_deadline ?? 0;
        const season = Number(a.p.season);
        for (const t of a.trades) {
          if (t.leg !== D || t.statusUpdated === undefined) continue;
          const b = timingInWeek(cal, season, D, t.statusUpdated);
          if (!b) continue;
          timing[b] = (timing[b] ?? 0) + 1;
          legDTimed++;
        }
      }
      for (const a of prev1) {
        const season = Number(a.p.season);
        for (const t of a.trades) {
          if (t.statusUpdated === undefined || t.leg === undefined) continue;
          const w = cal.weekOf(season, t.statusUpdated);
          if (w !== undefined) lag.push(w - t.leg);
        }
      }
    }
    const timingOrdered = Object.fromEntries(TIMING_BUCKETS.filter((b) => timing[b]).map((b) => [b, timing[b] ?? 0]));
    const afterWeekD = (timing["Tuesday after week D"] ?? 0) + (timing["Wednesday after week D or later"] ?? 0);
    const duringGames = timing["Sunday 1 pm ET – Monday of week D"] ?? 0;
    const lagTally = tally(lag);
    const informative = new Set([...leaguesAtD, ...leaguesAfter]).size;
    const weekOk = enough(informative, leaguesAfter.size) && atD > 0;
    verification.tradeDeadline = {
      seasonsWithWeekDeadline: withWeek.length,
      seasons: tally(withWeek.map((a) => a.p.season)),
      tradingOn: tradingOn.length,
      legsFetched: legSets,
      tradesInLegD: atD,
      leaguesWithTradesInLegD: leaguesAtD.size,
      tradesInLegDMinus1: dMinus1,
      leaguesWithTradesInLegDMinus1: leaguesDm1.size,
      tradesInEarlierControlLegs: earlier,
      tradesAfterLegD: after,
      leaguesWithTradesAfterLegD: leaguesAfter.size,
      legDCompletionTiming: timingOrdered,
      nflWeekOfCompletionMinusLeg: lagTally,
    };
    add(
      "CODES.tradeDeadline",
      "settings.trade_deadline (a week)",
      weekOk ? "ok" : "warn",
      `${weekOk ? "Verified" : "Not verified"}: a value D in 1–17 is the last league week (transaction leg) in which trades complete — ${withWeek.length} finished seasons (${Object.entries(tally(withWeek.map((a) => a.p.season)))
        .map(([s, n]) => `${n} from ${s}`)
        .join(", ")}), trading on in ${tradingOn.length}: ${atD} trades in leg D (${plural(leaguesAtD.size, "league")}), ${dMinus1} in leg D−1 (${plural(leaguesDm1.size, "league")})${earlier ? `, ${earlier} in earlier control weeks` : ""}, ${after} after leg D (${plural(leaguesAfter.size, "league")})${below(informative, leaguesAfter.size)}.${
        cal
          ? ` In real time (US Eastern, NFL weeks from nflverse games.csv) the ${legDTimed} leg-D trades completed: ${JSON.stringify(timingOrdered)}; NFL week of completion minus leg over ${lag.length} completed trades: ${JSON.stringify(lagTally)}.`
          : " (NFL calendar unavailable: no real-time evidence.)"
      } 2026 values: ${JSON.stringify(dist("trade_deadline"))}`,
      { url: URLS.userLeagues, status: 200, path: "[].settings.trade_deadline", sample: dist("trade_deadline") },
      { url: URLS.transactions, status: 200, path: "[type=trade,status=complete].leg", sample: { dMinus1, atD, after, earlier }, note: `legs fetched per season: ${JSON.stringify(legSets)}` },
      ...(cal ? [{ url: URLS.nflGames, status: d.calendarStatus, path: "gameday by season/week → NFL week windows (Wednesday to Tuesday); [type=trade].status_updated", sample: timingOrdered }] : []),
    );
    const lagged = lag.filter((x) => x === 1).length;
    if (weekOk) {
      const stateAhead = (d.state.weekday ?? "").startsWith("Tuesday") && inSeason.length > 0 && inSeason.every((l) => l.settings.last_scored_leg === d.state.week - 1);
      const why = [
        `no trade completed after leg D in ${plural(informative, "league")} that traded at the deadline`,
        cal && lagged ? `${lagged}/${lag.length} completed trades finished in the NFL week after their leg (a league's leg advances only at its weekly waiver run)` : "",
        cal && afterWeekD ? `${afterWeekD} of ${legDTimed} leg-D trades completed on the Tuesday or Wednesday after NFL week D` : "",
        cal && duringGames ? `${duringGames} of ${legDTimed} leg-D trades completed during week D's Sunday/Monday games (no lock at kickoff)` : "",
        stateAhead ? `on this probe's Tuesday run /state/nfl already said week ${d.state.week} while last_scored_leg was ${d.state.week - 1} in every in-season league` : "",
      ].filter(Boolean);
      decisions.push(
        `Sleeper trade-deadline rule for Phase 1 (proposed): trades are open while the league's settings.leg ≤ trade_deadline, not the /state/nfl week — ${why.join("; ")}${lagged || afterWeekD ? ", so the /state/nfl week can run a week ahead of the league's leg" : ""}.`,
      );
    }

    // "No deadline": values above 17
    const maxWeekValue = Math.max(0, ...L.map((l) => l.settings.trade_deadline ?? 0).filter((v) => v <= 17));
    const sentinels = byCode(
      prev1.filter((a) => a.s.trade_deadline !== undefined && !isWeek(a.s.trade_deadline)),
      "trade_deadline",
    );
    const sentinelStats = Object.fromEntries(
      [...sentinels].map(([v, as]) => {
        const late = as.filter((a) => a.trades.some((t) => (t.leg ?? 0) > maxWeekValue));
        return [v, { leagues: as.length, leaguesWithTradesAfterLatestWeekValue: late.length, tradesAfterLatestWeekValue: as.reduce((s, a) => s + a.trades.filter((t) => (t.leg ?? 0) > maxWeekValue).length, 0), legsFetched: tally(as.flatMap((a) => a.legs)) }];
      }),
    );
    const values2026 = Object.keys(dist("trade_deadline")).filter((v) => v !== "absent" && Number(v) > 17);
    const noneOk = values2026.length > 0 && values2026.every((v) => enough(sentinelStats[v]?.leaguesWithTradesAfterLatestWeekValue ?? 0, 0));
    verification.tradeDeadlineNone = { latestWeekValue2026: maxWeekValue, values: sentinelStats };
    add(
      "CODES.tradeDeadlineNone",
      "settings.trade_deadline (no deadline)",
      values2026.length ? (noneOk ? "ok" : "warn") : "na",
      values2026.length
        ? `${noneOk ? "Verified" : "Inferred"}: ${values2026
            .map((v) => {
              const s = sentinelStats[v];
              return s ? `${v} → trades completed after week ${maxWeekValue} (the latest week value in the 2026 sample) in ${s.leaguesWithTradesAfterLatestWeekValue}/${s.leagues} finished seasons with that value (${s.tradesAfterLatestWeekValue} trades)${below(s.leaguesWithTradesAfterLatestWeekValue)}` : `${v} → not in the finished seasons`;
            })
            .join("; ")}; reading: no trade deadline. Legs fetched for these seasons: ${JSON.stringify(Object.keys(tally(prev1.filter((a) => a.s.trade_deadline !== undefined && !isWeek(a.s.trade_deadline)).flatMap((a) => a.legs))).map(Number))}. 2026: ${values2026.map((v) => `${v} in ${dist("trade_deadline")[v]} leagues`).join(", ")}`
        : "No trade_deadline value above 17 in the sample",
      { url: URLS.transactions, status: 200, path: "[type=trade,status=complete].leg > latest week value", sample: sentinelStats },
      { url: URLS.userLeagues, status: 200, path: "[].settings.trade_deadline", sample: dist("trade_deadline") },
    );
    if (values2026.length && !noneOk)
      questions.push(
        `Sleeper's no-deadline value: trades after week ${maxWeekValue} were seen in only ${values2026.map((v) => `${sentinelStats[v]?.leaguesWithTradesAfterLatestWeekValue ?? 0} league(s) with trade_deadline ${v}`).join(", ")}: treat trade_deadline ≥ 18 as "no deadline"?`,
      );
  }

  // ---- Playoff round type (the older seasons were fetched for this check: counted as seasons, not leagues)
  {
    const classified = prevAll.filter((a) => a.pattern && a.pattern !== "unclear" && a.pattern !== "single round");
    const unclear = prevAll.filter((a) => a.pattern === "unclear").length;
    const per = Object.fromEntries(
      [...byCode(classified, "playoff_round_type")].map(([v, as]) => {
        const patterns = tally(as.map((a) => a.pattern));
        const m = modal(patterns);
        const byLineage = new Map<string, Set<string>>();
        for (const a of as) byLineage.set(a.lineage, (byLineage.get(a.lineage) ?? new Set<string>()).add(a.pattern ?? "?"));
        const contra = [...byLineage.values()].filter((set) => [...set].some((pt) => pt !== m.value)).length;
        return [v, { seasons: as.length, leagues: byLineage.size, pattern: m.value, seasonsWithPattern: m.n, contradictingLeagues: contra, verified: enough(byLineage.size, contra), patterns }];
      }),
    );
    const values2026 = Object.keys(dist("playoff_round_type")).filter((v) => v !== "absent");
    const verifiedValues = Object.entries(per).filter(([, x]) => x.verified);
    const distinct = new Set(verifiedValues.map(([, x]) => x.pattern)).size === verifiedValues.length;
    const notSeen = values2026.filter((v) => !per[v]);
    const allOk = distinct && values2026.every((v) => per[v]?.verified);
    verification.playoffRoundType = {
      byCode: per,
      unclearSeasons: unclear,
      // Counts per pattern only (no per-league records): "code: weeks per round".
      weeksPerRound: tally(prevAll.filter((a) => a.roundWeeks.length).map((a) => `${a.s.playoff_round_type ?? "absent"}: ${a.roundWeeks.map((r) => r.weeks.length).join("+")}`)),
    };
    add(
      "CODES.playoffRoundType",
      "settings.playoff_round_type",
      allOk ? "ok" : "warn",
      `${allOk ? "Verified" : "Partly verified"} from winners-bracket pairings vs weekly matchups: ${Object.entries(per)
        .map(([v, x]) => `${v} → ${x.pattern} (${x.seasonsWithPattern}/${x.seasons} seasons from ${plural(x.leagues, "league")}${below(x.leagues, x.contradictingLeagues)})`)
        .join("; ")}${unclear ? `; ${unclear} season(s) unclear` : ""}${notSeen.length ? `; never seen in a finished bracket: ${notSeen.join(", ")}` : ""}. 2026 values: ${JSON.stringify(dist("playoff_round_type"))}`,
      { url: URLS.winners, status: 200, path: "[].r, [].t1, [].t2, [].p", sample: Object.fromEntries(Object.entries(per).map(([v, x]) => [v, { seasons: x.seasons, leagues: x.leagues, patterns: x.patterns }])) },
      { url: URLS.matchups, status: 200, path: "[].matchup_id (pairs per week)", note: "a round lasts the weeks in which all its main-path pairings are matchups; older seasons of the same league count as seasons, not leagues" },
    );
  }

  // ---- Playoff week start and playoff teams
  {
    const withRounds = prev1.filter((a) => a.firstPlayoffWeek !== undefined);
    const startMatches = withRounds.filter((a) => a.firstPlayoffWeek === a.pws).length;
    const zero = L.filter((l) => l.settings.playoff_week_start === 0);
    const zeroOther = zero.filter((l) => l.settings.type !== 3);
    const zeroKinds = tally(zero.map((l) => `${typeName(l.settings.type)}, ${l.status ?? "?"}${l.settings.type !== 3 ? `, playoff_teams ${l.settings.playoff_teams ?? "absent"}` : ""}`));
    const pwsMode = modal(dist("playoff_week_start"));
    add(
      "CODES.playoffWeekStart",
      "settings.playoff_week_start",
      enough(withRounds.length, withRounds.length - startMatches) && zeroOther.length === 0 ? "ok" : "warn",
      `Round 1 of the winners bracket was played in week playoff_week_start in ${frac(startMatches, withRounds.length)} finished seasons${below(withRounds.length, withRounds.length - startMatches)}. The value 0 appears in ${zero.length} 2026 leagues: ${JSON.stringify(zeroKinds)}${zeroOther.length ? ` — ${zeroOther.length} outside guillotine leagues, unexplained` : " (guillotine leagues have no playoff bracket)"}. 2026 values: ${JSON.stringify(dist("playoff_week_start"))}`,
      { url: URLS.userLeagues, status: 200, path: "[].settings.playoff_week_start", sample: dist("playoff_week_start") },
      { url: URLS.matchups, status: 200, path: "[].matchup_id", sample: tally(withRounds.map((a) => (a.firstPlayoffWeek ?? 0) - a.pws)), note: "first round-1 week minus playoff_week_start" },
    );
    if (zeroOther.length)
      issues.push(
        `Sleeper playoff_week_start is 0 in ${zeroOther.length} sampled 2026 league(s) that aren't guillotine leagues (${JSON.stringify(tally(zeroOther.map((l) => `${typeName(l.settings.type)}, ${l.status ?? "?"}, playoff_teams ${l.settings.playoff_teams ?? "absent"}`)))}), so their fantasy playoff weeks can't be read from settings — evidence: ${URLS.userLeagues} → [].settings.playoff_week_start — options: (a) treat 0 as "not set" and assume the most common start (week ${pwsMode.value}, ${pwsMode.n}/${pwsMode.total} leagues) with an Import Report warning; (b) ask the user for the first playoff week.`,
      );

    const withBracket = prev1.filter((a) => a.winners && a.s.playoff_teams !== undefined);
    const teamsMatch = withBracket.filter((a) => a.winners?.teams.length === a.s.playoff_teams).length;
    const byes = crossTab(withBracket, (a) => a.s.playoff_teams, (a) => a.winners?.byes.length);
    const byeContra = withBracket.filter((a) => (a.winners?.byes.length ?? -1) !== standardByes(a.s.playoff_teams ?? 0)).length;
    const seen = new Set(withBracket.map((a) => String(a.s.playoff_teams)));
    const teams2026 = dist("playoff_teams");
    const unseen = Object.keys(teams2026).filter((v) => v !== "absent" && !seen.has(v));
    const ok = enough(withBracket.length, withBracket.length - teamsMatch) && enough(withBracket.length, byeContra) && unseen.length === 0;
    verification.playoffTeams = { teamsMatch, leagues: withBracket.length, byesByPlayoffTeams: byes, byeRuleContradictions: byeContra, unseen2026: unseen, winnersPlacements: tally(withBracket.flatMap((a) => a.winners?.placements ?? [])) };
    add(
      "CODES.playoffTeams",
      "settings.playoff_teams",
      ok ? "ok" : "warn",
      `Distinct teams in the winners bracket = playoff_teams in ${frac(teamsMatch, withBracket.length)} finished seasons; byes = next power of two − playoff_teams in ${frac(withBracket.length - byeContra, withBracket.length)} (byes by playoff_teams: ${JSON.stringify(byes)})${unseen.length ? `; never in a finished bracket of the sample: ${unseen.map((v) => `${v} (${teams2026[v]} leagues in 2026)`).join(", ")}` : ""}. 2026 values: ${JSON.stringify(teams2026)}`,
      { url: URLS.winners, status: 200, path: "[].t1, [].t2 (first round per team)", sample: byes },
      { url: URLS.userLeagues, status: 200, path: "[].settings.playoff_teams", sample: teams2026 },
    );
    for (const v of unseen)
      questions.push(`playoff_teams = ${v} (${teams2026[v]} sampled 2026 leagues) never appeared in a finished bracket: assume the standard bracket (byes for the top ${standardByes(Number(v))} seed(s)), as CLAUDE.md §8 says?`);
  }

  // ---- Median game and start week (games per team vs regular-season weeks)
  {
    const withGames = prev1.filter((a) => a.games);
    const kind = (a: PrevAnalysis) => (a.games?.once === a.games?.teams ? "once" : a.games?.twice === a.games?.teams ? "twice" : "mixed");
    /** metadata.record has one letter per decided game: its length per regular week is 1 or 2. */
    const recordPerWeek = (a: PrevAnalysis) => a.p.standings.map((st) => (st.recordLength !== undefined && a.regularWeeks ? round2(st.recordLength / a.regularWeeks) : undefined));
    const per = Object.fromEntries(
      [...byCode(withGames, "league_average_match")].map(([v, as]) => {
        const expected = v === "1" ? "twice" : "once";
        const exceptions = as.filter((a) => kind(a) !== expected);
        return [
          v,
          {
            leagues: as.length,
            leaguesBy: tally(as.map(kind)),
            teams: as.reduce((s, a) => s + (a.games?.teams ?? 0), 0),
            recordLengthPerWeek: tally(as.flatMap(recordPerWeek)),
            contradicting: exceptions.length,
            exceptionsRecordLengthPerWeek: tally(exceptions.flatMap(recordPerWeek)),
            exceptions: tally(exceptions.map((a) => `${a.p.standings.length}-team league: ${kind(a)}`)),
            verified: enough(as.length, exceptions.length),
          },
        ];
      }),
    );
    const g0 = per["0"];
    const g1 = per["1"];
    const ok = !!g0?.verified && !!g1?.verified;
    const absent2026 = dist("league_average_match").absent ?? 0;
    verification.medianGame = per;
    add(
      "CODES.medianGame",
      "settings.league_average_match",
      ok ? "ok" : "warn",
      `${ok ? "Verified" : "Partly verified"}: W+L+T per team vs regular-season weeks (playoff_week_start − start_week) in finished seasons: ${Object.entries(per)
        .map(([v, s]) => `${v} → once per week in ${frac(s.leaguesBy.once ?? 0, s.leagues)} leagues, twice in ${frac(s.leaguesBy.twice ?? 0, s.leagues)}${s.contradicting ? ` (exceptions: ${Object.entries(s.exceptions).map(([k, n]) => `${n}× ${k}`).join("; ")})` : ""}${below(s.leagues, s.contradicting)}`)
        .join("; ")}. Reading: 1 = an extra game vs the league median each week${absent2026 ? `; missing in ${absent2026} 2026 leagues (not seen in finished seasons, so "missing = 0" is unverified)` : ""}. 2026 values: ${JSON.stringify(dist("league_average_match"))}`,
      { url: URLS.prevRosters, status: 200, path: "[].settings.wins + losses + ties; [].metadata.record length", sample: per },
      { url: URLS.userLeagues, status: 200, path: "[].settings.league_average_match", sample: dist("league_average_match") },
    );
    if (g1?.contradicting)
      issues.push(
        `Sleeper league_average_match = 1, yet every team played only once per week in ${g1.contradicting} of ${g1.leagues} finished seasons with it (${Object.entries(g1.exceptions)
          .map(([k, n]) => `${n}× ${k}`)
          .join("; ")}; metadata.record letters per regular week there: ${JSON.stringify(g1.exceptionsRecordLengthPerWeek)}) — evidence: ${URLS.prevRosters} → [].settings.wins+losses+ties and [].metadata.record vs playoff_week_start − start_week — options: (a) trust league_average_match and warn in the Import Report when last season's W+L+T disagrees; (b) derive the median game from W+L+T per week.`,
      );
    if (absent2026) absentDefaults.push(`league_average_match missing in ${absent2026} → unverified (assume 0)`);

    // start_week: finished seasons plus 2026 games so far (W+L+T after last_scored_leg).
    const fullSeason = (a: PrevAnalysis) => (a.games?.teams ?? 0) > 0 && (a.lam ? a.games?.twice : a.games?.once) === a.games?.teams;
    const late25 = withGames.filter((a) => a.startWeek > 1);
    const absent25 = withGames.filter((a) => a.s.start_week === undefined);
    const expectedSoFar = (c: Current2026) => Math.max(0, (c.settings.last_scored_leg ?? d.state.week - 1) - (c.settings.start_week ?? 1) + 1) * (c.settings.league_average_match ? 2 : 1);
    const soFar = (c: Current2026) => c.standings.length > 0 && c.standings.every((s) => s.wins + s.losses + s.ties === expectedSoFar(c));
    const cur = d.current.filter((c) => c.standings.length);
    const late26 = cur.filter((c) => (c.settings.start_week ?? 1) > 1);
    const absent26 = cur.filter((c) => c.settings.start_week === undefined);
    const lateN = late25.length + late26.length;
    const lateOk = late25.filter(fullSeason).length + late26.filter(soFar).length;
    const absentN = absent25.length + absent26.length;
    const absentOk = absent25.filter(fullSeason).length + absent26.filter(soFar).length;
    const unexplained26 = late26.filter((c) => !soFar(c));
    verification.startWeek = {
      previousSeasons: { startAfterWeek1: late25.length, matched: late25.filter(fullSeason).length, keyAbsent: absent25.length, absentMatchedWeek1: absent25.filter(fullSeason).length },
      season2026SoFar: { startAfterWeek1: late26.length, matched: late26.filter(soFar).length, keyAbsent: absent26.length, absentMatchedWeek1: absent26.filter(soFar).length, startWeeks: tally(late26.map((c) => c.settings.start_week)) },
    };
    const absentByStatus = tally(L.filter((l) => l.settings.start_week === undefined).map((l) => `${l.status ?? "?"}${l.settings.type === 3 ? " (guillotine)" : ""}`));
    add(
      "CODES.startWeek",
      "settings.start_week",
      enough(lateN, lateN - lateOk) && (absentN === 0 || enough(absentN, absentN - absentOk)) ? "ok" : "warn",
      `First week of the fantasy season: games played (W+L+T) match start_week … playoff_week_start − 1 (finished seasons) or start_week … last_scored_leg (2026 so far) in ${frac(lateOk, lateN)} leagues starting after week 1${lateOk < lateN ? ` (${lateN - lateOk} unexplained)` : ""}${below(lateN, lateN - lateOk)}; the key is missing in ${JSON.stringify(absentByStatus)} 2026 leagues${absentN ? ` (those played from week 1 in ${frac(absentOk, absentN)})` : ""}. 2026 values: ${JSON.stringify(dist("start_week"))}`,
      { url: URLS.curRosters, status: 200, path: "[].settings.wins + losses + ties", sample: verification.startWeek },
      { url: URLS.userLeagues, status: 200, path: "[].settings.start_week", sample: dist("start_week") },
    );
    if (unexplained26.length)
      issues.push(
        `Sleeper start_week doesn't match the games already played in ${unexplained26.length} in-season 2026 league(s): ${JSON.stringify(
          tally(unexplained26.map((c) => `start_week ${c.settings.start_week}, last_scored_leg ${c.settings.last_scored_leg ?? "?"}, expected ${expectedSoFar(c)} games per team, found ${JSON.stringify(tally(c.standings.map((s) => s.wins + s.losses + s.ties)))}`)),
        )} — evidence: ${URLS.curRosters} → [].settings.wins/losses/ties vs ${URLS.userLeagues} → [].settings.start_week, last_scored_leg — options: (a) take completed games from rosters (W+L+T) and matchups rather than from start_week; (b) flag the league in the Import Report when they disagree.`,
      );
    if (absentN && absentOk < absentN) absentDefaults.push(`start_week missing: played from week 1 in ${frac(absentOk, absentN)} leagues`);
    else if (absentN) absentDefaults.push(`start_week missing → 1 (${absentOk}/${absentN} leagues)`);
  }

  // ---- Best ball: finished seasons plus 2026 points so far
  {
    const rows = [
      ...prev1.map((a) => ({ v: String(a.s.best_ball ?? "absent"), o: a.optimal, season: a.p.season ?? "?", lineage: a.lineage })),
      ...d.current.filter((c) => c.standings.length).map((c) => ({ v: String(c.settings.best_ball ?? "absent"), o: optimalLineupShare(c.standings), season: "2026", lineage: c.leagueId })),
    ];
    const per = Object.fromEntries(
      [...new Set(rows.map((r) => r.v))].sort(compareKeys).map((v) => {
        const rs = rows.filter((r) => r.v === v && r.o.withPotential > 0);
        const allOptimal = new Set(rs.filter((r) => r.o.withPotential >= 2 && r.o.optimal === r.o.withPotential).map((r) => r.lineage));
        const notAll = new Set(rs.filter((r) => r.o.optimal < r.o.withPotential).map((r) => r.lineage));
        const leagues = new Set(rs.map((r) => r.lineage)).size;
        const contraSet = v === "1" ? notAll : allOptimal;
        const contraRows = rs.filter((r) => contraSet.has(r.lineage) && (v === "1" ? r.o.optimal < r.o.withPotential : r.o.optimal === r.o.withPotential));
        return [
          v,
          {
            leagues,
            bySeason: tally(rs.map((r) => r.season)),
            teams: rs.reduce((s, r) => s + r.o.withPotential, 0),
            optimal: rs.reduce((s, r) => s + r.o.optimal, 0),
            contradicting: contraSet.size,
            contradictingBySeason: tally(contraRows.map((r) => r.season)),
            contradictingTeamsAtPotential: contraRows.map((r) => `${r.o.optimal}/${r.o.withPotential}`),
            verified: enough(leagues, contraSet.size),
          },
        ];
      }),
    );
    const b1 = per["1"];
    const b0 = per["0"];
    const bAbs = per.absent;
    const absent2026 = dist("best_ball").absent ?? 0;
    const ok = !!b1?.verified && !!b0?.verified && (absent2026 === 0 || !!bAbs?.verified);
    verification.bestBall = per;
    add(
      "CODES.bestBall",
      "settings.best_ball",
      ok ? "ok" : "warn",
      `${ok ? "Verified" : "Partly verified"}: points scored = potential (optimal-lineup) points for ${Object.entries(per)
        .map(([v, s]) => `${v} → ${frac(s.optimal, s.teams)} teams (${plural(s.leagues, "league")}: ${Object.entries(s.bySeason).map(([y, n]) => `${n} in ${y}`).join(", ")}${below(s.leagues, s.contradicting)}${s.contradicting ? ` (${Object.entries(s.contradictingBySeason).map(([y, n]) => `${n} in ${y}`).join(", ")}, teams at potential there: ${s.contradictingTeamsAtPotential.join(", ")})` : ""})`)
        .join("; ")}. Reading: 1 = best ball (Sleeper sets the optimal lineup)${bAbs ? `; missing behaves like 0${bAbs.verified ? " ✓" : " (not enough leagues)"}` : ""}. 2026 values: ${JSON.stringify(dist("best_ball"))}`,
      { url: URLS.prevRosters, status: 200, path: "[].settings.fpts(+_decimal) vs [].settings.ppts(+_decimal)", sample: per, note: "finished seasons and 2026 weeks so far (league/{leagueId}/rosters)" },
      { url: URLS.userLeagues, status: 200, path: "[].settings.best_ball", sample: dist("best_ball") },
    );
    if (absent2026) absentDefaults.push(`best_ball missing in ${absent2026} → 0${bAbs?.verified ? " (verified)" : " (unverified)"}`);
    const bb2026 = L.filter((l) => l.settings.best_ball === 1).length;
    if (bb2026)
      issues.push(
        `Sleeper has best-ball leagues (settings.best_ball = 1 in ${bb2026}/${L.length} sampled 2026 leagues; points = potential points for ${b1 ? frac(b1.optimal, b1.teams) : "0/0"} teams), which CLAUDE.md doesn't mention — evidence: ${URLS.prevRosters} → [].settings.fpts vs ppts — options: (a) import them normally (the engine already values optimal lineups) and say "best ball" in the Import Report; (b) reject them for the MVP.`,
      );
  }

  // ---- Playoff type (consolation bracket)
  {
    const style = (a: PrevAnalysis): string => {
      if (!a.losers || !a.losers.matches) return "no losers bracket";
      const adv = a.losersAdv;
      if (!adv || adv.higherScorer + adv.lowerScorer === 0) return "unknown";
      if (adv.lowerScorer > adv.higherScorer) return "losers advance (toilet bowl)";
      return "winners advance (consolation)";
    };
    const known = (s: string) => s === "losers advance (toilet bowl)" || s === "winners advance (consolation)";
    const per = Object.fromEntries(
      [...byCode(prev1.filter((a) => a.winners), "playoff_type")].map(([v, as]) => {
        const styles = tally(as.map(style));
        const knownStyles = Object.fromEntries(Object.entries(styles).filter(([k]) => known(k)));
        const m = modal(knownStyles);
        const contra = m.total - m.n;
        return [
          v,
          {
            leagues: as.length,
            losersBracket: styles,
            reading: m.value,
            informative: m.total,
            contradicting: contra,
            verified: enough(m.total, contra),
            losersMatches: tally(as.map((a) => a.losers?.matches ?? 0)),
            winnersPlacements: tally(as.flatMap((a) => a.winners?.placements ?? [])),
            winnersBracketWinnerIsHigherScorer: frac(
              as.reduce((s, a) => s + (a.winnersAdv?.higherScorer ?? 0), 0),
              as.reduce((s, a) => s + (a.winnersAdv?.higherScorer ?? 0) + (a.winnersAdv?.lowerScorer ?? 0), 0),
            ),
          },
        ];
      }),
    );
    const verified = Object.entries(per).filter(([, s]) => s.verified);
    const distinct = new Set(verified.map(([, s]) => s.reading)).size === verified.length;
    const values2026 = Object.keys(dist("playoff_type")).filter((v) => v !== "absent");
    const allOk = distinct && values2026.every((v) => per[v]?.verified);
    verification.playoffType = per;
    add(
      "CODES.playoffType",
      "settings.playoff_type",
      allOk ? "ok" : "warn",
      `${allOk ? "Verified" : "Partly verified"} from losers_bracket winners vs matchup points: ${Object.entries(per)
        .map(([v, s]) => `${v} → ${s.reading || "?"} (${s.informative - s.contradicting}/${s.informative} leagues with a decided consolation game${below(s.informative, s.contradicting)})`)
        .join("; ")}. 2026 values: ${JSON.stringify(dist("playoff_type"))}`,
      { url: URLS.losers, status: 200, path: "[].w vs matchups[].points", sample: per },
      { url: URLS.userLeagues, status: 200, path: "[].settings.playoff_type", sample: dist("playoff_type") },
    );
  }

  // ---- Seeding (record then points) and playoff_seed_type (re-seeding?)
  {
    const withFit = prev1.filter((a) => a.winners?.complete && a.p.standings.length);
    const edited = withFit.filter((a) => a.p.hasBracketOverrides);
    const clean = withFit.filter((a) => !a.p.hasBracketOverrides);
    const divOn = (a: PrevAnalysis) => (a.s.divisions ?? 0) > 0;
    const noDiv = clean.filter((a) => !divOn(a));
    const noDivFit = noDiv.filter((a) => a.fits.record).length;
    const withDiv = clean.filter(divOn);
    // Leagues where the two rules predict different brackets tell them apart.
    const informative = withDiv.filter((a) => a.fits.divisionsFirst !== undefined && a.fits.record !== a.fits.divisionsFirst);
    const divFirstWins = informative.filter((a) => a.fits.divisionsFirst).length;
    const misfits = clean.filter((a) => !a.fits.record && !a.fits.divisionsFirst);
    verification.divisionSeeding = { leaguesWithDivisions: withDiv.length, informative: informative.length, divisionWinnersFirstFits: divFirstWins, seedTypeOfInformative: tally(informative.map((a) => a.s.playoff_seed_type)) };
    // Counts only (privacy: no per-league records).
    verification.seedingMisfits = {
      unexplained: misfits.length,
      unexplainedFitPointsOnly: misfits.filter((a) => a.fits.points).length,
      unexplainedWithMedianGame: misfits.filter((a) => a.lam).length,
      editedBrackets: edited.length,
      editedBracketsFittingARule: edited.filter((a) => a.fits.record || a.fits.divisionsFirst).length,
    };
    add(
      "CODES.seeding",
      "Playoff seeding rule",
      enough(noDiv.length, noDiv.length - noDivFit) ? "ok" : "warn",
      `Seeds = record (win %), then points for: teams, byes and round-1 pairings match in ${frac(noDivFit, noDiv.length)} complete brackets without divisions (settings.divisions 0 or missing; ${edited.length} commissioner-edited brackets left out)${below(noDiv.length, noDiv.length - noDivFit)}. With divisions (${plural(withDiv.length, "league")}), division winners seeded first explained ${divFirstWins} of the ${informative.length} where the two rules differ${informative.length ? ` (playoff_seed_type there: ${JSON.stringify(tally(informative.map((a) => a.s.playoff_seed_type)))})` : ""}${misfits.length ? `; unexplained: ${misfits.length}` : ""}`,
      { url: URLS.winners, status: 200, path: "[r=1].t1/t2 and bye teams", sample: { noDivisions: { leagues: noDiv.length, fitsRecordThenPoints: noDivFit }, withDivisions: verification.divisionSeeding, edited: edited.length } },
      { url: URLS.prevRosters, status: 200, path: "[].settings.wins/losses/ties/fpts/division" },
    );
    if (informative.length && divFirstWins === informative.length)
      questions.push(`With divisions, Sleeper seeded division winners first in ${divFirstWins}/${informative.length} informative league(s)${enough(informative.length) ? "" : ` (below the ${EVIDENCE.minClean}-league minimum)`}: model seeding that way for leagues with divisions?`);

    const withTop = prev1.filter((a) => a.topSeed);
    const per = Object.fromEntries(
      [...byCode(withTop, "playoff_seed_type")].map(([v, as]) => {
        const ev = tally(as.map((a) => (a.topSeed ? seedRuleEvidence(a.topSeed) : "unknown")));
        return [v, { leagues: as.length, evidence: ev, fromGameByPlayoffTeams: crossTab(as, (a) => a.s.playoff_teams, (a) => a.topSeed?.fromGame) }];
      }),
    );
    const informativeOf = (v: string) => {
      const e = per[v]?.evidence ?? {};
      return { fixed: e.fixed ?? 0, reseed: e.reseed ?? 0, neither: e.neither ?? 0, total: (e.fixed ?? 0) + (e.reseed ?? 0) + (e.neither ?? 0) };
    };
    const i0 = informativeOf("0");
    const i1 = informativeOf("1");
    const fixed0 = enough(i0.total, i0.reseed + i0.neither) && i0.fixed > 0;
    const reseed1 = enough(i1.total, i1.fixed + i1.neither) && i1.reseed > 0;
    const values2026 = Object.keys(dist("playoff_seed_type")).filter((v) => v !== "absent");
    const others = values2026.filter((v) => v !== "0" && v !== "1");
    verification.playoffSeedType = per;
    add(
      "CODES.playoffSeedType",
      "settings.playoff_seed_type",
      fixed0 && reseed1 && others.length === 0 ? "ok" : "warn",
      `${fixed0 && reseed1 ? "Verified" : "Inferred"} from the top seed's round-2 opponent, in brackets where a fixed bracket and re-seeding predict different opponents (a lower seed won in round 1): 0 → fixed-bracket opponent in ${frac(i0.fixed, i0.total)} leagues${below(i0.total, i0.reseed + i0.neither)}; 1 → lowest remaining seed in ${frac(i1.reseed, i1.total)} leagues${below(i1.total, i1.fixed + i1.neither)}; uninformative brackets: ${(per["0"]?.evidence.same ?? 0) + (per["1"]?.evidence.same ?? 0)}. Reading: 0 = fixed bracket${fixed0 ? " ✓" : ""}, 1 = re-seed after each round${reseed1 ? " ✓" : ""}${others.length ? `; not checked: ${others.join(", ")}` : ""}. 2026 values: ${JSON.stringify(dist("playoff_seed_type"))}`,
      { url: URLS.winners, status: 200, path: "[r=2].t1/t2 vs seeds", sample: per },
      { url: URLS.userLeagues, status: 200, path: "[].settings.playoff_seed_type", sample: dist("playoff_seed_type") },
    );
    const reseed2026 = L.filter((l) => l.settings.playoff_seed_type === 1).length;
    if (reseed2026)
      issues.push(
        `Sleeper supports playoff re-seeding (playoff_seed_type 1 in ${reseed2026}/${L.length} sampled 2026 leagues; in ${i1.reseed}/${i1.total} informative finished brackets seed 1 then played the lowest remaining seed), but CLAUDE.md §8 only says to seed by wins, then points-for — evidence: ${URLS.winners} → [r=2] pairings vs seeds from ${URLS.prevRosters} — options: (a) re-seed after each round in the simulator when playoff_seed_type = 1; (b) ignore it (it only changes who meets whom after round 1).`,
      );
  }

  // ---- Waiver type
  {
    const per = Object.fromEntries(
      [...byCode(prev1, "waiver_type")].map(([v, as]) => {
        const withClaims = as.filter((a) => a.waivers.length);
        const claims = as.flatMap((a) => a.waivers);
        const rhos = as.map((a) => a.waiverCorr).filter((x): x is number => x !== undefined);
        return [
          v,
          {
            leagues: as.length,
            leaguesWithClaims: withClaims.length,
            leaguesWithBidlessClaims: withClaims.filter((a) => a.waivers.some((c) => c.waiverBid === undefined)).length,
            waiverClaims: claims.length,
            claimsWithBid: claims.filter((c) => c.waiverBid !== undefined).length,
            claimSettingsKeys: tally(claims.flatMap((c) => c.settingsKeys)),
            waiverBudget: tally(as.map((a) => a.s.waiver_budget)),
            waiverOrderVsStandingsRho: rhos.map((x) => round2(x) ?? 0).sort((a, b) => a - b),
          },
        ];
      }),
    );
    verification.waiverType = per;
    const faab = per["2"];
    const faabOk = !!faab && faab.waiverClaims > 0 && enough(faab.leaguesWithClaims, faab.leaguesWithBidlessClaims);
    const r0 = per["0"]?.waiverOrderVsStandingsRho ?? [];
    const r1 = per["1"]?.waiverOrderVsStandingsRho ?? [];
    const noBids = (v: string) => (per[v]?.waiverClaims ?? 0) > 0 && per[v]?.claimsWithBid === 0;
    // Reverse standings should give a strongly negative ρ (worst team claims first); rolling needn't.
    const separable = r0.length >= EVIDENCE.minClean && r1.length >= EVIDENCE.minClean && Math.max(...r1) < Math.min(...r0);
    const reverseOk = separable && enough(r1.length, r1.filter((x) => x > -0.5).length) && noBids("1");
    const ok = faabOk && reverseOk && noBids("0");
    add(
      "CODES.waiverType",
      "settings.waiver_type",
      ok ? "ok" : "warn",
      `${ok ? "Verified" : "Partly verified"}: ${Object.entries(per)
        .map(([v, s]) => `${v} → bids on ${frac(s.claimsWithBid, s.waiverClaims)} waiver claims (${plural(s.leaguesWithClaims, "league")}), final waiver order vs standings rank ρ per league ${numbersText(s.waiverOrderVsStandingsRho)}`)
        .join("; ")}. Reading: 2 = FAAB${faabOk ? " ✓" : ""}; 1 = reverse standings and 0 = rolling ${reverseOk ? "✓" : `are inferred (the final waiver order ${separable ? "separates them but on too few leagues" : "doesn't separate them: the ρ ranges overlap"})`}. 2026 values: ${JSON.stringify(dist("waiver_type"))}`,
      { url: URLS.transactions, status: 200, path: "[type=waiver].settings.waiver_bid", sample: Object.fromEntries(Object.entries(per).map(([v, s]) => [v, { claims: s.waiverClaims, withBid: s.claimsWithBid, leagues: s.leaguesWithClaims }])) },
      { url: URLS.prevRosters, status: 200, path: "[].settings.waiver_position vs record rank (Spearman ρ)", sample: Object.fromEntries(Object.entries(per).map(([v, s]) => [v, s.waiverOrderVsStandingsRho])) },
    );
  }

  // ---- FAAB budget
  {
    const faab = prev1.filter((a) => a.s.waiver_type === 2 && (a.s.waiver_budget ?? 0) > 0 && a.p.standings.some((s) => s.waiverBudgetUsed !== undefined));
    const budget = (a: PrevAnalysis) => a.s.waiver_budget ?? 0;
    const spentOver = faab.filter((a) => a.p.standings.some((s) => (s.waiverBudgetUsed ?? 0) > budget(a)));
    const bidOver = faab.filter((a) => a.waivers.some((w) => (w.waiverBid ?? 0) > budget(a)));
    const over = new Set([...spentOver, ...bidOver].map((a) => a.lineage)).size;
    const halfSpent = faab.filter((a) => a.p.standings.some((s) => (s.waiverBudgetUsed ?? 0) >= 0.5 * budget(a))).length;
    const maxShare = Math.max(0, ...faab.flatMap((a) => a.p.standings.map((s) => (s.waiverBudgetUsed ?? 0) / budget(a))));
    add(
      "CODES.waiverBudget",
      "settings.waiver_budget",
      enough(faab.length, over) && halfSpent > 0 ? "ok" : "warn",
      `FAAB budget per team for the season: in ${faab.length} finished FAAB seasons no team spent more than waiver_budget (${spentOver.length} over; highest share spent ${pct(maxShare)}), no single bid exceeded it (${bidOver.length} over), and some team spent at least half of it in ${halfSpent}${below(faab.length, over)}. 2026 values in FAAB leagues: ${JSON.stringify(tally(L.filter((l) => l.settings.waiver_type === 2).map((l) => l.settings.waiver_budget)))}`,
      { url: URLS.prevRosters, status: 200, path: "[].settings.waiver_budget_used vs settings.waiver_budget", sample: { leagues: faab.length, spentOver: spentOver.length, halfSpent } },
      { url: URLS.transactions, status: 200, path: "[type=waiver].settings.waiver_bid", sample: { bidOver: bidOver.length } },
    );
  }

  // ---- Divisions (only settings.divisions > 0 means divisions: rosters can keep stale numbers)
  {
    const distinctDiv = (a: PrevAnalysis) => new Set(a.p.standings.map((s) => s.division).filter((x) => x !== undefined)).size;
    const withDiv = prev1.filter((a) => (a.s.divisions ?? 0) > 0);
    const match = withDiv.filter((a) => distinctDiv(a) === a.s.divisions).length;
    const noDiv = prev1.filter((a) => !((a.s.divisions ?? 0) > 0) && a.p.standings.length);
    const stale = noDiv.filter((a) => distinctDiv(a) >= 2);
    add(
      "CODES.divisions",
      "settings.divisions",
      enough(withDiv.length, withDiv.length - match) ? "ok" : "warn",
      `Number of divisions: distinct rosters[].settings.division values = divisions in ${frac(match, withDiv.length)} finished seasons with divisions${below(withDiv.length, withDiv.length - match)}; with divisions 0 or missing, rosters still carry ≥ 2 division values in ${frac(stale.length, noDiv.length)} seasons (stale numbers), so only settings.divisions > 0 means divisions. 2026 values: ${JSON.stringify(dist("divisions"))}`,
      { url: URLS.prevRosters, status: 200, path: "[].settings.division", sample: { withDivisions: tally(withDiv.map((a) => `${a.s.divisions} set, ${distinctDiv(a)} on rosters`)), divisionsOffWithRosterValues: tally(noDiv.map((a) => distinctDiv(a))) } },
      { url: URLS.userLeagues, status: 200, path: "[].settings.divisions", sample: dist("divisions") },
    );
    if (stale.length)
      issues.push(
        `Sleeper rosters[].settings.division keeps division numbers after divisions are turned off: ≥ 2 distinct values in ${stale.length} of ${noDiv.length} finished seasons with settings.divisions 0 or missing — evidence: ${URLS.prevRosters} → [].settings.division vs ${URLS.prevLeague} → settings.divisions — options: read divisions (and division seeding) only when settings.divisions > 0 (this probe's seeding check does).`,
      );
  }

  // ---- Reserve (IR) and taxi slots
  for (const [key, code, field] of [
    ["CODES.reserveSlots", "reserve_slots", "reserve"],
    ["CODES.taxiSlots", "taxi_slots", "taxi"],
  ] as const) {
    const withRosters = prev1.filter((a) => a.p.standings.length);
    const over = withRosters.filter((a) => a.p.standings.some((s) => s[field] > (a.s[code] ?? 0)));
    const full = withRosters.filter((a) => (a.s[code] ?? 0) > 0 && a.p.standings.some((s) => s[field] === a.s[code]));
    const used = withRosters.filter((a) => a.p.standings.some((s) => s[field] > 0));
    add(
      key,
      `settings.${code}`,
      enough(withRosters.length, over.length) && full.length > 0 ? "ok" : "warn",
      `Max ${field === "reserve" ? "IR" : "taxi"} players per team: no team exceeded ${code} in ${frac(withRosters.length - over.length, withRosters.length)} finished seasons; at least one team at the limit in ${full.length}; any ${field} use in ${used.length}${below(withRosters.length, over.length)}. 2026 values: ${JSON.stringify(dist(code))}`,
      { url: URLS.prevRosters, status: 200, path: `[].${field}.length`, sample: { leagues: withRosters.length, over: over.length, atLimit: full.length } },
      { url: URLS.userLeagues, status: 200, path: `[].settings.${code}`, sample: dist(code) },
    );
  }

  // ---- Teams
  {
    const withBoth = L.filter((l) => l.totalRosters !== undefined && l.settings.num_teams !== undefined);
    const eq = withBoth.filter((l) => l.totalRosters === l.settings.num_teams).length;
    add(
      "CODES.numTeams",
      "settings.num_teams",
      enough(withBoth.length, withBoth.length - eq) ? "ok" : "warn",
      `num_teams = total_rosters in ${frac(eq, withBoth.length)} 2026 leagues. Values: ${JSON.stringify(dist("num_teams"))}`,
      { url: URLS.userLeagues, status: 200, path: "[].settings.num_teams vs [].total_rosters", sample: dist("num_teams") },
    );
  }

  // ---- Keepers
  {
    const keeperDrafts = L.filter((l) => l.picks && l.picks.keepers > 0);
    const over = keeperDrafts.filter((l) => (l.picks?.maxKeepersPerRoster ?? 0) > (l.settings.max_keepers ?? 0));
    const byType = crossTab(L, (l) => l.settings.type, (l) => l.settings.max_keepers);
    add(
      "CODES.maxKeepers",
      "settings.max_keepers",
      enough(keeperDrafts.length, over.length) ? "ok" : "warn",
      `Keeper picks per team never exceeded max_keepers in ${frac(keeperDrafts.length - over.length, keeperDrafts.length)} 2026 drafts with keepers${below(keeperDrafts.length, over.length)}; max_keepers by league type: ${JSON.stringify(byType)}`,
      { url: URLS.picks, status: 200, path: "[is_keeper=true] per roster_id", sample: { draftsWithKeepers: keeperDrafts.length, overLimit: over.length, maxPerTeam: tally(keeperDrafts.map((l) => l.picks?.maxKeepersPerRoster)) } },
      { url: URLS.userLeagues, status: 200, path: "[].settings.max_keepers", sample: dist("max_keepers") },
    );
  }

  // ---- Trades: disable_trades, pick_trading, trade review
  {
    const weeksOf = (as: readonly PrevAnalysis[]) => {
      const all = as.flatMap((a) => Object.values(a.p.transactions));
      return { leagueWeeks: all.length, withTrade: all.filter((txs) => txs.some((t) => t.type === "trade" && t.status === "complete")).length };
    };
    const tradesIn = (as: readonly PrevAnalysis[]) => ({ leagues: as.length, leaguesWithTrades: as.filter((a) => a.trades.length).length, trades: as.reduce((s, a) => s + a.trades.length, 0), tradesWithPicks: as.reduce((s, a) => s + a.trades.filter((t) => t.draftPicks > 0).length, 0) });

    // disable_trades: compare each league type's seasons with trading off against seasons of the
    // same type with trading on (guillotine leagues trade differently from the rest).
    const dis = Object.fromEntries([...byCode(prev1, "disable_trades")].map(([v, as]) => [v, { ...tradesIn(as), ...weeksOf(as), types: tally(as.map((a) => typeName(a.s.type))) }]));
    const off = prev1.filter((a) => a.s.disable_trades === 1);
    const offWithTrades = off.filter((a) => a.trades.length).length;
    const perType = [...new Set(off.map((a) => a.s.type))]
      .sort((x, y) => (x ?? -1) - (y ?? -1))
      .map((t) => {
        const offT = off.filter((a) => a.s.type === t);
        const ctlT = prev1.filter((a) => a.s.disable_trades === 0 && a.s.type === t);
        const wOffT = weeksOf(offT);
        const wCtlT = weeksOf(ctlT);
        const rate = wCtlT.leagueWeeks ? wCtlT.withTrade / wCtlT.leagueWeeks : undefined;
        return {
          type: typeName(t),
          offSeasons: offT.length,
          offLeagueWeeks: wOffT.leagueWeeks,
          offTrades: offT.reduce((sum, a) => sum + a.trades.length, 0),
          controlSeasons: ctlT.length,
          controlLeagueWeeks: wCtlT.leagueWeeks,
          controlWeeksWithTrade: wCtlT.withTrade,
          chanceOfNoTrade: rate === undefined ? undefined : Math.round(10000 * (1 - rate) ** wOffT.leagueWeeks) / 10000,
        };
      });
    // A type without a same-type control, or whose control had no trade either, can't show anything.
    const uncontrolled = perType.filter((x) => x.chanceOfNoTrade === undefined || x.controlWeeksWithTrade === 0);
    const pNone = perType.reduce((prod, x) => prod * (x.chanceOfNoTrade ?? 1), 1);
    const off2026 = L.filter((l) => l.settings.disable_trades === 1);
    const offOther2026 = off2026.filter((l) => l.settings.type !== 3);
    const disOk = enough(off.length, offWithTrades) && uncontrolled.length === 0 && pNone < 0.01;
    const pctText = (x: number) => (x < 0.001 ? "< 0.1%" : `${(100 * x).toFixed(1)}%`);
    verification.disableTrades = { bySetting: dis, byLeagueType: perType, chanceOfNoTradeIfTradingWereOn: Math.round(10000 * pNone) / 10000 };
    add(
      "CODES.disableTrades",
      "settings.disable_trades",
      disOk ? "ok" : "warn",
      `Completed trades in the sampled weeks: ${Object.entries(dis)
        .map(([v, x]) => `${v} → ${x.trades} trades in ${x.leaguesWithTrades}/${x.leagues} seasons (a trade in ${x.withTrade}/${x.leagueWeeks} league-weeks; ${JSON.stringify(x.types)})`)
        .join("; ")}. ${
        off.length
          ? `Against seasons of the same league type with trading on: ${perType
              .map((x) =>
                x.chanceOfNoTrade === undefined
                  ? `${x.type}: ${x.offTrades} trades in ${x.offLeagueWeeks} league-weeks with trading off, but no ${x.type} season with trading on to compare`
                  : `${x.type}: ${x.offTrades} trades in ${x.offLeagueWeeks} league-weeks off vs a trade in ${x.controlWeeksWithTrade}/${x.controlLeagueWeeks} league-weeks in ${plural(x.controlSeasons, "season")} on (chance of no trade if trading were on: ${pctText(x.chanceOfNoTrade)})`,
              )
              .join("; ")}${uncontrolled.length ? ` — not comparable for ${uncontrolled.map((x) => x.type).join(", ")}` : `; combined ${pctText(pNone)}`}${below(off.length, offWithTrades)}.`
          : "No finished season with disable_trades = 1."
      } 2026: disable_trades 1 in ${off2026.length} leagues (${JSON.stringify(tally(off2026.map((l) => typeName(l.settings.type))))}); ${offOther2026.length} outside guillotine leagues, ${offOther2026.filter((l) => l.previousLeagueId).length} of them with a previous season. Reading: 1 = trading turned off${disOk ? " ✓" : " (inferred: key name and no trades seen, but not enough comparable seasons)"}`,
      { url: URLS.transactions, status: 200, path: "[type=trade,status=complete] per league-week", sample: perType, note: "weeks D−1…D+1 (or 15–17) for every season, plus weeks 4–8 for seasons with trading off and as many with it on (same league type first)" },
      { url: URLS.userLeagues, status: 200, path: "[].settings.disable_trades × [].settings.type", sample: crossTab(L, (l) => l.settings.disable_trades, (l) => typeName(l.settings.type)) },
    );

    // pick_trading: pick trades only happen in some league types, so compare within those types.
    const pkKey = (a: PrevAnalysis) => `${a.s.pick_trading ?? "absent"} × ${typeName(a.s.type)}`;
    const pkTable = Object.fromEntries(
      [...new Set(prev1.map(pkKey))].sort().map((k) => {
        const t = tradesIn(prev1.filter((a) => pkKey(a) === k));
        return [k, `${t.tradesWithPicks}/${t.trades} trades with picks (${plural(t.leagues, "season")})`];
      }),
    );
    const pickTypes = new Set(prev1.filter((a) => a.trades.some((t) => t.draftPicks > 0)).map((a) => a.s.type));
    const pickTypeNames = [...pickTypes].sort((x, y) => (x ?? -1) - (y ?? -1)).map(typeName);
    const tradingSeasons = prev1.filter((a) => pickTypes.has(a.s.type) && a.trades.length);
    const zero = tradingSeasons.filter((a) => a.s.pick_trading === 0);
    const zeroWithPicks = zero.filter((a) => a.trades.some((t) => t.draftPicks > 0)).length;
    const oneWithPicks = tradingSeasons.filter((a) => a.s.pick_trading === 1 && a.trades.some((t) => t.draftPicks > 0)).length;
    const zero2026 = L.filter((l) => pickTypes.has(l.settings.type) && l.settings.pick_trading === 0);
    const pickOk = pickTypes.size > 0 && enough(zero.length, zeroWithPicks) && enough(oneWithPicks, 0);
    verification.pickTrading = { byCodeAndType: pkTable, typesWithPickTrades: pickTypeNames, pickTrading0SeasonsWithTradesInThoseTypes: zero.length, pickTrading0In2026InThoseTypes: tally(zero2026.map((l) => typeName(l.settings.type))) };
    add(
      "CODES.pickTrading",
      "settings.pick_trading",
      pickOk ? "ok" : "warn",
      `Trades that include draft picks, by pick_trading × league type: ${JSON.stringify(pkTable)}. ${
        pickTypes.size
          ? `Pick trades happen only in ${pickTypeNames.join(" and ")} leagues; there, pick_trading 1 → pick trades in ${plural(oneWithPicks, "season")}, pick_trading 0 → ${zeroWithPicks} of ${plural(zero.length, "season")} with trades had one${below(zero.length, zeroWithPicks)}`
          : "No trade with draft picks in the sample"
      }. Reading: 1 = draft picks can be traded${pickOk ? " ✓" : ` — inferred from the key name (2026: pick_trading 0 in ${zero2026.length} ${pickTypeNames.join("/")} leagues)`}. 2026 pick_trading × type: ${JSON.stringify(crossTab(L, (l) => l.settings.pick_trading, (l) => typeName(l.settings.type)))}`,
      { url: URLS.transactions, status: 200, path: "[type=trade].draft_picks", sample: pkTable },
      { url: URLS.userLeagues, status: 200, path: "[].settings.pick_trading", sample: dist("pick_trading") },
    );

    // Trade review: is there a veto poll, and does a trade wait before it completes?
    // Hours from created (proposal) to status_updated (completion) include the partner's time to
    // accept, so they bound any review hold from above: a trade done within 24 h rules out a 2-day hold.
    const hoursOf = (t: TxLite) => (t.created !== undefined && t.statusUpdated !== undefined ? (t.statusUpdated - t.created) / 3_600_000 : undefined);
    const reviewStats = (as: readonly PrevAnalysis[]) => {
      const trades = as.flatMap((a) => a.trades);
      const hours = trades.map(hoursOf).filter((h): h is number => h !== undefined);
      const byDays = Object.fromEntries(
        [...byCode([...as], "trade_review_days")].map(([days, bs]) => {
          const hs = bs.flatMap((a) => a.trades.map(hoursOf)).filter((h): h is number => h !== undefined);
          return [days, { seasons: bs.length, trades: hs.length, medianHours: round1(median(hs)), minHours: round1(hs.length ? Math.min(...hs) : undefined), maxHours: round1(hs.length ? Math.max(...hs) : undefined), under24h: hs.filter((h) => h < 24).length }];
        }),
      );
      return {
        leagues: as.length,
        leaguesWithTrades: as.filter((a) => a.trades.length).length,
        trades: trades.length,
        withVetoPoll: trades.filter((t) => t.metadataKeys.includes("poll_id")).length,
        leaguesWithPolledTrades: as.filter((a) => a.trades.some((t) => t.metadataKeys.includes("poll_id"))).length,
        leaguesWithUnpolledTrades: as.filter((a) => a.trades.some((t) => !t.metadataKeys.includes("poll_id"))).length,
        medianHours: round1(median(hours)),
        under24h: hours.filter((h) => h < 24).length,
        atLeast48h: hours.filter((h) => h >= 48).length,
        byReviewDays: byDays,
      };
    };
    const byPoll = Object.fromEntries([...byCode(prev1, "veto_auto_poll")].map(([v, as]) => [v, reviewStats(as)]));
    const olderByPoll = Object.fromEntries([...byCode(prevOlder, "veto_auto_poll")].map(([v, as]) => [v, reviewStats(as)]));
    const on = byPoll["1"];
    const offP = byPoll["0"];
    const absent = byPoll.absent;
    const pollOnOk = !!on && enough(on.leaguesWithTrades, on.leaguesWithUnpolledTrades);
    const pollOffOk = !!offP && enough(offP.leaguesWithTrades, offP.leaguesWithPolledTrades);
    // trade_review_days as the length of the veto vote: poll-on trades that finished sooner contradict it.
    const vote = prev1.filter((a) => a.s.veto_auto_poll === 1).flatMap((a) => a.trades.map((t) => ({ h: hoursOf(t), days: a.s.trade_review_days ?? 0 })));
    const voteSooner = vote.filter((x) => x.h !== undefined && x.h < 24 * x.days).length;
    const voteHeld = vote.filter((x) => x.h !== undefined && x.h >= 24 * x.days).length;
    // Poll off with review days ≥ 1: completions within 24 h show no enforced hold.
    const offHold = prev1.filter((a) => a.s.veto_auto_poll === 0 && (a.s.trade_review_days ?? 0) >= 1);
    const offHoldHours = offHold.flatMap((a) => a.trades.map(hoursOf)).filter((h): h is number => h !== undefined);
    const offUnder24 = offHoldHours.filter((h) => h < 24).length;
    const absent2026 = L.filter((l) => !("veto_auto_poll" in l.settings));
    const absentOk = !!absent && enough(absent.leaguesWithTrades, absent.leaguesWithPolledTrades);
    const reviewOk = pollOnOk && pollOffOk && voteSooner === 0 && (absent2026.length === 0 || absentOk);
    const days = (s: ReturnType<typeof reviewStats>) =>
      Object.entries(s.byReviewDays)
        .map(([k, x]) => `${k} day(s): ${x.trades ? `${x.under24h}/${x.trades} within 24 h, ${x.minHours}–${x.maxHours} h` : "no trades"}`)
        .join("; ");
    verification.tradeReview = {
      byVetoAutoPoll: byPoll,
      olderSeasonsOfTheSameLeagues: olderByPoll,
      tradeSettingsKeys: tally(prev1.flatMap((a) => a.trades.flatMap((t) => t.settingsKeys))),
      tradeMetadataKeys: tally(prev1.flatMap((a) => a.trades.flatMap((t) => t.metadataKeys))),
    };
    add(
      "CODES.tradeReview",
      "settings.veto_auto_poll / trade_review_days",
      reviewOk ? "ok" : "warn",
      `${reviewOk ? "Verified" : "Partly verified"} (hours from proposal to completion, which include the partner's time to accept): veto_auto_poll = 1 → ${
        on ? `${on.withVetoPoll}/${on.trades} completed trades carried a veto poll (metadata.poll_id) in ${plural(on.leaguesWithTrades, "league")}${below(on.leaguesWithTrades, on.leaguesWithUnpolledTrades)}; ${days(on)}` : "not in the finished seasons"
      }; 0 → ${offP ? `${offP.withVetoPoll}/${offP.trades} with a poll (${plural(offP.leaguesWithTrades, "league")}); with trade_review_days ≥ 1, ${offUnder24}/${offHoldHours.length} trades completed within 24 h${offUnder24 ? ", so no enforced hold was seen" : offHoldHours.length ? " (consistent with a hold)" : ""}; ${days(offP)}` : "not in the finished seasons"}; key missing → ${
        absent ? `${absent.withVetoPoll}/${absent.trades} with a poll in ${plural(absent.leaguesWithTrades, "league")}; ${days(absent)}${absentOk ? "" : " — unverified"}` : "not in the finished seasons (unverified)"
      }. trade_review_days as the length of the veto vote: ${voteHeld} poll trades took at least that long, ${voteSooner} finished sooner${voteSooner ? " (contradicted)" : ""}. Older seasons of the same leagues (not counted): ${JSON.stringify(Object.fromEntries(Object.entries(olderByPoll).map(([v, s]) => [v, { trades: s.trades, atLeast48h: s.atLeast48h }])))}. 2026: veto_auto_poll ${JSON.stringify(dist("veto_auto_poll"))}, trade_review_days ${JSON.stringify(dist("trade_review_days"))}; veto keys missing in ${absent2026.length} leagues (${absent2026.filter((l) => !l.previousLeagueId).length} of them new)`,
      { url: URLS.transactions, status: 200, path: "[type=trade].metadata.poll_id; .status_updated − .created", sample: Object.fromEntries(Object.entries(byPoll).map(([v, s]) => [v, { leagues: s.leaguesWithTrades, trades: s.trades, withVetoPoll: s.withVetoPoll, under24h: s.under24h, atLeast48h: s.atLeast48h }])) },
      { url: URLS.userLeagues, status: 200, path: "[].settings.veto_auto_poll, trade_review_days, veto_votes_needed, veto_show_votes", sample: crossTab(L, (l) => l.settings.veto_auto_poll, (l) => l.settings.trade_review_days) },
    );
    decisions.push(
      `Sleeper tradeReview mapping (proposed): 'league_vote' when settings.veto_auto_poll = 1 (${on ? `${on.withVetoPoll}/${on.trades} such trades had a veto poll` : "not seen"}), otherwise 'none' (${offP ? `with the poll off, ${offUnder24}/${offHoldHours.length} trades in leagues with trade_review_days ≥ 1 completed within 24 h` : "not seen"}); veto keys missing (${absent2026.length} 2026 leagues) → 'none' with an Import Report warning until verified; 'commissioner' is never produced (no approval step in the data).`,
    );
    questions.push(
      `Reconcile with probe:sleeper A.tradeReview: should Phase 1 map Sleeper tradeReview from veto_auto_poll (1 → 'league_vote', else 'none') rather than from trade_review_days, given that with the poll off ${offUnder24}/${offHoldHours.length} trades with trade_review_days ≥ 1 completed within 24 h?`,
    );
    if (absent2026.length) absentDefaults.push(`veto_auto_poll/veto_votes_needed missing in ${absent2026.length} → 'none'${absentOk ? " (verified)" : " (unverified)"}`);
  }

  // ---- Current week fields
  {
    const scoredOk = inSeason.filter((l) => l.settings.last_scored_leg === d.state.week - 1).length;
    add(
      "CODES.lastScoredLeg",
      "settings.last_scored_leg",
      enough(inSeason.length, inSeason.length - scoredOk) ? "ok" : "warn",
      `last_scored_leg = the last completed NFL week (${d.state.week - 1}; /state/nfl week is ${d.state.week}) in ${frac(scoredOk, inSeason.length)} in-season 2026 leagues`,
      { url: URLS.userLeagues, status: 200, path: "[].settings.last_scored_leg", sample: tally(inSeason.map((l) => l.settings.last_scored_leg)) },
      { url: URLS.state, status: 200, path: "week, display_week", sample: { week: d.state.week, display_week: d.state.displayWeek } },
    );
    const legByDay = crossTab(inSeason, (l) => l.settings.waiver_day_of_week, (l) => l.settings.leg);
    const oneLegPerDay = Object.values(legByDay).every((t) => Object.keys(t).length === 1);
    const advanced = inSeason.filter((l) => l.settings.leg === d.state.week).length;
    verification.legByWaiverDay = legByDay;
    decisions.push("Sleeper currentWeek comes from /state/nfl (week); settings.leg lags until the league's weekly waiver run, and settings.last_scored_leg is the last completed week.");
    add(
      "CODES.leg",
      "settings.leg / waiver_day_of_week",
      "warn",
      `leg is the league's own current week, not the NFL week: on the probe day (${d.state.weekday ?? "?"} of NFL week ${d.state.week}) it was ${d.state.week} in ${frac(advanced, inSeason.length)} leagues and ${d.state.week - 1} in the rest. By waiver_day_of_week → leg: ${JSON.stringify(legByDay)}${oneLegPerDay ? " — each waiver day maps to one leg value, so leg advances when the league's weekly waivers run" : ""}. Not verified: which weekday each waiver_day_of_week value means. Use /state/nfl week for the current week`,
      { url: URLS.userLeagues, status: 200, path: "[].settings.leg by [].settings.waiver_day_of_week", sample: legByDay },
      { url: URLS.state, status: 200, path: "week", sample: d.state.week },
    );
    add("CODES.status", "League status values", "ok", `status: ${JSON.stringify(tally(L.map((l) => l.status)))}; season_type: ${JSON.stringify(tally(L.map((l) => l.seasonType)))}`, {
      url: URLS.userLeagues,
      status: 200,
      path: "[].status",
      sample: tally(L.map((l) => l.status)),
    });
  }

  // ---- Roster positions and scoring keys
  {
    const slotLeagues = tally(L.flatMap((l) => [...new Set(l.rosterPositions)]));
    const unknown = Object.keys(slotLeagues).filter((s) => !KNOWN_SLOTS.includes(s));
    const bench = tally(L.map((l) => l.rosterPositions.filter((s) => s === "BN").length));
    const sf = L.filter((l) => l.rosterPositions.includes("SUPER_FLEX") || l.rosterPositions.filter((s) => s === "QB").length >= 2).length;
    const idp = L.filter((l) => l.rosterPositions.some((s) => ["DL", "LB", "DB", "IDP_FLEX"].includes(s))).length;
    meta.rosterPositions = { leaguesWithSlot: slotLeagues, benchSlots: bench, superflexOr2QB: sf, idp, noKicker: L.filter((l) => !l.rosterPositions.includes("K")).length, noDefense: L.filter((l) => !l.rosterPositions.includes("DEF")).length };
    add(
      "CODES.rosterPositions",
      "roster_positions slot names",
      unknown.length ? "warn" : "ok",
      `${Object.keys(slotLeagues).length} slot names seen${unknown.length ? `, not in the spec's list: ${unknown.join(", ")}` : ", all in the spec's list"}; superflex/2QB ${frac(sf, L.length)}, IDP ${frac(idp, L.length)}; bench sizes ${JSON.stringify(bench)}`,
      { url: URLS.userLeagues, status: 200, path: "[].roster_positions[]", sample: slotLeagues },
    );
    if (unknown.length) issues.push(`Sleeper roster_positions has slot names not listed in CLAUDE.md §2.3: ${unknown.join(", ")} — evidence: ${URLS.userLeagues} → [].roster_positions[] (${unknown.map((u) => `${u}: ${slotLeagues[u]} leagues`).join(", ")}). Options: add them to the Sleeper slot map with their eligible positions.`);
    const keys = tally(L.flatMap((l) => l.scoringNonzero));
    meta.scoringKeysNonzero = Object.fromEntries(Object.entries(keys).sort((a, b) => b[1] - a[1]));
    add(
      "CODES.scoringKeys",
      "scoring_settings keys in use",
      "ok",
      `${Object.keys(keys).length} distinct scoring keys with a non-zero value across ${L.length} leagues (full list with counts in meta.scoringKeysNonzero, for the Phase 1 scoring map)`,
      { url: URLS.userLeagues, status: 200, path: "[].scoring_settings", sample: Object.fromEntries(Object.entries(keys).sort((a, b) => b[1] - a[1]).slice(0, 12)) },
    );
  }

  // ---- Draft player type
  {
    const withPicks = L.filter((l) => l.picks && l.picks.withYearsExp > 0 && l.draft);
    const per = Object.fromEntries(
      [...new Set(withPicks.map((l) => String(l.draft?.playerType ?? "absent")))].sort(compareKeys).map((v) => {
        const ls = withPicks.filter((l) => String(l.draft?.playerType ?? "absent") === v);
        const shares = ls.map((l) => (l.picks ? l.picks.rookies / l.picks.withYearsExp : 0));
        return [v, { drafts: ls.length, rookieShareMedian: round2(median(shares)) ?? 0, rookieOnly: shares.filter((x) => x >= 0.95).length, withVeterans: shares.filter((x) => x < 0.95).length }];
      }),
    );
    const one = per["1"];
    const zero = per["0"];
    // 1 = rookies only: a draft with veterans contradicts. 0 = all players: drafts with veterans support it
    // (a rookie-only draft doesn't contradict: in a dynasty league only rookies may be left).
    const ok1 = !!one && enough(one.drafts, one.withVeterans);
    const ok0 = !!zero && enough(zero.withVeterans, 0);
    const values2026 = Object.keys(tally(L.map((l) => l.draft?.playerType))).filter((v) => v !== "absent");
    const unchecked = values2026.filter((v) => v !== "0" && v !== "1");
    add(
      "CODES.draftPlayerType",
      "draft settings.player_type",
      ok0 && ok1 && unchecked.length === 0 ? "ok" : "warn",
      `Rookie share of picks by draft player_type: ${Object.entries(per)
        .map(([v, s]) => `${v} → median ${pct(s.rookieShareMedian)}, rookie-only ${s.rookieOnly}/${s.drafts} drafts`)
        .join("; ")}. Reading: 1 = rookies only${ok1 ? " ✓" : ` (${below(one?.drafts ?? 0, one?.withVeterans ?? 0).replace(/^; /, "")})`}, 0 = all players${ok0 ? " ✓" : ""}${unchecked.length ? `; not checked: ${unchecked.join(", ")}` : ""}. Draft types: ${JSON.stringify(tally(L.map((l) => l.draft?.type)))}`,
      { url: URLS.picks, status: 200, path: "[].metadata.years_exp", sample: per },
      { url: URLS.userDrafts, status: 200, path: "[].settings.player_type", sample: tally(L.map((l) => l.draft?.playerType)) },
    );
  }

  // ---- Position limits: counted on the active roster and on everything, separately
  {
    const keys = [...new Set(L.flatMap((l) => Object.keys(l.settings).filter((k) => k.startsWith("position_limit_"))))].sort();
    const withKeys2026 = L.filter((l) => hasLimits(l.settings)).length;
    type Obs = { lineage: string; season: string; checks: LimitCheck[]; groups: RosterGroups[] };
    const obs: Obs[] = [];
    if (d.positionOf) {
      for (const a of prev1) if (a.p.rosterGroups?.length && hasLimits(a.s)) obs.push({ lineage: a.lineage, season: a.p.season ?? "?", checks: positionLimitChecks(a.s, a.p.rosterGroups, d.positionOf), groups: a.p.rosterGroups });
      for (const c of d.current) if (c.rosterGroups?.length && hasLimits(c.settings)) obs.push({ lineage: c.leagueId, season: "2026 so far", checks: positionLimitChecks(c.settings, c.rosterGroups, d.positionOf), groups: c.rosterGroups });
    }
    const limits = obs.flatMap((o) => o.checks);
    const informative = obs.filter((o) => o.checks.some((c) => c.maxActive >= c.limit || c.maxAll > c.limit));
    const contra = obs.filter((o) => o.checks.some((c) => c.exceededActive));
    const viaReserve = obs.filter((o) => o.checks.some((c) => c.overOnlyViaReserve > 0));
    const viaTaxi = obs.filter((o) => o.checks.some((c) => c.overOnlyViaTaxi > 0));
    const exAll = limits.filter((c) => c.maxAll > c.limit).length;
    const exActive = limits.filter((c) => c.exceededActive).length;
    const atLimit = limits.filter((c) => c.atLimitActive).length;
    const inPlayers = groupsInPlayers(obs.flatMap((o) => o.groups));
    const capOk = enough(lineagesOf(informative), lineagesOf(contra));
    const irOk = lineagesOf(viaReserve) >= EVIDENCE.minClean;
    verification.positionLimits = {
      leagues: lineagesOf(obs),
      rosterSets: tally(obs.map((o) => o.season)),
      limitsChecked: limits.length,
      exceededOnActiveRosters: exActive,
      reachedOnActiveRosters: atLimit,
      exceededCountingReserveAndTaxi: exAll,
      leaguesOverOnlyViaReserve: lineagesOf(viaReserve),
      leaguesOverOnlyViaTaxi: lineagesOf(viaTaxi),
      reserveAndTaxiInPlayers: inPlayers,
    };
    add(
      "CODES.positionLimits",
      "settings.position_limit_*",
      keys.length ? (capOk && irOk ? "ok" : "warn") : "na",
      keys.length
        ? `Keys seen: ${keys.map((k) => `${k} (${L.filter((l) => k in l.settings).length} leagues)`).join(", ")}. Rosters vs the limit (${limits.length} limits in ${plural(lineagesOf(obs), "league")}: ${obs.filter((o) => o.season !== "2026 so far").length} final ${Object.keys(tally(obs.filter((o) => o.season !== "2026 so far").map((o) => o.season))).join("/")} rosters and ${obs.filter((o) => o.season === "2026 so far").length} in-season 2026 rosters): on active rosters (players[] minus reserve and taxi) ${exActive} exceeded and ${atLimit} were reached exactly; counting reserve and taxi too, ${exAll} exceeded — over the limit only through IR (reserve) players in ${plural(lineagesOf(viaReserve), "league")}${lineagesOf(viaTaxi) ? `, only through taxi players in ${lineagesOf(viaTaxi)}` : ""}. players[] includes ${inPlayers.reserveInPlayers}/${inPlayers.reserve} reserve and ${inPlayers.taxiInPlayers}/${inPlayers.taxi} taxi players. Reading: a cap on the active roster${capOk ? " ✓" : below(lineagesOf(informative), lineagesOf(contra))}, IR exempt${irOk ? " ✓" : ` (seen in ${plural(lineagesOf(viaReserve), "league")}; below the ${EVIDENCE.minClean}-league minimum)`}`
        : "No position_limit_* keys in the sample",
      { url: URLS.userLeagues, status: 200, path: "[].settings.position_limit_{pos}", sample: Object.fromEntries(keys.map((k) => [k, dist(k)])) },
      { url: URLS.prevRosters, status: 200, path: "[].players[], [].reserve[], [].taxi[] (positions from /players/nfl); also league/{leagueId}/rosters for 2026", sample: verification.positionLimits },
    );
    if (keys.length) {
      issues.push(
        `Sleeper position limits live in settings.position_limit_{pos} (${keys.join(", ")}; ${withKeys2026}/${L.length} sampled 2026 leagues), which CLAUDE.md §2.3's settings list doesn't mention; the rosters checked fit a cap on the active roster with IR exempt (${exActive} of ${limits.length} limits exceeded on active rosters; ${plural(lineagesOf(viaReserve), "league")} over a limit only through IR players) — evidence: ${URLS.prevRosters} and ${URLS.curRosters} → [].players/reserve/taxi with positions from /players/nfl vs settings.position_limit_{pos} — options: (a) map them to LeagueSettings.positionLimits and enforce them on the active roster (IR and taxi exempt) per CLAUDE.md §7; (b) only warn on the trade card until more leagues confirm the IR exemption.`,
      );
      questions.push(`Sleeper position limits appear to exempt IR (seen in ${plural(lineagesOf(viaReserve), "league")}): enforce them on the active roster only (players minus reserve and taxi), per CLAUDE.md §7?`);
    }
  }

  // ---- Everything else: distributions only
  {
    const keys = Object.keys((meta.distributions2026 as Record<string, Tally> | undefined) ?? {}).filter((k) => !COVERED.has(k) && !k.startsWith("position_limit_"));
    add(
      "CODES.other",
      "Other numeric settings",
      "warn",
      `${keys.length} more codes reported as distributions only (meaning not verified): ${keys.join(", ")}`,
      { url: URLS.userLeagues, status: 200, path: "[].settings.*", sample: Object.fromEntries(keys.slice(0, 6).map((k) => [k, dist(k)])), note: "full distributions in meta.distributions2026" },
    );
  }

  meta.evidenceRule = EVIDENCE_RULE;
  meta.verification = verification;
  if (absentDefaults.length) decisions.push(`Sleeper omits settings keys freely; Phase 1 defaults for missing keys (from this sample): ${absentDefaults.join("; ")}.`);
  decisions.push(`Evidence rule for this item: ${EVIDENCE_RULE}.`);
  decisions.push(
    "Sampling: snowball through league member lists, at most 5 new leagues per user so a few very active accounts can't dominate; previous seasons chosen greedily so every value of each code is covered where available. Every ordering uses a random salt kept only in data-local/ (git-ignored), so the committed code can't reproduce which public leagues were sampled.",
  );
  return { checks, meta, issues, decisions, questions };
}
