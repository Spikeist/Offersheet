/**
 * Plan B, "If they won't move: try …" ("If they say no, try:" until Checkpoint 7e) (CLAUDE.md §13; planner reply to Checkpoint 4, change 6; Phase 4b design, track F
 * rule 2, and the review of track F). Pure and deterministic: no I/O, no clock; its numbers come from config.search.
 * planB, config.search.steps.minAcceptGain and config.ranking.perGivenPlayerInTop20. The trade search (search.ts) asks
 * for one for every card it shows (since Checkpoint 7e, planner reply to Checkpoint 7d, item 4.1: "Plan B stays below the
 * list: 'If they won't move: try …', a different target", below "How to offer it", offers.ts, which never offers the box's
 * trade; until then only for a card without "Offer first / if they say no" steps, whose throw-in step was its "try again");
 * the Trade Analyzer gives none (⚠️ ours: a trade built by hand has no list of evaluated
 * alternatives behind it).
 *
 * Candidates (planBCandidates): the search's exactly evaluated trades, each with its best numbers (the final
 * simulation's for a finalist, else the screening simulation's), other than the card itself and ⚠️ the trades the search
 * bars from the boxes (planBCandidates' `shown`: search.ts barredFromBoxes, the one place the rule lives). Those are every
 * trade the list shows as a card, above or below it (final review of Phase 4b: a box naming another card is circular, the
 * user sees that card anyway; on Parker's league, the 2026-10-03 21:29Z dump, 2 of 6 boxes on the main list did, and 11
 * of 15 on the one-partner lists of Teams 8, 4 and 9, 10 of them the first card), and since Phase 4c a card plus more
 * players who don't make it config.search.steps.minAcceptGain likelier to go through (the same card again, no easier to
 * say yes to; players worth at most W at first, any player since the final review of Phase 4c, findings R2 and PAGES-1).
 * Since Checkpoint 7f the search counts a list's merged trades as its cards here (search.ts, "Merged cards": each is among a
 * card's offers), and in dominatedByCard's cards.
 * Candidates are with the card's partner (any other trade with that team differs
 * from the card in at least one player) and pass the rules on those numbers (planBPasses):
 * - legal, and it helps me: B known and above 0 (so its Helps you and Overall are numbers);
 * - its Helps you (the Trade Score as the card prints it, a whole number) is at least minHelpsShare × the card's
 *   (⚠️ the printed numbers, so the rule agrees with what the user reads; since Phase 7a every trade of a search is scored
 *   on the same B₃, evaluate.helpsScaleOf, so the two compare like for like);
 * - not hidden by the market guard (flags.hiddenByMarket: g_mkt(me) below config.benefit.marketHideBelow);
 * - ⚠️ likelier to go through than the card: its P_complete at least minAcceptGain above the card's (review of track F:
 *   it's what you try after a no, so it must be easier to say yes to; on Parker's league, the 2026-10-03 21:29Z dump, the
 *   planner's rules alone, cards excluded, gave 15 of 17 cards a Plan B, 9 of them less likely to be accepted than their
 *   card, 8 of those no better on Overall and 3 worse on both Helps you and the chance, mostly the card with one more
 *   player of mine, Kyle Monangai in 11 boxes, that the steps had already turned down for not raising acceptance enough;
 *   with the rule, 6 of 17, all likelier, 5 distinct trades).
 *   The bar is config.search.steps.minAcceptGain (5 points), the steps' own "if they say no" bar: the planner calls
 *   Plan B the cards' "try again" step (answer 2), so both "if they say no" versions must clear the same bar. null
 *   turns the rule off (a report switch: the planner's rules as first read);
 * - ⚠️ when the card helps both teams (benefit.ts helpsBoth: its "Helps both" tag, Helps you and Helps them each at least
 *   config.benefit.helpsThemMin, both as printed), it helps both too (Checkpoint 7c, ours: review of the "Helps both" engine
 *   track, finding HB-4; planner reply to Checkpoint 7b, §7). A box shows no "Helps them" line (the lead's call), so the
 *   "try again" under a card tagged "Helps both" must never be a trade that doesn't help them: on Parker's league under his
 *   prizes both Team 8 cards of the "Helps both" list offered Garrett Wilson → Christian Watson + Carnell Tate, Helps them 0,
 *   and on 42 synthetic leagues 21 of the 27 boxes on that list's cards didn't help both. A card that doesn't help both
 *   reads the rules as before.
 * Which: since Checkpoint 7e only a different target ("otherTarget": another set of the players I'd get; planner reply to
 * Checkpoint 7d, item 4.1: "Plan B stays below the list: 'If they won't move: try …', a different target"; the review of
 * wave D, findings D-ENG-5 and UI-D-5: a box for the card's own players of theirs, most often the card plus one player of
 * mine, is the card's "How to offer it" ladder's job, whose Last offer it is, and on Parker's leagues 6 of 17 boxes were),
 * the highest Overall (EG = B × P_complete: the planner's "best") first, then the key. Until then (PlanBConfig.
 * otherTargetOnly false, a report switch) a different package for the same players of theirs first ("samePlayers": the very
 * same set of players I'd get), then a different target, each tier in that order. A key counts once (its first entry in
 * the pool). ⚠️ Since Checkpoint 7g (planner reply to Checkpoint 7f, answer 3(a): the Last offer can ask for fewer of their
 * players; offers.ts) a box is never a smaller ask of its card (smallerAskOf: the card's players of mine for part of its
 * players of theirs) that the card's Last offer could take by its rules on both printed numbers (offers.ts offerFeasible
 * "smaller"): the search skips such a candidate once its printed numbers are known (search.ts finish; the narrow rule, the
 * lead's call D5), so the box and the Last offer never show one trade twice, and a box is still never an offer. One the Last
 * offer couldn't take (it keeps less than config.offers.lastMinOverallShare of the card's Overall, say) can still be a box.
 * ⚠️ The rule reads the two printed numbers only, not the Last offer the ladder picks, so a skipped candidate isn't always the
 * Last offer: when the ladder picks another version (a throw-in with a higher Overall, say), the skipped ask shows nowhere on
 * the card, and the box is the next candidate or none (search.ts, "Merged cards, Checkpoint 7g": smallLeague 32's card).
 *
 * The choice (choosePlanB): the first candidate, in that order, that isn't passed over (`skip`, below) and whose numbers
 * on the final block of seasons (the card's basis) still pass the rules: a finalist's are its own (stage "final"); any
 * other is simulated on that block first (the caller's `finalOf`), so a box under a card that helps both teams helps both
 * on its final numbers too. ⚠️ Nor may another card the list shows, with the same
 * partner, match or beat it on both Helps you (as printed) and P_complete (dominatedByCard; final review of Phase 4c,
 * finding R2): that card is the better "try again", and it's on the list already. One that fails is passed over; at most
 * `tries` candidates are tried (a skipped one isn't tried: it needs no simulation). ⚠️ A candidate's place comes from
 * mixed numbers (the finalists' final ones, the others' screening ones), as the design reads; the chosen one's are final.
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
 *
 * The chosen Plan B carries its numbers on the final block and (Phase 4c, planner reply to Checkpoint 4b, change 7) the
 * same evaluation's acceptance features and raw g_mkt(P) (PlanB.features, gPartner), which feedback stores when it's the
 * version sent, and (change 9, "real odds on every card") its odds from that same final-block simulation (PlanB.dPO, dCH,
 * since Checkpoint 7c every prize component's change, dPrizes, and winChance: the box prints "Title odds a → b · Playoff
 * odds a → b" and the weekly line as the card prints its own,
 * from the same "before"; a re-filter reuses the simulation, search.ts finalByKey, so its odds equal a fresh search's).
 * The minimum chance (Phase 4c, change 10) needs no rule here: a Plan B is at least minAcceptGain likelier
 * to go through than its card, which the minimum let through (on the chance as printed, rank.ts: a card printing at the
 * bar is at most half a display step under it, less than minAcceptGain), so it prints at or above the minimum too; ⚠️ not
 * under the report switch minAcceptGain null, which can pick a Plan B under it.
 */
