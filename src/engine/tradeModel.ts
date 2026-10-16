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
import type { HelpsScale } from "./benefit";
import type { InjuryStatus, Pos } from "./model";
import type { PrizeDeltas, PrizeOdds, Reward } from "./reward";

/** One side's asset in a trade: a player (canonical id) or a draft pick (dynasty and keeper leagues). */
export type TradeAsset = { kind: "player"; id: string } | { kind: "pick"; season: number; round: number; originalTeamId: string };

/** A trade between my team and one partner: what I give and what I get. */
export interface TradeProposal {
  partnerId: string;
  give: TradeAsset[];
  get: TradeAsset[];
}

/**
 * A roster spot a trade opened and the free agent legality's rule 4 put into it (RosterChange.openSpots; Phase 7c, planner
 * reply to Checkpoint 7b, section 5: "fill each open spot with the best available free agent at a position where the team
 * gave more players than it received"; evaluate.ts's header, rule 4).
 */
export interface OpenSpot {
  playerId: string;
  /**
   * The position he fills: one where the team gave more players than it received, his own (the card: "the best available
   * RB"). Null when no free agent could come in at such a position and he's the best available at any position (the
   * fallback; and under TradeContextOptions.openSpotFill "bestAny", Checkpoint 7b's rule for the trade report, every spot).
   */
  pos: Pos | null;
  /**
   * On a fallback: the positions still short where no free agent could come in (none available, or the position at its
   * limit), for the card's "(no TE is available)". ⚠️ Never a position the team streams (its streaming row fills that
   * slot every week; legality never adds there) nor a K or D/ST it doesn't stream (one comes in only to refill a starting
   * slot the trade emptied: evaluate.ts's header, rule 4), so the card never says none is available where free agents
   * are. Absent when there are none.
   */
  short?: Pos[];
  /**
   * On the partner's side only (review of Phase 7c's fill, finding pickups-4): he's one of my own baseline pickups (on my
   * V*(T)'s roster: the League page suggests him for me), and the partner claims before me (it goes first in the
   * allocation order: evaluate.ts tradeSides), so my free-agent pickups after the trade can't make that pickup and my
   * numbers count without him. The card says so ("…, the pickup the League page suggests for you."). Absent otherwise.
   */
  yours?: true;
}

/** Moves the roster limits force on a team after the trade (§7 roster legality), shown on the card. */
export interface RosterChange {
  /** Players dropped because the active roster would be over maxRosterSize (lowest keep value first). */
  drops: string[];
  /**
   * Free agents added because it would be under it: rule 3's (a position under its roster minimum: the best available
   * there) and rule 4's (each roster spot the trade opened: `openSpots`), in that order.
   */
  adds: string[];
  /**
   * Phase 7c (planner reply to Checkpoint 7b, section 5): rule 4's adds, one per roster spot the trade opened, in the order
   * they were made (each also in `adds`; the rest of `adds` are rule 3's). Absent or empty: no spot opened (or an inactive
   * team's, left open), or an evaluation made before Phase 7c, whose card words every add as before.
   */
  openSpots?: OpenSpot[];
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
  /**
   * Phase 4c (final review, finding R1): my free-agent moves after the trade that my baseline doesn't make. The free-agent
   * optimizer after the trade (V*(after), §7, run on my roster once the moves above are made) picks up `adds` and drops
   * `drops` where my baseline V*(T), the one every number compares with (the League page's "Free-agent pickups that would
   * help"), doesn't (evaluate.ts freeAgentMovesOf). The trade's numbers count on them: B's lineups, and its market term,
   * where each counts at max(v, W) like a traded player (a player worth more than W cut to make room
   * costs his value, as if traded away). So the card names them. `starts`: for each pickup, the NFL weeks he starts in my
   * expected-value lineup after the trade, among the weeks team numbers count ("to start in week 7"). `kept`: players my
   * baseline drops who stay on my roster after the trade (the card's "rather than …" when the trade brings no pickup of
   * its own, only a different drop). `room` (verification of the final review, finding VF-1): the pickups my baseline
   * makes too whose spot one of `drops` opens after the trade (the card's "to make room for …" when the trade brings no
   * pickup of its own); absent or empty: none. My side only (the partner's estimate reads the trade itself); absent when
   * there's no such pickup and no such drop of a player worth more than the waiver credit W (evaluate.ts faShown: a drop
   * swap between bench players worth at most W isn't named; the market term counts every such move all the same). Since
   * Checkpoint 7e (planner reply to Checkpoint 7d, item 2.1) against the trade's own "before" (my baseline with its
   * either-way moves: they're in both versions, so neither here nor in the market term), and the card words my moves from
   * TradeEvaluation.myMoves instead; this stays for the report and an evaluation's readers.
   */
  faMoves?: { adds: string[]; drops: string[]; kept: string[]; starts: Record<string, number[]>; room?: string[] };
  /**
   * Checkpoint 7e: on legality's own change (evaluate.ts LegalSide.change; the card's `required` doesn't copy it): how many of
   * `drops` are rule 1's (a position over its limit), the first ones; the rest are rule 2's (the roster over its size).
   * Absent or 0: none.
   */
  limitDrops?: number;
}

/**
 * Checkpoint 7e (planner reply to Checkpoint 7d, item 2.2: "Each card lists every roster move its numbers assume, in order,
 * each with its reason and its week. … Moves Parker would make either way, like his Malik Washington pickup, aren't listed
 * as part of the trade. One line can say they're assumed either way."; TradeEvaluation.myMoves, evaluate.ts myRosterMoves):
 * my side's roster moves, against the "before" the numbers are measured from (my baseline V*(T) with the trade's either-way
 * moves, item 2.1). Together they name every way my roster after the trade differs from that "before", the trade's own
 * players aside, and nothing that doesn't (review of wave B, findings B-1, moves-skip-reason-spot-taken,
 * moves-waiver-takes-pickup-drop and moves-before-release-unnamed; evaluate.moves.test.ts checks it on every exact trade of
 * whole searches): each player this week, and what happens at each IR player's return.
 */
