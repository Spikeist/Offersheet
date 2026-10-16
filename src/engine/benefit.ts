/**
 * Our benefit B, the Trade Score ("Helps you") and Overall, and the guards (CLAUDE.md §10; lead decision L6 of
 * the Phase 4 design; planner reply to Checkpoint 4c, A2: the self-calibrating scale B₃; planner reply to Checkpoint 7a,
 * §2 questions 5 and 6: "Protect my trade value" priced in lineup points, and the dynasty scale following the Win now ↔
 * Future slider). Pure and deterministic: plain numbers in, plain numbers out, no I/O and no clock; every tunable number
 * comes from config.benefit (package values from config.market). Everything here is from the user's side (§10): the
 * partner's side only matters through the chance they accept (src/engine/acceptance.ts), and since Checkpoint 7c through
 * "Helps them", a number shown beside mine that ranks nothing but the "Helps both" list (below).
 *
 * The caller (src/engine/evaluate.ts) runs the season simulation on one common-random-numbers matrix with every
 * team at its free-agent-optimized roster V* (§7), before the trade and after it (L6: my roster after the trade
 * and its legality moves, then V*; the partner's the same way; every other team at its V*), and passes my
 * changes in. Because both runs optimize free agents, no B comes from a pickup I could make anyway.
 *
 * B (§10):
 * - B_win = 100 × (w_PO × ΔPO + w_S × ΔE[S]) in percentage points, ΔPO and ΔE[S] as fractions (Checkpoint 7c; planner reply
 *   to Checkpoint 7b, §6, league prizes): E[S] is my expected share of the league's prizes this season, ΔE[S] its change
 *   (src/engine/reward.ts shareChange: Σ over the prizes that pay of share × the change in my odds of winning it, from the
 *   simulation's components, BenefitInputs.dPrizes; a prize that pays nothing is never read). The weights and the prizes are
 *   the user's "What does your league reward?" (planner reply to Checkpoint 4b, change 8, "What matters most" then; reworded
 *   by the planner's reply to Checkpoint 7a, 5.2; TradeSettings.goal and prizes, reward.ts rewardOf, BenefitInputs.reward;
 *   goalWeights): config.benefit.goals "title", "Only the champion", 0.15 / 0.85 with 1st place paying everything (the
 *   default, config.benefit.goalDefault: Parker's main goal is the title); "prizes", "Several prizes", 0.15 / 0.85 with the
 *   league's own split of 1st, 2nd and 3rd place, the weekly high scores and the points title; "playoffs", "Making the
 *   playoffs", 0.70 / 0.30 with 1st place paying everything. When 1st place pays everything ΔE[S] = 1 × ΔCH, exactly ΔCH, so
 *   "Only the champion" and "Making the playoffs" give the numbers they gave before Checkpoint 7c bit for bit (the planner:
 *   "today's numbers don't change"). ("balanced", "Top finishers too", 0.35 / 0.65 on ΔPO and ΔCH, went then: a stored one
 *   reads as "Several prizes", settings.ts.) The scores divide B by B₃ under the same reward (the three numbers, below), so
 *   the reward changes what a trade's odds are worth, not what a lineup gain reads. ΔPO missing (not simulated yet) → B_win
 *   and B are null. ⚠️ The lead's reward engine contract ("A paid component unknown → today's titleMissing fallback"): when a
 *   prize that pays has unknown odds but the playoff odds aren't (season.ts nulls every team's P(title), P(2nd) and P(3rd)
 *   when a played playoff round has no result it can match, SeasonOdds.playoffsKnown false, or when the league lists fewer
 *   playoff rounds than its bracket needs; P(3rd) alone when the 3rd-place game's round is over), B_win = 100 × (w_PO +
 *   w_S) × ΔPO: the playoff term scaled up to the whole weight (each goal's weights sum to 1, so it is 100 × ΔPO under
 *   every goal), so B stays on the Trade Score's scale.
 *   Under "Only the champion" and "Making the playoffs" that is title odds unknown, as before; a split paying only weekly
 *   high scores and the points title never needs it. Benefit.titleMissing marks it, tradeNumbers passes it on, and
 *   benefitNotes words it (naming the prize odds when 2nd or 3rd place pays). It holds for every trade in such a league, so
 *   a search says it once (TradeSearchResult.notes); TradeEvaluation has no field for it.
 * - Redraft: B = B_win + (B₃ / helpsGain) × κ × clamp(g_mkt(me), marketSanityClamp), the market term (g_mkt(me) from
 *   perception values; +∞, a side that gives nothing of value, clamps to +0.5; NaN counts 0). κ is the user's "Protect my
 *   trade value" setting (planner addendum to Checkpoint 3, §3; TradeSettings.protectValue, lead decision N3) as a lineup
 *   price since the planner's reply to Checkpoint 7a, §2 question 5: config.benefit.protectValue low 1, medium 2 (the
 *   default), high 4 projected points a week per 100% of trade value (protectValueWeight; BenefitInputs.kappa). B₃ is the
 *   scale the same evaluation's Helps you and Overall read (helpsScale's b3 for the call's goal: in redraft the B of +3
 *   points a week, floored at helpsFloor; BenefitInputs.b3), so on that scale the term is worth exactly κ × clamp(g_mkt(me))
 *   points a week (Benefit.marketWeekly, the Analyzer's "Trade value: −0.4 pts/week equivalent"), in every league under
 *   every goal: at medium, giving 25% more value than I get (g_mkt(me) = −0.20) costs 0.4 points a week. It keeps trade
 *   value for later deals before the deadline; depth for injuries and byes is already in B_win (scenario lineups). So B now
 *   depends on B₃: every B of an evaluation (its card, steps, Plan B, the screening and final simulations, the Analyzer)
 *   must read the B₃ its scores read (evaluate.ts simulateTrade, the one place both are computed), and EG = B × P_complete
 *   ranks on it. Without a scale (no calibration run: no odds or no team, when B is null anyway) there is no market term.
 *   Before, κ was 2 / 4 / 8 in B units, so the same g cost more lineup points where B₃ was small (a team whose odds move
 *   little, a goal with a small B₃) and less where it was large (review of track SC, SC-2). ⚠️ evaluate.ts passes κ = 0 in
 *   FantasyCalc's curve fallback (Phase 4c lead decision; evaluate.valuesEstimated: the values there come from our own ROS
 *   points, so the term would count lineup points twice), with a note, and ⚠️ ours, with no FantasyCalc values at all
 *   (evaluate.valuesMissing: every g is 0 then, so the term is 0 either way; κ = 0 says there is no term to show:
 *   Benefit.marketWeekly null).
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
 *   10% of my roster's value ≈ +4). No market term (L6), whatever κ (⚠️ N3: B_future carries the value change). ⚠️ The
 *   planner's reply to Checkpoint 7a (§2 question 5) adds "Dynasty and keeper: the term stays inside the win-now part": our
 *   reading is that there is no term there to place, so nothing changes; were one added, it would sit inside B_win's (1 − λ)
 *   share. ΔDyn = my package
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
 * e^(−B × P_complete / B₃))) when B > 0, null otherwise (B ≤ 0 is hidden by default). B₃ (helpsScale; TradeEvaluation.b3)
 * is built on the B of a uniform +config.benefit.helpsGain (3) projected points a week for my team in every week a trade can
 * change: the League model's calibration run (league.ts helpsCalibrationOf, LeagueModel.helpsCalibration: ΔPO₃ and every
 * prize component's change, my odds' changes on the same baseline, every team after its pickups, on the same seasons as
 * every trade's final run) as B_win₃ under the reward (benefitWin, no market term: g_mkt(me) 0; HelpsScale.odds). Since
 * Checkpoint 7c (planner reply to Checkpoint 7b, §6: "Everything follows E[S] … so +3 points a week still reads 63") the
 * reward is the league's prizes, so under "Several prizes" B₃ is the B of +3 a week in ΔE[S] too.
 * - Redraft, and dynasty and keeper leagues without long-term values (every trade's B is then B_win): B₃ = B_win₃. It
 *   follows the goal ("What matters most") like every trade's B, so a trade worth +1, +3 or +6 points a week of lineup reads
 *   about 28, 63 or 86 in every league under every goal (63 = 100 × (1 − e^−1): B = B₃).
 * - Dynasty and keeper leagues with long-term values (planner reply to Checkpoint 7a, §2 question 6: "the dynasty scale
 *   follows the slider"): B₃ = B_ref(λ) = (1 − λ) × B_win₃ + λ × F₁₀, F₁₀ = the B_future of gaining
 *   config.benefit.helpsFutureShare (10%) of my roster's long-term value, bFutureScale × 0.10 = 4 (HelpsScale.f10), λ the
 *   trade's (resolveLambda: the slider, else the default by my P(playoffs)). B_ref(λ) is the B of a trade worth +3 points a
 *   week this season together with +10% long-term value, so that trade reads 63 at every λ; +3 a week alone reads
 *   HelpsScale.gainReads ((1 − λ) × B_win₃ on the scale) and +10% alone futureReads (λ × F₁₀), the tooltip's mix. It
 *   replaces review SC-1's (1 − λ) × B_win₃ with λ capped at 0.75 (config.benefit.helpsLambdaMax) and its λ note: λ → 1
 *   shrank that scale to the floor, so any long-term gain read about 100, while B_ref(1) = F₁₀ reads +10% long-term value
 *   as 63 at λ 1, and B_ref stays above the floor at any λ while the odds move.
 * Helps you and Overall both read B₃ (B_ref(λ) in dynasty and keeper leagues with long-term values). B₃ is floored at
 * config.benefit.helpsFloor (0.5): below it my odds barely move with lineup changes (a team certainly out or locked in, the
 * season's last weeks) and the ratio would be mostly noise; helpsScaleNotes says so once per search and with each
 * evaluation. A floored B_ref(λ) needs λ × F₁₀ under the floor too, so λ under 1/8, and B_win₃ under it: the note's "barely
 * move" holds then. ⚠️ Ours (review of track SC, SC-2): HELPS_FLOOR_NOTE names the title odds (the planner's words);
 * HELPS_FLOOR_NOTE_PLAYOFFS the playoff odds when B₃ weighs them most (title odds unknown, or "Make the playoffs"), where the
 * planner's words were false.
 * The market term (redraft) is priced on the same B₃ (above), so its lineup equivalent doesn't depend on B₃ (SC-2's
 * question, answered by the planner's reply to Checkpoint 7a, question 5). The Analyzer's "≈ +X pts/week" is
 * lineupEquivalent: helpsGain × B / B₃ (in a dynasty or keeper league with long-term values, in units of the scale's mix:
 * "+3" is as good as +3 points a week this season together with +10% long-term value at the trade's λ). Overall never exceeds
 * Helps you (P_complete ≤ 0.85, config.acceptance.pAcceptClamp's top). EG = B × P_complete ranks (§13): under one B₃ Overall
 * is a monotone function of it. Don't add extra factors to Overall (§10). (Checkpoint 3 to Phase 4c: a fixed B_ref of 6 in
 * place of B₃.)
 *
 * Helps them (Checkpoint 7c; planner reply to Checkpoint 7b, §7: "the partner's version of Helps you, from the same simulation
 * runs"; TradeEvaluation.them, evaluate.ts simulateTrade): the trade's own simulation gives every team's odds, so the
 * partner's changes cost no run. B_P (partnerBenefit) is benefit() from the partner's side under the same reward as mine (the
 * league's: "What does your league reward?"), with no trade-value term: in redraft leagues B_win,P; in dynasty and keeper
 * leagues (1 − λ_P) × B_win,P + λ_P × B_future,P, λ_P §10's default for the partner's baseline P(playoffs) on the final block
 * (keeper 0.2; never the user's slider), B_future,P = bFutureScale × ΔDyn_P / the partner's roster's long-term value, ΔDyn_P
 * from the trade's own long-term package (⚠️ the partner's free-agent moves after the trade aren't in it, as the partner's g
 * reads the trade alone), B_win,P alone without long-term values. Its scale B_ref,P (partnerScale): the B_win of the partner's
 * +helpsGain points a week (league.ts helpsCalibrationOf with its id, on the final block against the same baseline: one run
 * per partner, made when first needed, evaluate.ts partnerCalibrationOf), floored at helpsFloor (B₃,P), then mixed (1 − λ_P)
 * × B₃,P + λ_P × F₁₀ with long-term values (the planner's order: floor, then mix; ⚠️ helpsScale, mine, floors the mix). Helps
 * them = round(100 × (1 − e^(−B_P / B_ref,P))) when B_P > 0, 0 when B_P ≤ 0 (helpsThemScore), so +3 points a week for them
 * reads 63 as for me. A trade helps both teams when its Helps you and its Helps them, as printed, are each at least
 * config.benefit.helpsThemMin (10, about +0.3 points a week for them: helpsBoth; Helps you above 0 until Checkpoint 7d). Helps them weighs nothing in B, the
 * chance they accept or Overall (§10's "Don't add extra factors to Overall"; "Helps you already counts the cost of making
 * them stronger": my B_win reads the run in which they gain).
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
 * MyDynTotal = rosterValue(my players, future values, my picks' values). After the simulation: B₃ for the call's reward and λ
 * (evaluate.ts helpsScaleOf), then benefit({ ΔPO, ΔCH, every prize component's change, g_mkt(me), dynasty, my baseline
 * P(playoffs), settings.lambda, κ = protectValueWeight(settings.protectValue), b3 = that B₃, reward = rewardOf(settings) }),
 * tradeNumbers(benefit, acceptance result, the same B₃) and tradeFlags({ g_mkt(me), B, injuredReceived(get,
 * snapshot.players) }); benefitNotes(benefit, reward) and helpsScaleNotes(B₃'s scale) for the search's notes (the Analyzer's
 * notes).
 */