import { expectedGain, helpsBoth } from "./benefit";
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
  /**
   * Checkpoint 7e (the file header, "Which"): only a different target (absent or true); false, the rule before, the same
   * players of theirs first (a report switch, TradeSearchOptions.planB).
   */
  readonly otherTargetOnly?: boolean;
}

/** Plan B's rules from config (§15; the file header). */
export function planBConfig(): PlanBConfig {
  const p = config.search.planB;
  return { minHelpsShare: p.minHelpsShare, tries: p.tries, minAcceptGain: config.search.steps.minAcceptGain, givenPlayerCap: config.ranking.perGivenPlayerInTop20, otherTargetOnly: true };
}

/** Float noise in comparisons (not a tunable). */
const EPS = 1e-9;

const isFiniteNumber = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

/** What the rules read of a trade's numbers (`them`, the partner's: only for a card that helps both teams). */
export type PlanBNumbers = Pick<TradeEvaluationCore, "illegal" | "b" | "tradeScore" | "overall" | "flags" | "pComplete" | "them">;

/** What the rules read of the card's numbers (`them`: whether it helps both teams, the "Helps both" rule). */
export type PlanBCard = Pick<TradeEvaluationCore, "tradeScore" | "pComplete" | "them">;

/**
 * Whether a trade's numbers pass Plan B's rules against the card (the file header): legal, B > 0 (Helps you and Overall
 * known), Helps you at least minHelpsShare × the card's, not hidden by the market guard, (unless cfg.minAcceptGain is
 * null) a P_complete at least minAcceptGain above the card's, and ⚠️ (Checkpoint 7c) helping both teams when the card does
 * (benefit.helpsBoth on both). False when the card's Helps you isn't a number.
 */