export interface RosterMoves {
  /**
   * The trade's moves, in order: this week's first (legality's drops, roster-minimum adds, open-spot fills, IR placements,
   * then the waiver moves that go with the trade and the pickups of the "before" it changes), then the later weeks' (what
   * happens at an IR player's return, where the trade changes it), by week. The moves made either way aren't among them
   * (`assumed`).
   */
  moves: RosterMove[];
  /**
   * My free-agent moves the numbers assume with or without the trade, in order: the League page's pickups the roster after the
   * trade holds too (each with the drop the "before" makes for him when that player leaves after the trade too and isn't
   * traded), then the trade's either-way moves (item 2.1; `eitherWay`), then the players dropped in both versions whom no
   * pickup here names (`add` null). Empty: none.
   */
  assumed: AssumedMove[];
  /**
   * Checkpoint 7f (planner reply to Checkpoint 7e, answer 4; the lead's R3): the releases at an IR player's return made with or
   * without the trade (the "before" and my roster after the trade release the same player from the same week for the same
   * returner, so no move above names them), by week, each with why when the near-tie rule decided it after the trade. Absent
   * or empty: none (or an evaluation made before Checkpoint 7f). The card names them in its line of moves made either way,
   * names only, the reason left to the League page (tradeView.ts myMovesLines; review of Checkpoint 7f, INTEGRATION-4).
   */
  assumedLater?: AssumedRelease[];
}

/**
 * Why the near-tie rule released a player at an IR player's return (Checkpoint 7f; planner reply to Checkpoint 7e, answer 4:
 * "keep the rule, but the card must say why"; returners.Displacement.keptInstead): `keptInstead`, the player the lineup alone
 * would have released, kept for his trade value (from the return on, the two add about the same to my starting lineup, and
 * he's worth more then); `lockable` when the player released is on my active roster or IR as imported, where the League
 * page's lock is (the card's "Lock Pierce on the League page to keep him instead."), not one the trade brings in or a
 * pickup after it.
 */
export interface NearTieRelease {
  keptInstead: string;
  lockable: boolean;
}

/**
 * A release at an IR player's return my numbers assume with or without the trade (RosterMoves.assumedLater; Checkpoint 7f):
 * from `week`, when `returner` comes back from IR, `player` goes (the returner himself when he's the one released), in the
 * trade's "before" and after the trade alike; `nearTie` when the near-tie rule decided it after the trade.
 */
export interface AssumedRelease {
  week: number;
  player: string;
  returner: string;
  nearTie?: NearTieRelease;
}

/**
 * A pickup the "before" makes too, brought in by legality after the trade (RosterMove's openSpot and rosterMinimum; review
 * of wave B, finding B-1): the League page's own (`eitherWay` absent) or item 2.1's either-way move; `keep`, the player the
 * "before" drops for him, whom my roster after the trade keeps (null: none to name).
 */
export interface PickupOf {
  keep: string | null;
  eitherWay?: true;
}

/**
 * One of my roster moves a trade's numbers assume (RosterMoves.moves; Checkpoint 7e, planner reply to Checkpoint 7d, item
 * 2.2), with its reason and its NFL week (`week`: the first week team numbers count for this week's moves, the returner's
 * week for what happens at a return). Players are canonical ids. A drop or a pickup is named here only when it differs from
 * the "before" (my baseline V*(T) with the either-way moves); one the "before" makes too goes on the assumed line.
 * - "positionLimit": legality's rule 1 (a position over its limit `limit`): `drop` goes.
 * - "makeRoom": legality's rule 2 (the active roster over its size): `drop` go, to make room for `for`, the players received
 *   beyond those given (empty when a roster-minimum add needs the room, or when my pickups after the trade drop a player it
 *   brings in: review of wave B, finding B-3); `received`, those of `drop` this trade brings in. ⚠️ When a player the
 *   "before" drops for one of its pickups leaves through the trade (rule 2 drops him, or I send him away) and my free-agent
 *   pickups after it make that same pickup with another drop, the other drop is named in his place (evaluate.ts
 *   myRosterMoves: against the "before", the trade costs that player, and the pickup is assumed either way).
 * - "rosterMinimum": legality's rule 3 (a position under its minimum `min`): `add` comes in; `pickup` when he's a pickup the
 *   "before" makes too (then the trade's change is only `pickup.keep`).
 * - "openSpot": legality's rule 4, a roster spot the trade opened (OpenSpot: the card's "Open roster spot: add X, the best
 *   available RB."); `pickup` as for rosterMinimum.
 * - "toIR": legality's rule 5, a received IR player into an open IR slot.
 * - "waiver": a free-agent move my pickups after the trade make that the "before" doesn't and that stays with the trade
 *   (item 2.1: it doesn't clear the pickup bar on the baseline, or can't be made there): `add` for `drop` (null: an open
 *   roster spot), the drop as the "before" holds it (`received`: a player this trade brings in), or in place of the
 *   "before"'s pickup `insteadOf` (`insteadOfEitherWay` when that one is an either-way move); `starts`, the weeks he starts.
 * - "pickupDrop": the "before"'s pickup `add` (the League page's, or an either-way move: `eitherWay`), made after the trade
 *   with another drop, `drop` (null: an open roster spot; `received`: a player this trade brings in), where the "before"
 *   drops `instead` (null: the "before"'s drop left another way, traded or dropped): the trade makes `instead` worth keeping.
 * - "skip": the "before"'s pickup `add` (`eitherWay` as for pickupDrop) isn't made after the trade: `why` "taken" (the
 *   partner, claiming before me, picks him up after the trade), "spot" (the players this trade brings in take his roster
 *   spot, named in `by` when they can be: the player the "before" drops for him goes in the trade or to make room for them;
 *   review of wave B, finding moves-skip-reason-spot-taken) or "unneeded" (my pickups after the trade pass on him: he no
 *   longer clears the pickup bar, or a better move took the run's place); `keep`, the "before"'s drop for him when he stays
 *   on my roster (null otherwise).
 * - "release": from `week`, when `returner` comes back from IR, `player` goes (the returner himself when he's the one
 *   released), where the "before" releases nobody then, or `instead` (review of wave B, finding moves-before-release-unnamed):
 *   `kept` when that player is still on my roster then (the trade keeps him), else he's gone by then; `nearTie` when the
 *   near-tie rule decided this release (Checkpoint 7f; planner reply to Checkpoint 7e, answer 4: NearTieRelease).
 * - "keepAtReturn": at `returner`'s return in `week` the "before" releases `player`, and my roster after the trade releases
 *   nobody (`returnerStays`: he's still mine, so the trade leaves room; else the trade sends him away).
 * - "drop", "keep", "add": a difference the moves above don't explain (none on any test league: a safety net, so the list
 *   still names it): `player` goes (`received`: one this trade brings in), stays, or comes in.
 */