import type { AcceptanceResult } from "./acceptance";
import { config } from "./config";
import type { MarketInputs } from "./inputs";
import type { HelpsCalibration } from "./leagueModel";
import { packageValues, type ActiveSpots, type MarketConfig, type ValueLookup } from "./market";
import type { InjuryStatus, LeagueSettings, PlayerInfo } from "./model";
import { TITLE_ONLY, assertWeeklyMeasured, isTitleOnly, shareChange, titleDeltas, type PrizeDeltas, type Reward } from "./reward";
import type { Goal, ProtectValue } from "./settings";
import type { TradeEvaluation } from "./tradeModel";

/**
 * B_win's weights on ΔPO (playoffs) and ΔE[S] (prizes: the change in my share of the league's prizes, reward.ts; ΔCH when 1st
 * place pays everything). Checkpoint 7c renamed the second from `title` (planner reply to Checkpoint 7b, §6).
 */
export interface GoalWeights {
  readonly playoffs: number;
  readonly prizes: number;
}

/** The config.benefit keys this module reads, widened so calibration and tests can pass other numbers. */
export interface BenefitConfig {
  /** B_win's weights by "What does your league reward?" (TradeSettings.goal; Phase 4c, Checkpoint 7c), and the default goal. */
  readonly goals: Readonly<Record<Goal, GoalWeights>>;
  readonly goalDefault: Goal;
  /** κ by "Protect my trade value" level (projected points a week per 100% of trade value), and the default level. */
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
   * The "Helps you" scale (the file header, the three numbers): B₃ is the B of +helpsGain points a week, and in dynasty and
   * keeper leagues with long-term values B_ref(λ) = (1 − λ) × that + λ × F₁₀, F₁₀ = bFutureScale × helpsFutureShare; floored
   * at helpsFloor. The redraft market term is priced on it (B₃ / helpsGain per point a week).
   */
  readonly helpsGain: number;
  readonly helpsFloor: number;
  readonly helpsFutureShare: number;
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
 * B_win's weights for a "What does your league reward?" goal (the file header; TradeSettings.goal): config.benefit.goals[goal].
 * An unknown goal (absent, or not one of the three: an older version's "balanced" among them) gets the default goal's
 * (config.benefit.goalDefault: "title").
 */
export function goalWeights(goal: Goal | null | undefined, cfg: Pick<BenefitConfig, "goals" | "goalDefault"> = config.benefit): GoalWeights {
  const own = goal && Object.hasOwn(cfg.goals, goal) ? cfg.goals[goal] : undefined;
  return own ?? cfg.goals[cfg.goalDefault];
}

/**
 * A reward that pays 1st place everything under `goal`'s weights (reward.ts TITLE_ONLY): what "Only the champion" and
 * "Making the playoffs" give (reward.ts rewardOf), for callers that have a goal but no league to count prize periods in
 * (BenefitInputs.goal, the tests, the reports' title-only rows). `goal` absent: config.benefit.goalDefault.
 */
export function titleOnlyReward(goal?: Goal | null, cfg: Pick<BenefitConfig, "goalDefault"> = config.benefit): Reward {
  return { goal: goal ?? cfg.goalDefault, shares: TITLE_ONLY, periods: 0, empty: false };
}

/**
 * B_win in percentage points (the file header): 100 × (w_PO × ΔPO + w_S × ΔE[S]), ΔPO a fraction and ΔE[S] reward.ts
 * shareChange(dPrizes, reward) (each prize component's change, a fraction; only the prizes that pay are read), with `reward`'s
 * goal's weights (goalWeights). `reward` absent: the default goal, 1st place paying everything (so ΔE[S] = ΔCH, dPrizes.first).
 * Null when ΔPO is missing (titleMissing false: nothing was simulated); a paid prize's change missing → the playoff term
 * scaled up to the whole weight (the file header), titleMissing true.
 */
export function benefitWin(dPO: number | null, dPrizes: Partial<PrizeDeltas> | null, cfg: Pick<BenefitConfig, "goals" | "goalDefault"> = config.benefit, reward?: Reward | null): { bWin: number | null; titleMissing: boolean } {
  const r = reward ?? titleOnlyReward(null, cfg);
  const w = goalWeights(r.goal, cfg);
  if (!isFiniteNumber(dPO)) return { bWin: null, titleMissing: false };
  const dES = shareChange(dPrizes, r);
  if (isFiniteNumber(dES)) return { bWin: 100 * (w.playoffs * dPO + w.prizes * dES), titleMissing: false };
  return { bWin: w.playoffs > 0 ? 100 * (w.playoffs + w.prizes) * dPO : null, titleMissing: true };
}

/** B_future = bFutureScale × ΔDyn / MyDynTotal; null when either is missing or MyDynTotal ≤ 0. */
export function benefitFuture(dDyn: number | null, myDynTotal: number | null, cfg: BenefitConfig = config.benefit): number | null {
  if (!isFiniteNumber(dDyn) || !isFiniteNumber(myDynTotal) || myDynTotal <= 0) return null;
  return (cfg.bFutureScale * dDyn) / myDynTotal;
}

/**
 * κ for a "Protect my trade value" level (TradeSettings.protectValue; the file header): config.benefit.protectValue (low 1,
 * medium 2, high 4), in projected points a week per 100% of trade value. An unknown level (absent, or not one of the three)
 * gets the default level's κ.
 */
export function protectValueWeight(level: ProtectValue | null | undefined, cfg: Pick<BenefitConfig, "protectValue" | "protectValueDefault"> = config.benefit): number {
  const k = level ? cfg.protectValue[level] : undefined;
  return isFiniteNumber(k) ? k : cfg.protectValue[cfg.protectValueDefault];
}

/**
 * The redraft market term's lineup equivalent (planner reply to Checkpoint 7a, §2 question 5): κ × clamp(g_mkt(me),
 * marketSanityClamp) projected points a week, signed (NaN counts 0); κ default: the default level's (protectValueWeight).
 * At medium (κ 2), g_mkt(me) = −0.20 (giving 25% more value than I get) is −0.4 points a week.
 */
export function marketWeekly(gMine: number, kappa?: number, cfg: Pick<BenefitConfig, "protectValue" | "protectValueDefault" | "marketSanityClamp"> = config.benefit): number {
  const k = isFiniteNumber(kappa) ? kappa : protectValueWeight(cfg.protectValueDefault, cfg);
  return k * clampTo(Number.isNaN(gMine) ? 0 : gMine, cfg.marketSanityClamp);
}

/**
 * The redraft market term in B units: (B₃ / helpsGain) × marketWeekly(g_mkt(me), κ), so on the scale B₃ it is worth exactly
 * marketWeekly points a week (helpsGain × term / B₃: lineupEquivalent). 0 without a scale (B₃ missing or not above 0).
 */
export function marketSanity(gMine: number, b3: number | null | undefined, kappa?: number, cfg: BenefitConfig = config.benefit): number {
  if (!isFiniteNumber(b3) || !(b3 > 0) || !isFiniteNumber(cfg.helpsGain) || !(cfg.helpsGain > 0)) return 0;
  return (b3 / cfg.helpsGain) * marketWeekly(gMine, kappa, cfg);
}

export interface BenefitInputs {
  leagueType: LeagueType;
  /** Changes in my P(playoffs) and P(title), fractions, from the common-random-numbers simulation; null = unknown. */
  dPO: number | null;
  dCH: number | null;
  /**
   * Checkpoint 7c (planner reply to Checkpoint 7b, §6): every prize component's change (reward.ts PrizeDeltas: 1st = ΔCH, 2nd,
   * 3rd, weekly high scores won, the points title), the same runs as dPO; ΔE[S] reads the ones `reward` pays. Absent: dCH as
   * 1st place's (reward.ts titleDeltas), the title-only reading.
   */
  dPrizes?: PrizeDeltas | null;
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
   * κ, the redraft market term's lineup price: protectValueWeight(TradeSettings.protectValue), projected points a week per
   * 100% of trade value. Absent = the default level's (medium, 2); 0 = no market term (evaluate.ts: FantasyCalc's curve
   * fallback, or no values). Ignored in dynasty and keeper leagues (no market term).
   */
  kappa?: number;
  /**
   * Planner reply to Checkpoint 7a, §2 question 5: B₃, the scale the same evaluation's Helps you and Overall read
   * (helpsScale's b3 for the same goal; evaluate.ts helpsScaleOf), which prices the redraft market term: (B₃ / helpsGain) ×
   * κ × clamp(g_mkt(me)). Absent, null or not above 0: no market term (B = B_win; there's no scale to price it on, and no
   * scores either). Ignored in dynasty and keeper leagues.
   */
  b3?: number | null;
  /**
   * Phase 4c (planner reply to Checkpoint 4b, change 8): TradeSettings.goal, "What does your league reward?". B_win's ΔPO /
   * ΔE[S] weights are config.benefit.goals[goal]; absent = config.benefit.goalDefault ("title": 0.15 / 0.85). Read with 1st
   * place paying everything (titleOnlyReward), only when `reward` is absent.
   */
  goal?: Goal;
  /**
   * Checkpoint 7c: the league's reward (reward.ts rewardOf: the goal's weights and the prize shares ΔE[S] reads), which wins
   * over `goal`. The engine always passes it (evaluate.ts simulateTrade, search.ts).
   */
  reward?: Reward | null;
}

export interface Benefit {
  /** B; null when the trade hasn't been simulated (ΔPO missing). */
  b: number | null;
  bWin: number | null;
  /** Dynasty and keeper; null in redraft leagues or when long-term values are missing. */
  bFuture: number | null;
  /** λ used (dynasty and keeper); null in redraft leagues. */
  lambda: number | null;
  /**
   * The redraft market term inside B, (B₃ / helpsGain) × κ × clamp(g_mkt(me)) (marketSanity); 0 in dynasty and keeper
   * leagues, at κ 0, and without a scale.
   */
  market: number;
  /**
   * The market term's lineup equivalent, projected points a week, signed (marketWeekly: κ × clamp(g_mkt(me)); helpsGain ×
   * market / B₃ exactly): the Analyzer's "Trade value: −0.4 pts/week equivalent" (planner reply to Checkpoint 7a, §2
   * question 5). Null when B has no market term: dynasty and keeper leagues, κ 0, or no scale (BenefitInputs.b3).
   */
  marketWeekly: number | null;
  /** ΔDyn (dynasty and keeper), null in redraft leagues or when missing. */
  dDyn: number | null;
  /** A dynasty or keeper league whose long-term values are missing: B = B_win, and the card says so. */
  dynMissing: boolean;
  /**
   * A paid prize's change unknown while ΔPO is known (ΔCH under "Only the champion" and "Making the playoffs"): B_win counts
   * the playoff odds alone, scaled (the file header). False when B wasn't simulated.
   */
  titleMissing: boolean;
}

/** B and its parts (§10; L6). See the file header for every rule. */
export function benefit(x: BenefitInputs, cfg: BenefitConfig = config.benefit): Benefit {
  const { bWin, titleMissing } = benefitWin(x.dPO, x.dPrizes ?? titleDeltas(x.dCH), cfg, x.reward ?? titleOnlyReward(x.goal, cfg));
  if (x.leagueType === "redraft") {
    // The market term, priced on the evaluation's own scale (planner reply to Checkpoint 7a, §2 question 5): none at κ 0 or
    // without a scale.
    const kappa = isFiniteNumber(x.kappa) ? x.kappa : protectValueWeight(cfg.protectValueDefault, cfg);
    const scaled = isFiniteNumber(x.b3) && x.b3 > 0 && isFiniteNumber(cfg.helpsGain) && cfg.helpsGain > 0;
    const weekly = kappa !== 0 && scaled ? marketWeekly(x.gMine, kappa, cfg) : null;
    const market = weekly === null ? 0 : marketSanity(x.gMine, x.b3, kappa, cfg);
    return { b: bWin === null ? null : bWin + market, bWin, bFuture: null, lambda: null, market, marketWeekly: weekly, dDyn: null, dynMissing: false, titleMissing };
  }
  // resolveLambda is null only in redraft leagues; the fallback just narrows the type.
  const lambda = resolveLambda(x.leagueType, x.lambda, x.myPPlayoffs, cfg) ?? cfg.lambda.bubble;
  const dyn = x.dynasty;
  const bFuture = dyn ? benefitFuture(dyn.delta, dyn.total, cfg) : null;
  if (bFuture === null || !dyn) return { b: bWin, bWin, bFuture: null, lambda, market: 0, marketWeekly: null, dDyn: null, dynMissing: true, titleMissing };
  const b = bWin === null ? null : (1 - lambda) * bWin + lambda * bFuture;
  return { b, bWin, bFuture, lambda, market: 0, marketWeekly: null, dDyn: dyn.delta, dynMissing: false, titleMissing };
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
  /** TradeSettings.goal ("What does your league reward?"), read with 1st place paying everything; absent = config.benefit.goalDefault. */
  goal?: Goal;
  /** Checkpoint 7c: the league's reward (reward.ts rewardOf), which wins over `goal` (BenefitInputs.reward's rule). */
  reward?: Reward | null;
  /**
   * MyDynTotal when long-term values loaded (dynasty and keeper leagues: evaluate.ts TradeInternals.future), so B₃ is
   * B_ref(λ) (the file header; every trade's B weighs B_win by 1 − λ and B_future by λ); null without them (B₃ = B_win₃, as
   * every trade's B is then B_win). Ignored in redraft leagues.
   */
  dynastyTotal: number | null;
}

/**
 * "Helps you"'s scale for one goal and λ (helpsScale): what the Trade Finder's and the Analyzer's tooltip words
 * (TradeSearchResult.helpsScale, evaluate.ts TradeAnalysis.helpsScale). In a dynasty or keeper league with long-term values
 * 63 reads as good as +helpsGain points a week this season (gainReads alone) together with +helpsFutureShare of the roster's
 * long-term value (futureReads alone), mixed by λ: B_ref(λ) = (1 − λ) × odds + λ × f10 (planner reply to Checkpoint 7a, §2
 * question 6: "The tooltip follows the mix").
 */
export interface HelpsScale {
  /** B₃ as the scores use it (B_ref(λ) with long-term values): `raw` floored at config.benefit.helpsFloor. Always above 0. TradeEvaluation.b3. */
  b3: number;
  /**
   * B₃ before the floor: `odds`; in a dynasty or keeper league with long-term values B_ref(λ) = (1 − lambda) × odds + lambda ×
   * f10, the B of a trade worth +helpsGain points a week this season together with +helpsFutureShare long-term value.
   */
  raw: number;
  /** raw is below helpsFloor (or not above 0): the scores read B against the floor. */
  floored: boolean;
  /** B_win₃: the calibration run's B_win under the goal, without λ, the odds' own response to +helpsGain a week. */
  odds: number;
  /**
   * The odds the floor note names: those B₃ weighs most. "playoff" when a paid prize's odds are unknown (B₃ counts the playoff
   * odds in their place) or the goal weighs playoff odds more; "prizes" under "Several prizes" paying more than 1st place
   * (Checkpoint 7c: my chances at the league's prizes); else "title".
   */
  oddsNamed: "title" | "playoff" | "prizes";
  /** λ of every trade's B (resolveLambda: the slider, else the default) in a dynasty or keeper league with long-term values; null elsewhere (no λ in B₃). */
  lambda: number | null;
  /**
   * F₁₀ (planner reply to Checkpoint 7a, §2 question 6): the B_future of gaining config.benefit.helpsFutureShare (10%) of my
   * roster's long-term value, bFutureScale × helpsFutureShare (40 × 0.10 = 4), in a dynasty or keeper league with long-term
   * values; null elsewhere (with `lambda`).
   */
  f10: number | null;
  /**
   * What +helpsGain points a week this season alone prints on this scale (its B: (1 − λ) × odds with long-term values, else
   * odds; through tradeScore, 0 when that B isn't above 0): HELPS_AT_GAIN (63) in a redraft league unless floored.
   */
  gainReads: number;
  /**
   * What +helpsFutureShare (10%) of my roster's long-term value alone prints (its B, λ × f10, through tradeScore; 0 when λ is
   * 0); null without long-term values. With gainReads: the mix's two parts (both at once read HELPS_AT_GAIN unless floored).
   */
  futureReads: number | null;
  /**
   * "odds" when the scale is floored, so my odds barely move with lineup changes (the floor note, helpsScaleNotes; a floored
   * B_ref(λ) means B_win₃ under the floor too: the file header), null otherwise. (Review SC-1's "lambda", the Win now ↔ Future
   * setting's own note, went with its cap: planner reply to Checkpoint 7a, §2 question 6.)
   */
  reason: "odds" | null;
}

/**
 * B₃ (the file header): the calibration run's ΔPO₃ and prize components' changes (LeagueModel.helpsCalibration, evaluate.ts
 * SimState.calibration; dPrizes absent: ΔCH₃ as 1st place's) as B_win under `x`'s reward (`odds`, benefitWin: a paid prize's
 * odds unknown → the playoff term scaled up, as every trade's B); in a dynasty or keeper league with long-term values
 * (benefit()'s rule: MyDynTotal above 0) B_ref(λ) = (1 − λ) × odds + λ × F₁₀ (planner reply to Checkpoint 7a, §2 question 6),
 * λ the trade's (resolveLambda); floored at helpsFloor. Null without a run (no odds or no team) or when B₃ isn't a number (no
 * ΔPO): then no B is either, and the scores are null. Throws under a reward that pays the weekly high score when the run
 * didn't simulate the high scores (its weekly change unknown: reward.ts assertWeeklyMeasured; the review of the reward
 * engine, compat-R1): a B₃ that silently left the weekly prize out otherwise. The engine's runs simulate them whenever their
 * own build's reward pays them, and evaluate.ts rewardOn refuses a call's reward its context can't price.
 */
export function helpsScale(run: (Pick<HelpsCalibration, "dPO" | "dCH"> & { readonly dPrizes?: PrizeDeltas | null }) | null | undefined, x: HelpsScaleInputs, cfg: BenefitConfig = config.benefit): HelpsScale | null {
  if (!run) return null;
  const reward = x.reward ?? titleOnlyReward(x.goal, cfg);
  assertWeeklyMeasured(reward, run, "The “Helps you” calibration run");
  const { bWin: odds, titleMissing } = benefitWin(run.dPO, run.dPrizes ?? titleDeltas(run.dCH), cfg, reward);
  if (!isFiniteNumber(odds)) return null;
  // Long-term values loaded: every trade's B mixes B_win and B_future by λ (benefit(): B_future null, so B = B_win, without them).
  const future = x.leagueType !== "redraft" && isFiniteNumber(x.dynastyTotal) && x.dynastyTotal > 0;
  // resolveLambda is null only in redraft leagues; the fallback just narrows the type.
  const lambda = future ? (resolveLambda(x.leagueType, x.lambda, x.myPPlayoffs, cfg) ?? cfg.lambda.bubble) : null;
  const f10 = lambda === null ? null : cfg.bFutureScale * cfg.helpsFutureShare;
  const raw = lambda === null || f10 === null ? odds : (1 - lambda) * odds + lambda * f10;
  const floored = !(raw >= cfg.helpsFloor) || !(raw > 0);
  const b3 = floored ? cfg.helpsFloor : raw;
  if (!isFiniteNumber(b3) || !(b3 > 0)) return null;
  const gainReads = tradeScore(lambda === null ? odds : (1 - lambda) * odds, b3) ?? 0;
  const futureReads = lambda === null || f10 === null ? null : (tradeScore(lambda * f10, b3) ?? 0);
  const w = goalWeights(reward.goal, cfg);
  const oddsNamed = titleMissing ? "playoff" : reward.goal === "prizes" && !isTitleOnly(reward.shares) ? "prizes" : w.playoffs > w.prizes ? "playoff" : "title";
  return { b3, raw, floored, odds, oddsNamed, lambda, f10, gainReads, futureReads, reason: floored ? "odds" : null };
}

/** The note when B₃ is floored because my odds barely move (planner reply to Checkpoint 4c, A2: "When it's floored, note it"). */
export const HELPS_FLOOR_NOTE = "Your title odds barely move with lineup changes right now.";

/**
 * Checkpoint 7c (the lead's words for "Several prizes", planner reply to Checkpoint 7b, §6): the floor note when B₃ weighs my
 * share of the league's prizes (HelpsScale.oddsNamed "prizes"). src/lib/tradeView.ts helpsReasonOf reads it back as an odds
 * note.
 */
export const HELPS_FLOOR_NOTE_PRIZES = "Your chances at your league's prizes barely move with lineup changes right now.";

/**
 * ⚠️ Ours (review of track SC, finding SC-2): the floor note naming the playoff odds when B₃ weighs them most (HelpsScale.
 * oddsNamed): title odds unknown (B counts the playoff odds in their place, benefitNotes), or a goal that weighs playoff odds
 * more ("Make the playoffs": a team locked into the playoffs floors B₃ while its title odds can still move).
 */
export const HELPS_FLOOR_NOTE_PLAYOFFS = "Your playoff odds barely move with lineup changes right now.";

/**
 * The floor note, once per search (search.ts) and with each evaluation (the Analyzer's notes), when the scale is floored
 * (HelpsScale.reason "odds"): HELPS_FLOOR_NOTE, HELPS_FLOOR_NOTE_PLAYOFFS or HELPS_FLOOR_NOTE_PRIZES by HelpsScale.oddsNamed;
 * else none. (The Win now ↔ Future note of review SC-1 went with its λ cap: planner reply to Checkpoint 7a, §2 question 6.)
 */
export function helpsScaleNotes(scale: Pick<HelpsScale, "reason" | "oddsNamed"> | null | undefined): string[] {
  if (scale?.reason !== "odds") return [];
  return [scale.oddsNamed === "playoff" ? HELPS_FLOOR_NOTE_PLAYOFFS : scale.oddsNamed === "prizes" ? HELPS_FLOOR_NOTE_PRIZES : HELPS_FLOOR_NOTE];
}

/**
 * What a B is worth in lineup points a week on the scale (the Analyzer's "≈ +X pts/week"; planner reply to Checkpoint 4c,
 * A2): helpsGain × B / B₃, so B = B₃ is +3. Signed (a B below 0 is a loss); null without B or B₃. In a dynasty or keeper
 * league with long-term values B₃ is B_ref(λ) (the file header), so the unit is the scale's mix: +3 is as good as +3 points a
 * week this season together with +10% of the roster's long-term value at the trade's λ (exactly +3 points a week this
 * season at λ 0; +10% long-term value alone at λ 1).
 */
export function lineupEquivalent(b: number | null, b3: number | null, cfg: Pick<BenefitConfig, "helpsGain"> = config.benefit): number | null {
  return isFiniteNumber(b) && isFiniteNumber(b3) && b3 > 0 ? (cfg.helpsGain * b) / b3 : null;
}

/** The Helps you that B = B₃ reads: round(100 × (1 − e^−1)) = 63, the "+3 points a week" of the tooltip. */
export const HELPS_AT_GAIN = Math.round(100 * (1 - Math.exp(-1)));

// ---------------------------------------------------------------------------------------------
// "Helps them" (Checkpoint 7c; planner reply to Checkpoint 7b, §7; the file header, "Helps them")

/** What B_P reads (partnerBenefit): the partner's changes from a trade's own runs, its long-term package and its odds. */
export interface PartnerBenefitInputs {
  leagueType: LeagueType;
  /** The partner's changes in P(playoffs) and P(title), fractions, from the trade's simulation (the runs my B comes from); null = unknown. */
  dPO: number | null;
  dCH: number | null;
  /** Every prize component's change for the partner (BenefitInputs.dPrizes' rules; absent: dCH as 1st place's). */
  dPrizes?: PrizeDeltas | null;
  /**
   * Dynasty and keeper leagues with long-term values: ΔDyn_P, the partner's long-term package change from the trade itself
   * (tradePackage on the long-term values and W, its own roster spots), and its roster's long-term value (rosterValue). Null
   * without them; ignored in redraft leagues.
   */
  dynasty: { delta: number; total: number } | null;
  /** The partner's baseline P(playoffs) (the final block: its acceptance profile's number): λ_P's default. Null = unknown. */
  pPlayoffs: number | null;
  /** The league's reward (reward.ts rewardOf): the one my B is weighed by. Absent: the default goal, 1st place paying everything. */
  reward?: Reward | null;
}

/**
 * B_P, the partner's benefit from a trade (the file header, "Helps them"): benefit() from the partner's side with no
 * trade-value term (κ 0, no scale: Benefit.market 0) and λ_P its default by the partner's baseline P(playoffs) (keeper 0.2),
 * never the user's Win now ↔ Future setting. Redraft: B_win,P under the reward. Dynasty and keeper: (1 − λ_P) × B_win,P + λ_P ×
 * B_future,P, or B_win,P without long-term values (dynMissing), as for mine.
 */
export function partnerBenefit(x: PartnerBenefitInputs, cfg: BenefitConfig = config.benefit): Benefit {
  return benefit(
    { leagueType: x.leagueType, dPO: x.dPO, dCH: x.dCH, dPrizes: x.dPrizes ?? null, gMine: 0, dynasty: x.dynasty, myPPlayoffs: x.pPlayoffs, lambda: null, kappa: 0, b3: null, reward: x.reward ?? null },
    cfg,
  );
}

/** What B_ref,P reads besides the partner's calibration run (partnerScale). */
export interface PartnerScaleInputs {
  leagueType: LeagueType;
  /** The partner's baseline P(playoffs) on the final block: λ_P's default, as for B_P. Null = unknown. */
  pPlayoffs: number | null;
  /** The league's reward (B_P's). Absent: the default goal, 1st place paying everything. */
  reward?: Reward | null;
  /**
   * The partner's roster's long-term value when long-term values loaded (dynasty and keeper leagues: evaluate.ts
   * TradeInternals.future.totals), so B_ref,P mixes in F₁₀ as B_P mixes in B_future,P; null without them. Ignored in redraft.
   */
  dynastyTotal: number | null;
}

/** "Helps them"'s scale for one partner (partnerScale; TradeEvaluation.them's b3). */
export interface PartnerScale {
  /** B_ref,P, what Helps them divides B_P by: b3P, or with long-term values (1 − lambda) × b3P + lambda × F₁₀. Always above 0. */
  b3: number;
  /** B₃,P: `odds` floored at config.benefit.helpsFloor, before any mix (the planner's order). */
  b3P: number;
  /** B_win₃,P: the B_win under the reward of the partner's calibration run (+helpsGain points a week for it), unfloored. */
  odds: number;
  /** `odds` was under the floor (or not above 0): the partner's odds barely move with lineup changes. */
  floored: boolean;
  /** λ_P in the mix (a dynasty or keeper league with long-term values), else null. */
  lambda: number | null;
}

/**
 * B_ref,P (the file header, "Helps them"; planner reply to Checkpoint 7b, §7: "B₃,P = the B of +3 points a week for that
 * partner, on the same baseline with the same common random numbers, floored at 0.5 … B_ref,P = B₃,P in redraft, and (1 −
 * λ_P) × B₃,P + λ_P × 4 in dynasty and keeper"): the partner's calibration run (evaluate.ts partnerCalibrationOf, league.ts
 * helpsCalibrationOf with its id) as B_win under the reward, floored at helpsFloor, then, in a dynasty or keeper league with
 * long-term values (⚠️ ours: as helpsScale reads "dynasty and keeper", since without them B_P is B_win,P alone), mixed with
 * F₁₀ = bFutureScale × helpsFutureShare by λ_P (defaultLambda: never the user's setting). ⚠️ The planner's order, floor then
 * mix (the lead's call): helpsScale, mine, floors the mix; the two differ only when B_win₃,P is under the floor with
 * long-term values. Null without a run or when B_win₃,P isn't a number; throws as helpsScale does under a reward paying the
 * weekly high score for a run that didn't simulate them (reward.ts assertWeeklyMeasured).
 */
export function partnerScale(run: (Pick<HelpsCalibration, "dPO" | "dCH"> & { readonly dPrizes?: PrizeDeltas | null }) | null | undefined, x: PartnerScaleInputs, cfg: BenefitConfig = config.benefit): PartnerScale | null {
  if (!run) return null;
  const reward = x.reward ?? titleOnlyReward(null, cfg);
  assertWeeklyMeasured(reward, run, "The “Helps them” calibration run");
  const odds = benefitWin(run.dPO, run.dPrizes ?? titleDeltas(run.dCH), cfg, reward).bWin;
  if (!isFiniteNumber(odds)) return null;
  const floored = !(odds >= cfg.helpsFloor) || !(odds > 0);
  const b3P = floored ? cfg.helpsFloor : odds;
  const future = x.leagueType !== "redraft" && isFiniteNumber(x.dynastyTotal) && x.dynastyTotal > 0;
  // defaultLambda is null only in redraft leagues; the fallback just narrows the type.
  const lambda = future ? (defaultLambda(x.leagueType, x.pPlayoffs, cfg) ?? cfg.lambda.bubble) : null;
  const b3 = lambda === null ? b3P : (1 - lambda) * b3P + lambda * cfg.bFutureScale * cfg.helpsFutureShare;
  if (!isFiniteNumber(b3) || !(b3 > 0)) return null;
  return { b3, b3P, odds, floored, lambda };
}

/**
 * "Helps them" as printed (planner reply to Checkpoint 7b, §7: "Helps them = 100 × (1 − e^(−B_P / B_ref,P))"): tradeScore
 * when B_P > 0, 0 when B_P ≤ 0 (the card's "Helps them 0": a trade that costs them reads 0, never a negative score); null when
 * B_P or B_ref,P is unknown.
 */
export function helpsThemScore(b: number | null, b3: number | null): number | null {
  if (!isFiniteNumber(b) || !isFiniteNumber(b3) || !(b3 > 0)) return null;
  return b > 0 ? (tradeScore(b, b3) as number) : 0;
}

/**
 * Whether a trade helps both teams, judged on the printed scores (⚠️ the lead's call, like the minimum chance's printed rule):
 * its Helps you (tradeScore, a whole number) and its Helps them (them.helps) each at least `min` (config.benefit.helpsThemMin,
 * 10). Planner reply to Checkpoint 7c, answer 5: "“Helps both” needs Helps you ≥ 10 too, the same bar as Helps them, so trades
 * that barely help Parker stay out" (Checkpoint 7c read the planner's "Helps you > 0", so a card reading Helps you 2 qualified).
 * False without a Helps them (not simulated, or an evaluation made before it).
 */
export function helpsBoth(e: Pick<TradeEvaluation, "tradeScore" | "them">, min: number = config.benefit.helpsThemMin): boolean {
  const mine = e.tradeScore;
  const theirs = e.them?.helps;
  return isFiniteNumber(mine) && mine >= min && isFiniteNumber(theirs) && theirs >= min;
}

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
  const unrounded = overallUnrounded(b, pComplete, b3);
  return unrounded === null ? null : Math.round(unrounded);
}

