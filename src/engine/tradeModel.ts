/**
 * Trade search, evaluation and the Trade Analyzer: the types the engine fills (src/engine/evaluate.ts,
 * search.ts, rank.ts, explain.ts) and the Trade Finder, Trade Analyzer and report read (CLAUDE.md §10–§13;
 * planner reply to Checkpoint 3). Pure types only.
 *
 * Units: B and its parts are §10's benefit points; probabilities are fractions in [0, 1]; ΔPO and ΔCH are
 * fractions too (+0.04 = 4 percentage points); ΔPPW and ΔLineup are projected points per week; values are
 * FantasyCalc units (perception term, §9); ROS points are §6 step 7's (Σ p over the remaining weeks).
 */
import type { AcceptanceTerms, ActivitySummary, ContextTerm } from "./acceptance";
import type { InjuryStatus } from "./model";

/** One side's asset in a trade: a player (canonical id) or a draft pick (dynasty and keeper leagues). */
export type TradeAsset = { kind: "player"; id: string } | { kind: "pick"; season: number; round: number; originalTeamId: string };

/** A trade between my team and one partner: what I give and what I get. */
export interface TradeProposal {
  partnerId: string;
  give: TradeAsset[];
  get: TradeAsset[];
}

/** Moves the roster limits force on a team after the trade (§7 roster legality), shown on the card. */
export interface RosterChange {
  /** Players dropped because the active roster would be over maxRosterSize (lowest keep value first). */
  drops: string[];
  /** Free agents added because it would be under it (the best available). */
  adds: string[];
  /**
   * Phase 4b (IR players; planner reply to Checkpoint 4, change 5): received IR players who go into an open IR slot of
   * this team (legality rule 5), so they take no active roster spot until they return. Absent or empty: none.
   */
  toIR?: string[];
  /**
   * Phase 4b: players this team drops from a week on, when an IR player comes back and the active roster is full (the
   * displacement on the team's final roster after the trade, after its free-agent optimizer: src/engine/returners.ts),
   * ⚠️ only the ones its baseline at V*(T) doesn't have (evaluate.ts rosterChangeOf: a displacement the team makes with
   * or without the trade isn't the trade's move, and B doesn't count it). `returner` is the IR player whose return forces
   * it (the player himself when he's released at his return), `week` the NFL week from which the drop counts. Absent or
   * empty: none.
   */
  displaced?: { playerId: string; week: number; returner: string }[];
}

/** §11's features for the partner, as the model used them (the feedback export stores them). */
export interface AcceptanceFeatures {
  /**
   * The partner's g as they perceive it, clamped to config.acceptance.gClamp: g_mkt(P) with the star premium on the
   * players they give (planner addendum to Checkpoint 3, §1, after the value floor of the planner's reply to Checkpoint
   * 4, change 4: v′ = max(v, W) × (1 + e)). TradeEvaluation.gPartner keeps the market reading without the premium.
   */
  g: number;
  /** ΔLineup_P / nScale, clamped (before the contender factor). */
  n: number;
  /** 1 when the trade fills a hole in P's lineup. */
  h: 0 | 1;
  /** Players in the trade − 2. */
  c: number;
  /** Activity: +1, 0, −1 or −2. */
  a: number;
  /** Average g_mkt(P) over P's completed trades (clamped), null without any. */
  hist: number | null;
  /** Season context term (already in logit units). */
  ctx: number;
  /** Recency term: +bonus, 0 or −bonus. */
  hot: number;
  /** Deadline urgency term. */
  urg: number;
  /** The logit z (§11's model) before the clamp. */
  z: number;
}

export interface TradeEvaluation {
  /** Stable id of the proposal (sorted assets): dedupe, diversity and feedback records use it. */
  key: string;
  proposal: TradeProposal;
  /** Null for a legal trade; else why not, in plain English (the Analyzer shows it; the search drops it). */
  illegal: string | null;
  /** How far the evaluation went (§12): screened (fast lineups), exact (scenario lineups), final (5,000 seasons). */
  stage: "screened" | "exact" | "final";
  /** Seasons simulated behind B (0 = not simulated yet). */
  sims: number;
  /** Moves the roster limits force (§7), per side. */
  required: { me: RosterChange; partner: RosterChange };

