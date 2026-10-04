/**
 * Ranking and diversity (CLAUDE.md §13; lead decisions L10 and M9 of the Phase 4 designs; Phase 4b's given-player cap).
 * Pure and deterministic: no I/O, no clock, and the output never depends on the input order. The caps come from
 * config.ranking and config.search.resultsShown, the hiding threshold from config.benefit.
 *
 * Sorts (sortTrades; the search ranks with "overall", the Trade Finder re-sorts with any of them):
 * - "overall" (the default): the expected gain EG = B × P_complete (benefit.expectedGain), highest first; it is what
 *   the card's Overall number rounds;
 * - "helps": B, highest first;
 * - "accept": P_complete, highest first, among trades with B > 0; trades with B ≤ 0 or an unknown B come after them,
 *   in the same order (§13: "Chance they accept (P_complete, among trades with B > 0)").
 * An unknown number (B not simulated yet, or not finite) sorts after every known one. Ties: EG (highest first), then
 * the trade's key (TradeEvaluation.key, ascending), then, for evaluations of one key, the furthest evaluated first
 * (stage final > exact > screened, then more seasons simulated), then B, P_complete and g_mkt(me), highest first.
 *
 * rankTrades (§13 on the search's evaluated trades):
 * 1. Hidden by default (§10 guards), counted and never shown: B ≤ 0 or unknown (byBenefit, checked first), else
 *    g_mkt(me) < marketHideBelow (byMarket; a NaN g_mkt(me) hides nothing, as benefit.tradeFlags reads it). Illegal
 *    evaluations are skipped (the search drops them before ranking). A key evaluated more than once counts once, as
 *    its furthest evaluation (⚠️ ours: a legal one first, then stage final > exact > screened, then more seasons
 *    simulated, then the higher EG, B, P_complete and g_mkt(me)), whatever the input order.
 * 2. The rest, in Overall order, go through the diversity rules greedily, each trade judged against the trades
 *    already kept:
 *    a. filler: a kept trade with the same partner whose assets (side by side) are a proper subset of this one's, and
 *       |B − B_kept| < fillerCutoffFraction × B_kept: the extra assets barely change B (§13: "Drop variants that only
 *       add a filler player whose effect is under 0.2 × B"). Only the variant ranked below is dropped: a variant that
 *       ranks above its smaller trade is no filler of it;
 *    b. core: perCore kept trades already share its core, the highest-value asset on each side (`value`: the
 *       perception value; ties and unknown values: the smaller asset id; an empty side has no core asset);
 *    c. partner cap: while fewer than partnerCapTop (20, §13's "top 20") trades are kept, its partner already has
 *       perPartnerInTop20 of them. Past the first 20, a partner may have more;
 *    d. given-player cap (planner reply to Checkpoint 4, change 6 and answer 7: the live top ideas mostly sold one
 *       player of mine, Garrett Wilson in 15 of 22): in the same top-20 window, a player of mine it gives is already
 *       given by perGivenPlayerInTop20 of the trades kept (counted per player on my side, picks aside: a 2-for-1 counts
 *       for both of my players). Past the first 20, a player may be given in more.
 *    A trade more than one rule would drop is counted once, under the first rule in that order.
 * 3. It stops once resultsShown trades are kept; the trades after that are neither kept nor counted as dropped.
 */
import { expectedGain } from "./benefit";
import { config } from "./config";
import type { TradeAsset, TradeEvaluation, TradeSort } from "./tradeModel";

/** The numbers rankTrades reads, widened so tests and calibration can pass others (defaults: config). */
export interface RankConfig {
  readonly perPartnerInTop20: number;
  /** The partner cap and the given-player cap apply within the first this many trades kept (§13's "top 20"). */
  readonly partnerCapTop: number;
  /**
   * At most this many trades in that window give the same player of mine (planner reply to Checkpoint 4, answer 7).
   * Absent: config.ranking.perGivenPlayerInTop20 (a config built before Phase 4b still gets the cap).
   */
  readonly perGivenPlayerInTop20?: number;
  readonly perCore: number;
  readonly fillerCutoffFraction: number;
  readonly resultsShown: number;
  readonly marketHideBelow: number;
}

