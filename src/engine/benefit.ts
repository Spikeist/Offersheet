/**
 * Our benefit B, the Trade Score ("Helps you") and Overall, and the guards (CLAUDE.md §10; lead decision L6 of
 * the Phase 4 design; planner reply to Checkpoint 4c, A2: the self-calibrating scale B₃). Pure and deterministic: plain
 * numbers in, plain numbers out, no I/O and no clock; every tunable number comes from config.benefit (package values
 * from config.market). Everything here is from the user's side (§10): the partner's side only matters through
 * the chance they accept (src/engine/acceptance.ts).
 *
 * The caller (src/engine/evaluate.ts) runs the season simulation on one common-random-numbers matrix with every
 * team at its free-agent-optimized roster V* (§7), before the trade and after it (L6: my roster after the trade
 * and its legality moves, then V*; the partner's the same way; every other team at its V*), and passes my
 * changes in. Because both runs optimize free agents, no B comes from a pickup I could make anyway.
 *
 * B (§10):
 * - B_win = 100 × (w_PO × ΔPO + w_CH × ΔCH) in percentage points, ΔPO and ΔCH as fractions. The weights are the
 *   user's "What matters most" (planner reply to Checkpoint 4b, change 8; TradeSettings.goal, BenefitInputs.goal;
 *   goalWeights): config.benefit.goals "title" 0.15 / 0.85 (the default, config.benefit.goalDefault: Parker's main goal
 *   is the title), "balanced" 0.35 / 0.65 (the weights before Phase 4c), "playoffs" 0.70 / 0.30. The scores divide B by
 *   B₃ under the same goal (the three numbers, below), so the goal changes what a trade's odds are worth, not what a lineup
 *   gain reads. ΔPO missing (not simulated yet) → B_win and B are null. ⚠️ Ours (awaiting the lead's
 *   sign-off in §10): when the title odds are unknown but the playoff odds aren't (season.ts nulls every team's
 *   P(title) when a played playoff round has no result it can match, SeasonOdds.playoffsKnown false, or when the
 *   league lists fewer playoff rounds than its bracket needs), B_win = 100 × (w_PO + w_CH) × ΔPO: the playoff
 *   term scaled up to the whole weight (each goal's weights sum to 1, so it is 100 × ΔPO under every goal), so B stays
 *   on the Trade Score's scale. Benefit.titleMissing marks it,
 *   tradeNumbers passes it on, and benefitNotes words it. It holds for every trade in such a league, so a
 *   search says it once (TradeSearchResult.notes); TradeEvaluation has no field for it.
 * - Redraft: B = B_win + κ × clamp(g_mkt(me), marketSanityClamp), the market term (g_mkt(me) from perception values;
 *   +∞, a side that gives nothing of value, clamps to +0.5; NaN counts 0). κ is the user's "Protect my trade value"
 *   setting (planner addendum to Checkpoint 3, §3; TradeSettings.protectValue, lead decision N3): config.benefit.
 *   protectValue low 2, medium 4 (the default), high 8 (protectValueWeight; BenefitInputs.kappa). It keeps trade value
 *   for later deals before the deadline; depth for injuries and byes is already in B_win (scenario lineups). At medium,
 *   giving 25% more value than I get (g_mkt(me) = −0.20) costs 0.8 B, about 0.4 projected points a week in Parker's
 *   league. ⚠️ evaluate.ts passes κ = 0 in FantasyCalc's curve fallback (Phase 4c lead decision; evaluate.valuesEstimated:
 *   the values there come from our own ROS points, so the term would count lineup points twice), with a note.
 * - The value floor at W on both sides (planner reply to Checkpoint 4, change 4; it replaces lead decision N10, which
 *   floored only the players I give and only in the market term): every package counts each player at max(v, W)
 *   (market.packageValues, which tradePackage goes through), so g_mkt(me) itself is floored, and the market term, the
 *   card's values, the Market check flag and the hide threshold all read the same g. A player worth less than the best
 *   free agent is replaceable, and my free-agent-optimized roster V*(me) already counts that replacement, so dumping
 *   him isn't a value gain: giving him for nothing reads g = 0. An even swap of two players worth less than W reads
 *   g = 0 for both sides. Phase 4c (planner reply to Checkpoint 4b, change 2, with the lead's matched pairs; market.ts's
 *   header, "Neutral throw-ins"): before any sum, the players worth at most W on the side moving more players are left
 *   out with their roster spots, then matched pairs of such players, one from each side. So when every player moves with
 *   an active roster spot a package is the one with every player worth at most W left out with his spot, and a throw-in
 *   worth at most W added to either side moves neither g_mkt(me) nor the partner's g (before, he added W to both sums of
 *   each side and pulled every g toward 0: a cheap throw-in could lift me past the Market check or the hide threshold,
 *   and the partner past the veto line; the planner's step alone still did when the other side moved d more players, at
 *   least d of them worth at most W: review of track EF, finding 1). ⚠️ A trade that moves an IR player can be the
 *   exception market.ts's header states precisely. Picks keep their values (they open no roster spot, and aren't
 *   players: the rule counts players only).
 * - Dynasty and keeper: B = (1 − λ) × B_win + λ × B_future, B_future = bFutureScale × ΔDyn / MyDynTotal (gaining
 *   10% of my roster's value ≈ +4). No market term (L6), whatever κ (⚠️ N3: B_future carries the value change). ΔDyn = my package
 *   change in long-term (dynasty) values, the waiver credit and picks included, each player at max(v, W) like every
 *   package (tradePackage with the future term's values and W); MyDynTotal = my roster's long-term value before the
 *   trade, my picks included (rosterValue: ⚠️ raw, W = 0, since it is the scale of B_future, not a trade package).
 * - λ: TradeSettings.lambda when it is set (0 = win now … 1 = future), else by my baseline P(playoffs) (every
 *   team at V*): ≥ contenderAt (0.5) → 0.35, ≥ bubbleAt (0.2) → 0.5, below → 0.75; keeper leagues default to
 *   0.2 (keeper costs aren't modeled, and the UI says so). ⚠️ Ours: an unknown P(playoffs) (the season wasn't
 *   simulated) takes the middle value, 0.5. Redraft leagues have no λ (null).
 * - Missing long-term values (Checkpoint 2; L6): a keeper league whose dynasty list didn't load (the server then
 *   serves the redraft list as MarketInputs.values with format.isDynasty false: futureValuesLoaded), a dynasty
 *   league without values (FantasyCalc down), ⚠️ the curve fallback (Phase 4c, MarketInputs.fallback kind "curve":
 *   a curve of an old list's values on this season's points says nothing about long-term worth, so ours), or
 *   MyDynTotal ≤ 0 → B_future and ΔDyn null, B = B_win (no market term either, as L6 writes it), dynMissing true (the
 *   card says so). λ is still reported.
 *
 * Package values (§9) for any term, picks included (tradePackage): the neutral throw-ins left out first (players only,
 * market.neutralThrowIns), the waiver credit W counts players only (a pick takes no roster spot), so PV_recv = Σ max(v,
 * W)(players received) + Σ v(picks received) + max(0, players given − players received) × W, and the same for PV_give
 * (players on and off the side's ACTIVE roster when a trade moves IR players: an IR slot isn't a roster spot,
 * market.ts's header); g = (PV_recv − PV_give) / PV_give with market.marketGain's zero rule (a side that gives nothing of
 * value gains +∞ when it receives something, else 0). Player-only packages equal market.packageValues and
 * market.marketGain exactly. studExponent γ applies to pick values too (they're values). The card's "value given /
 * received" is my perception package (TradeEvaluation.value).
 *
 * The three numbers (§10; planner reply to Checkpoint 4c, A2: "Helps you" calibrates itself per league and goal, so it means
 * the same thing everywhere): Helps you (the Trade Score) = round(100 × (1 − e^(−B / B₃))) and Overall = round(100 × (1 −
 * e^(−B × P_complete / B₃))) when B > 0, null otherwise (B ≤ 0 is hidden by default). B₃ (helpsScale) is the B of a uniform
 * +config.benefit.helpsGain (3) projected points a week for my team in every week a trade can change: the League model's
 * calibration run (league.ts helpsCalibrationOf, LeagueModel.helpsCalibration: ΔPO₃ and ΔCH₃, my odds' changes on the same
 * baseline, every team after its pickups, on the same seasons as every trade's final run) put through benefit() as a trade
 * that moves no trade value: g_mkt(me) 0 (no market term) and, in dynasty and keeper leagues, a long-term change of 0, so B₃
 * = (1 − λ) × B_win₃ there, λ capped (below; B_win₃ when long-term values are missing, as every trade's B is then B_win). It follows the goal
 * ("What matters most") and λ like every trade's B, so a trade worth +1, +3 or +6 points a week of lineup reads about 28, 63
 * or 86 in every league under every goal (63 = 100 × (1 − e^−1): B = B₃). B₃ is floored at config.benefit.helpsFloor (0.5):
 * below it my odds barely move with lineup changes (a team certainly out or locked in, the season's last weeks) and the
 * ratio would be mostly noise; helpsScaleNotes says so once per search and with each evaluation.
 * ⚠️ Ours (review of track SC):
 * - SC-1, λ: in dynasty and keeper leagues a high λ shrinks B₃ (+3 points a week this season weighs little for a rebuilding
 *   team), so long-term gains read high on the scale. Uncapped, λ → 1 took B₃ to 0, so the floor became the whole scale
 *   (any long-term gain read about 100, "≈ +36 pts/week"), and the floor note said "Your title odds barely move" while
 *   they moved normally. So B₃'s λ is capped at config.benefit.helpsLambdaMax (0.75, the largest default λ: every default
 *   still reads +3 as 63; HelpsScale.lambdaUsed), and the floor note is judged on the odds alone (HelpsScale.odds, B_win₃
 *   without λ: reason "odds"). When the odds move but the setting makes +3 a week print another number (λ above the cap,
 *   or (1 − λ) × B_win₃ under the floor: reason "lambda"), helpsLambdaNote says what it prints instead.
 * - SC-2, the floor note's odds: HELPS_FLOOR_NOTE names the title odds (the planner's words); HELPS_FLOOR_NOTE_PLAYOFFS the
 *   playoff odds when B₃ weighs them most (title odds unknown, or "Make the playoffs"), where the planner's words were false.
 * - SC-2, the market term (a question for the lead and the planner): the scale calibrates lineup gains only. The redraft
 *   market term κ × clamp(g_mkt(me)) stays in B units (the addendum's κ, priced at "about 0.4 points a week in Parker's
 *   league" under Balanced), so on this scale a trade-value change costs 3κ|g| / B₃ points a week: more on a team whose
 *   odds move little (a small or floored B₃), less under a goal with a larger B₃. Ranking (EG) doesn't depend on B₃.
 * The Analyzer's "≈ +X pts/week" is lineupEquivalent: helpsGain × B / B₃. Overall never exceeds Helps you (P_complete ≤
 * 0.85, config.acceptance.pAcceptClamp's top). EG = B × P_complete ranks (§13): under one B₃ Overall is a monotone function
 * of it. Don't add extra factors to Overall (§10). (Checkpoint 3 to Phase 4c: a fixed B_ref of 6 in place of B₃.)
 *
 * Guards (§10; TradeEvaluation.flags), apart from the three numbers: "Market check" when g_mkt(me) <
 * marketCheckBelow (−0.15); hidden by default when g_mkt(me) < marketHideBelow (−0.35) or when B ≤ 0 (a B not
 * known yet hides nothing); "depends on an injured player": the players I'd get whose status is one of
 * benefit.injuredStatuses (OUT, IR, PUP: "currently OUT or on IR"; PUP is a reserve list like IR).
 *
 * How an evaluation uses it (src/engine/evaluate.ts): my perception package tradePackage(get, give, perception
 * values, W) gives TradeEvaluation.value (received = recv, given = give) and g_mkt(me), which the market term reads;
 * the partner's (swapped) tradePackage gives g_mkt(P) for acceptance.ts. Dynasty and keeper leagues with
 * futureValuesLoaded: ΔDyn = recv − give of tradePackage(get, give, future values, the future term's W) and
 * MyDynTotal = rosterValue(my players, future values, my picks' values). After the simulation: benefit({ ΔPO, ΔCH,
 * g_mkt(me), dynasty, my baseline P(playoffs), settings.lambda, κ = protectValueWeight(settings.protectValue),
 * goal = settings.goal }), then tradeNumbers(benefit, acceptance result, B₃ for the same goal and λ: evaluate.ts
 * helpsScaleOf) and tradeFlags({ g_mkt(me), B, injuredReceived(get, snapshot.players) }); benefitNotes(benefit) and
 * helpsScaleNotes(B₃'s scale) for the search's notes (the Analyzer's notes).
 */