/**
 * "Overall" before it's rounded, 100 × (1 − e^(−B × P_complete / B₃)) (overallScore's number; null when it has none). Since
 * Checkpoint 7g a smaller ask's Last offer keeps a share of its card's on it (offers.ts overallOf; config.offers.
 * lastMinOverallShare).
 */
export function overallUnrounded(b: number | null, pComplete: number, b3: number | null): number | null {
  if (!isFiniteNumber(b) || !(b > 0) || !isFiniteNumber(pComplete) || !isFiniteNumber(b3) || !(b3 > 0)) return null;
  const p = Math.min(1, Math.max(0, pComplete));
  return 100 * (1 - Math.exp(-(b * p) / b3));
}

/**
 * tradeNumbers' result: TradeEvaluation's fields of those names (marketWeekly always set here), plus titleMissing (Benefit's;
 * TradeEvaluation has no field for it).
 */
export type TradeNumbers = Pick<TradeEvaluation, "b" | "tradeScore" | "pAccept" | "pComplete" | "acceptLabel" | "overall" | "bWin" | "bFuture" | "lambda" | "dDyn" | "dynMissing" | "b3"> & {
  marketWeekly: number | null;
  titleMissing: boolean;
};

/**
 * The numbers a card shows from B, the acceptance result and B₃ (helpsScale's b3 for the same goal and λ, the scale B's
 * market term was priced on: BenefitInputs.b3; null without one): B and its parts, the market term's lineup equivalent
 * (Benefit.marketWeekly), the Trade Score, P_accept, P_complete, the label (acceptance.ts), Overall and B₃ itself
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
    marketWeekly: b.marketWeekly,
    b3: isFiniteNumber(b3) && b3 > 0 ? b3 : null,
    titleMissing: b.titleMissing,
  };
}

/** benefitNotes' words when the title odds are unknown (Benefit.titleMissing under a reward where only 1st place's odds can be). */
export const TITLE_MISSING_NOTE = "Title odds aren't available for this league, so “Helps you” uses playoff odds in their place.";