export type RosterMove =
  | { kind: "positionLimit"; week: number; drop: string; pos: Pos; limit: number }
  | { kind: "makeRoom"; week: number; drop: string[]; for: string[]; received?: string[] }
  | { kind: "rosterMinimum"; week: number; add: string; pos: Pos | null; min: number | null; pickup?: PickupOf }
  | { kind: "openSpot"; week: number; spot: OpenSpot; pickup?: PickupOf }
  | { kind: "toIR"; week: number; player: string }
  | { kind: "waiver"; week: number; add: string; drop: string | null; starts?: number[]; received?: true; insteadOf?: string; insteadOfEitherWay?: true }
  | { kind: "pickupDrop"; week: number; add: string; drop: string | null; instead: string | null; received?: true; eitherWay?: true }
  | { kind: "skip"; week: number; add: string; keep: string | null; why: "unneeded" | "taken" | "spot"; by?: string[]; eitherWay?: true }
  | { kind: "release"; week: number; player: string; returner: string; instead?: string; kept?: boolean; nearTie?: NearTieRelease }
  | { kind: "keepAtReturn"; week: number; player: string; returner: string; returnerStays: boolean }
  | { kind: "drop"; week: number; player: string; received?: true }
  | { kind: "keep"; week: number; player: string }
  | { kind: "add"; week: number; player: string };

/**
 * A free-agent move my numbers assume with or without the trade (RosterMoves.assumed; Checkpoint 7e, item 2.2): add `add`
 * (null: no pickup to name, a player dropped in both versions), dropping `drop` (null: none to name, an open roster spot or
 * a player the trade sends away); `eitherWay` for item 2.1's either-way moves (absent: the League page's own pickup).
 */
export interface AssumedMove {
  add: string | null;
  drop: string | null;
  eitherWay?: true;
}

/**
 * My odds before a trade on the block its numbers came from, when they aren't the search's baseline (TradeEvaluation.before,
 * PlanB.before; Checkpoint 7e, item 2.1): the trade's own "before", my baseline V*(T) with its either-way moves.
 */
export interface OddsBefore {
  pPlayoffs: number;
  /** Null when the league's title odds are unknown. */
  pTitle: number | null;
  prizes: PrizeOdds;
}

/**
 * Checkpoint 7e (planner reply to Checkpoint 7d, item 4.2, "Now or after this week": "run the simulation once more with the
 * trade starting next week"; TradeEvaluation.later, evaluate.ts laterNumbers): the same trade done after this week's games.
 * The current week is played by both teams as in the trade's "before" (mine: my baseline, or the trade's own "before" with
 * its either-way moves; the partner's: its baseline), every later week as after the trade, simulated on the shown block of
 * seasons and scored on the card's own "Helps you" scale (the shown block's B₃). Nothing else changes: the rosters, the roster
 * moves, the trade value and the chance they accept are the trade's.
 */
export interface LaterNumbers {
  /** B if the trade is done after this week's games (its market term the trade's own); null when it can't be known. */
  b: number | null;
  /** Its Helps you on the same B₃ as the card's: round(100 × (1 − e^(−B / B₃))) when B > 0, else null (a card prints 0 for B ≤ 0). */
  tradeScore: number | null;
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
  /**
   * How far the evaluation went (§12): screened (fast lineups), exact (scenario lineups), final (the final simulation: the
   * ranking block's config.simulation.finalSims seasons on a finalist the search ranks, the shown block's shownSims on a card
   * shown and in the Analyzer, Checkpoint 7e; `sims` says which).
   */
  stage: "screened" | "exact" | "final";
  /** Seasons simulated behind B (0 = not simulated yet): screeningSims, finalSims or shownSims (config.simulation). */
  sims: number;
  /** Moves the roster limits force (§7), per side. */
  required: { me: RosterChange; partner: RosterChange };

  // The three numbers (§10)
  /** B, my benefit (null before simulation). */
  b: number | null;
  /** "Helps you": round(100 × (1 − e^(−B / B₃))) when B > 0 (b3 below); null otherwise. */
  tradeScore: number | null;
  /** §11: P_accept and P_complete (the veto rule applied). */
  pAccept: number;
  pComplete: number;
  /** "Long shot" | "Possible" | "Decent" | "Likely" (config.acceptance.labels, from P_accept). */
  acceptLabel: string;
  /** "Overall": round(100 × (1 − e^(−(B × P_complete) / B₃))) when B > 0; null otherwise. */
  overall: number | null;
  /**
   * Phase 7a (planner reply to Checkpoint 4c, A2): B₃, the scale Helps you and Overall were scored on (benefit.helpsScale's
   * b3, floored at config.benefit.helpsFloor): the B of a uniform +config.benefit.helpsGain (3) projected points a week for
   * my team, under the same goal, on the same baseline and seasons (evaluate.ts helpsScaleOf); in a dynasty or keeper league
   * with long-term values B_ref(λ) = (1 − λ) × that + λ × F₁₀, F₁₀ = 4, the B of +10% long-term value (planner reply to
   * Checkpoint 7a, §2 question 6; λ the trade's). The same for every trade of a search (its Plan B's numbers and, since Checkpoint 7e,
   * its "How to offer it" offers too: the shown block's; until then its steps', and since 7e the screening block's versions
   * read the ranking block's) and for the Analyzer's call with the same settings. So B = B₃ reads 63, and helpsGain × B / B₃ is what the trade is worth
   * in lineup points a week (the Analyzer's Details, benefit.lineupEquivalent; in units of the scale's mix with long-term
   * values). B's market term is priced on it too (marketWeekly). Null before simulation or without odds.
   */
  b3: number | null;