import type { AcceptanceResult } from "./acceptance";
import { config } from "./config";
import type { MarketInputs } from "./inputs";
import type { HelpsCalibration } from "./leagueModel";
import { packageValues, type ActiveSpots, type MarketConfig, type ValueLookup } from "./market";
import type { InjuryStatus, LeagueSettings, PlayerInfo } from "./model";
import type { Goal, ProtectValue } from "./settings";
import type { TradeEvaluation } from "./tradeModel";

/** B_win's weights on ΔPO (playoffs) and ΔCH (title). */
export interface GoalWeights {
  readonly playoffs: number;
  readonly title: number;
}

/** The config.benefit keys this module reads, widened so calibration and tests can pass other numbers. */
export interface BenefitConfig {
  /** B_win's weights by "What matters most" (TradeSettings.goal; Phase 4c), and the default goal. */
  readonly goals: Readonly<Record<Goal, GoalWeights>>;
  readonly goalDefault: Goal;
  /** κ by "Protect my trade value" level, and the default level. */
  readonly protectValue: Readonly<Record<ProtectValue, number>>;
  readonly protectValueDefault: ProtectValue;
  readonly marketSanityClamp: readonly [number, number];
  readonly bFutureScale: number;
  readonly lambda: {
    readonly contender: number;
    readonly bubble: number;
    readonly rebuild: number;
    readonly keeper: number;
    readonly contenderAt: number;
    readonly bubbleAt: number;
  };
  /**
   * The "Helps you" scale (the file header, the three numbers): B₃ is the B of +helpsGain points a week, floored at helpsFloor;
   * in dynasty and keeper leagues its λ is capped at helpsLambdaMax.
   */
  readonly helpsGain: number;
  readonly helpsFloor: number;
  readonly helpsLambdaMax: number;
  readonly marketCheckBelow: number;
  readonly marketHideBelow: number;
  readonly injuredStatuses: readonly InjuryStatus[];
}