/**
 * Checkpoint 7c: benefitNotes' words when a paid prize's odds are unknown under "Several prizes" paying 2nd or 3rd place
 * (their odds go with the title's: season.ts), so B counts the playoff odds in place of the prize odds. ⚠️ Worded like
 * TITLE_MISSING_NOTE, naming no cause (the review of the reward engine, compat-R2; accepted by the lead after wave 4): the
 * lead's first words, "Playoff results aren't available for this league, …", were wrong when nothing is missing from the
 * results, as when the league's playoff schedule lists fewer rounds than its bracket needs, or pairs teams differently from
 * ours (season.ts).
 */
export const PRIZES_MISSING_NOTE = "Prize odds aren't available for this league, so “Helps you” uses playoff odds in their place.";

/**
 * Plain-English notes on what B leaves out: a paid prize's odds unknown (B_win counts the playoff odds alone:
 * TITLE_MISSING_NOTE, or PRIZES_MISSING_NOTE when `reward` pays 2nd or 3rd place) and long-term values missing (dynasty and
 * keeper leagues: B = B_win, this season only). Both hold for every trade in a league, so a search adds them once to
 * TradeSearchResult.notes; the Analyzer can list them with a card's reasons.
 */
export function benefitNotes(b: Pick<Benefit, "titleMissing" | "dynMissing">, reward?: Pick<Reward, "goal" | "shares"> | null): string[] {
  const notes: string[] = [];
  const places = reward?.goal === "prizes" && (reward.shares.second > 0 || reward.shares.third > 0);
  if (b.titleMissing) notes.push(places ? PRIZES_MISSING_NOTE : TITLE_MISSING_NOTE);
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