  // The three numbers (§10)
  /** B, my benefit (null before simulation). */
  b: number | null;
  /** "Helps you": round(100 × (1 − e^(−B / bRef))) when B > 0; null otherwise. */
  tradeScore: number | null;
  /** §11: P_accept and P_complete (the veto rule applied). */
  pAccept: number;
  pComplete: number;
  /** "Long shot" | "Possible" | "Decent" | "Likely" (config.acceptance.labels, from P_accept). */
  acceptLabel: string;
  /** "Overall": round(100 × (1 − e^(−(B × P_complete) / bRef))) when B > 0; null otherwise. */
  overall: number | null;

  // The numbers behind them (§10 "always show")
  /** Changes in my P(playoffs), P(title) and expected wins (null before simulation). */
  dPO: number | null;
  dCH: number | null;
  dEW: number | null;
  /** Changes in my average weekly starting points: remaining regular-season weeks, and playoff weeks. */
  dPPW: number;
  dPPWPlayoffs: number;
  /** §10 parts: B_win, B_future (dynasty and keeper; null in redraft or when missing), λ (null in redraft). */
  bWin: number | null;
  bFuture: number | null;
  lambda: number | null;
  /** Change in my roster's dynasty value (dynasty and keeper), null in redraft or when missing. */
  dDyn: number | null;
  /** A keeper league whose dynasty values didn't load: ΔDyn is missing and the card says so (Checkpoint 2). */
  dynMissing: boolean;
  /**
   * My package values (§9, perception): what I give and what I get, each player at max(v, W) (the value floor on both
   * sides, planner reply to Checkpoint 4, change 4: a player worth less than the best free agent counts at that free
   * agent's value W), plus W for each open roster spot on the side that gets fewer players. Roster spots are my active
   * roster's (review of Phase 4b track E: an IR slot isn't one, market.ts's header): W on what I get for each spot it
   * opens, on what I give for each it fills, which is the same thing when no IR player moves.
   */
  value: { given: number; received: number };
  /**
   * g_mkt for my side and the partner's (§9), on those packages (each player at max(v, W)), without the star premium (the
   * partner's perceived g, with it, is features.g).
   */
  gMine: number;
  gPartner: number;
  /** ROS points (§6 step 7) of the players I give and get. */
  ros: { given: number; received: number };
  /** ΔLineup_P (points per week, §11's n before scaling): the change in the partner's weekly starting points. */
  partnerDeltaLineup: number;
  features: AcceptanceFeatures;

  /** Risk flags (§10 guards), shown apart from the three numbers. */
  flags: {
    /** g_mkt(me) < marketCheckBelow: "Market check". */
    marketCheck: boolean;
    /** g_mkt(me) < marketHideBelow: hidden by default. */
    hiddenByMarket: boolean;
    /** B ≤ 0: hidden by default. */
    hiddenByBenefit: boolean;
    /** Players I'd get whose status is in config.benefit.injuredStatuses: "depends on an injured player". */
    injured: string[];
    /**
     * Every injury-tagged player on either side (planner reply to Checkpoint 4, change 6): status other than ACTIVE
     * (explain.injuryTags, from snapshot.players, with explain.tagContextOf: the week now and the League model's word on
     * which conflicted Probable, Questionable or Doubtful players follow their ESPN return date). evaluate.ts withWords sets
     * it on every finished evaluation, the Trade Finder's cards and the Analyzer's alike. Absent on a core (before its
     * words) and on an evaluation stored before Phase 4b: the cards then read the tags from the snapshot
     * (src/lib/tradeView.ts), without that word, so such a player's far date isn't said there.
     */
    tagged?: InjuryTag[];
  };
  /** What the explanations and the Analyzer read besides the numbers above (ids only, no names). */
  detail: TradeDetail;
  /**
   * "Offer first / if they say no" (planner addendum to Checkpoint 3, §4): absent when no step qualifies (or before the
   * addendum). Ranking and the three numbers above stay the ranked trade's.
   */
  steps?: TradeSteps;
  /**
   * "If they say no, try:" (planner reply to Checkpoint 4, change 6): on a Trade Finder card without steps, the best other
   * exactly evaluated trade with the same partner that still helps (B > 0, Helps you at least config.search.planB.
   * minHelpsShare of the card's, not hidden by the market guard) and, ⚠️ since the review of track F, is likelier to go
   * through (P_complete at least config.search.steps.minAcceptGain above the card's), the same players of theirs first,
   * with at most config.ranking.perGivenPlayerInTop20 boxes adding the same player of mine, and ⚠️ never a trade the list
   * shows as a card itself (final review of Phase 4b) (src/engine/planB.ts). Absent when none qualifies, on a card with
   * steps, and in the Analyzer.
   */
  planB?: PlanB;
  /** Plain-English reasons (§13), most important first (src/engine/explain.ts). */
  reasons: string[];
  /** The copy-ready pitch message (§13), leading with what the partner gains (src/engine/explain.ts). */
  pitch: string;
}