export type LeagueType = LeagueSettings["leagueType"];

const isFiniteNumber = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

/** x clamped to [lo, hi]; ±Infinity land on the bounds. */
const clampTo = (x: number, range: readonly [number, number]): number => Math.min(range[1], Math.max(range[0], x));

// ---------------------------------------------------------------------------------------------
// λ (§10 dynasty and keeper)

/** §10's default λ: keeper 0.2; dynasty by my baseline P(playoffs) (0.35 / 0.5 / 0.75; unknown → the middle); redraft null. */
export function defaultLambda(leagueType: LeagueType, myPPlayoffs: number | null, cfg: BenefitConfig = config.benefit): number | null {
  if (leagueType === "redraft") return null;
  if (leagueType === "keeper") return cfg.lambda.keeper;
  if (!isFiniteNumber(myPPlayoffs)) return cfg.lambda.bubble;
  if (myPPlayoffs >= cfg.lambda.contenderAt) return cfg.lambda.contender;
  if (myPPlayoffs >= cfg.lambda.bubbleAt) return cfg.lambda.bubble;
  return cfg.lambda.rebuild;
}

/** λ for a trade: the user's Win now ↔ Future setting when it's a number in [0, 1], else defaultLambda; null in redraft leagues. */
export function resolveLambda(leagueType: LeagueType, setting: number | null | undefined, myPPlayoffs: number | null, cfg: BenefitConfig = config.benefit): number | null {
  if (leagueType === "redraft") return null;
  if (isFiniteNumber(setting) && setting >= 0 && setting <= 1) return setting;
  return defaultLambda(leagueType, myPPlayoffs, cfg);
}

