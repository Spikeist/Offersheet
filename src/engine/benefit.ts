/**
 * Our benefit B, the Trade Score ("Helps you") and Overall, and the guards (CLAUDE.md §10; lead decision L6 of
 * the Phase 4 design; planner reply to Checkpoint 3, answer 1: B_ref 6). Pure and deterministic: plain numbers
 * in, plain numbers out, no I/O and no clock; every tunable number comes from config.benefit (package values
 * from config.market). Everything here is from the user's side (§10): the partner's side only matters through
 * the chance they accept (src/engine/acceptance.ts).
 *
 * The caller (src/engine/evaluate.ts) runs the season simulation on one common-random-numbers matrix with every
 * team at its free-agent-optimized roster V* (§7), before the trade and after it (L6: my roster after the trade
 * and its legality moves, then V*; the partner's the same way; every other team at its V*), and passes my
 * changes in. Because both runs optimize free agents, no B comes from a pickup I could make anyway.
 *
 * B (§10):
 * - B_win = 100 × (w_PO × ΔPO + w_CH × ΔCH) in percentage points, ΔPO and ΔCH as fractions (config.benefit.
 *   weights 0.35 / 0.65). ΔPO missing (not simulated yet) → B_win and B are null. ⚠️ Ours (awaiting the lead's
 *   sign-off in §10): when the title odds are unknown but the playoff odds aren't (season.ts nulls every team's
 *   P(title) when a played playoff round has no result it can match, SeasonOdds.playoffsKnown false, or when the
 *   league lists fewer playoff rounds than its bracket needs), B_win = 100 × (w_PO + w_CH) × ΔPO: the playoff
 *   term scaled up to the whole weight, so B stays on the Trade Score's scale. Benefit.titleMissing marks it,
 *   tradeNumbers passes it on, and benefitNotes words it. It holds for every trade in such a league, so a
 *   search says it once (TradeSearchResult.notes); TradeEvaluation has no field for it.
 * - Redraft: B = B_win + κ × clamp(g_mkt(me), marketSanityClamp), the market term (g_mkt(me) from perception values;
 *   +∞, a side that gives nothing of value, clamps to +0.5; NaN counts 0). κ is the user's "Protect my trade value"
 *   setting (planner addendum to Checkpoint 3, §3; TradeSettings.protectValue, lead decision N3): config.benefit.
 *   protectValue low 2, medium 4 (the default), high 8 (protectValueWeight). It keeps trade value for later deals
 *   before the deadline; depth for injuries and byes is already in B_win (scenario lineups). At medium, giving 25%
 *   more value than I get (g_mkt(me) = −0.20) costs 0.8 B, about 0.4 projected points a week in Parker's league.
 *   Before the addendum the weight was marketSanityWeight (1.0), which only evaluate.ts's before/after variant
 *   (TradeContextOptions.beforeAddendum) still passes (BenefitInputs.kappa).
 * - The market term's waiver-credit floor (lead decision N10; ⚠️ our reading of §10's "a trade never gets credit for a
 *   pickup I could make anyway", reported to the planner): the term reads my g with each player I give valued at max(v, W)
 *   (marketTermPackage; BenefitInputs.gMarket). A player worth less than the best free agent is replaceable, and my
 *   free-agent-optimized roster V*(me) already counts that replacement, so dumping him isn't a value gain: §9's waiver
 *   credit for the roster spot he opens (W) is cancelled by his floored value (W), and giving him for nothing reads g = 0.
 *   Only the term reads it: g_mkt(me) on the card (TradeEvaluation.gMine), the card's values, the Market check flag and
 *   the hide threshold stay raw, as do the partner's g's. What I receive stays raw too (the decision floors the given side
 *   only), so ⚠️ a swap of two players worth less than W reads as giving W for the one received (an even bench-for-bench
 *   swap's term goes from 0 to κ × clamp(v / W − 1)). Picks keep their values (they open no roster spot). The before/after
 *   variant reads the raw g (no gMarket).
 * - Dynasty and keeper: B = (1 − λ) × B_win + λ × B_future, B_future = bFutureScale × ΔDyn / MyDynTotal (gaining
 *   10% of my roster's value ≈ +4). No market term (L6), whatever κ (⚠️ N3: B_future carries the value change). ΔDyn = my package
 *   change in long-term (dynasty) values, the waiver credit and picks included (tradePackage with the future
 *   term's values and W); MyDynTotal = my roster's long-term value before the trade, my picks included
 *   (rosterValue).
 * - λ: TradeSettings.lambda when it is set (0 = win now … 1 = future), else by my baseline P(playoffs) (every
 *   team at V*): ≥ contenderAt (0.5) → 0.35, ≥ bubbleAt (0.2) → 0.5, below → 0.75; keeper leagues default to
 *   0.2 (keeper costs aren't modeled, and the UI says so). ⚠️ Ours: an unknown P(playoffs) (the season wasn't
 *   simulated) takes the middle value, 0.5. Redraft leagues have no λ (null).
 * - Missing long-term values (Checkpoint 2; L6): a keeper league whose dynasty list didn't load (the server then
 *   serves the redraft list as MarketInputs.values with format.isDynasty false: futureValuesLoaded), a dynasty
 *   league without values (FantasyCalc down), or MyDynTotal ≤ 0 → B_future and ΔDyn null, B = B_win (no market
 *   term either, as L6 writes it), dynMissing true (the card says so). λ is still reported.
 *
 * Package values (§9) for any term, picks included (tradePackage): the waiver credit W counts players only (a
 * pick takes no roster spot), so PV_recv = Σ v(players received) + Σ v(picks received) + max(0, players given −
 * players received) × W, and the same for PV_give; g = (PV_recv − PV_give) / PV_give with market.marketGain's
 * zero rule (a side that gives nothing of value gains +∞ when it receives something, else 0). Player-only
 * packages equal market.packageValues and market.marketGain exactly. studExponent γ applies to pick values too
 * (they're values). The card's "value given / received" is my perception package (TradeEvaluation.value).
 *
 * The three numbers (§10): Trade Score = round(100 × (1 − e^(−B / bRef))) and Overall = round(100 × (1 −
 * e^(−B × P_complete / bRef))) when B > 0, null otherwise (B ≤ 0 is hidden by default). bRef = 6 since
 * Checkpoint 3. Overall never exceeds the Trade Score (P_complete ≤ 0.95). EG = B × P_complete ranks (§13).
 * Don't add extra factors to Overall (§10).
 *
 * Guards (§10; TradeEvaluation.flags), apart from the three numbers: "Market check" when g_mkt(me) <
 * marketCheckBelow (−0.15); hidden by default when g_mkt(me) < marketHideBelow (−0.35) or when B ≤ 0 (a B not
 * known yet hides nothing); "depends on an injured player": the players I'd get whose status is one of
 * benefit.injuredStatuses (OUT, IR, PUP: "currently OUT or on IR"; PUP is a reserve list like IR).
 *
 * How an evaluation uses it (src/engine/evaluate.ts): my perception package tradePackage(get, give, perception
 * values, W) gives TradeEvaluation.value (received = recv, given = give) and g_mkt(me), and marketTermPackage on the
 * same inputs the market term's g (N10); the partner's (swapped) tradePackage gives g_mkt(P) for acceptance.ts.
 * Dynasty and keeper leagues with futureValuesLoaded: ΔDyn = recv − give of
 * tradePackage(get, give, future values, the future term's W) and MyDynTotal = rosterValue(my players, future
 * values, my picks' values). After the simulation: benefit({ ΔPO, ΔCH, g_mkt(me), the market term's g, dynasty, my
 * baseline P(playoffs), settings.lambda, κ = protectValueWeight(settings.protectValue) }), then tradeNumbers(benefit,
 * acceptance result) and tradeFlags({ g_mkt(me), B, injuredReceived(get, snapshot.players) }); benefitNotes(benefit)
 * for the search's notes (the Analyzer's reasons).
 */