const DEFAULT_RANK_CONFIG: RankConfig = {
  perPartnerInTop20: config.ranking.perPartnerInTop20,
  partnerCapTop: config.ranking.partnerCapTop,
  perGivenPlayerInTop20: config.ranking.perGivenPlayerInTop20,
  perCore: config.ranking.perCore,
  fillerCutoffFraction: config.ranking.fillerCutoffFraction,
  resultsShown: config.search.resultsShown,
  marketHideBelow: config.benefit.marketHideBelow,
};

const isFiniteNumber = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Highest first; an unknown number after every known one. */
function descending(a: number | null | undefined, b: number | null | undefined): number {
  const ka = isFiniteNumber(a);
  const kb = isFiniteNumber(b);
  if (ka && kb) return b > a ? 1 : b < a ? -1 : 0;
  if (ka) return -1;
  if (kb) return 1;
  return 0;
}

/** EG = B × P_complete, null when either is unknown. */
function gainOf(t: TradeEvaluation): number | null {
  const eg = expectedGain(t.b, t.pComplete);
  return isFiniteNumber(eg) ? eg : null;
}

const STAGE_ORDER: Readonly<Record<TradeEvaluation["stage"], number>> = { screened: 0, exact: 1, final: 2 };

/** Evaluations of one trade: the furthest evaluated first (stage, then seasons simulated), then B, P_complete and g_mkt(me). */
function furthestFirst(a: TradeEvaluation, b: TradeEvaluation): number {
  return (
    (STAGE_ORDER[b.stage] ?? -1) - (STAGE_ORDER[a.stage] ?? -1) ||
    descending(a.sims, b.sims) ||
    descending(a.b, b.b) ||
    descending(a.pComplete, b.pComplete) ||
    descending(a.gMine, b.gMine)
  );
}

/** The common tie-break: EG, then the key, then furthestFirst (one key evaluated twice). */
function byGainThenKey(a: TradeEvaluation, b: TradeEvaluation): number {
  return descending(gainOf(a), gainOf(b)) || byString(a.key, b.key) || furthestFirst(a, b);
}

/** Which evaluation of one key rankTrades keeps (the file header): a legal one, then the furthest evaluated, then the higher EG. */
function preferred(a: TradeEvaluation, b: TradeEvaluation): number {
  const stage = (STAGE_ORDER[b.stage] ?? -1) - (STAGE_ORDER[a.stage] ?? -1);
  return Number(a.illegal !== null) - Number(b.illegal !== null) || stage || descending(a.sims, b.sims) || descending(gainOf(a), gainOf(b)) || furthestFirst(a, b);
}

const helpsYou = (t: TradeEvaluation): boolean => isFiniteNumber(t.b) && t.b > 0;

/** The trades in the order of a sort option (§13; the file header). Returns a new array; the input is left as it is. */
export function sortTrades(trades: readonly TradeEvaluation[], sort: TradeSort): TradeEvaluation[] {
  let compare: (a: TradeEvaluation, b: TradeEvaluation) => number;
  if (sort === "helps") compare = (a, b) => descending(a.b, b.b) || byGainThenKey(a, b);
  else if (sort === "accept") compare = (a, b) => Number(helpsYou(b)) - Number(helpsYou(a)) || descending(a.pComplete, b.pComplete) || byGainThenKey(a, b);
  else compare = byGainThenKey;
  return [...trades].sort(compare);
}

export interface RankedTrades {
  /** The top config.search.resultsShown, Overall order, after the hidden-by-default guards and the diversity rules. */
  trades: TradeEvaluation[];
  /** Kept out by default (§10): B ≤ 0, or g_mkt(me) below marketHideBelow. */
  hidden: { byBenefit: number; byMarket: number };
  /**
   * Dropped by the diversity rules (§13): over the per-partner cap in the top 20, over the per-core cap, filler variants,
   * and over the given-player cap in the top 20 (givenPlayer; planner reply to Checkpoint 4, answer 7).
   */
  dropped: { partnerCap: number; core: number; filler: number; givenPlayer: number };
}

/** An asset's id within its side: a player's canonical id, or a pick's season, round and original team. */
export function assetId(asset: TradeAsset): string {
  return asset.kind === "player" ? asset.id : `pick:${asset.season}:${asset.round}:${asset.originalTeamId}`;
}