// ---------------------------------------------------------------------------------------------
// B (§10)

/**
 * B_win's weights for a "What matters most" goal (the file header; TradeSettings.goal): config.benefit.goals[goal]. An
 * unknown goal (absent, or not one of the three) gets the default goal's (config.benefit.goalDefault: "title").
 */
export function goalWeights(goal: Goal | null | undefined, cfg: Pick<BenefitConfig, "goals" | "goalDefault"> = config.benefit): GoalWeights {
  const own = goal && Object.hasOwn(cfg.goals, goal) ? cfg.goals[goal] : undefined;
  return own ?? cfg.goals[cfg.goalDefault];
}

/**
 * B_win in percentage points from ΔPO and ΔCH (fractions), with `goal`'s weights (goalWeights; absent: the default goal's).
 * Null when ΔPO is missing (titleMissing false: nothing was simulated); ΔCH missing → the playoff term scaled up to the
 * whole weight (the file header), titleMissing true.
 */
export function benefitWin(dPO: number | null, dCH: number | null, cfg: BenefitConfig = config.benefit, goal?: Goal | null): { bWin: number | null; titleMissing: boolean } {
  const w = goalWeights(goal, cfg);
  if (!isFiniteNumber(dPO)) return { bWin: null, titleMissing: false };
  if (isFiniteNumber(dCH)) return { bWin: 100 * (w.playoffs * dPO + w.title * dCH), titleMissing: false };
  return { bWin: w.playoffs > 0 ? 100 * (w.playoffs + w.title) * dPO : null, titleMissing: true };
}

/** B_future = bFutureScale × ΔDyn / MyDynTotal; null when either is missing or MyDynTotal ≤ 0. */
export function benefitFuture(dDyn: number | null, myDynTotal: number | null, cfg: BenefitConfig = config.benefit): number | null {
  if (!isFiniteNumber(dDyn) || !isFiniteNumber(myDynTotal) || myDynTotal <= 0) return null;
  return (cfg.bFutureScale * dDyn) / myDynTotal;
}

/**
 * κ for a "Protect my trade value" level (TradeSettings.protectValue; the file header): config.benefit.protectValue
 * (low 2, medium 4, high 8). An unknown level (absent, or not one of the three) gets the default level's κ.
 */
export function protectValueWeight(level: ProtectValue | null | undefined, cfg: Pick<BenefitConfig, "protectValue" | "protectValueDefault"> = config.benefit): number {
  const k = level ? cfg.protectValue[level] : undefined;
  return isFiniteNumber(k) ? k : cfg.protectValue[cfg.protectValueDefault];
}

/** The redraft market term: κ × clamp(g_mkt(me), marketSanityClamp) (NaN counts 0); κ default: the default level's (protectValueWeight). */
export function marketSanity(gMine: number, kappa?: number, cfg: BenefitConfig = config.benefit): number {
  const k = isFiniteNumber(kappa) ? kappa : protectValueWeight(cfg.protectValueDefault, cfg);
  return k * clampTo(Number.isNaN(gMine) ? 0 : gMine, cfg.marketSanityClamp);
}