  // The numbers behind them (§10 "always show")
  /** Changes in my P(playoffs), P(title) and expected wins (null before simulation). */
  dPO: number | null;
  dCH: number | null;
  dEW: number | null;
  /**
   * Checkpoint 7c (planner reply to Checkpoint 7b, §6, league prizes): every prize component's change on the same runs as dPO
   * (reward.ts PrizeDeltas: 1st = dCH, P(2nd), P(3rd), the weekly high scores won, the points title; null where unknown, the
   * weekly high scores' whenever the context didn't simulate them: reward.ts runPrizeDeltas), what
   * B's ΔE[S] read under the search's reward (TradeSearchResult.reward) and the "Top 3 odds" line reads. Null before
   * simulation; the engine sets it on every simulated evaluation, optional only so that fakes and older evaluations needn't.
   */
  dPrizes?: PrizeDeltas | null;
  /**
   * Checkpoint 7c (planner reply to Checkpoint 7b, §7, "Helps them": "the partner's version of Helps you, from the same
   * simulation runs"): the partner's side of the runs dPO came from (evaluate.ts simulateTrade). Set on every simulated
   * evaluation (the search's screened and final trades, the versions "How to offer it" reads and offers, the steps' until
   * Checkpoint 7e, and the Analyzer's; a TradeStep and a PlanB don't carry it), absent before simulation, without odds and on an evaluation made before it.
   */
  them?: PartnerNumbers;
  /**
   * Checkpoint 7e (planner reply to Checkpoint 7d, item 2.1: "No credit for moves Parker could make anyway"): my odds before
   * the trade on the block the numbers came from, when the trade has either-way moves (evaluate.ts eitherWayMoves): its own
   * "before" (my baseline V*(T) with those moves made, simulated on the same seasons), from which dPO, dCH, dPrizes, the
   * weekly win chances and the partner's numbers are measured, and from which the card's odds lines and the reasons start.
   * Absent: the search's baseline (TradeSearchResult.baseline, the Analyzer's), as for every trade without such a move.
   */
  before?: OddsBefore;
  /**
   * Checkpoint 7e (planner reply to Checkpoint 7d, item 2.2): my roster moves the numbers assume, the trade's in order and
   * those assumed either way (RosterMoves; evaluate.ts myRosterMoves), which the card lists. Set on every exact evaluation;
   * absent on one made before it (the card then words `required.me` as before).
   */
  myMoves?: RosterMoves;
  /**
   * Checkpoint 7e (planner reply to Checkpoint 7d, item 4.2, "Now or after this week"): the same trade done after this week's
   * games (LaterNumbers; evaluate.ts laterNumbers), for the card's "Helps you 37 now · 41 if done after this week's games."
   * The Trade Analyzer sets it with each evaluation (analyzeTrade); the Trade Finder's cards get theirs from the engine
   * worker once the search has answered (engine.worker.ts `later`), so a search's own evaluations don't carry it. Absent
   * when a week is under way (its games are held as rosters stand before and after every trade, so "now" already starts next
   * week), when no week after this one counts, when fewer than config.explain.nowOrLaterWeeks weeks remain before the trade
   * deadline, without odds or a team, and on an evaluation made before it.
   */
  later?: LaterNumbers;
  /** Changes in my average weekly starting points: remaining regular-season weeks, and playoff weeks. */
  dPPW: number;
  dPPWPlayoffs: number;
  /** §10 parts: B_win, B_future (dynasty and keeper; null in redraft or when missing), λ (null in redraft). */
  bWin: number | null;
  bFuture: number | null;
  lambda: number | null;
  /**
   * Planner reply to Checkpoint 7a, §2 question 5 ("Protect my trade value" priced in lineup points): B's market term (the
   * redraft "Trade value" part, B − B_win) as projected points a week on this evaluation's scale, signed: κ ×
   * clamp(g_mkt(me)), κ the setting's points a week per 100% of trade value (benefit.marketWeekly; helpsGain × (B − B_win) /
   * b3 exactly). The Analyzer's Details print it ("Trade value: −0.4 pts/week equivalent."). Null when B has no market term:
   * dynasty and keeper leagues (B_future carries the value change), FantasyCalc's curve fallback or no values at all (κ 0:
   * evaluate.ts simulateTrade), and before simulation or without a scale. The engine sets it on every evaluation; optional
   * only so that fakes and evaluations kept from before it needn't (absent reads as null).
   */
  marketWeekly?: number | null;
  /** Change in my roster's dynasty value (dynasty and keeper), null in redraft or when missing. */
  dDyn: number | null;
  /** A keeper league whose dynasty values didn't load: ΔDyn is missing and the card says so (Checkpoint 2). */
  dynMissing: boolean;
  /**
   * My package values (§9, perception; market.packageValues, the model's own figures: the card quotes FantasyCalc's raw
   * values instead, planner reply to Checkpoint 4b, change 3). ⚠️ Since the final review of Phase 4c (finding R1) my
   * package holds my free-agent moves after the trade that my baseline doesn't make too (RosterChange.faMoves: each pickup
   * as received, each drop as given, every one with an active roster spot), so g_mkt(me), B's market term, ΔDyn and the
   * Market check read what my roster really gains and loses; the partner's package and g read the trade itself. First the
   * neutral throw-ins are left out (Phase 4c, change 2
   * and the lead's matched pairs; market.ts's header, "Neutral throw-ins"): players worth at most W on the side giving more
   * players, up to the difference in player counts, then matched pairs of such players, one from each side, each with the
   * roster spot he moves. Then what I give and what I get, each player left at max(v, W) (the value floor on both sides,
   * planner reply to Checkpoint 4, change 4: a player worth less than W, the best free agent no team is predicted to claim,
   * counts at W), plus W for each open roster spot on the side that gets fewer players. Roster spots are my active roster's
   * (review of Phase 4b track E: an IR slot isn't one, market.ts's header): W on what I get for each spot it opens, on what
   * I give for each it fills, which is the same thing when no IR player moves. So an even swap of two players worth at most
   * W reads 0 given and 0 received (both left out), and, ⚠️ when no IR player moves, a throw-in worth at most W adds
   * nothing to either number. A trade that moves an IR player can break that (review POL-3; market.ts's header, "⚠️ The
   * exception, IR moves"; market.test.ts): a cheap IR player left in counts W with no roster spot behind him, and a
   * player worth more than W who moves without one (into or out of an IR slot) can leave cheap players in, each adding W
   * to both numbers. With W 600, giving 5,000 for 3,000 (into my open IR slot) and 4,000 reads 5,000 given and 7,000
   * received; adding a 200 throw-in of mine reads 5,600 and 7,600.
   */
  value: { given: number; received: number };
  /**
   * g_mkt for my side and the partner's (§9), on those packages (the neutral throw-ins left out, each player left at max(v,
   * W)), without the star premium (the partner's perceived g, with it, is features.g).
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
   * addendum). Ranking and the three numbers above stay the ranked trade's. Since Checkpoint 7e (planner reply to Checkpoint
   * 7d, item 4.1) no evaluation has steps: a card's "How to offer it" is an OfferLadder, worked out when it's opened
   * (src/engine/offers.ts). Kept so an evaluation made before still reads.
   */
  steps?: TradeSteps;
  /**
   * "If they say no, try:" (planner reply to Checkpoint 4, change 6; since Checkpoint 7e "If they won't move: try …", planner
   * reply to Checkpoint 7d, item 4.1): on a Trade Finder card without steps (since Checkpoint 7e every card), the best other
   * exactly evaluated trade with the same partner that still helps (B > 0, Helps you at least config.search.planB.
   * minHelpsShare of the card's, not hidden by the market guard) and, ⚠️ since the review of track F, is likelier to go
   * through (P_complete at least config.search.steps.minAcceptGain above the card's), the same players of theirs first,
   * with at most config.ranking.perGivenPlayerInTop20 boxes adding the same player of mine, and ⚠️ never a trade the
   * search bars from the boxes (search.ts barredFromBoxes: a trade the list shows as a card itself, final review of Phase
   * 4b, or such a card plus more players who don't make it minAcceptGain likelier, Phase 4c; and since the final review of
   * Phase 4c a version a card's steps show (until Checkpoint 7e), or one another card with its partner matches or beats on
   * both Helps you and P_complete: planB.ts dominatedByCard) (src/engine/planB.ts). Absent when none qualifies, on a card
   * with steps (until Checkpoint 7e), and in the Analyzer. A card's "How to offer it" never offers it (offers.ts).
   */
  planB?: PlanB;
  /** Plain-English reasons (§13), most important first (src/engine/explain.ts). */
  reasons: string[];
  /** The copy-ready pitch message (§13), leading with what the partner gains (src/engine/explain.ts). */
  pitch: string;
}

