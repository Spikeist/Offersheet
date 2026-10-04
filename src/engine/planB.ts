/**
 * Plan B, "If they say no, try:" (CLAUDE.md §13; planner reply to Checkpoint 4, change 6; Phase 4b design, track F
 * rule 2, and the review of track F). Pure and deterministic: no I/O, no clock; its numbers come from config.search.
 * planB, config.search.steps.minAcceptGain and config.ranking.perGivenPlayerInTop20. The trade search (search.ts) asks
 * for one for each trade it shows without "Offer first / if they say no" steps (a card with a qualifying throw-in step
 * already has its "try again"); the Trade Analyzer gives none (⚠️ ours: a trade built by hand has no list of evaluated
 * alternatives behind it).
 *
 * Candidates (planBCandidates): the search's exactly evaluated trades, each with its best numbers (the final
 * simulation's for a finalist, else the screening simulation's), other than the card itself and ⚠️ any other trade the
 * list shows as a card, above or below it (final review of Phase 4b: a box naming another card is circular, the user
 * sees that card anyway; on Parker's league, the 2026-10-03 21:29Z dump, 2 of 6 boxes on the main list did, and 11 of 15
 * on the one-partner lists of Teams 8, 4 and 9, 10 of them the first card), with the card's partner (any other trade
 * with that team differs from the card in at least one player), that pass the rules on those numbers (planBPasses):
 * - legal, and it helps me: B known and above 0 (so its Helps you and Overall are numbers);
 * - its Helps you (the Trade Score as the card prints it, a whole number) is at least minHelpsShare × the card's
 *   (⚠️ the printed numbers, so the rule agrees with what the user reads);
 * - not hidden by the market guard (flags.hiddenByMarket: g_mkt(me) below config.benefit.marketHideBelow);
 * - ⚠️ likelier to go through than the card: its P_complete at least minAcceptGain above the card's (review of track F:
 *   it's what you try after a no, so it must be easier to say yes to; on Parker's league, the 2026-10-03 21:29Z dump, the
 *   planner's rules alone, cards excluded, gave 15 of 17 cards a Plan B, 9 of them less likely to be accepted than their
 *   card, 8 of those no better on Overall and 3 worse on both Helps you and the chance, mostly the card with one more
 *   player of mine, Kyle Monangai in 11 boxes, that the steps had already turned down for not raising acceptance enough;
 *   with the rule, 6 of 17, all likelier, 5 distinct trades).
 *   The bar is config.search.steps.minAcceptGain (5 points), the steps' own "if they say no" bar: the planner calls
 *   Plan B the cards' "try again" step (answer 2), so both "if they say no" versions must clear the same bar. null
 *   turns the rule off (a report switch: the planner's rules as first read).
 * Order: a different package for the same players of theirs first ("samePlayers": the very same set of players I'd
 * get), then a different target ("otherTarget"); within each, the highest Overall (EG = B × P_complete: the planner's
 * "best"), then the key. A key counts once (its first entry in the pool).
 *
 * The choice (choosePlanB): the first candidate, in that order, that isn't passed over (`skip`, below) and whose numbers
 * on the final block of seasons (the card's basis) still pass the rules: a finalist's are its own (stage "final"); any
 * other is simulated on that block first (the caller's `finalOf`). One that fails is passed over; at most `tries`
 * candidates are tried (a skipped one isn't tried: it needs no simulation). ⚠️ A candidate's place comes from mixed
 * numbers (the finalists' final ones, the others' screening ones), as the design reads; the chosen one's are final.
 *
 * The given-player cap on the boxes (⚠️ ours, review of track F; planner reply to Checkpoint 4, answer 7: "Same player
 * given in many ideas: cap it at 3 in the top 20", which rank.ts applies to the cards): the boxes offer my players too,
 * and the "likelier" fallback is most often the card plus one cheap player of mine the partner's market values more than
 * my lineup does (on Parker's Oct 3 data, before this cap and before cards were excluded, Kyle Monangai was added in 6
 * of 9 boxes on top of his 3 cards, and Bo Nix in 4 of 7 once the trades shared out free agents too; on the 21:29Z dump
 * with cards excluded the cap binds nowhere: Monangai 3, Garrett Wilson 2, Bo Nix 1). So the boxes keep to the cap
 * among themselves: a candidate is skipped when a player of mine it gives that its card doesn't (addedGiven: the offers
 * it adds; a player it shares with its card is the same offer, as an
 * alternative) is already added by givenPlayerCap of the boxes chosen so far for the cards in the cap's top-20 window
 * (search.ts counts them, in the cards' order). ⚠️ The cards' own offers aren't counted against the boxes: with them,
 * every fallback on Parker's league (Oct 3) added a player already in 3 cards, so no card kept a Plan B at all. Plan Bs
 * of cards past that window are uncapped and uncounted, like the cards there. null turns it off (a report switch).
 * ⚠️ Two cards may show the same box (the same fallback for two offers to one team: 6 boxes, 5 distinct trades on the
 * main list; on one-partner lists 1–3 distinct per list), a question for the planner.
 *
 * Progress: choosePlanB is a generator that yields right before each simulation it asks for, so the search can report
 * progress (and a worker can stop it) between a card's steps and its Plan B's simulation.
 */