export interface BenefitInputs {
  leagueType: LeagueType;
  /** Changes in my P(playoffs) and P(title), fractions, from the common-random-numbers simulation; null = unknown. */
  dPO: number | null;
  dCH: number | null;
  /** g_mkt(me) on perception values (§9; each player at max(v, W): the file header): the redraft market term reads it. */
  gMine: number;
  /**
   * Dynasty and keeper leagues: ΔDyn (my long-term package change, tradePackage's recv − give on the future
   * term) and MyDynTotal (rosterValue before the trade). Null when long-term values are missing; ignored in
   * redraft leagues.
   */
  dynasty: { delta: number; total: number } | null;
  /** My baseline P(playoffs) (before the trade, every team at V*): the default λ. Null = unknown. */
  myPPlayoffs: number | null;
  /** TradeSettings.lambda: null or absent = the default by P(playoffs). */
  lambda?: number | null;
  /**
   * κ, the redraft market term's weight: protectValueWeight(TradeSettings.protectValue). Absent = the default level's
   * (medium, 4). Ignored in dynasty and keeper leagues (no market term).
   */
  kappa?: number;
  /**
   * Phase 4c (planner reply to Checkpoint 4b, change 8): TradeSettings.goal, "What matters most". B_win's ΔPO / ΔCH
   * weights are config.benefit.goals[goal]; absent = config.benefit.goalDefault ("title": 0.15 / 0.85).
   */
  goal?: Goal;
}

export interface Benefit {
  /** B; null when the trade hasn't been simulated (ΔPO missing). */
  b: number | null;
  bWin: number | null;
  /** Dynasty and keeper; null in redraft leagues or when long-term values are missing. */
  bFuture: number | null;
  /** λ used (dynasty and keeper); null in redraft leagues. */
  lambda: number | null;
  /** The redraft market term inside B, κ × clamp(g_mkt(me)) (0 in dynasty and keeper leagues). */
  market: number;
  /** ΔDyn (dynasty and keeper), null in redraft leagues or when missing. */
  dDyn: number | null;
  /** A dynasty or keeper league whose long-term values are missing: B = B_win, and the card says so. */
  dynMissing: boolean;
  /** ΔCH unknown while ΔPO is known: B_win counts the playoff odds alone, scaled (the file header). False when B wasn't simulated. */
  titleMissing: boolean;
}

/** B and its parts (§10; L6). See the file header for every rule. */
export function benefit(x: BenefitInputs, cfg: BenefitConfig = config.benefit): Benefit {
  const { bWin, titleMissing } = benefitWin(x.dPO, x.dCH, cfg, x.goal);
  if (x.leagueType === "redraft") {
    const market = marketSanity(x.gMine, x.kappa, cfg);
    return { b: bWin === null ? null : bWin + market, bWin, bFuture: null, lambda: null, market, dDyn: null, dynMissing: false, titleMissing };
  }
  // resolveLambda is null only in redraft leagues; the fallback just narrows the type.
  const lambda = resolveLambda(x.leagueType, x.lambda, x.myPPlayoffs, cfg) ?? cfg.lambda.bubble;
  const dyn = x.dynasty;
  const bFuture = dyn ? benefitFuture(dyn.delta, dyn.total, cfg) : null;
  if (bFuture === null || !dyn) return { b: bWin, bWin, bFuture: null, lambda, market: 0, dDyn: null, dynMissing: true, titleMissing };
  const b = bWin === null ? null : (1 - lambda) * bWin + lambda * bFuture;
  return { b, bWin, bFuture, lambda, market: 0, dDyn: dyn.delta, dynMissing: false, titleMissing };
}

/**
 * Whether long-term (dynasty) values are available for B_future: a dynasty or keeper league whose market
 * loaded in a dynasty format with at least one value. A keeper league whose dynasty list failed gets the
 * redraft list in `values` (format.isDynasty false; src/server/modelInputs.ts), which isn't long-term worth. ⚠️ Nor is
 * the curve fallback (MarketInputs.fallback kind "curve"; the file header): no long-term term then.
 */
export function futureValuesLoaded(leagueType: LeagueType, market: MarketInputs | null): boolean {
  if (leagueType === "redraft" || !market || !market.format.isDynasty || market.fallback?.kind === "curve") return false;
  return Object.values(market.values).some((v) => Number.isFinite(v) && v > 0);
}

// ---------------------------------------------------------------------------------------------
// The "Helps you" scale, B₃ (planner reply to Checkpoint 4c, A2; the file header, the three numbers)

/** What B₃ reads besides the calibration run: a trade's B inputs (BenefitInputs) without a trade-value change. */
export interface HelpsScaleInputs {
  leagueType: LeagueType;
  /** My baseline P(playoffs) (every team after its pickups): the default λ, as for every trade. Null = unknown. */
  myPPlayoffs: number | null;
  /** TradeSettings.lambda: null or absent = the default by P(playoffs). */
  lambda?: number | null;
  /** TradeSettings.goal ("What matters most"); absent = config.benefit.goalDefault. */
  goal?: Goal;
  /**
   * MyDynTotal when long-term values loaded (dynasty and keeper leagues: evaluate.ts TradeInternals.future), so B₃ =
   * (1 − λ) × B_win₃ like a trade with no long-term change; null without them (B₃ = B_win₃, as every trade's B is then
   * B_win). Ignored in redraft leagues.
   */
  dynastyTotal: number | null;
}