/**
 * "Helps them" (Checkpoint 7c; planner reply to Checkpoint 7b, §7; TradeEvaluation.them): the partner's numbers from the very
 * runs behind my B (evaluate.ts simulateTrade: one simulation with both rows replaced gives every team's odds), scored the
 * way mine are, from its side (benefit.ts partnerBenefit, partnerScale, helpsThemScore). Numbers only.
 */
export interface PartnerNumbers {
  /**
   * B_P: in redraft leagues the partner's B_win under the league's reward (the reward my B is weighed by: "What does your
   * league reward?", its goal's weights and prize shares), with no trade-value term; in dynasty and keeper leagues (1 − λ_P) ×
   * B_win,P + λ_P × B_future,P while long-term values loaded, else B_win,P. Null when B_win,P isn't known.
   */
  b: number | null;
  bWin: number | null;
  /**
   * B_future,P = config.benefit.bFutureScale × ΔDyn_P ÷ the partner's roster's long-term value, ΔDyn_P from the trade's own
   * long-term package (⚠️ none of the partner's free-agent moves, as the partner's g reads the trade alone); null in redraft
   * leagues and without long-term values.
   */
  bFuture: number | null;
  /** λ_P: §10's default for the partner's baseline P(playoffs) on the shown block (LeagueModel.odds; keeper 0.2), never the user's Win now ↔ Future setting; null in redraft leagues. */
  lambda: number | null;
  /**
   * B_ref,P, the scale Helps them is scored on (benefit.ts partnerScale): B₃,P, the B_win of the partner's +3 points a week on
   * the same baseline and seasons, floored at config.benefit.helpsFloor; in a dynasty or keeper league with long-term values
   * then mixed, (1 − λ_P) × B₃,P + λ_P × F₁₀ (the planner's order: floor, then mix). Null without the partner's calibration run.
   */
  b3: number | null;
  /** Helps them as printed: round(100 × (1 − e^(−B_P / B_ref,P))) when B_P > 0, 0 when B_P ≤ 0; null when either is unknown. */
  helps: number | null;
  /** The partner's changes in P(playoffs) and P(title) (null when the league's title odds are unknown), from the same runs as mine. */
  dPO: number;
  dCH: number | null;
  /** Every prize component's change for the partner (reward.ts PrizeDeltas, TradeEvaluation.dPrizes' rules), the same runs. */
  dPrizes: PrizeDeltas;
  /**
   * The partner's odds before the trade on the same block of seasons (the screening block's baseline on a screened trade, the
   * ranking block's on a finalist the search ranks, the shown block's on a card shown and in the Analyzer: LeagueModel.odds
   * for that team), so "after" is before + the changes above.
   */
  before: { pPlayoffs: number; pTitle: number | null; prizes: PrizeOdds };
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
   * Since Checkpoint 7e (planner reply to Checkpoint 7d, item 3.5; review of wave C, RC-ENG-1) the user's own week for one
   * of my players when he set one, whatever the status (returnSource "user"): his numbers follow it.
   */
  returnWeek?: number;
  /** "user": returnWeek is the user's own (TradeSettings.returnWeeks), so the card says so; absent: the platform's date. */
  returnSource?: "user";
}

/**
 * A Plan B (TradeEvaluation.planB): its proposal and its three numbers on the card's basis (the final simulation: chosen on
 * the ranking block, its numbers then the shown block's, as the card's are: search.ts, "The shown pass", Checkpoint 7e). ⚠️
 * Checkpoint 7c: under a card that helps both teams (its "Helps both" tag) it helps both too (planB.ts planBPasses), though
 * it carries no partner's numbers (the box shows no "Helps them" line).
 */