/** The highest-value asset of one side (ties and unknown values: the smaller id); "" for an empty side. */
function coreAsset(assets: readonly TradeAsset[], value: (asset: TradeAsset) => number): string {
  let best = "";
  let bestValue = Number.NEGATIVE_INFINITY;
  let found = false;
  for (const a of assets) {
    const raw = value(a);
    const v = isFiniteNumber(raw) ? raw : Number.NEGATIVE_INFINITY;
    const id = assetId(a);
    if (!found || v > bestValue || (v === bestValue && id < best)) {
      best = id;
      bestValue = v;
      found = true;
    }
  }
  return best;
}

interface Candidate {
  trade: TradeEvaluation;
  partnerId: string;
  /** Side-tagged asset ids ("give:…", "get:…"). */
  assets: Set<string>;
  core: string;
  /** The players of mine it gives (each once; picks aside): the given-player cap counts them. */
  given: string[];
  b: number;
}

/** Whether `small`'s assets are a proper subset of `big`'s (side by side). */
function properSubset(small: ReadonlySet<string>, big: ReadonlySet<string>): boolean {
  if (small.size >= big.size) return false;
  for (const a of small) if (!big.has(a)) return false;
  return true;
}

/**
 * §13's ranking and diversity on evaluated trades (the file header). `value` gives an asset's perception value (the
 * core of a trade is its highest-value asset on each side). `cfg` defaults to config.
 */
export function rankTrades(evaluations: readonly TradeEvaluation[], value: (asset: TradeAsset) => number, cfg: RankConfig = DEFAULT_RANK_CONFIG): RankedTrades {
  const hidden = { byBenefit: 0, byMarket: 0 };
  const dropped = { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 };
  const givenCap = cfg.perGivenPlayerInTop20 ?? config.ranking.perGivenPlayerInTop20;
  const byKey = new Map<string, TradeEvaluation>();
  for (const e of evaluations) {
    const kept = byKey.get(e.key);
    if (kept === undefined || preferred(e, kept) < 0) byKey.set(e.key, e);
  }
  const shown: TradeEvaluation[] = [];
  for (const e of sortTrades([...byKey.values()], "overall")) {
    if (e.illegal !== null) continue;
    if (!helpsYou(e)) hidden.byBenefit++;
    else if (e.gMine < cfg.marketHideBelow) hidden.byMarket++;
    else shown.push(e);
  }

  const kept: Candidate[] = [];
  const perCore = new Map<string, number>();
  const perPartnerTop = new Map<string, number>();
  const perGivenTop = new Map<string, number>();
  const limit = Math.max(0, Math.floor(cfg.resultsShown));
  for (const trade of shown) {
    if (kept.length >= limit) break;
    const give = trade.proposal.give;
    const get = trade.proposal.get;
    const c: Candidate = {
      trade,
      partnerId: trade.proposal.partnerId,
      assets: new Set([...give.map((a) => `give:${assetId(a)}`), ...get.map((a) => `get:${assetId(a)}`)]),
      core: `${coreAsset(give, value)}|${coreAsset(get, value)}`,
      given: [...new Set(give.flatMap((a) => (a.kind === "player" ? [a.id] : [])))],
      b: trade.b as number,
    };
    if (kept.some((k) => k.partnerId === c.partnerId && properSubset(k.assets, c.assets) && Math.abs(c.b - k.b) < cfg.fillerCutoffFraction * k.b)) {
      dropped.filler++;
      continue;
    }
    if ((perCore.get(c.core) ?? 0) >= cfg.perCore) {
      dropped.core++;
      continue;
    }
    const inTop = kept.length < cfg.partnerCapTop;
    if (inTop && (perPartnerTop.get(c.partnerId) ?? 0) >= cfg.perPartnerInTop20) {
      dropped.partnerCap++;
      continue;
    }
    if (inTop && c.given.some((id) => (perGivenTop.get(id) ?? 0) >= givenCap)) {
      dropped.givenPlayer++;
      continue;
    }
    kept.push(c);
    perCore.set(c.core, (perCore.get(c.core) ?? 0) + 1);
    if (inTop) {
      perPartnerTop.set(c.partnerId, (perPartnerTop.get(c.partnerId) ?? 0) + 1);
      for (const id of c.given) perGivenTop.set(id, (perGivenTop.get(id) ?? 0) + 1);
    }
  }
  return { trades: kept.map((k) => k.trade), hidden, dropped };
}