/** "Helps you"'s scale for one goal and λ (helpsScale). */
export interface HelpsScale {
  /** B₃ as the scores use it: `raw` floored at config.benefit.helpsFloor. Always above 0. */
  b3: number;
  /**
   * B₃ before the floor: `odds`, times (1 − lambdaUsed) in a dynasty or keeper league with long-term values (the B of the
   * calibration run with no long-term change, λ capped at helpsLambdaMax).
   */
  raw: number;
  /** raw is below helpsFloor (or not above 0): the scores read B against the floor. */
  floored: boolean;
  /** B_win₃: the calibration run's B_win under the goal, without λ, the odds' own response to +helpsGain a week. */
  odds: number;
  /** The odds the floor note names: those B₃ weighs most (title odds, unless the goal weighs playoff odds more or title odds are unknown). */
  oddsNamed: "title" | "playoff";
  /** λ of every trade's B (resolveLambda) in a dynasty or keeper league with long-term values; null elsewhere (no λ in B₃). */
  lambda: number | null;
  /** λ in B₃'s factor: min(lambda, helpsLambdaMax); null with lambda. */
  lambdaUsed: number | null;
  /**
   * What +helpsGain points a week this season prints on this scale (its B, (1 − λ) × odds or odds, through tradeScore; 0
   * when that B isn't above 0): HELPS_AT_GAIN (63) unless the scale departs (`reason`).
   */
  gainReads: number;
  /**
   * Why the scale departs from "+3 points a week reads 63", for the notes (helpsScaleNotes): "odds" when my odds barely move
   * (`odds` below helpsFloor, so B₃ is floored whatever λ), "lambda" when the odds move but the Win now ↔ Future setting
   * makes +3 a week print another number (λ above helpsLambdaMax, or (1 − λ) × odds below the floor), null otherwise.
   */
  reason: "odds" | "lambda" | null;
}

/**
 * B₃ (the file header): the calibration run's ΔPO₃ and ΔCH₃ (LeagueModel.helpsCalibration, evaluate.ts SimState.
 * calibration) as B_win under `x`'s goal (`odds`, benefitWin: title odds unknown → the playoff term scaled up, as every
 * trade's B), times 1 − λ in a dynasty or keeper league with long-term values (benefit()'s rule: MyDynTotal above 0) like a
 * trade with no long-term change, λ capped at helpsLambdaMax (⚠️ ours, review of track SC, SC-1), floored at helpsFloor.
 * Null without a run (no odds or no team) or when B₃ isn't a number (no ΔPO): then no B is either, and the scores are null.
 */
export function helpsScale(run: Pick<HelpsCalibration, "dPO" | "dCH"> | null | undefined, x: HelpsScaleInputs, cfg: BenefitConfig = config.benefit): HelpsScale | null {
  if (!run) return null;
  const { bWin: odds, titleMissing } = benefitWin(run.dPO, run.dCH, cfg, x.goal);
  if (!isFiniteNumber(odds)) return null;
  // Long-term values loaded: every trade's B weighs B_win by 1 − λ (benefit(): B_future null, so B = B_win, without them).
  const future = x.leagueType !== "redraft" && isFiniteNumber(x.dynastyTotal) && x.dynastyTotal > 0;
  // resolveLambda is null only in redraft leagues; the fallback just narrows the type.
  const lambda = future ? (resolveLambda(x.leagueType, x.lambda, x.myPPlayoffs, cfg) ?? cfg.lambda.bubble) : null;
  const cap = isFiniteNumber(cfg.helpsLambdaMax) ? Math.min(1, Math.max(0, cfg.helpsLambdaMax)) : 1;
  const lambdaUsed = lambda === null ? null : Math.min(lambda, cap);
  const raw = lambdaUsed === null ? odds : (1 - lambdaUsed) * odds;
  const floored = !(raw >= cfg.helpsFloor) || !(raw > 0);
  const b3 = floored ? cfg.helpsFloor : raw;
  if (!isFiniteNumber(b3) || !(b3 > 0)) return null;
  const gainReads = tradeScore(lambda === null ? odds : (1 - lambda) * odds, b3) ?? 0;
  const oddsFlat = !(odds >= cfg.helpsFloor) || !(odds > 0);
  const reason = oddsFlat ? "odds" : gainReads !== HELPS_AT_GAIN ? "lambda" : null;
  const w = goalWeights(x.goal, cfg);
  return { b3, raw, floored, odds, oddsNamed: titleMissing || w.playoffs > w.title ? "playoff" : "title", lambda, lambdaUsed, gainReads, reason };
}

/** The note when B₃ is floored because my odds barely move (planner reply to Checkpoint 4c, A2: "When it's floored, note it"). */
export const HELPS_FLOOR_NOTE = "Your title odds barely move with lineup changes right now.";

/**
 * ⚠️ Ours (review of track SC, finding SC-2): the floor note naming the playoff odds when B₃ weighs them most (HelpsScale.
 * oddsNamed): title odds unknown (B counts the playoff odds in their place, benefitNotes), or a goal that weighs playoff odds
 * more ("Make the playoffs": a team locked into the playoffs floors B₃ while its title odds can still move).
 */
export const HELPS_FLOOR_NOTE_PLAYOFFS = "Your playoff odds barely move with lineup changes right now.";