export function planBPasses(candidate: PlanBNumbers, card: PlanBCard, cfg: PlanBConfig = planBConfig()): boolean {
  if (candidate.illegal !== null) return false;
  if (!isFiniteNumber(candidate.b) || !(candidate.b > 0)) return false;
  if (candidate.flags.hiddenByMarket) return false;
  if (!isFiniteNumber(candidate.tradeScore) || !isFiniteNumber(candidate.overall) || !isFiniteNumber(card.tradeScore)) return false;
  const gain = cfg.minAcceptGain;
  if (gain !== null && isFiniteNumber(gain) && !(isFiniteNumber(candidate.pComplete) && isFiniteNumber(card.pComplete) && candidate.pComplete >= card.pComplete + gain - EPS)) return false;
  if (helpsBoth(card) && !helpsBoth(candidate)) return false;
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

/**
 * Whether `candidate` is a smaller ask of `card` (Checkpoint 7g; the file header, "Which"; offers.ts smallerAsks): the same
 * partner, the same players of mine, and a proper, non-empty part of its players of theirs.
 */
export function smallerAskOf(card: Pick<TradeProposal, "partnerId" | "give" | "get">, candidate: Pick<TradeProposal, "partnerId" | "give" | "get">): boolean {
  if (card.partnerId !== candidate.partnerId || sideKey(card.give) !== sideKey(candidate.give)) return false;
  const theirs = new Set(card.get.map((a) => sideKey([a])));
  const asked = candidate.get.map((a) => sideKey([a]));
  return asked.length > 0 && asked.length < theirs.size && new Set(asked).size === asked.length && asked.every((id) => theirs.has(id));
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
 * header), never one of `shown` (the keys barred from the boxes: search.ts barredFromBoxes, the cards and the cards plus
 * cheap players who don't make them likelier; the file header).
 */
export function planBCandidates(card: TradeEvaluationCore, pool: readonly TradeEvaluationCore[], cfg: PlanBConfig = planBConfig(), shown: Iterable<string> = []): PlanBCandidate[] {
  const target = sideKey(card.proposal.get);
  const seen = new Set<string>([card.key, ...shown]);
  const found: (PlanBCandidate & { eg: number })[] = [];
  for (const core of pool) {
    if (seen.has(core.key)) continue;
    seen.add(core.key);
    if (core.proposal.partnerId !== card.proposal.partnerId || !planBPasses(core, card, cfg)) continue;
    const kind: PlanB["kind"] = sideKey(core.proposal.get) === target ? "samePlayers" : "otherTarget";
    // Since Checkpoint 7e a different target only (the file header, "Which").
    if (kind === "samePlayers" && cfg.otherTargetOnly !== false) continue;
    found.push({ core, kind, eg: expectedGain(core.b, core.pComplete) ?? Number.NEGATIVE_INFINITY });
  }
  const tier = (c: PlanBCandidate) => (c.kind === "samePlayers" ? 0 : 1);
  found.sort((a, b) => tier(a) - tier(b) || (Math.abs(b.eg - a.eg) > EPS ? b.eg - a.eg : 0) || (a.core.key < b.core.key ? -1 : a.core.key > b.core.key ? 1 : 0));
  return found.map(({ core, kind }) => ({ core, kind }));
}

const copyProposal = (p: TradeProposal): TradeProposal => ({ partnerId: p.partnerId, give: p.give.map((a) => ({ ...a })), get: p.get.map((a) => ({ ...a })) });

/**
 * A trade's Plan B from its numbers on the final block (planBPasses held: B, Helps you and Overall are numbers), with its
 * acceptance features and raw g_mkt(P) (Phase 4c, planner reply to Checkpoint 4b, change 7: feedback stores the sent
 * version's model inputs; from the same evaluation as the numbers), and its odds from the same simulation (change 9: ΔPO,
 * ΔCH and my win chance by week, the box's odds lines), copied only when the numbers are the final block's (stage
 * "final", the card's basis: the search's always are; a test's finalOf may hand back other numbers).
 */
function toPlanB(c: TradeEvaluationCore, kind: PlanB["kind"]): PlanB {
  const final = c.stage === "final";
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
    features: { ...c.features },
    gPartner: c.gPartner,
    ...(final ? { dPO: c.dPO, dCH: c.dCH, ...(c.dPrizes !== undefined ? { dPrizes: c.dPrizes && { ...c.dPrizes } } : {}) } : {}),
    ...(final && c.detail.winChance ? { winChance: c.detail.winChance.map((w) => ({ ...w })) } : {}),
  };
}

/** A card the list shows, as dominatedByCard reads it. */
export type ShownCard = Pick<TradeEvaluationCore, "key" | "proposal" | "tradeScore" | "pComplete">;

/**
 * Whether a card the list shows, another trade with the same partner, matches or beats `candidate` on both Helps you (the
 * Trade Score as printed, as minHelpsShare reads it) and the chance it goes through (P_complete): then that card is at
 * least as good a "try again" as the box would be, and the user already sees it (⚠️ ours, final review of Phase 4c,
 * finding R2: on Parker's league, Oct 4 09:24Z, the box Garrett Wilson → Tee Higgins + Mike Evans, 25 and 32.0%, sat on a
 * card for Team 4 while the list showed Garrett Wilson → Chuba Hubbard + Mike Evans, 30 and 36.1%, with the same team).
 * Numbers that aren't finite never dominate.
 */
export function dominatedByCard(candidate: ShownCard, cards: readonly ShownCard[]): boolean {
  if (!isFiniteNumber(candidate.tradeScore) || !isFiniteNumber(candidate.pComplete)) return false;
  return cards.some(
    (c) =>
      c.key !== candidate.key &&
      c.proposal.partnerId === candidate.proposal.partnerId &&
      isFiniteNumber(c.tradeScore) &&
      isFiniteNumber(c.pComplete) &&
      c.tradeScore >= (candidate.tradeScore as number) &&
      c.pComplete >= (candidate.pComplete as number) - EPS,
  );
}

/**
 * The card's Plan B (the file header): the first of `candidates` (planBCandidates' order) that `skip` doesn't pass over
 * and whose numbers on the final block pass the rules and that no card of `cards` (the list's cards; dominatedByCard)
 * matches or beats, trying at most cfg.tries (a skipped candidate isn't tried); null when none does. `finalOf` gives a
 * candidate's numbers on the final block (the search: its cache of finalists' numbers, else simulateTrade "final"); it's
 * called only for a candidate whose numbers aren't final yet (stage other than "final"), and the generator yields right
 * before each such call.
 */
export function* choosePlanB(
  card: PlanBCard,
  candidates: readonly PlanBCandidate[],
  finalOf: (core: TradeEvaluationCore) => TradeEvaluationCore,
  cfg: PlanBConfig = planBConfig(),
  skip?: (candidate: PlanBCandidate) => boolean,
  cards: readonly ShownCard[] = [],
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
    if (planBPasses(numbers, card, cfg) && !dominatedByCard(numbers, cards)) return toPlanB(numbers, candidate.kind);
  }
  return null;
}

/** choosePlanB run to the end on the calling thread (tests, scripts); `shown` as planBCandidates reads it, `cards` as choosePlanB. */
export function planBFor(
  card: TradeEvaluationCore,
  pool: readonly TradeEvaluationCore[],
  finalOf: (core: TradeEvaluationCore) => TradeEvaluationCore,
  cfg: PlanBConfig = planBConfig(),
  skip?: (candidate: PlanBCandidate) => boolean,
  shown: Iterable<string> = [],
  cards: readonly ShownCard[] = [],
): PlanB | null {
  const it = choosePlanB(card, planBCandidates(card, pool, cfg, shown), finalOf, cfg, skip, cards);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}