/** An injury-tagged player in a trade (TradeEvaluation.flags.tagged). */
export interface InjuryTag {
  playerId: string;
  /** "give": a player of mine; "get": one I'd receive. */
  side: "give" | "get";
  status: Exclude<InjuryStatus, "ACTIVE">;
  /**
   * PlayerInfo.injuryReturnWeek when known and his projection counts on it (explain.injuryTags, review of track F): OUT
   * from next week on; IR, PUP and SUSPENDED after this week; a Probable, Questionable or Doubtful player's far ESPN date
   * only when his projection follows it (§6 step 3's conflict); never NA. After the NFL's last week = out for the season.
   */
  returnWeek?: number;
}

/** A Plan B (TradeEvaluation.planB): its proposal and its three numbers on the card's basis (the final simulation). */
export interface PlanB {
  proposal: TradeProposal;
  /** proposalKey of the proposal. */
  key: string;
  b: number;
  tradeScore: number;
  pAccept: number;
  pComplete: number;
  acceptLabel: string;
  overall: number;
  /** "samePlayers": a different package for the same players of theirs; "otherTarget": a different target. */
  kind: "samePlayers" | "otherTarget";
}

/** One version of a trade in "Offer first / if they say no" (§4 of the addendum): exact evaluation + the screening simulation. */
export interface TradeStep {
  proposal: TradeProposal;
  /** proposalKey of the proposal. */
  key: string;
  /** B at config.simulation.screeningSims seasons (the screening block), the Trade Score from it, and the acceptance numbers. */
  b: number | null;
  tradeScore: number | null;
  pAccept: number;
  pComplete: number;
  acceptLabel: string;
  /** g_mkt for my side and the partner's, each player at max(v, W), without the star premium (as TradeEvaluation's). */
  gMine: number;
  gPartner: number;
  /** The forced roster moves of this version (§7 legality). */
  required: { me: RosterChange; partner: RosterChange };
  /** This version's explanation facts (the pitch names the offer-first version and reads its partner-side facts). */
  detail: TradeDetail;
}

/**
 * The two steps (§4 of the addendum). A throw-in is one of my players whose loss costs me at most
 * config.search.throwInMaxCost ROS lineup points (scenario lineups) against my free-agent-optimized roster.
 * - The ranked trade gives a throw-in (and keeps a player on my side without it): offer first = the trade without my
 *   lowest-value throw-in; if they say no, add it back (= the ranked trade). `ranked` = "full".
 * - Otherwise: offer first = the ranked trade; if they say no, add the throw-in that raises the chance they accept most
 *   while B stays at least config.search.steps.minBShare of the offer's. `ranked` = "offerFirst".
 * Shown only when the full version's P_complete is at least minAcceptGain above the offer-first's, which is at least
 * minOfferFirst, and the offer-first version helps me (B > 0 on the screening block; so does case 2's full version). The
 * Analyzer gives steps only to a trade the Trade Finder could show (B > 0, not hidden by the market guard).
 */
export interface TradeSteps {
  offerFirst: TradeStep;
  ifNo: { add: string; full: TradeStep };
  ranked: "full" | "offerFirst";
}

/** The star premium on one player the partner would give (§1 of the addendum), for the explanations and the tags. */
export interface PremiumFact {
  playerId: string;
  /** e = e_rank + e_elite (after the dynasty rebuilding halving). */
  e: number;
  /** His rank by market value on the partner's roster (1 = their most valuable), and whether he's top eliteTop by FantasyCalc value. */
  rank: number;
  elite: boolean;
  /** e ≥ config.acceptance.starPremium.harderToGetMin: the "Harder to get" tag. */
  harderToGet: boolean;
}

/** A TradeEvaluation before its words: what src/engine/explain.ts reads. */
export type TradeEvaluationCore = Omit<TradeEvaluation, "reasons" | "pitch">;

/**
 * One slot instance's starter before and after a trade (§13 "Your RB2 spot goes from 9.1 to 14.3 projected points
 * per week"): average projected points per week over the remaining regular-season weeks team numbers count, from
 * the team's V* lineups (§7) before and after (scenario lineups in exact evaluation).
 */