/**
 * ⚠️ Ours (review of track SC, finding SC-1): the note when the Win now ↔ Future setting makes +helpsGain points a week this
 * season print another number than 63 (HelpsScale.reason "lambda"), in the cards' words for the setting: "Your Win now ↔
 * Future setting counts later seasons 90%, so adding 3 points a week to your lineup this season reads 33 on Helps you, not 63."
 */
export function helpsLambdaNote(lambda: number, reads: number, cfg: Pick<BenefitConfig, "helpsGain"> = config.benefit): string {
  return `Your Win now ↔ Future setting counts later seasons ${Math.round(lambda * 100)}%, so adding ${cfg.helpsGain} points a week to your lineup this season reads ${reads} on Helps you, not ${HELPS_AT_GAIN}.`;
}

/**
 * Why the scale departs from "+3 points a week reads 63", once per search (search.ts) and with each evaluation (the
 * Analyzer's notes): the floor note when my odds barely move (HELPS_FLOOR_NOTE, or HELPS_FLOOR_NOTE_PLAYOFFS by
 * HelpsScale.oddsNamed: judged on the odds alone, never on λ, review of track SC, SC-1), the λ note (helpsLambdaNote), or none.
 */
export function helpsScaleNotes(scale: Pick<HelpsScale, "reason" | "oddsNamed" | "lambda" | "gainReads"> | null | undefined): string[] {
  if (!scale?.reason) return [];
  if (scale.reason === "odds") return [scale.oddsNamed === "playoff" ? HELPS_FLOOR_NOTE_PLAYOFFS : HELPS_FLOOR_NOTE];
  return scale.lambda === null ? [] : [helpsLambdaNote(scale.lambda, scale.gainReads)];
}

/**
 * What a B is worth in lineup points a week on the scale (the Analyzer's "≈ +X pts/week"; planner reply to Checkpoint 4c,
 * A2): helpsGain × B / B₃, so B = B₃ is +3. Signed (a B below 0 is a loss); null without B or B₃.
 */
export function lineupEquivalent(b: number | null, b3: number | null, cfg: Pick<BenefitConfig, "helpsGain"> = config.benefit): number | null {
  return isFiniteNumber(b) && isFiniteNumber(b3) && b3 > 0 ? (cfg.helpsGain * b) / b3 : null;
}

/** The Helps you that B = B₃ reads: round(100 × (1 − e^−1)) = 63, the "+3 points a week" of the tooltip. */
export const HELPS_AT_GAIN = Math.round(100 * (1 - Math.exp(-1)));

// ---------------------------------------------------------------------------------------------
// The three numbers (§10)

/** "Helps you": round(100 × (1 − e^(−B / B₃))) when B > 0 and B₃ (helpsScale's b3) is known; null otherwise (hidden by default). */
export function tradeScore(b: number | null, b3: number | null): number | null {
  return isFiniteNumber(b) && b > 0 && isFiniteNumber(b3) && b3 > 0 ? Math.round(100 * (1 - Math.exp(-b / b3))) : null;
}

/** Expected gain EG = B × P_complete (§13's default ranking); null without a B. */
export function expectedGain(b: number | null, pComplete: number): number | null {
  return isFiniteNumber(b) && isFiniteNumber(pComplete) ? b * pComplete : null;
}

/** "Overall": round(100 × (1 − e^(−B × P_complete / B₃))) when B > 0 and B₃ is known; null otherwise. P_complete is clamped to [0, 1]. */
export function overallScore(b: number | null, pComplete: number, b3: number | null): number | null {
  if (!isFiniteNumber(b) || !(b > 0) || !isFiniteNumber(pComplete) || !isFiniteNumber(b3) || !(b3 > 0)) return null;
  const p = Math.min(1, Math.max(0, pComplete));
  return Math.round(100 * (1 - Math.exp(-(b * p) / b3)));
}

/** tradeNumbers' result: TradeEvaluation's fields of those names, plus titleMissing (Benefit's; TradeEvaluation has no field for it). */
export type TradeNumbers = Pick<TradeEvaluation, "b" | "tradeScore" | "pAccept" | "pComplete" | "acceptLabel" | "overall" | "bWin" | "bFuture" | "lambda" | "dDyn" | "dynMissing" | "b3"> & {
  titleMissing: boolean;
};

/**
 * The numbers a card shows from B, the acceptance result and B₃ (helpsScale's b3 for the same goal and λ; null without
 * one): B and its parts, the Trade Score, P_accept, P_complete, the label (acceptance.ts), Overall and B₃ itself
 * (TradeEvaluation's fields of those names); and titleMissing, which benefitNotes words.
 */
export function tradeNumbers(b: Benefit, accept: Pick<AcceptanceResult, "pAccept" | "pComplete" | "label">, b3: number | null): TradeNumbers {
  return {
    b: b.b,
    tradeScore: tradeScore(b.b, b3),
    pAccept: accept.pAccept,
    pComplete: accept.pComplete,
    acceptLabel: accept.label,
    overall: overallScore(b.b, accept.pComplete, b3),
    bWin: b.bWin,
    bFuture: b.bFuture,
    lambda: b.lambda,
    dDyn: b.dDyn,
    dynMissing: b.dynMissing,
    b3: isFiniteNumber(b3) && b3 > 0 ? b3 : null,
    titleMissing: b.titleMissing,
  };
}

