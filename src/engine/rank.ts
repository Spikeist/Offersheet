/**
 * Ranking and diversity (CLAUDE.md §13; lead decisions L10 and M9 of the Phase 4 designs; Phase 4b's given-player cap;
 * Phase 4c's minimum chance). Pure and deterministic: no I/O, no clock, and the output never depends on the input order.
 * The caps come from config.ranking and config.search.resultsShown, the hiding threshold from config.benefit, the minimum
 * chance and the players the given-player cap skips from the call (RankOptions: the user's TradeSettings.minChance and
 * must-include players of mine).
 *
 * Sorts (sortTrades; the search ranks with "overall", the Trade Finder re-sorts with any of them):
 * - "overall" (the default): the expected gain EG = B × P_complete (benefit.expectedGain), highest first; it is what
 *   the card's Overall number rounds;
 * - "helps": B, highest first;
 * - "accept": P_complete, highest first, among trades with B > 0; trades with B ≤ 0 or an unknown B come after them,
 *   in the same order (§13: "Chance they accept (P_complete, among trades with B > 0)");
 * - "helpsBoth" (Checkpoint 7c; planner reply to Checkpoint 7b, §7: "only trades that help both teams, sorted by Helps you"):
 *   the trades that help both teams (benefit.helpsBoth: Helps you and Helps them each at least config.benefit.helpsThemMin,
 *   both as printed) first, by B, then the rest by B. A sort never drops a trade: the search's own "Helps both" list
 *   (TradeSearchResult.helpsBoth, rankTrades with order "helps" and keep, below) holds only those, and helpsBothTrades
 *   filters a list for a result without one.
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
 *    Then the minimum chance (planner reply to Checkpoint 4b, change 10: "Chance they accept: at least Any / 10% / … /
 *    50%", which replaced hiding long shots): a trade the guards keep whose P_complete is under RankOptions.minChance is
 *    counted (byChance) and never shown, BEFORE the diversity rules below, so the list fills with trades that qualify.
 *    ⚠️ Judged on P_complete as the card prints it (acceptance.displayAcceptance: the nearest 5%; review of track SR,
 *    finding 3: judged on the model's own number, a card printing "10%" was hidden under "at least 10%" and appeared
 *    when the user picked Any, and at 40% on Parker's league a card printing "40%" (39.5%) lost its place to a weaker
 *    one; §11 judges the labels on the shown value the same way): a P_complete of 7.5% prints "10%"
 *    and meets 10%, one of 7.49% prints "5%" and doesn't (meetsMinChance). The options start at 10%, so a chance printed
 *    at or under 5% never meets one. minChance 0 (Any) or absent removes nothing. RankedTrades.qualifying counts the
 *    trades that pass both (what the diversity rules start from). Checkpoint 7c (the "Helps both" list): between the guards
 *    and the minimum, RankOptions.keep turns away the trades it doesn't keep (benefit.helpsBoth there), counted as
 *    RankedTrades.notKept, so byChance and qualifying count only the trades it keeps.
 * 2. The rest, in Overall order (Checkpoint 7c: RankOptions.order "helps", B highest first, for the "Helps both" list), go
 *    through the diversity rules greedily, each trade judged against the trades already kept:
 *    a. filler: a kept trade with the same partner whose assets (side by side) are a proper subset of this one's, and
 *       |B − B_kept| < fillerCutoffFraction × B_kept: the extra assets barely change B (§13: "Drop variants that only
 *       add a filler player whose effect is under 0.2 × B"), or ⚠️ (final review of Phase 4c, finding R5, ours) this one
 *       is no more helpful (B ≤ B_kept) and less likely to go through (P_complete under the kept one's): its extra players
 *       only make it worse, however much. ⚠️ Not seen on Parker's data (verification of that review, finding VF-3): on his
 *       league (Oct 4 09:24Z) it drops nothing the 20% clause doesn't. That review's card, Rico Dowdle → Jordan Mason +
 *       Kalif Raymond (B 0.171 at 40.8%), left the list through search.ts leanVersionOf's fallback, which made Rico Dowdle
 *       → Jordan Mason (B 0.158 at 47.0%) a lean companion and then a finalist, and the 20% clause (its B is the higher
 *       one, so this clause doesn't hold). On the synthetic smallLeague(11) it drops three variants of Team 2's 1011 → 1020
 *       (B 5.83 at 29.1%) the 20% clause keeps, such as 1011 + 1002 → 1015 + 1020 (B 3.83 at 26.6%). Only the variant
 *       ranked below its smaller trade in Overall order (EG, sortTrades "overall": what "ranked below" meant when every list
 *       was in that order) is dropped: a variant that ranks above its smaller trade is no filler of it. ⚠️ So the same
 *       pairs are filler in either order (Checkpoint 7c, ours: review of the "Helps both" engine track, finding HB-3). In
 *       Helps-you order a bigger variant whose extra player lifts B a little comes first however much less likely it is,
 *       and its smaller trade, arriving later, is no superset of it (on Parker's league under his prizes the "Helps both"
 *       list led with Puka Nacua + Marvin Harrison Jr. → Drake London + Christian Watson, B 1.454 at 24.7%, then Puka
 *       Nacua → Drake London + Christian Watson, B 1.440 at 27.2%). So after the pass the kept cards are read in Overall
 *       order, and one that is filler of an earlier card that stays leaves (as that order's own pass would drop it); the
 *       trades are ranked again without the cards that left (the freed places go to the next trades). ⚠️ That can still cost
 *       a smaller trade its place, when the trades that take the freed places fill a cap it needs (final review of
 *       Checkpoint 7c, engine-rank-hb3-late-filler: on a made-up league with 2 players a side, the bigger variant left and
 *       its smaller trade then hit its partner's cap, so neither showed). So, once no kept card is filler of another, a card
 *       that left comes back when the ranking keeps none of its smaller trades, and they leave instead, for good: beside it
 *       each would make it filler again, and none made the list without it. Rounds until nothing changes (fillerRounds); a
 *       card leaves and comes back at most once each, so the rounds end. In Overall order the pass already drops every such
 *       card (the smaller trade comes first), so that list is ranked once, exactly as before. A bigger variant whose smaller
 *       trade the other rules leave out stays. Checkpoint 7f (merged cards; search.ts, "Merged cards"): the trades
 *       RankOptions.shownElsewhere names, folded into another card's "How to offer it", count as kept trades for this rule
 *       alone (a variant of one that only adds a filler player leaves, as it would beside the card it was), never for a
 *       place or a cap; since Checkpoint 7g so do the versions a better one of the same trade dropped (search.ts, "Merged
 *       cards, Checkpoint 7g"), which read this rule's relation (smallerVersion: versionsOfSameTrade);
 *    b. core: perCore kept trades already share its core, the highest-value asset on each side (`value`: the
 *       perception value; ties and unknown values: the smaller asset id; an empty side has no core asset);
 *    c. partner cap: while fewer than partnerCapTop (20, §13's "top 20") trades are kept, its partner already has
 *       perPartnerInTop20 of them. Past the first 20, a partner may have more;
 *    d. given-player cap (planner reply to Checkpoint 4, change 6 and answer 7: the live top ideas mostly sold one
 *       player of mine, Garrett Wilson in 15 of 22): in the same top-20 window, a player of mine it gives is already
 *       given by perGivenPlayerInTop20 of the trades kept (counted per player on my side, picks aside: a 2-for-1 counts
 *       for both of my players). Past the first 20, a player may be given in more. ⚠️ Players in
 *       RankOptions.givenCapExempt are never counted nor checked (review of track SR, finding 1: the search passes my
 *       must-include players, whom every trade gives because the user asked, so the cap cut such a list to
 *       perGivenPlayerInTop20 cards whatever else qualified: 3 cards with Garrett Wilson must-include on Parker's league,
 *       22 without counting him; the search's one-partner rule drops the partner cap for the same reason).
 *    A trade more than one rule would drop is counted once, under the first rule in that order.
 * 3. It stops once resultsShown trades are kept; the trades after that are neither kept nor counted as dropped.
 */