export interface SlotChange {
  /** Slot instance key (needs.slotInstances: "QB1", "RB2", "FLEX1", "DEF1"; LeagueModel.slots). */
  key: string;
  before: number;
  after: number;
}

/**
 * The facts behind a trade's explanations (§13) that the card's numbers don't carry: ids and numbers only, so the
 * report script can word them with placeholder names (explain.ts takes the names separately).
 */
export interface TradeDetail {
  myTeamId: string;
  /** Every one of my slot instances (LeagueModel.slots order), before and after. */
  mySlots: SlotChange[];
  /** Every one of the partner's slot instances, with the partner's rank there among all teams before the trade (1 = best, by the same averages; every team at V*). */
  partnerSlots: (SlotChange & { rank: number })[];
  /** Teams in the league ("9th of 10"). */
  teams: number;
  /** The partner's holes (§11 h: instance keys) and the ones this trade fills (acceptance.holeFeature). */
  holes: string[];
  holesFilled: string[];
  /** Each acceptance feature's contribution to z (what moved the estimate most: acceptance.AcceptanceResult.terms). */
  terms: AcceptanceTerms;
  /** The veto rule halved P_complete (the card shows both numbers). */
  vetoRisk: boolean;
  /** The partner's activity (§11 a) and its completed trades this season with their average g_mkt(P) (unclamped; null without any valued). */
  activity: ActivitySummary;
  history: { trades: number; average: number | null };
  /** §11 season context for the partner. */
  context: ContextTerm;
  /** Players the partner would receive / give up who are hot (§11 hot: canonical ids). */
  hotReceived: string[];
  hotGiven: string[];
  /** The deadline urgency term (§11 urg; 0 when it doesn't apply). */
  urgency: number;
  /** My starting points per remaining week (LeagueModel.weeks order), V* lineups before and after (a week in progress: the same number both times). */
  weekly: { week: number; before: number; after: number }[];
  /**
   * My remaining regular-season weeks (that team numbers count) the League page would flag as risky before the trade:
   * under config.leaguePage.riskyWinChance to win (on the printed whole percent), or riskyByes or more of my likely
   * starters on bye (likely starter: in my V* EV lineup in at least half of the counted weeks he plays).
   */
  riskyWeeks: number[];
  /** Plain-English notes about this evaluation (benefit.benefitNotes: title odds missing, long-term values missing; evaluate.ts's own). */
  notes: string[];
  /** The star premium on each player the partner gives (§1 of the addendum); absent before the addendum. */
  premium?: PremiumFact[];
}

/** Sort options (§13): Overall (default), Helps you (B), Chance they accept (P_complete, among B > 0). */
export type TradeSort = "overall" | "helps" | "accept";

/** Search stages, in order (the progress bar and the per-stage timings use them). */
export type TradeSearchStage = "setup" | "screening" | "exact" | "simScreen" | "simFinal" | "rank";

export interface TradeSearchProgress {
  stage: TradeSearchStage;
  /** Work done and total in this stage (for example trades evaluated of 200). */
  done: number;
  total: number;
}

export interface TradeSearchResult {
  /** The top config.search.resultsShown trades after ranking and diversity (§13), Overall order. */
  trades: TradeEvaluation[];
  /** My team, and its baseline odds (every team at V*, config.simulation.finalSims seasons); null fields when not simulated. */
  myTeamId: string | null;
  baseline: { pPlayoffs: number | null; pTitle: number | null; expWins: number | null };
  /** Trades the ranking kept out by default (§10 guards: B ≤ 0, or g_mkt(me) below marketHideBelow), counted. */
  hidden: { byBenefit: number; byMarket: number };
  /**
   * Trades the final ranking's variety rules left out (§13 diversity, rank.ts RankedTrades.dropped: over the per-partner
   * cap in the top 20, over the per-core cap, filler variants, and over Phase 4b's given-player cap in the top 20),
   * counted so a page can say so. The search always sets it (every key, 0 when it stops before ranking); optional only
   * so that fakes needn't (end-of-Phase-4 review, finding 5).
   */
  dropped?: { partnerCap: number; core: number; filler: number; givenPlayer: number };
  /** Counts per stage: candidates screened, exactly evaluated, simulated at 1,000 and at 5,000 seasons. */
  counts: { screened: number; exact: number; simScreen: number; simFinal: number };
  /** Milliseconds per stage (TradeSearchStage keys) and "total". */
  timings: Record<string, number>;
  /** Plain-English notes (for example: "Kickers and D/STs are left out; turn them on in Settings."). */
  notes: string[];
  warnings: string[];
}