/**
 * Plain-English notes on what B leaves out: title odds unknown (B_win counts the playoff odds alone) and long-term
 * values missing (dynasty and keeper leagues: B = B_win, this season only). Both hold for every trade in a league,
 * so a search adds them once to TradeSearchResult.notes; the Analyzer can list them with a card's reasons.
 */
export function benefitNotes(b: Pick<Benefit, "titleMissing" | "dynMissing">): string[] {
  const notes: string[] = [];
  if (b.titleMissing) notes.push("Title odds aren't available for this league, so “Helps you” uses playoff odds in their place.");
  if (b.dynMissing) notes.push("Long-term trade values aren't available, so “Helps you” counts this season only.");
  return notes;
}

// ---------------------------------------------------------------------------------------------
// Guards (§10)

/** The players I'd get whose injury status is one of injuredStatuses (OUT, IR, PUP), in the order given; unknown players are skipped. */
export function injuredReceived(
  getIds: readonly string[],
  players: Readonly<Record<string, Pick<PlayerInfo, "injury"> | undefined>>,
  cfg: Pick<BenefitConfig, "injuredStatuses"> = config.benefit,
): string[] {
  const statuses = new Set<InjuryStatus>(cfg.injuredStatuses);
  const out: string[] = [];
  for (const id of getIds) {
    const injury = players[id]?.injury;
    if (injury !== undefined && statuses.has(injury) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** TradeEvaluation.flags (§10 guards): market check, hidden by market, hidden by benefit (B ≤ 0; an unknown B hides nothing) and the injured players. */
export function tradeFlags(x: { gMine: number; b: number | null; injured: readonly string[] }, cfg: BenefitConfig = config.benefit): TradeEvaluation["flags"] {
  const g = Number.isNaN(x.gMine) ? 0 : x.gMine;
  return {
    marketCheck: g < cfg.marketCheckBelow,
    hiddenByMarket: g < cfg.marketHideBelow,
    hiddenByBenefit: isFiniteNumber(x.b) && x.b <= 0,
    injured: [...x.injured],
  };
}

// ---------------------------------------------------------------------------------------------
// Package values with picks (§9; ΔDyn, MyDynTotal, the card's values, g)

/** One side of a package: players (they take roster spots, so the waiver credit counts them) and pick values (no roster spot). */
export interface PackageSide {
  players: readonly string[];
  pickValues?: readonly number[];
}

/** PV_recv, PV_give and g for the side that receives `recv` and gives `give` (§9). */
export interface PackageValue {
  recv: number;
  give: number;
  g: number;
}

/** Σ max(0, v)^γ over the finite pick values (γ = studExponent, as for player values). */
function pickSum(values: readonly number[] | undefined, cfg: MarketConfig): number {
  if (!values) return 0;
  let sum = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const x = Math.max(0, v);
    sum += cfg.studExponent === 1 ? x : x ** cfg.studExponent;
  }
  return sum;
}

/**
 * §9's package values for the side that receives `recv` and gives `give`, picks included (the file header): the neutral
 * throw-ins left out, then each player at max(v, W) and the waiver credit W per open roster spot, all for players only
 * (market.packageValues); picks keep their values. For my side pass (what I get, what I give); for the partner, swap
 * them. `spots`: the side's own moves on and off its active roster (market.ActiveSpots; a trade that moves IR players: an
 * IR slot isn't a roster spot), else every player takes one. `throwInValues`: the table the neutral throw-ins are chosen
 * on, when `values` isn't the market's own (premium.perceivedPackage). Player-only packages equal market.packageValues
 * and market.marketGain.
 */
export function tradePackage(recv: PackageSide, give: PackageSide, values: ValueLookup, W: number, cfg: MarketConfig = config.market, spots?: ActiveSpots, throwInValues?: ValueLookup): PackageValue {
  const pv = packageValues(recv.players, give.players, values, W, cfg, spots, throwInValues ?? values);
  const r = pv.recv + pickSum(recv.pickValues, cfg);
  const g = pv.give + pickSum(give.pickValues, cfg);
  return { recv: r, give: g, g: g > 0 ? (r - g) / g : r > 0 ? Number.POSITIVE_INFINITY : 0 };
}

/**
 * A roster's total value on one term (§10's MyDynTotal on the future term): Σ v^γ over its players (each once) plus its
 * picks' values. ⚠️ Raw (no floor at W: market.packageValues with W = 0): it is the scale of B_future, not a trade package.
 */
export function rosterValue(players: readonly string[], values: ValueLookup, pickValues: readonly number[] = [], cfg: MarketConfig = config.market): number {
  return packageValues([...new Set(players)], [], values, 0, cfg).recv + pickSum(pickValues, cfg);
}