import { displayAcceptance } from "./acceptance";
import { expectedGain, helpsBoth } from "./benefit";
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

/** A ranking's per-call options (the user's settings, not config). */
export interface RankOptions {
  /**
   * Phase 4c (planner reply to Checkpoint 4b, change 10): the minimum P_complete a trade needs to be kept, as the card
   * prints it, applied before the diversity rules (the file header, step 1; meetsMinChance); TradeSettings.minChance.
   * 0 (Any) or absent: no minimum.
   */
  readonly minChance?: number;
  /**
   * ⚠️ Players of mine the given-player cap neither counts nor checks (the file header, rule d): the search's must-include
   * players of mine, in every trade by the user's choice. Absent or empty: every player of mine counts.
   */
  readonly givenCapExempt?: readonly string[];
  /**
   * Checkpoint 7c (planner reply to Checkpoint 7b, §7, the "Helps both" list): the order the trades go through the diversity
   * rules in, which is the list's order: "overall" (the default: EG, sortTrades "overall") or "helps" (B, highest first:
   * sortTrades "helps"). The file header, step 2.
   */
  readonly order?: "overall" | "helps";
  /**
   * Checkpoint 7c: only the trades this keeps can be shown (benefit.helpsBoth for the "Helps both" list), judged after the §10
   * guards and before the minimum chance; the others the guards keep are counted (RankedTrades.notKept). Absent: every trade.
   */
  readonly keep?: (trade: TradeEvaluation) => boolean;
  /**
   * Checkpoint 7f (planner reply to Checkpoint 7e, decision 3; search.ts, "Merged cards"): trades the list shows elsewhere,
   * folded into another card's "How to offer it". The filler rule reads them as kept trades (the file header, rule a: a
   * variant of one that only adds a filler player leaves, as it would beside the card it was), but they take no place and
   * count for no cap (⚠️ the lead's call: counted for the caps too, the places they free mostly couldn't be filled). One
   * that isn't legal or has no known B is ignored. Absent: none.
   */
  readonly shownElsewhere?: readonly TradeEvaluation[];
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

/** Float noise in the minimum-chance comparison (not a tunable). */
const EPS = 1e-9;

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

/**
 * Overall order (sortTrades "overall": EG highest first, then the key), as a comparator: negative when `a` comes first. The
 * merge's "the card with the higher Overall" (Checkpoint 7f; search.ts, "Merged cards") reads it, so it agrees with the order
 * the Overall list is in.
 */
export function compareOverall(a: TradeEvaluation, b: TradeEvaluation): number {
  return byGainThenKey(a, b);
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
  else if (sort === "helpsBoth") compare = (a, b) => Number(helpsBoth(b)) - Number(helpsBoth(a)) || descending(a.b, b.b) || byGainThenKey(a, b);
  else compare = byGainThenKey;
  return [...trades].sort(compare);
}

export interface RankedTrades {
  /**
   * The top config.search.resultsShown, Overall order (RankOptions.order's: Helps-you order under "helps"), after the
   * hidden-by-default guards, RankOptions.keep, the minimum chance and the diversity rules.
   */
  trades: TradeEvaluation[];
  /**
   * Kept out by default (§10): B ≤ 0, or g_mkt(me) below marketHideBelow; and (Phase 4c) kept out by the minimum chance:
   * P_complete, as the card prints it, under RankOptions.minChance (byChance, counted only for trades the guards keep; 0
   * without a minimum).
   */
  hidden: { byBenefit: number; byMarket: number; byChance: number };
  /** Phase 4c: the trades that pass the guards and the minimum chance, before the diversity rules (the filter's "qualifying"). */
  qualifying: number;
  /**
   * Dropped by the diversity rules (§13): over the per-partner cap in the top 20, over the per-core cap, filler variants,
   * and over the given-player cap in the top 20 (givenPlayer; planner reply to Checkpoint 4, answer 7).
   */
  dropped: { partnerCap: number; core: number; filler: number; givenPlayer: number };
  /**
   * Checkpoint 7c: the trades the guards keep that RankOptions.keep turned away (a "Helps both" ranking: the ones that don't
   * help both teams). Present only when the call passes `keep`.
   */
  notKept?: number;
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
  /** The players of mine it gives (each once; picks and RankOptions.givenCapExempt aside): the given-player cap counts them. */
  given: string[];
  b: number;
}

/** Whether `small`'s assets are a proper subset of `big`'s (side by side). */
function properSubset(small: ReadonlySet<string>, big: ReadonlySet<string>): boolean {
  if (small.size >= big.size) return false;
  for (const a of small) if (!big.has(a)) return false;
  return true;
}

/** A trade's side-tagged asset ids ("give:…", "get:…"): what the filler rule and the versions of a trade compare. */
function tradeAssets(proposal: Pick<TradeEvaluation["proposal"], "give" | "get">): Set<string> {
  return new Set([...proposal.give.map((a) => `give:${assetId(a)}`), ...proposal.get.map((a) => `get:${assetId(a)}`)]);
}

/**
 * Whether `small` is a smaller version of `big`: the same partner, and `small`'s assets (side by side) a proper subset of
 * `big`'s. One relation for the filler rule (rule a: a filler variant is a bigger version of a kept trade) and, since
 * Checkpoint 7g, the dropped versions (versionsOfSameTrade; search.ts, "Merged cards, Checkpoint 7g").
 */
function smallerVersion(small: Pick<Candidate, "partnerId" | "assets">, big: Pick<Candidate, "partnerId" | "assets">): boolean {
  return small.partnerId === big.partnerId && properSubset(small.assets, big.assets);
}

/**
 * Whether two trades are versions of the same trade (Checkpoint 7g; planner reply to Checkpoint 7f, answer 3(c): "Drop a
 * version when another version of the same trade is at least as good on both Helps you and the chance."; search.ts drops
 * them): either is a smaller version of the other (smallerVersion, the filler rule's relation).
 */
export function versionsOfSameTrade(a: Pick<TradeEvaluation, "proposal">, b: Pick<TradeEvaluation, "proposal">): boolean {
  const va = { partnerId: a.proposal.partnerId, assets: tradeAssets(a.proposal) };
  const vb = { partnerId: b.proposal.partnerId, assets: tradeAssets(b.proposal) };
  return smallerVersion(va, vb) || smallerVersion(vb, va);
}

/**
 * Whether `c` is a filler variant of `k` (the file header, rule a): a bigger version of `k` (smallerVersion: the same partner,
 * `k`'s assets plus more), B within fillerCutoffFraction × B_k (or ⚠️ R5: no more helpful and less likely), and ranked below
 * `k` in Overall order (⚠️ HB-3: judged in that order whatever order the list goes in, so the same pairs are filler in every
 * list).
 */
function fillerOf(c: Candidate, k: Candidate, cutoff: number): boolean {
  return (
    smallerVersion(k, c) &&
    (Math.abs(c.b - k.b) < cutoff * k.b || (c.b <= k.b && c.trade.pComplete < k.trade.pComplete)) &&
    byGainThenKey(c.trade, k.trade) > 0
  );
}

/**
 * One greedy pass of the diversity rules (the file header, step 2) over `candidates` in the list's order; `elsewhere`, the
 * trades shown elsewhere (RankOptions.shownElsewhere), are kept trades for the filler rule alone.
 */
function diversify(candidates: readonly Candidate[], cfg: RankConfig, givenCap: number, elsewhere: readonly Candidate[]): { kept: Candidate[]; dropped: RankedTrades["dropped"] } {
  const dropped = { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 };
  const kept: Candidate[] = [];
  const perCore = new Map<string, number>();
  const perPartnerTop = new Map<string, number>();
  const perGivenTop = new Map<string, number>();
  const limit = Math.max(0, Math.floor(cfg.resultsShown));
  for (const c of candidates) {
    if (kept.length >= limit) break;
    if (kept.some((k) => fillerOf(c, k, cfg.fillerCutoffFraction)) || elsewhere.some((k) => fillerOf(c, k, cfg.fillerCutoffFraction))) {
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
  return { kept, dropped };
}

/**
 * Whether a trade's P_complete reaches the minimum chance as the card prints it (the file header, step 1:
 * acceptance.displayAcceptance, the nearest 5%; float noise counts as at it). A minimum of 0 (Any), or none, holds for
 * every trade.
 */
export function meetsMinChance(pComplete: number, minChance: number | undefined): boolean {
  if (!isFiniteNumber(minChance) || !(minChance > 0)) return true;
  return isFiniteNumber(pComplete) && displayAcceptance(pComplete) >= minChance - EPS;
}

/**
 * §13's ranking and diversity on evaluated trades (the file header). `value` gives an asset's perception value (the
 * core of a trade is its highest-value asset on each side). `cfg` defaults to config; `opts.minChance` is the user's
 * minimum chance (none by default), `opts.givenCapExempt` the players of mine the given-player cap skips (none by
 * default).
 */
export function rankTrades(evaluations: readonly TradeEvaluation[], value: (asset: TradeAsset) => number, cfg: RankConfig = DEFAULT_RANK_CONFIG, opts: RankOptions = {}): RankedTrades {
  const hidden = { byBenefit: 0, byMarket: 0, byChance: 0 };
  const givenCap = cfg.perGivenPlayerInTop20 ?? config.ranking.perGivenPlayerInTop20;
  const exempt = new Set(opts.givenCapExempt ?? []);
  const byKey = new Map<string, TradeEvaluation>();
  for (const e of evaluations) {
    const kept = byKey.get(e.key);
    if (kept === undefined || preferred(e, kept) < 0) byKey.set(e.key, e);
  }
  const shown: TradeEvaluation[] = [];
  let notKept = 0;
  for (const e of sortTrades([...byKey.values()], opts.order ?? "overall")) {
    if (e.illegal !== null) continue;
    if (!helpsYou(e)) hidden.byBenefit++;
    else if (e.gMine < cfg.marketHideBelow) hidden.byMarket++;
    else if (opts.keep && !opts.keep(e)) notKept++;
    else if (!meetsMinChance(e.pComplete, opts.minChance)) hidden.byChance++;
    else shown.push(e);
  }
  const qualifying = shown.length;

  const candidateOf = (trade: TradeEvaluation): Candidate => {
    const give = trade.proposal.give;
    const get = trade.proposal.get;
    return {
      trade,
      partnerId: trade.proposal.partnerId,
      assets: tradeAssets(trade.proposal),
      core: `${coreAsset(give, value)}|${coreAsset(get, value)}`,
      given: [...new Set(give.flatMap((a) => (a.kind === "player" && !exempt.has(a.id) ? [a.id] : [])))],
      b: trade.b as number,
    };
  };
  const candidates: Candidate[] = shown.map(candidateOf);
  // Checkpoint 7f: the trades shown elsewhere, for the filler rule alone (RankOptions.shownElsewhere).
  const elsewhere: Candidate[] = (opts.shownElsewhere ?? []).filter((t) => t.illegal === null && isFiniteNumber(t.b)).map(candidateOf);
  const pass = fillerRounds(candidates, cfg, givenCap, elsewhere);
  return { trades: pass.kept.map((k) => k.trade), hidden, qualifying, dropped: pass.dropped, ...(opts.keep ? { notKept } : {}) };
}

/**
 * The diversity rules, then (⚠️ HB-3, the file header, rule a) rounds until nothing changes, each card that leaves counted as
 * filler:
 * 1. The kept cards in Overall order: one that is filler of an earlier one that stays leaves (`late`), judged as the Overall
 *    order's own pass judges it.
 * 2. When none does: the first card that left, in the list's order, none of whose smaller trades (the cards it is filler of:
 *    fillerOf) the ranking keeps comes back, and those smaller trades leave instead, for good (`out`): beside it each would
 *    make it filler again, and none made the list without it (final review of Checkpoint 7c, engine-rank-hb3-late-filler).
 *    Judged only on a ranking with no filler left, so a smaller trade that a filler about to leave keeps out isn't given up.
 * Then the trades are ranked again without the cards that left. A card leaves at most once (once it comes back its smaller
 * trades are out, so it is filler of no card the ranking can keep) and comes back at most once, so the rounds end. In Overall
 * order the first pass leaves none. `elsewhere` (RankOptions.shownElsewhere) goes to every pass: a candidate that is filler
 * of one of them leaves in the pass itself (it is checked against them whatever the list's order), so it is never among the
 * cards that leave here, and none of them is a smaller trade a card can come back for.
 */
function fillerRounds(candidates: readonly Candidate[], cfg: RankConfig, givenCap: number, elsewhere: readonly Candidate[]): { kept: Candidate[]; dropped: RankedTrades["dropped"] } {
  const late = new Set<string>();
  const out = new Set<string>();
  const parents = new Map<string, Candidate[]>();
  const parentsOf = (c: Candidate): Candidate[] => {
    let ps = parents.get(c.trade.key);
    if (ps === undefined) {
      ps = candidates.filter((k) => fillerOf(c, k, cfg.fillerCutoffFraction));
      parents.set(c.trade.key, ps);
    }
    return ps;
  };
  let pass = diversify(candidates, cfg, givenCap, elsewhere);
  for (;;) {
    // 1. Every kept card that is filler of an earlier one that stays, in Overall order.
    const stay: Candidate[] = [];
    let left = 0;
    for (const c of [...pass.kept].sort((a, b) => byGainThenKey(a.trade, b.trade))) {
      if (stay.some((k) => fillerOf(c, k, cfg.fillerCutoffFraction))) {
        late.add(c.trade.key);
        left++;
      } else stay.push(c);
    }
    if (!left) {
      // 2. The first card that left, in the list's order, whose smaller trades the ranking keeps none of (not one left out itself).
      const kept = new Set(pass.kept.map((k) => k.trade.key));
      const back = candidates.find((c) => late.has(c.trade.key) && !out.has(c.trade.key) && !parentsOf(c).some((k) => kept.has(k.trade.key)));
      if (!back) break;
      late.delete(back.trade.key);
      for (const k of parentsOf(back)) out.add(k.trade.key);
    }
    pass = diversify(
      candidates.filter((c) => !late.has(c.trade.key) && !out.has(c.trade.key)),
      cfg,
      givenCap,
      elsewhere,
    );
  }
  const removed = new Set([...late, ...out]).size;
  return { kept: pass.kept, dropped: { ...pass.dropped, filler: pass.dropped.filler + removed } };
}

/**
 * The trades that help both teams (benefit.helpsBoth, on the printed scores), in Helps-you order (sortTrades "helps"): the
 * "Helps both" sort read from a list alone, with no ranking of its own (no guards, minimum or caps beyond the list's). A
 * page reads the engine's own list (TradeSearchResult.helpsBoth, the search's ranking) and falls back on this for a result
 * without one. Returns a new array.
 */
export function helpsBothTrades(trades: readonly TradeEvaluation[]): TradeEvaluation[] {
  return sortTrades(trades.filter((t) => helpsBoth(t)), "helps");
}