import type { AcceptanceResult } from "./acceptance";
import { config } from "./config";
import type { MarketInputs } from "./inputs";
import { packageValues, type MarketConfig, type ValueLookup } from "./market";
import type { InjuryStatus, LeagueSettings, PlayerInfo } from "./model";
import type { ProtectValue } from "./settings";
import type { TradeEvaluation } from "./tradeModel";

/** The config.benefit keys this module reads, widened so calibration and tests can pass other numbers. */
export interface BenefitConfig {
  readonly weights: { readonly playoffs: number; readonly title: number };
  /** The market term's weight before the addendum (the before/after variant passes it as BenefitInputs.kappa). */
  readonly marketSanityWeight: number;
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
  readonly bRef: number;
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
 * B_win in percentage points from ΔPO and ΔCH (fractions). Null when ΔPO is missing (titleMissing false: nothing
 * was simulated); ΔCH missing → the playoff term scaled up to the whole weight (the file header), titleMissing true.
 */
export function benefitWin(dPO: number | null, dCH: number | null, cfg: BenefitConfig = config.benefit): { bWin: number | null; titleMissing: boolean } {
  const w = cfg.weights;
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
  /** g_mkt(me) on perception values (§9). */
  gMine: number;
  /**
   * g_mkt(me) as the redraft market term reads it (lead decision N10; the file header): marketTermPackage's g, each
   * player I give valued at max(v, W). Absent = gMine (the before/after variant, and callers that only state facts).
   */
  gMarket?: number;
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
   * (medium, 4). The before/after variant passes config.benefit.marketSanityWeight (1.0). Ignored in dynasty and keeper
   * leagues (no market term).
   */
  kappa?: number;
}

export interface Benefit {
  /** B; null when the trade hasn't been simulated (ΔPO missing). */
  b: number | null;
  bWin: number | null;
  /** Dynasty and keeper; null in redraft leagues or when long-term values are missing. */
  bFuture: number | null;
  /** λ used (dynasty and keeper); null in redraft leagues. */
  lambda: number | null;
  /** The redraft market term inside B, κ × clamp(the market term's g: gMarket, else g_mkt(me)) (0 in dynasty and keeper leagues). */
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
  const { bWin, titleMissing } = benefitWin(x.dPO, x.dCH, cfg);
  if (x.leagueType === "redraft") {
    const market = marketSanity(x.gMarket ?? x.gMine, x.kappa, cfg);
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
 * redraft list in `values` (format.isDynasty false; src/server/modelInputs.ts), which isn't long-term worth.
 */
export function futureValuesLoaded(leagueType: LeagueType, market: MarketInputs | null): boolean {
  if (leagueType === "redraft" || !market || !market.format.isDynasty) return false;
  return Object.values(market.values).some((v) => Number.isFinite(v) && v > 0);
}

// ---------------------------------------------------------------------------------------------
// The three numbers (§10)

/** "Helps you": round(100 × (1 − e^(−B / bRef))) when B > 0; null otherwise (hidden by default). */
export function tradeScore(b: number | null, cfg: Pick<BenefitConfig, "bRef"> = config.benefit): number | null {
  return isFiniteNumber(b) && b > 0 ? Math.round(100 * (1 - Math.exp(-b / cfg.bRef))) : null;
}

/** Expected gain EG = B × P_complete (§13's default ranking); null without a B. */
export function expectedGain(b: number | null, pComplete: number): number | null {
  return isFiniteNumber(b) && isFiniteNumber(pComplete) ? b * pComplete : null;
}

/** "Overall": round(100 × (1 − e^(−B × P_complete / bRef))) when B > 0; null otherwise. P_complete is clamped to [0, 1]. */
export function overallScore(b: number | null, pComplete: number, cfg: Pick<BenefitConfig, "bRef"> = config.benefit): number | null {
  if (!isFiniteNumber(b) || !(b > 0) || !isFiniteNumber(pComplete)) return null;
  const p = Math.min(1, Math.max(0, pComplete));
  return Math.round(100 * (1 - Math.exp(-(b * p) / cfg.bRef)));
}

/** tradeNumbers' result: TradeEvaluation's fields of those names, plus titleMissing (Benefit's; TradeEvaluation has no field for it). */
export type TradeNumbers = Pick<TradeEvaluation, "b" | "tradeScore" | "pAccept" | "pComplete" | "acceptLabel" | "overall" | "bWin" | "bFuture" | "lambda" | "dDyn" | "dynMissing"> & {
  titleMissing: boolean;
};

/**
 * The numbers a card shows from B and the acceptance result (TradeEvaluation's fields of that name): B and its
 * parts, the Trade Score, P_accept, P_complete, the label (acceptance.ts) and Overall; and titleMissing, which
 * benefitNotes words.
 */
export function tradeNumbers(b: Benefit, accept: Pick<AcceptanceResult, "pAccept" | "pComplete" | "label">, cfg: Pick<BenefitConfig, "bRef"> = config.benefit): TradeNumbers {
  return {
    b: b.b,
    tradeScore: tradeScore(b.b, cfg),
    pAccept: accept.pAccept,
    pComplete: accept.pComplete,
    acceptLabel: accept.label,
    overall: overallScore(b.b, accept.pComplete, cfg),
    bWin: b.bWin,
    bFuture: b.bFuture,
    lambda: b.lambda,
    dDyn: b.dDyn,
    dynMissing: b.dynMissing,
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
 * §9's package values for the side that receives `recv` and gives `give`, picks included (the file header): the
 * waiver credit W per open roster spot counts players only. For my side pass (what I get, what I give); for the
 * partner, swap them. Player-only packages equal market.packageValues and market.marketGain.
 */
export function tradePackage(recv: PackageSide, give: PackageSide, values: ValueLookup, W: number, cfg: MarketConfig = config.market): PackageValue {
  const pv = packageValues(recv.players, give.players, values, W, cfg);
  const r = pv.recv + pickSum(recv.pickValues, cfg);
  const g = pv.give + pickSum(give.pickValues, cfg);
  return { recv: r, give: g, g: g > 0 ? (r - g) / g : r > 0 ? Number.POSITIVE_INFINITY : 0 };
}

/** A value lookup's entry as a number (market.ts's rule: a number or { value }; missing or non-finite → 0). */
function entryValue(entry: number | { readonly value: number } | undefined): number {
  const v = typeof entry === "number" ? entry : entry?.value;
  return v !== undefined && Number.isFinite(v) ? v : 0;
}

/**
 * My package as B's redraft market term reads it (lead decision N10; the file header): tradePackage with each player of
 * `give` (the side I give) valued at max(v, W). What I receive and every pick keep their values, and the waiver credit
 * is the same; with every given player worth W or more it is tradePackage exactly. Pass (what I get, what I give), as for
 * my tradePackage; a player on both sides (never in a legal trade) would be floored on both.
 */
export function marketTermPackage(recv: PackageSide, give: PackageSide, values: ValueLookup, W: number, cfg: MarketConfig = config.market): PackageValue {
  const floor = Number.isFinite(W) ? W : 0;
  const lookup: Record<string, number> = {};
  for (const id of recv.players) lookup[id] = entryValue(values[id]);
  for (const id of give.players) lookup[id] = Math.max(entryValue(values[id]), floor);
  return tradePackage(recv, give, lookup, W, cfg);
}

/** A roster's total value on one term (§10's MyDynTotal on the future term): Σ v^γ over its players (each once) plus its picks' values. */
export function rosterValue(players: readonly string[], values: ValueLookup, pickValues: readonly number[] = [], cfg: MarketConfig = config.market): number {
  return packageValues([...new Set(players)], [], values, 0, cfg).recv + pickSum(pickValues, cfg);
}