import { expectedGain } from "./benefit";
import { config } from "./config";
import type { PlanB, TradeAsset, TradeEvaluationCore, TradeProposal } from "./tradeModel";

/** Plan B's rules (the file header), widened so tests and reports can pass other numbers. */
export interface PlanBConfig {
  /** A Plan B's Helps you is at least this share of the card's (config.search.planB.minHelpsShare). */
  readonly minHelpsShare: number;
  /** At most this many candidates are tried (each a simulation on the final block unless it was a finalist). */
  readonly tries: number;
  /**
   * ⚠️ A Plan B's P_complete is at least this much above the card's (config.search.steps.minAcceptGain: the file
   * header); null: no such rule (a report switch, TradeSearchOptions.planB).
   */
  readonly minAcceptGain: number | null;
  /**
   * ⚠️ The given-player cap on the Plan B boxes (config.ranking.perGivenPlayerInTop20: the file header); null: off (a
   * report switch). The search applies it (choosePlanB's `skip`); planBCandidates doesn't read it.
   */
  readonly givenPlayerCap: number | null;
}

/** Plan B's rules from config (§15; the file header). */
export function planBConfig(): PlanBConfig {
  const p = config.search.planB;
  return { minHelpsShare: p.minHelpsShare, tries: p.tries, minAcceptGain: config.search.steps.minAcceptGain, givenPlayerCap: config.ranking.perGivenPlayerInTop20 };
}

/** Float noise in comparisons (not a tunable). */
const EPS = 1e-9;

const isFiniteNumber = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

/** What the rules read of a trade's numbers. */
export type PlanBNumbers = Pick<TradeEvaluationCore, "illegal" | "b" | "tradeScore" | "overall" | "flags" | "pComplete">;

/**
 * Whether a trade's numbers pass Plan B's rules against the card (the file header): legal, B > 0 (Helps you and Overall
 * known), Helps you at least minHelpsShare × the card's, not hidden by the market guard, and (unless cfg.minAcceptGain is
 * null) a P_complete at least minAcceptGain above the card's. False when the card's Helps you isn't a number.
 */
export function planBPasses(candidate: PlanBNumbers, card: Pick<TradeEvaluationCore, "tradeScore" | "pComplete">, cfg: PlanBConfig = planBConfig()): boolean {
  if (candidate.illegal !== null) return false;
  if (!isFiniteNumber(candidate.b) || !(candidate.b > 0)) return false;
  if (candidate.flags.hiddenByMarket) return false;
  if (!isFiniteNumber(candidate.tradeScore) || !isFiniteNumber(candidate.overall) || !isFiniteNumber(card.tradeScore)) return false;
  const gain = cfg.minAcceptGain;
  if (gain !== null && isFiniteNumber(gain) && !(isFiniteNumber(candidate.pComplete) && isFiniteNumber(card.pComplete) && candidate.pComplete >= card.pComplete + gain - EPS)) return false;
  return candidate.tradeScore >= cfg.minHelpsShare * card.tradeScore - EPS;
}

/** A side's assets as a key that ignores their order. */
function sideKey(assets: readonly TradeAsset[]): string {
  return assets
    .map((a) => (a.kind === "player" ? a.id : `pick:${a.season}:${a.round}:${a.originalTeamId}`))
    .sort()
    .join(",");
}

/** The players of mine a trade gives, each once, in its order (picks aside). */
export function givenPlayers(p: Pick<TradeProposal, "give">): string[] {
  return [...new Set(p.give.flatMap((a) => (a.kind === "player" ? [a.id] : [])))];
}

/** The players of mine `candidate` gives that `card` doesn't (the file header: the offers a Plan B adds on screen). */
export function addedGiven(card: Pick<TradeProposal, "give">, candidate: Pick<TradeProposal, "give">): string[] {
  const own = new Set(givenPlayers(card));
  return givenPlayers(candidate).filter((id) => !own.has(id));
}

/** A Plan B candidate: a trade with its best numbers, and whether it's for the same players of theirs. */
export interface PlanBCandidate {
  core: TradeEvaluationCore;
  kind: PlanB["kind"];
}