export interface PlanB {
  proposal: TradeProposal;
  /** proposalKey of the proposal. */
  key: string;
  b: number;
  /** Its Helps you, on the same B₃ as its card (TradeEvaluation.b3: the search's goal and λ). */
  tradeScore: number;
  pAccept: number;
  pComplete: number;
  acceptLabel: string;
  overall: number;
  /** "samePlayers": a different package for the same players of theirs; "otherTarget": a different target. */
  kind: "samePlayers" | "otherTarget";
  /** Phase 4c (change 7): its acceptance features and raw g_mkt(P), stored with feedback when it's the one sent. */
  features?: AcceptanceFeatures;
  gPartner?: number;
  /**
   * Phase 4c (planner reply to Checkpoint 4b, change 9, "real odds on every card"): the changes in my P(playoffs) and
   * P(title) and my win chance by week before and after (TradeDetail.winChance's shape and rules), from Plan B's own
   * simulation on the final block (the shown block's in the search's results since Checkpoint 7e), the runs its B came from:
   * the card's basis, so they start from the same "before" (the search's baseline) and the box prints them as the card
   * prints its own. dCH null when the league's title odds are unknown. Absent when its numbers aren't a final simulation's
   * (planB.ts toPlanB: never in the search) and on a Plan B made before these fields.
   */
  dPO?: number | null;
  dCH?: number | null;
  /** Checkpoint 7c: every prize component's change from the same simulation (TradeEvaluation.dPrizes'); absent with dPO. */
  dPrizes?: PrizeDeltas | null;
  winChance?: TradeDetail["winChance"];
  /**
   * Checkpoint 7e (planner reply to Checkpoint 7d, item 2.1): its own "before" when it has either-way moves (TradeEvaluation.
   * before), which its odds start from; absent: the card's (the search's baseline).
   */
  before?: OddsBefore;
  /**
   * Checkpoint 7e (item 2.2: "a Plan B box when it has moves"): my roster moves its numbers assume (its evaluation's
   * TradeEvaluation.myMoves, carried by the search's shown pass: search.ts). Absent: a Plan B made before this field.
   */
  myMoves?: RosterMoves;
}

/**
 * One version of a trade in "Offer first / if they say no" (§4 of the addendum): exact evaluation + the screening simulation.
 * Until Checkpoint 7e (planner reply to Checkpoint 7d, item 4.1, which replaced the steps with OfferLadder); kept so an
 * evaluation made before still reads.
 */
export interface TradeStep {
  proposal: TradeProposal;
  /** proposalKey of the proposal. */
  key: string;
  /** B at config.simulation.screeningSims seasons (the screening block), the Trade Score from it (on `b3`), and the acceptance numbers. */
  b: number | null;
  /**
   * The "Helps you" scale B and the Trade Score are scored on (evaluate.ts stepOf: the step's own TradeEvaluation.b3). Since
   * Checkpoint 7e the ranking block's (evaluate.ts scaleBlockOf), not its card's: a card prints on the shown block's B₃
   * (search.ts, "The shown pass"), so the feedback's version inputs read each version's own (tradeView.ts versionChoices;
   * the review's SHOWN-4). Before, every stage shared one B₃, its card's. Absent on a step made before this field.
   */
  b3?: number | null;
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
  /** Phase 4c (planner reply to Checkpoint 4b, change 7): this version's acceptance features, stored with feedback when it's the one sent. */
  features?: AcceptanceFeatures;
}

/**
 * The two steps (§4 of the addendum), until Checkpoint 7e (planner reply to Checkpoint 7d, item 4.1: "How to offer it" is an
 * OfferLadder since, src/engine/offers.ts; its Last offer keeps the second case's rule). A throw-in is one of my players whose loss costs me at most
 * config.search.throwInMaxCost ROS lineup points (scenario lineups; × Σω ÷ Σω₀ under the automatic playoff weight: league.ts
 * step 5c, LineupThresholds) against my free-agent-optimized roster.
 * - The ranked trade gives a throw-in (and keeps a player on my side without it): offer first = the trade without my
 *   lowest-value throw-in; if they say no, add it back (= the ranked trade). `ranked` = "full".
 * - Otherwise: offer first = the ranked trade; if they say no, add the throw-in that raises the chance they accept most
 *   while B stays at least config.search.steps.minBShare of the offer's. `ranked` = "offerFirst".
 * Shown only when the full version's P_complete is at least minAcceptGain above the offer-first's, which is at least
 * minOfferFirst, and the offer-first version helps me (B > 0 on the screening block; so does case 2's full version). The
 * Analyzer gives steps only to a trade the Trade Finder could show (B > 0, not hidden by the market guard). ⚠️ Checkpoint 7c:
 * on a trade that helps both teams (its "Helps both" tag) the offer-first version helps both too (evaluate.ts tradeSteps,
 * StepOptions.helpsBoth).
 */
export interface TradeSteps {
  offerFirst: TradeStep;
  ifNo: { add: string; full: TradeStep };
  ranked: "full" | "offerFirst";
}

/**
 * A step's place in "How to offer it" (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1: "one ordered list of up to 4
 * offers to the same team"): "open", the version best for me that still prints a fair chance; "then", a little less good
 * for me, each likelier than the step before; "suggested", the card's own trade; "last", the suggested trade plus a
 * throw-in.
 */
export type OfferStepKind = "open" | "then" | "suggested" | "last";

/** One offer of a card's ladder (OfferLadder): its place, its own evaluation and its copy-ready message. */
export interface OfferStep {
  kind: OfferStepKind;
  /**
   * The version's own evaluation, with its words: its proposal and key, its printed numbers (the shown block, as a card's),
   * its roster moves (myMoves) and its reasons and pitch.
   */
  evaluation: TradeEvaluation;
  /** The step's message to send: the first step's pitch, a later step's a follow-up naming its version. */
  message: string;
}

/**
 * "How to offer it" for one card (Checkpoint 7e, item 4.1), built on demand in the engine worker; since Checkpoint 7f also
 * during the search for a card the merge reads (search.ts, "Merged cards"), which the worker then hands back as it is.
 */
export interface OfferLadder {
  /** The card's key: its suggested trade's proposalKey. */
  cardKey: string;
  /** The offers in order, the suggested trade always among them; the suggested trade alone: nothing better to open with. */
  steps: OfferStep[];
  /** How long the ladder took to build, in ms, when the engine had a clock. */
  ms?: number;
}

/**
 * A trade folded into another card's "How to offer it" (Checkpoint 7f; planner reply to Checkpoint 7e, decision 3: "When one
 * card's offer list contains another card's trade, merge them: Keep only the card with the higher Overall in the list. The
 * other trade appears only inside that card's offer list."; search.ts, "Merged cards"): its key, the card that offers it
 * (`into`, still on the list) and its place among that card's offers.
 */
export interface MergedTrade {
  key: string;
  into: string;
  kind: Exclude<OfferStepKind, "suggested">;
}

/** A search's merged cards (TradeSearchResult.merged; search.ts, "Merged cards"). */
export interface MergedCards {
  /** Each list's trades folded into another card's offers, in the order they were folded. */
  overall: MergedTrade[];
  helpsBoth: MergedTrade[];
  /** The rounds each list's merge took, the last one folding nothing (1: nothing folded). */
  rounds: { overall: number; helpsBoth: number };
  /**
   * The ladders the merge read (each card with a card of its list below it among its possible offers, and to give a trade
   * back, the cards above it that could offer it): worked out during the search, or read back when a re-filter of the same
   * search at the same minimum chance had them already (offers.ts keeps each choice per search and minimum), so the count is
   * the same either way.
   */
  ladders: number;
  /** ⚠️ The trades folded and then given back, in no offers of a card above them on their list (the release rule; ours). */
  released: number;
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
   * starters on bye (likely starter: in my V* EV lineup in at least half of the counted weeks he plays; Phase 4c: never
   * one at a position I stream, whose bye the streaming replacement covers: evaluate.ts riskyWeeksOf).
   */
  riskyWeeks: number[];
  /** Plain-English notes about this evaluation (benefit.benefitNotes: title odds missing, long-term values missing; evaluate.ts's own). */
  notes: string[];
  /** The star premium on each player the partner gives (§1 of the addendum); absent before the addendum. */
  premium?: PremiumFact[];
  /**
   * Phase 4c (planner reply to Checkpoint 4b, change 9): my chance to win each remaining regular-season week's game,
   * before and after the trade, from the same simulation runs as B (the shown block on a card shown and in the Analyzer, the
   * ranking block on a finalist the search ranks, the screening block before that), one entry per week I have a head-to-head game (LeagueModel.weeks order; a multi-week
   * game at its first week). Null where the week's chance isn't defined. The card shows the weeks that move at least
   * config.explain.weeklyLineMin (up to weeklyLineMax, the drops first, then the largest gains, in week order). An empty list in a points-only
   * league (its games don't change the standings); absent without odds.
   */
  winChance?: { week: number; before: number | null; after: number | null }[];
  /**
   * Phase 4c (the pattern note's "injury cover" driver, change 6): my ΔPPW in scenario lineups minus my ΔPPW in expected-value
   * lineups, points a week: the part of the gain that comes from covering injuries and byes rather than from the average
   * lineup. Absent without scenarios.
   */
  depthCover?: number;
}

/**
 * Sort options (§13): Overall (default), Helps you (B), Chance they accept (P_complete, among B > 0), and since Checkpoint 7c
 * (planner reply to Checkpoint 7b, §7) Helps both: the trades that help both teams (benefit.ts helpsBoth), by Helps you
 * (TradeSearchResult.helpsBoth is that list, ranked by the engine; rank.ts sortTrades puts them first).
 */
export type TradeSort = "overall" | "helps" | "accept" | "helpsBoth";

/** Search stages, in order (the progress bar and the per-stage timings use them). */
export type TradeSearchStage = "setup" | "screening" | "exact" | "simScreen" | "simFinal" | "rank";

export interface TradeSearchProgress {
  stage: TradeSearchStage;
  /** Work done and total in this stage (for example trades evaluated of 200). */
  done: number;
  total: number;
  /**
   * Checkpoint 7e (planner reply to Checkpoint 7d, item 1.1; search.ts, "The shown pass"): "shown" while the "rank" stage
   * plays out the ideas the lists show on the shown block's config.simulation.shownSims seasons (most of that stage's time),
   * which tradeView.ts progressView names. Since Checkpoint 7f (search.ts, "Merged cards"; the review of the speed track):
   * "offers" while the merge works out a card's "How to offer it", which it names too. Still the "rank" stage, so a
   * re-filter reads as one (the Trade Finder's refilterProgress). Absent otherwise.
   */
  part?: "shown" | "offers";
}