/**
 * The given-player cap's skip test for one card's Plan B (the file header): a candidate is skipped when a player of mine
 * it adds (addedGiven) is already added by `cap` of the boxes chosen so far (`inBoxes`: player id → boxes that add him).
 * Undefined when the cap is off (null or not a number).
 */
export function givenCapSkip(card: Pick<TradeProposal, "give">, inBoxes: ReadonlyMap<string, number>, cap: number | null): ((c: PlanBCandidate) => boolean) | undefined {
  if (cap === null || !isFiniteNumber(cap)) return undefined;
  return (c) => addedGiven(card, c.core.proposal).some((id) => (inBoxes.get(id) ?? 0) >= cap);
}

/**
 * Plan B's candidates for `card` among `pool` (the search's exact trades with their best numbers), best first (the file
 * header), never one of `shown` (the keys of the trades the list shows as cards: the file header).
 */
export function planBCandidates(card: TradeEvaluationCore, pool: readonly TradeEvaluationCore[], cfg: PlanBConfig = planBConfig(), shown: Iterable<string> = []): PlanBCandidate[] {
  const target = sideKey(card.proposal.get);
  const seen = new Set<string>([card.key, ...shown]);
  const found: (PlanBCandidate & { eg: number })[] = [];
  for (const core of pool) {
    if (seen.has(core.key)) continue;
    seen.add(core.key);
    if (core.proposal.partnerId !== card.proposal.partnerId || !planBPasses(core, card, cfg)) continue;
    found.push({ core, kind: sideKey(core.proposal.get) === target ? "samePlayers" : "otherTarget", eg: expectedGain(core.b, core.pComplete) ?? Number.NEGATIVE_INFINITY });
  }
  const tier = (c: PlanBCandidate) => (c.kind === "samePlayers" ? 0 : 1);
  found.sort((a, b) => tier(a) - tier(b) || (Math.abs(b.eg - a.eg) > EPS ? b.eg - a.eg : 0) || (a.core.key < b.core.key ? -1 : a.core.key > b.core.key ? 1 : 0));
  return found.map(({ core, kind }) => ({ core, kind }));
}

const copyProposal = (p: TradeProposal): TradeProposal => ({ partnerId: p.partnerId, give: p.give.map((a) => ({ ...a })), get: p.get.map((a) => ({ ...a })) });

/** A trade's Plan B from its numbers on the final block (planBPasses held: B, Helps you and Overall are numbers). */
function toPlanB(c: TradeEvaluationCore, kind: PlanB["kind"]): PlanB {
  return {
    proposal: copyProposal(c.proposal),
    key: c.key,
    b: c.b as number,
    tradeScore: c.tradeScore as number,
    pAccept: c.pAccept,
    pComplete: c.pComplete,
    acceptLabel: c.acceptLabel,
    overall: c.overall as number,
    kind,
  };
}

/**
 * The card's Plan B (the file header): the first of `candidates` (planBCandidates' order) that `skip` doesn't pass over
 * and whose numbers on the final block pass the rules, trying at most cfg.tries (a skipped candidate isn't tried); null
 * when none does. `finalOf` gives a candidate's numbers on the final block (the search: its cache of finalists' numbers,
 * else simulateTrade "final"); it's called only for a candidate whose numbers aren't final yet (stage other than
 * "final"), and the generator yields right before each such call.
 */
export function* choosePlanB(
  card: Pick<TradeEvaluationCore, "tradeScore" | "pComplete">,
  candidates: readonly PlanBCandidate[],
  finalOf: (core: TradeEvaluationCore) => TradeEvaluationCore,
  cfg: PlanBConfig = planBConfig(),
  skip?: (candidate: PlanBCandidate) => boolean,
): Generator<void, PlanB | null, void> {
  const tries = Math.max(0, Math.floor(cfg.tries));
  let tried = 0;
  for (const candidate of candidates) {
    if (tried >= tries) break;
    if (skip?.(candidate)) continue;
    tried++;
    let numbers = candidate.core;
    if (numbers.stage !== "final") {
      yield;
      numbers = finalOf(numbers);
    }
    if (planBPasses(numbers, card, cfg)) return toPlanB(numbers, candidate.kind);
  }
  return null;
}

/** choosePlanB run to the end on the calling thread (tests, scripts); `shown` as planBCandidates reads it. */
export function planBFor(
  card: TradeEvaluationCore,
  pool: readonly TradeEvaluationCore[],
  finalOf: (core: TradeEvaluationCore) => TradeEvaluationCore,
  cfg: PlanBConfig = planBConfig(),
  skip?: (candidate: PlanBCandidate) => boolean,
  shown: Iterable<string> = [],
): PlanB | null {
  const it = choosePlanB(card, planBCandidates(card, pool, cfg, shown), finalOf, cfg, skip);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}