export interface TradeSearchResult {
  /** The top config.search.resultsShown trades after ranking and diversity (§13), Overall order. */
  trades: TradeEvaluation[];
  /**
   * My team, and its baseline odds (every team at V*, the shown block's config.simulation.shownSims seasons since Checkpoint
   * 7e: the League page's headline, every card's "before"); null fields when not simulated.
   * Checkpoint 7c: `prizes`, my prize components on the same seasons (reward.ts PrizeOdds), null when not simulated; optional
   * only so that fakes needn't.
   */
  myTeamId: string | null;
  baseline: { pPlayoffs: number | null; pTitle: number | null; expWins: number | null; prizes?: PrizeOdds | null };
  /** Trades the ranking kept out by default (§10 guards: B ≤ 0, or g_mkt(me) below marketHideBelow), counted. */
  hidden: { byBenefit: number; byMarket: number; /** Phase 4c: finalists under the minimum chance (TradeSettings.minChance). */ byChance?: number };
  /**
   * Trades the final ranking's variety rules left out (§13 diversity, rank.ts RankedTrades.dropped: over the per-partner
   * cap in the top 20, over the per-core cap, filler variants (with the cards folded into another card's steps from the
   * final review of Phase 4c until Checkpoint 7e: search.ts foldedCards), and over Phase 4b's given-player cap in the top 20),
   * counted so a page can say so. The search always sets it (every key, 0 when it stops before ranking); optional only
   * so that fakes needn't (end-of-Phase-4 review, finding 5). Checkpoint 7f: `merged`, the trades folded into another card's
   * "How to offer it" (MergedCards.overall), whenever the search ranks with the merge on.
   */
  dropped?: { partnerCap: number; core: number; filler: number; givenPlayer: number; merged?: number };
  /**
   * Counts per stage: candidates screened, exactly evaluated, simulated on the screening block (config.simulation.
   * screeningSims) and on the ranking block (finalSims: the finalists and "Helps both" extras); and since Checkpoint 7e
   * (planner reply to Checkpoint 7d, item 1.1) `simShown`, the trades the lists show (cards and Plan B boxes, each once)
   * with their numbers on the shown block (shownSims; search.ts, "The shown pass"). The search sets simShown whenever it
   * ranks; absent when it stopped before ranking, and on fakes.
   */
  counts: { screened: number; exact: number; simScreen: number; simFinal: number; simShown?: number };
  /** Milliseconds per stage (TradeSearchStage keys) and "total". */
  timings: Record<string, number>;
  /** Plain-English notes (for example: "Kickers and D/STs are left out; turn them on in Settings."). */
  notes: string[];
  warnings: string[];
  /**
   * Phase 4c (planner reply to Checkpoint 4b, change 10): the minimum chance applied (TradeSettings.minChance, judged on
   * P_complete as the card prints it, before the diversity caps); `qualifying`: how many finalists pass the §10 guards and
   * the minimum, before the caps (since Checkpoint 7f the trades merged into another card among them, as Phase 4c counted the
   * folded cards); `few`: the list shows fewer than config.ranking.minChanceFew ideas and the same finalists
   * would show more at a lower setting (never at "Any"), so the page suggests one. Absent when the search stopped before
   * ranking.
   */
  filter?: { minChance: number; qualifying: number; few: boolean };
  /** Phase 4c (change 6): the pattern note above the list, when at least patternMinCount of the uncapped top patternTop give one player of mine. */
  pattern?: PatternNote;
  /**
   * The search's one "Helps you" scale (evaluate.ts helpsScaleOf for its goal and λ, the shown block's: Checkpoint 7e): every
   * card's and Plan B box's TradeEvaluation.b3 (a step's is the ranking block's, which the search ranks on), with what the tooltip words (planner reply to Checkpoint 7a, §2 question 6, "The tooltip follows the
   * mix": λ, B_win₃ as `odds`, F₁₀ as `f10`, B_ref as `raw` and `b3`, and what +3 points a week and +10% long-term value read
   * alone). Null without odds or a team. The search always sets it; optional only so that fakes needn't.
   */
  helpsScale?: HelpsScale | null;
  /**
   * Checkpoint 7c (planner reply to Checkpoint 7b, §6): the reward every B of the search was weighed by (evaluate.ts rewardFor
   * on its settings: the goal's weights, the prize shares, the league's prize periods), so a page reads the prize shares (the
   * "Top 3 odds" line, the feedback copy's shares) without making them again. The search always sets it; optional only so
   * that fakes needn't.
   */
  reward?: Reward;
  /**
   * Checkpoint 7c (planner reply to Checkpoint 7b, §7): the "Helps both" list, ranked by the engine from the same finalists
   * (search.ts finish). The search sets it whenever it ranks (an empty list when no trade helps both teams); absent when it
   * stopped before ranking, and on fakes.
   */
  helpsBoth?: HelpsBothList;
  /**
   * Checkpoint 7f (planner reply to Checkpoint 7e, decision 3; search.ts, "Merged cards"): each list's trades folded into
   * another card's "How to offer it", for reports and tests. The search sets it whenever it ranks with the merge on
   * (TradeSearchOptions.mergeCards, a report switch); absent otherwise, and on fakes.
   */
  merged?: MergedCards;
}

/**
 * The "Helps both" list (Checkpoint 7c; planner reply to Checkpoint 7b, §7: "only trades that help both teams, sorted by Helps
 * you, highest first … the chance filter and the diversity caps still apply"; search.ts finish): the finalists, with the
 * helps-both finalists among them, that help both teams on their final numbers (benefit.ts helpsBoth: Helps you and Helps
 * them each at least config.benefit.helpsThemMin, both as printed), in Helps-you order (B, highest first), after the §10
 * guards and the minimum chance, through §13's diversity rules in that order (rank.ts RankOptions order "helps", keep), and
 * until Checkpoint 7e the folding of cards that showed one plan; since Checkpoint 7f the merge of a trade one of its cards
 * offers into that card (search.ts, "Merged cards"). A card the Overall list shows too is the very same evaluation
 * (one Plan B and one set of words per card; until Checkpoint 7e one set of steps).
 */
export interface HelpsBothList {
  /** At most config.search.resultsShown trades, Helps-you order. */
  trades: TradeEvaluation[];
  /**
   * The finalists that pass the guards, help both teams and meet the minimum chance, before the diversity rules (until
   * Checkpoint 7e the folded cards included, as the Overall list counted them; since Checkpoint 7f the merged ones).
   */
  qualifying: number;
  /** The finalists that help both teams and pass the guards but are under the minimum chance (the hidden line's count for this list). */
  byChance: number;
  /**
   * The same finalists with no minimum chance (Any, the lowest setting) would show more trades that help both than the list
   * does, so a lower setting would add some (the page's suggestion); false at Any.
   */
  lowerWouldAdd: boolean;
  /**
   * Dropped by the diversity rules, as TradeSearchResult.dropped counts the Overall list's (until Checkpoint 7e the folded
   * cards as filler; since Checkpoint 7f `merged`, the trades merged into another card of this list, with the merge on).
   */
  dropped: { partnerCap: number; core: number; filler: number; givenPlayer: number; merged?: number };
}

/**
 * The Trade Finder's pattern note (planner reply to Checkpoint 4b, change 6): when at least config.explain.patternMinCount of
 * the top config.explain.patternTop by Overall, ranked WITHOUT the given-player cap, give the same player of mine. `drivers`
 * are the model's own reasons that most often account for those trades' gains (src/engine/pattern.ts), in the order the text
 * names them; `text` is the one line the page shows.
 */
export interface PatternNote {
  playerId: string;
  count: number;
  of: number;
  drivers: ("byeCover" | "incomingByes" | "slotGain" | "injuryCover")[];
  text: string;
}
